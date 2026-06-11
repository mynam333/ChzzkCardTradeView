'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Ban,
  Check,
  MessageCircle,
  PanelLeftOpen,
  RefreshCw,
  Search,
  Send,
  Shield,
  Trash2,
  UserPlus,
  Users,
  X
} from 'lucide-react';
import { API_BASE_URL, apiFetch } from '@/lib/api';
import { useApp } from './AppContext';

type FriendUser = {
  id: string;
  username: string;
  avatar_url: string;
  role?: 'USER' | 'ADMIN';
};

type FriendRequest = {
  id: number;
  requester_id: string;
  receiver_id: string;
  status: 'pending' | 'accepted' | 'rejected' | 'canceled';
  requester?: FriendUser;
  receiver?: FriendUser;
  created_at: string;
};

type ChatMessage = {
  id: number;
  room_id: number;
  sender_id: string;
  body: string;
  created_at: string;
  read_at?: string | null;
};

type ChatRoom = {
  id: number;
  other_user: FriendUser;
  last_message?: ChatMessage | null;
  unread_count: number;
  can_send: boolean;
  closed_at?: string | null;
  is_admin_room?: boolean;
};

type DraftChatRoom = {
  id: `draft-${string}`;
  draft: true;
  other_user: FriendUser;
  unread_count: 0;
  can_send: true;
  last_message: null;
};

type ActiveChatRoom = ChatRoom | DraftChatRoom;

type ChatSocketPayload =
  | { type: 'ready'; user_id: string }
  | { type: 'joined'; room: ChatRoom; messages: ChatMessage[] }
  | { type: 'messages'; room_id: number; messages: ChatMessage[] }
  | { type: 'message' | 'sent'; room_id: number; message: ChatMessage }
  | { type: 'read'; room_id: number; reader_id: string }
  | { type: 'error'; code?: string; message?: string };

type FriendOverview = {
  friends: FriendUser[];
  requests: { incoming: FriendRequest[]; outgoing: FriendRequest[] };
  rooms: ChatRoom[];
};

type ContextMenuState =
  | { x: number; y: number; kind: 'friend'; friend: FriendUser }
  | { x: number; y: number; kind: 'room'; room: ChatRoom }
  | null;

const avatarFallback = (id: string) => `https://api.dicebear.com/10.x/fun-emoji/svg?seed=${encodeURIComponent(id)}`;
const isDraftRoom = (room: ActiveChatRoom | null): room is DraftChatRoom => Boolean(room && 'draft' in room);
const parseChatDate = (value?: string) => {
  if (!value) return null;
  const timezoneLessDateTime = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/;
  const normalized = timezoneLessDateTime.test(value) ? `${value.replace(' ', 'T')}Z` : value;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const FriendTab: React.FC = () => {
  const { user, toast } = useApp();
  const [friendSearch, setFriendSearch] = useState('');
  const [friendCandidates, setFriendCandidates] = useState<FriendUser[]>([]);
  const [friends, setFriends] = useState<FriendUser[]>([]);
  const [friendRequests, setFriendRequests] = useState<FriendOverview['requests']>({ incoming: [], outgoing: [] });
  const [chatRooms, setChatRooms] = useState<ChatRoom[]>([]);
  const [activeChatRoom, setActiveChatRoom] = useState<ActiveChatRoom | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [friendLoading, setFriendLoading] = useState(false);
  const [chatMessage, setChatMessage] = useState('');
  const [chatSending, setChatSending] = useState(false);
  const [chatSocketStatus, setChatSocketStatus] = useState<'connecting' | 'connected' | 'fallback'>('fallback');
  const [panelOpen, setPanelOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);

  const chatScrollRef = useRef<HTMLDivElement>(null);
  const chatSocketRef = useRef<WebSocket | null>(null);
  const chatReconnectTimerRef = useRef<number | null>(null);
  const activeChatRoomRef = useRef<ActiveChatRoom | null>(null);
  const skipNextAutoScrollRef = useRef(false);

  const pendingCount = friendRequests.incoming.length + friendRequests.outgoing.length;
  const friendIdSet = useMemo(() => new Set(friends.map((friend) => friend.id)), [friends]);
  const outgoingRequestByUserId = useMemo(
    () => new Map(friendRequests.outgoing.map((request) => [request.receiver_id, request])),
    [friendRequests.outgoing]
  );
  const incomingRequestByUserId = useMemo(
    () => new Map(friendRequests.incoming.map((request) => [request.requester_id, request])),
    [friendRequests.incoming]
  );

  const buildChatSocketUrl = () => {
    const explicit = process.env.NEXT_PUBLIC_CHAT_WS_URL;
    if (explicit) return explicit;
    if (API_BASE_URL.startsWith('http://') || API_BASE_URL.startsWith('https://')) {
      const url = new URL(API_BASE_URL);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      url.pathname = '/chat';
      url.search = '';
      return url.toString();
    }
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/chat`;
  };

  const sendSocket = (payload: unknown) => {
    const socket = chatSocketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(payload));
    return true;
  };

  const applyIncomingMessage = (message: ChatMessage) => {
    setChatMessages((prev) => {
      if (prev.some((item) => item.id === message.id)) {
        return prev.map((item) => item.id === message.id ? message : item);
      }
      return [...prev, message];
    });
  };

  const fetchFriends = async (showLoading = true) => {
    if (!user) return;
    if (showLoading) setFriendLoading(true);
    try {
      const res = await apiFetch('/friends');
      if (res.ok) {
        const data: Partial<FriendOverview> = await res.json();
        const nextRooms = data.rooms || [];
        setFriends(data.friends || []);
        setFriendRequests(data.requests || { incoming: [], outgoing: [] });
        setChatRooms(nextRooms);
        setActiveChatRoom((current) => {
          if (!current || isDraftRoom(current)) return current;
          return nextRooms.find((room) => room.id === current.id) || current;
        });
      }
    } catch {
      toast('친구 정보를 불러오지 못했습니다.', 'error');
    } finally {
      if (showLoading) setFriendLoading(false);
    }
  };

  const handleSocketPayload = (payload: ChatSocketPayload) => {
    if (payload.type === 'ready') {
      setChatSocketStatus('connected');
      const activeRoom = activeChatRoomRef.current;
      if (activeRoom && !isDraftRoom(activeRoom)) sendSocket({ type: 'join', room_id: activeRoom.id });
      return;
    }
    if (payload.type === 'joined') {
      setActiveChatRoom(payload.room);
      setChatMessages(payload.messages || []);
      setHasOlderMessages((payload.messages || []).length >= 50);
      fetchFriends(false);
      return;
    }
    if (payload.type === 'messages') {
      if (!isDraftRoom(activeChatRoomRef.current) && activeChatRoomRef.current?.id === payload.room_id) {
        setChatMessages(payload.messages || []);
        setHasOlderMessages((payload.messages || []).length >= 50);
      }
      fetchFriends(false);
      return;
    }
    if (payload.type === 'message' || payload.type === 'sent') {
      if (!isDraftRoom(activeChatRoomRef.current) && activeChatRoomRef.current?.id === payload.room_id) {
        applyIncomingMessage(payload.message);
        if (payload.message.sender_id !== user?.id) sendSocket({ type: 'read', room_id: payload.room_id });
      }
      fetchFriends(false);
      return;
    }
    if (payload.type === 'read') {
      if (isDraftRoom(activeChatRoomRef.current) || activeChatRoomRef.current?.id !== payload.room_id) return;
      setChatMessages((prev) => prev.map((message) => (
        message.sender_id !== payload.reader_id && !message.read_at
          ? { ...message, read_at: new Date().toISOString() }
          : message
      )));
      return;
    }
    if (payload.type === 'error' && payload.code === 'RoomClosed') {
      toast('닫힌 채팅방에는 메시지를 보낼 수 없습니다.', 'error');
    }
  };

  const searchFriends = async () => {
    const keyword = friendSearch.trim();
    if (!keyword) {
      setFriendCandidates([]);
      return;
    }
    try {
      const res = await apiFetch(`/friends/search?keyword=${encodeURIComponent(keyword)}`);
      if (res.ok) setFriendCandidates(await res.json());
    } catch {
      toast('친구 검색 중 오류가 발생했습니다.', 'error');
    }
  };

  const sendFriendInvite = async (targetId: string) => {
    try {
      const res = await apiFetch('/friends/requests', {
        method: 'POST',
        body: JSON.stringify({ user_id: targetId })
      });
      const data = await res.json();
      if (!res.ok) {
        toast(data.message || '친구 신청을 보낼 수 없습니다.', 'error');
        return;
      }
      if (data.request) {
        const request = data.request as FriendRequest;
        setFriendRequests((prev) => ({
          ...prev,
          outgoing: prev.outgoing.some((item) => item.id === request.id || item.receiver_id === request.receiver_id)
            ? prev.outgoing
            : [request, ...prev.outgoing]
        }));
      }
      toast(data.already_friends || data.already_pending ? data.message : '친구 신청을 보냈습니다.', data.already_friends || data.already_pending ? 'info' : 'success');
      await fetchFriends(false);
    } catch {
      toast('서버와의 통신 오류가 발생했습니다.', 'error');
    }
  };

  const respondFriendInvite = async (requestId: number, accept: boolean) => {
    try {
      const res = await apiFetch(`/friends/requests/${requestId}/respond`, {
        method: 'POST',
        body: JSON.stringify({ accept })
      });
      if (!res.ok) throw new Error();
      toast(accept ? '친구 신청을 수락했습니다.' : '친구 신청을 거절했습니다.', accept ? 'success' : 'info');
      await fetchFriends(false);
    } catch {
      toast('친구 신청 처리에 실패했습니다.', 'error');
    }
  };

  const cancelFriendInvite = async (requestId: number) => {
    try {
      const res = await apiFetch(`/friends/requests/${requestId}`, { method: 'DELETE' });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast(data?.message || '친구 신청을 취소할 수 없습니다.', 'error');
        return;
      }
      toast('친구 신청을 취소했습니다.', 'info');
      await fetchFriends(false);
    } catch {
      toast('친구 신청 취소에 실패했습니다.', 'error');
    }
  };

  const openDraftChat = (target: FriendUser) => {
    setActiveChatRoom({
      id: `draft-${target.id}`,
      draft: true,
      other_user: { ...target, avatar_url: target.avatar_url || avatarFallback(target.id) },
      unread_count: 0,
      can_send: true,
      last_message: null
    });
    setChatMessages([]);
    setHasOlderMessages(false);
    setPanelOpen(false);
  };

  const materializeChatRoom = async (targetId: string): Promise<ChatRoom | null> => {
    const res = await apiFetch('/friends/rooms/open', {
      method: 'POST',
      body: JSON.stringify({ user_id: targetId })
    });
    const data = await res.json();
    if (!res.ok) {
      toast(data.message || '채팅방을 열 수 없습니다.', 'error');
      return null;
    }
    setActiveChatRoom(data);
    await fetchFriends(false);
    return data;
  };

  const openExistingRoom = (room: ChatRoom) => {
    setActiveChatRoom(room);
    setPanelOpen(false);
  };

  const returnToRoomList = () => {
    setActiveChatRoom(null);
    setChatMessages([]);
    setHasOlderMessages(false);
  };

  const fetchChatMessages = async (roomId: number, mode: 'initial' | 'older' = 'initial', showError = true) => {
    const beforeId = mode === 'older' ? chatMessages[0]?.id : undefined;
    if (mode === 'older' && (!beforeId || loadingOlderMessages || !hasOlderMessages)) return;
    const scrollEl = chatScrollRef.current;
    const previousHeight = scrollEl?.scrollHeight || 0;
    const previousTop = scrollEl?.scrollTop || 0;
    if (mode === 'older') setLoadingOlderMessages(true);
    try {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        await apiFetch(`/friends/rooms/${roomId}/viewing`, { method: 'POST' }).catch(() => { /* noop */ });
      }
      const query = new URLSearchParams({ limit: '50' });
      if (beforeId) query.set('before_id', String(beforeId));
      const res = await apiFetch(`/friends/rooms/${roomId}/messages?${query.toString()}`);
      if (res.ok) {
        const messages: ChatMessage[] = await res.json();
        setHasOlderMessages(messages.length >= 50);
        if (mode === 'older') {
          skipNextAutoScrollRef.current = true;
          setChatMessages((prev) => {
            const existing = new Set(prev.map((message) => message.id));
            return [...messages.filter((message) => !existing.has(message.id)), ...prev];
          });
          window.requestAnimationFrame(() => {
            const nextEl = chatScrollRef.current;
            if (!nextEl) return;
            nextEl.scrollTop = nextEl.scrollHeight - previousHeight + previousTop;
          });
        } else {
          setChatMessages(messages);
        }
        fetchFriends(false);
      }
    } catch {
      if (showError) toast('채팅 내역을 불러오지 못했습니다.', 'error');
    } finally {
      if (mode === 'older') setLoadingOlderMessages(false);
    }
  };

  const sendChat = async () => {
    const text = chatMessage.trim();
    if (!activeChatRoom || !text) return;
    setChatSending(true);
    try {
      const wasDraft = isDraftRoom(activeChatRoom);
      const room = wasDraft ? await materializeChatRoom(activeChatRoom.other_user.id) : activeChatRoom;
      if (!room) return;

      if (chatSocketStatus === 'connected') {
        if (wasDraft) sendSocket({ type: 'join', room_id: room.id });
        if (sendSocket({ type: 'send', room_id: room.id, body: text })) {
          setChatMessage('');
          return;
        }
      }

      const res = await apiFetch(`/friends/rooms/${room.id}/messages`, {
        method: 'POST',
        body: JSON.stringify({ body: text })
      });
      const data = await res.json();
      if (!res.ok) {
        toast(data.message || '메시지를 보낼 수 없습니다.', 'error');
        return;
      }
      setChatMessage('');
      await fetchChatMessages(room.id, 'initial', false);
    } catch {
      toast('메시지 전송에 실패했습니다.', 'error');
    } finally {
      setChatSending(false);
    }
  };

  const removeFriendUser = async (targetId: string) => {
    if (!window.confirm('친구를 삭제할까요? 내 채팅방 목록에서는 사라지고, 상대방 방은 읽기 전용으로 남습니다.')) return;
    try {
      const res = await apiFetch(`/friends/${targetId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      if (activeChatRoom?.other_user.id === targetId) {
        setActiveChatRoom(null);
        setChatMessages([]);
      }
      toast('친구를 삭제했습니다.', 'info');
      await fetchFriends(false);
    } catch {
      toast('친구 삭제에 실패했습니다.', 'error');
    }
  };

  const deleteClosedRoom = async (roomId: number) => {
    try {
      const res = await apiFetch(`/friends/rooms/${roomId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      if (!isDraftRoom(activeChatRoom) && activeChatRoom?.id === roomId) {
        setActiveChatRoom(null);
        setChatMessages([]);
      }
      await fetchFriends(false);
    } catch {
      toast('닫힌 채팅방 삭제에 실패했습니다.', 'error');
    }
  };

  const toggleAdminRoomClosed = async (roomId: number, closeRoom: boolean) => {
    try {
      const res = await apiFetch(`/friends/rooms/${roomId}/close`, {
        method: 'POST',
        body: JSON.stringify({ closed: closeRoom })
      });
      if (!res.ok) throw new Error();
      await fetchFriends(false);
    } catch {
      toast('채팅방 상태 변경에 실패했습니다.', 'error');
    }
  };

  const formatChatTime = (value?: string) => parseChatDate(value)?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) || '';
  const formatChatDate = (value?: string) => parseChatDate(value)?.toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' }) || '';

  useEffect(() => {
    if (user) fetchFriends();
  }, [user?.id]);

  useEffect(() => {
    activeChatRoomRef.current = activeChatRoom;
  }, [activeChatRoom]);

  useEffect(() => {
    if (!user || typeof WebSocket === 'undefined') {
      setChatSocketStatus('fallback');
      return;
    }

    let cancelled = false;
    let reconnectAttempts = 0;

    const connect = () => {
      if (cancelled) return;
      setChatSocketStatus('connecting');
      const socket = new WebSocket(buildChatSocketUrl());
      chatSocketRef.current = socket;

      socket.onopen = () => {
        reconnectAttempts = 0;
        setChatSocketStatus('connected');
        const activeRoom = activeChatRoomRef.current;
        if (activeRoom && !isDraftRoom(activeRoom)) sendSocket({ type: 'join', room_id: activeRoom.id });
      };

      socket.onmessage = (event) => {
        try {
          handleSocketPayload(JSON.parse(event.data));
        } catch {
          // malformed socket payloads are ignored
        }
      };

      socket.onclose = () => {
        if (chatSocketRef.current === socket) chatSocketRef.current = null;
        if (cancelled) return;
        setChatSocketStatus('fallback');
        const delay = Math.min(15_000, 1000 + reconnectAttempts * 1500);
        reconnectAttempts += 1;
        chatReconnectTimerRef.current = window.setTimeout(connect, delay);
      };

      socket.onerror = () => socket.close();
    };

    connect();

    return () => {
      cancelled = true;
      if (chatReconnectTimerRef.current !== null) {
        window.clearTimeout(chatReconnectTimerRef.current);
        chatReconnectTimerRef.current = null;
      }
      chatSocketRef.current?.close();
      chatSocketRef.current = null;
    };
  }, [user?.id]);

  useEffect(() => {
    if (!activeChatRoom || isDraftRoom(activeChatRoom)) return;
    if (chatSocketStatus === 'connected') {
      sendSocket({ type: 'join', room_id: activeChatRoom.id });
      sendSocket({ type: 'read', room_id: activeChatRoom.id });
      return;
    }
    fetchChatMessages(activeChatRoom.id);
    const timer = window.setInterval(() => fetchChatMessages(activeChatRoom.id, 'initial', false), 5000);
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        fetchChatMessages(activeChatRoom.id, 'initial', false);
      } else {
        apiFetch(`/friends/rooms/${activeChatRoom.id}/viewing`, { method: 'DELETE' }).catch(() => { /* noop */ });
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisibility);
      apiFetch(`/friends/rooms/${activeChatRoom.id}/viewing`, { method: 'DELETE' }).catch(() => { /* noop */ });
    };
  }, [activeChatRoom?.id, chatSocketStatus]);

  useEffect(() => {
    if (skipNextAutoScrollRef.current) {
      skipNextAutoScrollRef.current = false;
      return;
    }
    chatScrollRef.current?.scrollTo({ top: chatScrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [chatMessages.length, activeChatRoom?.id]);

  useEffect(() => {
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
    };
  }, []);

  if (!user) {
    return (
      <section className="cute-surface rounded-[2rem] p-8 text-center">
        <MessageCircle className="mx-auto mb-3 h-10 w-10 text-primary/70" />
        <h2 className="text-xl font-black">친구와 1:1 톡</h2>
        <p className="mt-2 text-sm text-muted-foreground">로그인하면 친구 신청과 1:1 톡을 사용할 수 있습니다.</p>
      </section>
    );
  }

  const renderCandidateAction = (candidate: FriendUser) => {
    const incoming = incomingRequestByUserId.get(candidate.id);
    const outgoing = outgoingRequestByUserId.get(candidate.id);
    if (friendIdSet.has(candidate.id)) {
      return (
        <button type="button" onClick={() => openDraftChat(candidate)} className="rounded-full bg-primary/10 px-3 py-1.5 text-[10px] font-black text-primary">
          톡 열기
        </button>
      );
    }
    let friendAction: React.ReactNode;
    if (incoming) {
      friendAction = (
        <>
          <button type="button" onClick={() => respondFriendInvite(incoming.id, true)} className="rounded-full bg-primary px-2.5 py-1 text-[10px] font-black text-primary-foreground">수락</button>
          <button type="button" onClick={() => respondFriendInvite(incoming.id, false)} className="rounded-full bg-secondary px-2.5 py-1 text-[10px] font-black text-muted-foreground">거절</button>
        </>
      );
    } else if (outgoing) {
      friendAction = (
        <button type="button" onClick={() => cancelFriendInvite(outgoing.id)} className="rounded-full bg-rose-500/10 px-3 py-1.5 text-[10px] font-black text-rose-500">
          신청 취소
        </button>
      );
    } else {
      friendAction = (
        <button type="button" onClick={() => sendFriendInvite(candidate.id)} className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-3 py-1.5 text-[10px] font-black text-primary">
          <UserPlus className="h-3.5 w-3.5" /> 신청
        </button>
      );
    }

    return (
      <div className="flex flex-wrap justify-end gap-1">
        {friendAction}
        {user.role === 'ADMIN' && (
          <button type="button" onClick={() => openDraftChat(candidate)} className="inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-[10px] font-black text-primary-foreground">
            <Shield className="h-3.5 w-3.5" /> 톡 열기
          </button>
        )}
      </div>
    );
  };

  const managementPanel = (
    <aside className={`fixed inset-y-3 left-3 z-50 flex w-[min(24rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-[2rem] border border-border bg-card/95 shadow-2xl shadow-black/15 backdrop-blur-xl transition-transform duration-300 lg:absolute lg:inset-y-4 lg:left-4 ${panelOpen ? 'translate-x-0' : '-translate-x-[calc(100%+2rem)]'}`}>
      <div className="flex items-center justify-between border-b border-border/70 px-4 py-3">
        <div>
          <p className="text-sm font-black">친구 관리</p>
          <p className="text-[10px] font-bold text-muted-foreground">친구 신청, 목록, 톡방</p>
        </div>
        <button type="button" onClick={() => setPanelOpen(false)} className="rounded-full p-2 text-muted-foreground hover:bg-secondary">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <div data-tour="friends-search" className="rounded-[1.5rem] border border-border bg-secondary/20 p-3">
          <div className="flex gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={friendSearch}
                onChange={(e) => setFriendSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') searchFriends(); }}
                placeholder="닉네임으로 친구 찾기"
                className="w-full rounded-2xl border border-border bg-card px-9 py-2.5 text-xs font-bold focus:border-primary focus:outline-none"
              />
              {friendSearch && (
                <button type="button" onClick={() => { setFriendSearch(''); setFriendCandidates([]); }} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground hover:bg-secondary">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <button type="button" onClick={searchFriends} className="rounded-2xl bg-primary px-4 py-2 text-xs font-black text-primary-foreground">검색</button>
          </div>
          {friendCandidates.length > 0 && (
            <div className="mt-3 space-y-2">
              {friendCandidates.map((candidate) => (
                <div key={candidate.id} className="flex items-center justify-between gap-2 rounded-2xl bg-card/80 px-3 py-2 shadow-sm">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <img src={candidate.avatar_url || avatarFallback(candidate.id)} alt={candidate.username} className="h-9 w-9 rounded-full border border-border object-cover" />
                    <div className="min-w-0">
                      <p className="truncate text-xs font-black">{candidate.username}</p>
                      <p className="truncate text-[10px] text-muted-foreground">{candidate.id}</p>
                    </div>
                  </div>
                  <div className="shrink-0">{renderCandidateAction(candidate)}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {(friendRequests.incoming.length > 0 || friendRequests.outgoing.length > 0) && (
          <div className="space-y-2 rounded-[1.5rem] border border-primary/20 bg-primary/5 p-3">
            <p className="text-[11px] font-black text-primary">친구 신청</p>
            {friendRequests.incoming.map((request) => (
              <div key={request.id} className="flex items-center justify-between gap-2 rounded-2xl bg-card/85 px-3 py-2">
                <div className="flex min-w-0 items-center gap-2">
                  <img src={request.requester?.avatar_url || avatarFallback(request.requester_id)} alt={request.requester?.username || '친구 신청'} className="h-8 w-8 rounded-full border border-border object-cover" />
                  <p className="truncate text-xs font-black">{request.requester?.username}</p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button type="button" onClick={() => respondFriendInvite(request.id, true)} className="rounded-full bg-primary px-2.5 py-1 text-[10px] font-black text-primary-foreground">수락</button>
                  <button type="button" onClick={() => respondFriendInvite(request.id, false)} className="rounded-full bg-secondary px-2.5 py-1 text-[10px] font-black text-muted-foreground">거절</button>
                </div>
              </div>
            ))}
            {friendRequests.outgoing.map((request) => (
              <div key={request.id} className="flex items-center justify-between gap-2 rounded-2xl bg-card/60 px-3 py-2">
                <div className="flex min-w-0 items-center gap-2">
                  <img src={request.receiver?.avatar_url || avatarFallback(request.receiver_id)} alt={request.receiver?.username || '보낸 친구 신청'} className="h-8 w-8 rounded-full border border-border object-cover" />
                  <p className="truncate text-xs font-black">{request.receiver?.username}</p>
                </div>
                <button type="button" onClick={() => cancelFriendInvite(request.id)} className="shrink-0 rounded-full bg-rose-500/10 px-2.5 py-1 text-[10px] font-black text-rose-500">취소</button>
              </div>
            ))}
          </div>
        )}

        <div data-tour="friends-list" className="space-y-2 rounded-[1.5rem] border border-border bg-secondary/20 p-3">
          <p className="flex items-center gap-1.5 text-[11px] font-black text-muted-foreground"><Users className="h-3.5 w-3.5" /> 친구 목록 ({friends.length})</p>
          {friends.length === 0 ? (
            <p className="py-5 text-center text-[11px] text-muted-foreground">아직 친구가 없습니다.</p>
          ) : friends.map((friend) => (
            <div
              key={friend.id}
              onContextMenu={(event) => {
                event.preventDefault();
                setContextMenu({ x: event.clientX, y: event.clientY, kind: 'friend', friend });
              }}
              className="flex items-center justify-between gap-2 rounded-2xl bg-card/75 px-3 py-2"
            >
              <button type="button" onClick={() => openDraftChat(friend)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
                <img src={friend.avatar_url || avatarFallback(friend.id)} alt={friend.username} className="h-9 w-9 rounded-full border border-border object-cover" />
                <p className="truncate text-xs font-black">{friend.username}</p>
              </button>
              <button type="button" onClick={() => removeFriendUser(friend.id)} className="rounded-full bg-rose-500/10 px-2.5 py-1 text-[10px] font-black text-rose-500">삭제</button>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );

  const activeRoomIsReal = activeChatRoom && !isDraftRoom(activeChatRoom);
  const chatRoomRail = (
    <aside className={`${activeChatRoom ? 'hidden lg:flex' : 'flex'} min-h-0 flex-col bg-secondary/20 p-3 lg:h-full lg:border-r lg:border-border/70 lg:p-4`}>
      <div className="mb-3 flex items-center justify-between gap-2 lg:mb-3">
        <div>
          <p className="flex items-center gap-1.5 text-sm font-black lg:text-[11px] lg:text-muted-foreground">
            <MessageCircle className="h-4 w-4 text-primary lg:h-3.5 lg:w-3.5 lg:text-current" /> 톡방
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-black text-primary">{chatRooms.length}</span>
          </p>
          <p className="mt-0.5 text-[11px] font-bold text-muted-foreground lg:hidden">대화를 선택하면 채팅 화면으로 넘어갑니다.</p>
        </div>
        <button type="button" onClick={() => fetchFriends(false)} className="flex h-9 w-9 items-center justify-center rounded-2xl border border-border bg-card text-muted-foreground hover:bg-secondary" aria-label="톡방 새로고침">
          <RefreshCw className={`h-3.5 w-3.5 ${friendLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pb-2">
        {chatRooms.length === 0 ? (
          <div className="rounded-[1.5rem] border border-dashed border-border bg-card/60 px-4 py-10 text-center">
            <MessageCircle className="mx-auto mb-3 h-9 w-9 text-primary/60" />
            <p className="text-sm font-black">아직 열린 톡방이 없어요</p>
            <p className="mt-1 text-[11px] font-bold text-muted-foreground">친구 관리에서 친구를 선택하고 첫 메시지를 보내면 톡방이 시작됩니다.</p>
            <button type="button" onClick={() => setPanelOpen(true)} className="mt-4 rounded-2xl bg-primary px-4 py-2 text-xs font-black text-primary-foreground">
              친구 관리 열기
            </button>
          </div>
        ) : chatRooms.map((room) => (
          <button
            key={room.id}
            type="button"
            onClick={() => openExistingRoom(room)}
            onContextMenu={(event) => {
              event.preventDefault();
              setContextMenu({ x: event.clientX, y: event.clientY, kind: 'room', room });
            }}
            className={`w-full rounded-[1.35rem] px-3.5 py-3 text-left transition lg:px-3 lg:py-2 ${!isDraftRoom(activeChatRoom) && activeChatRoom?.id === room.id ? 'bg-primary text-primary-foreground shadow-sm shadow-primary/20' : 'bg-card/80 shadow-sm hover:bg-card'}`}
          >
            <div className="flex items-center gap-2">
              <img src={room.other_user.avatar_url || avatarFallback(room.other_user.id)} alt={room.other_user.username} className="h-11 w-11 shrink-0 rounded-full border border-border object-cover lg:h-9 lg:w-9" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-black lg:text-xs">{room.other_user.username}</p>
                <p className="truncate text-[11px] font-bold opacity-70 lg:text-[10px]">{room.closed_at ? '닫힌 톡방' : room.last_message?.body || '메시지 없음'}</p>
              </div>
              {room.unread_count > 0 && <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-rose-500 px-1.5 text-[10px] font-black text-white">{room.unread_count}</span>}
            </div>
          </button>
        ))}
      </div>
    </aside>
  );

  return (
    <div className="relative flex h-[calc(100dvh-9rem)] max-h-[calc(100dvh-9rem)] min-h-0 flex-col overflow-hidden rounded-[2rem] border border-border bg-card/75 shadow-sm">
      {panelOpen && <button type="button" aria-label="친구 관리 닫기" onClick={() => setPanelOpen(false)} className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[1px] lg:absolute" />}
      {managementPanel}

      {!activeChatRoom && (
        <header className="flex items-center justify-between gap-3 border-b border-border/70 bg-card/90 px-4 py-3 backdrop-blur lg:hidden">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-black">친구와 1:1 톡</h2>
            <p className="mt-0.5 text-[11px] font-bold leading-snug text-muted-foreground">친구 신청과 대화 관리는 왼쪽 버튼에서 할 수 있어요.</p>
          </div>
          <button
            type="button"
            onClick={() => setPanelOpen(true)}
            className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary transition hover:bg-primary/15"
            aria-label="친구 관리 열기"
          >
            <PanelLeftOpen className="h-5 w-5" />
            {pendingCount > 0 && <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-black text-white">{pendingCount}</span>}
          </button>
        </header>
      )}

      <div className="grid min-h-0 flex-1 lg:h-full lg:grid-cols-[18rem_minmax(0,1fr)]">
        {chatRoomRail}

        <div className={`${activeChatRoom ? 'flex' : 'hidden lg:flex'} min-h-0 flex-col lg:h-full`}>
        <header className="hidden items-center justify-between gap-3 border-b border-border/70 bg-card/85 px-3 py-3 backdrop-blur sm:px-5 lg:flex">
          <div className="flex min-w-0 items-center gap-2.5">
            <button
              type="button"
              onClick={() => setPanelOpen(true)}
              className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary transition hover:bg-primary/15"
              aria-label="친구 관리 열기"
            >
              <PanelLeftOpen className="h-5 w-5" />
              {pendingCount > 0 && <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-black text-white">{pendingCount}</span>}
            </button>
            <div className="min-w-0">
              <h2 className="truncate text-base font-black sm:text-lg">친구와 1:1 톡</h2>
              <p className="truncate text-[11px] font-bold text-muted-foreground">친구 신청과 대화 관리는 왼쪽 버튼에서 할 수 있어요.</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="hidden items-center gap-1.5 rounded-full border border-border bg-secondary/30 px-2.5 py-1 text-[10px] font-black text-muted-foreground sm:inline-flex">
              <span className={`h-2 w-2 rounded-full ${chatSocketStatus === 'connected' ? 'bg-emerald-400' : chatSocketStatus === 'connecting' ? 'bg-amber-400' : 'bg-muted-foreground/40'}`} />
              {chatSocketStatus === 'connected' ? '실시간' : chatSocketStatus === 'connecting' ? '연결 중' : '폴백'}
            </span>
            <button type="button" onClick={() => fetchFriends()} disabled={friendLoading} className="flex h-10 w-10 items-center justify-center rounded-2xl border border-border bg-card text-muted-foreground hover:bg-secondary disabled:opacity-50" aria-label="새로고침">
              <RefreshCw className={`h-4 w-4 ${friendLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </header>

        {activeChatRoom ? (
          <>
            <div className="flex items-center justify-between gap-2 border-b border-border/70 bg-secondary/15 px-4 py-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <button type="button" onClick={returnToRoomList} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-card text-muted-foreground shadow-sm ring-1 ring-border lg:hidden" aria-label="톡방 목록으로 돌아가기">
                  <ArrowLeft className="h-5 w-5" />
                </button>
                <img src={activeChatRoom.other_user.avatar_url || avatarFallback(activeChatRoom.other_user.id)} alt={activeChatRoom.other_user.username} className="h-10 w-10 rounded-full border border-border object-cover" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-black">{activeChatRoom.other_user.username}</p>
                  <p className="text-[10px] font-bold text-muted-foreground">
                    {isDraftRoom(activeChatRoom) ? '첫 메시지를 보내면 톡방이 시작됩니다.' : activeChatRoom.closed_at ? '닫힌 톡방' : activeChatRoom.is_admin_room ? '관리자 1:1 톡' : '1:1 톡'}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 gap-1">
                {user.role === 'ADMIN' && activeRoomIsReal && (
                  <button type="button" onClick={() => toggleAdminRoomClosed(activeChatRoom.id, activeChatRoom.can_send)} className="rounded-full bg-secondary px-2.5 py-1 text-[10px] font-black text-muted-foreground">
                    {activeChatRoom.can_send ? '닫기' : '열기'}
                  </button>
                )}
                {activeRoomIsReal && !activeChatRoom.can_send && (
                  <button type="button" onClick={() => deleteClosedRoom(activeChatRoom.id)} className="rounded-full bg-rose-500/10 px-2.5 py-1 text-[10px] font-black text-rose-500">방 삭제</button>
                )}
              </div>
            </div>

            <div
              ref={chatScrollRef}
              onScroll={(event) => {
                const target = event.currentTarget;
                if (target.scrollTop < 48 && activeRoomIsReal) fetchChatMessages(activeChatRoom.id, 'older', false);
              }}
              className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain bg-secondary/10 px-3 py-4 [scrollbar-gutter:stable] sm:px-5"
            >
              {loadingOlderMessages && <p className="text-center text-[10px] font-bold text-muted-foreground">이전 대화 불러오는 중...</p>}
              {chatMessages.length === 0 && (
                <div className="flex min-h-[18rem] flex-col items-center justify-center text-center">
                  <MessageCircle className="mb-3 h-10 w-10 text-primary/70" />
                  <p className="text-sm font-black">아직 메시지가 없습니다</p>
                  <p className="mt-1 text-xs text-muted-foreground">첫 메시지를 보내면 이 대화가 톡방 목록에 남습니다.</p>
                </div>
              )}
              {chatMessages.map((message, index) => {
                const mine = message.sender_id === user.id;
                const previous = chatMessages[index - 1];
                const showDate = !previous || formatChatDate(previous.created_at) !== formatChatDate(message.created_at);
                return (
                  <React.Fragment key={message.id}>
                    {showDate && (
                      <div className="sticky top-0 z-10 mx-auto w-fit rounded-full border border-border bg-card/90 px-3 py-1 text-[10px] font-black text-muted-foreground shadow-sm backdrop-blur">
                        {formatChatDate(message.created_at)}
                      </div>
                    )}
                    <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[82%] rounded-2xl px-3 py-2 shadow-sm sm:max-w-[72%] ${mine ? 'rounded-br-md bg-primary text-primary-foreground' : 'rounded-bl-md border border-border bg-card text-foreground'}`}>
                        <p className="whitespace-pre-wrap break-words text-xs leading-relaxed">{message.body}</p>
                        <div className={`mt-1 flex items-center gap-1 text-[9px] ${mine ? 'justify-end text-primary-foreground/75' : 'text-muted-foreground'}`}>
                          {mine && <span>{message.read_at ? '읽음' : '안읽음'}</span>}
                          <span>{formatChatTime(message.created_at)}</span>
                        </div>
                      </div>
                    </div>
                  </React.Fragment>
                );
              })}
            </div>

            <div className="border-t border-border/70 bg-card/90 p-3">
              {!activeChatRoom.can_send && <p className="mb-2 rounded-2xl bg-secondary/60 px-3 py-2 text-[11px] font-bold text-muted-foreground">이 톡방은 닫혀 있어 새 메시지를 보낼 수 없습니다.</p>}
              <div className="flex gap-2">
                <textarea
                  value={chatMessage}
                  disabled={!activeChatRoom.can_send}
                  onChange={(e) => setChatMessage(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      sendChat();
                    }
                  }}
                  placeholder="메시지 입력"
                  className="max-h-28 min-h-11 flex-1 resize-none rounded-2xl border border-border bg-secondary/35 px-3 py-2 text-xs focus:border-primary focus:outline-none disabled:opacity-50"
                />
                <button type="button" onClick={sendChat} disabled={!activeChatRoom.can_send || chatSending || !chatMessage.trim()} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm shadow-primary/20 disabled:opacity-45" aria-label="메시지 보내기">
                  <Send className="h-4 w-4" />
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
            <MessageCircle className="mb-3 h-12 w-12 text-primary/70" />
            <p className="text-base font-black">대화할 친구를 선택해 주세요</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">왼쪽 위 친구 관리 버튼에서 친구를 찾고, 목록을 눌러 1:1 톡을 시작할 수 있습니다.</p>
            <button type="button" onClick={() => setPanelOpen(true)} className="mt-4 rounded-2xl bg-primary px-4 py-2 text-xs font-black text-primary-foreground">
              친구 관리 열기
            </button>
          </div>
        )}
      </div>
      </div>

      {contextMenu && (
        <div className="fixed z-[70] min-w-44 overflow-hidden rounded-2xl border border-border bg-card p-1 shadow-2xl" style={{ left: contextMenu.x, top: contextMenu.y }}>
          {contextMenu.kind === 'friend' ? (
            <>
              <button type="button" onClick={() => openDraftChat(contextMenu.friend)} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-bold hover:bg-secondary">
                <MessageCircle className="h-4 w-4" /> 대화방 열기
              </button>
              {user.role === 'ADMIN' && (() => {
                const room = chatRooms.find((item) => item.other_user.id === contextMenu.friend.id);
                if (!room) return null;
                return (
                  <button type="button" onClick={() => toggleAdminRoomClosed(room.id, room.can_send)} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-bold hover:bg-secondary">
                    <Shield className="h-4 w-4" /> {room.can_send ? '대화방 닫기' : '대화방 열기'}
                  </button>
                );
              })()}
              <button type="button" onClick={() => removeFriendUser(contextMenu.friend.id)} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-bold text-rose-500 hover:bg-rose-500/10">
                <Trash2 className="h-4 w-4" /> 친구 삭제
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={() => openExistingRoom(contextMenu.room)} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-bold hover:bg-secondary">
                <MessageCircle className="h-4 w-4" /> 대화방 열기
              </button>
              {user.role === 'ADMIN' && (
                <button type="button" onClick={() => toggleAdminRoomClosed(contextMenu.room.id, contextMenu.room.can_send)} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-bold hover:bg-secondary">
                  {contextMenu.room.can_send ? <Ban className="h-4 w-4" /> : <Check className="h-4 w-4" />} {contextMenu.room.can_send ? '대화방 닫기' : '대화방 열기'}
                </button>
              )}
              {!contextMenu.room.can_send && (
                <button type="button" onClick={() => deleteClosedRoom(contextMenu.room.id)} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-bold text-rose-500 hover:bg-rose-500/10">
                  <Trash2 className="h-4 w-4" /> 대화방 삭제
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};
