'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MessageCircle, RefreshCw, Search, Send, Shield, UserPlus, Users, X } from 'lucide-react';
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

type ChatRoom = {
  id: number;
  other_user: FriendUser;
  last_message?: ChatMessage | null;
  unread_count: number;
  can_send: boolean;
  closed_at?: string | null;
  is_admin_room?: boolean;
};

type ChatMessage = {
  id: number;
  room_id: number;
  sender_id: string;
  body: string;
  created_at: string;
  read_at?: string | null;
};

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

export const FriendTab: React.FC = () => {
  const { user, toast } = useApp();
  const [friendSearch, setFriendSearch] = useState('');
  const [friendCandidates, setFriendCandidates] = useState<FriendUser[]>([]);
  const [friends, setFriends] = useState<FriendUser[]>([]);
  const [friendRequests, setFriendRequests] = useState<FriendOverview['requests']>({ incoming: [], outgoing: [] });
  const [chatRooms, setChatRooms] = useState<ChatRoom[]>([]);
  const [activeChatRoom, setActiveChatRoom] = useState<ChatRoom | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [friendLoading, setFriendLoading] = useState(false);
  const [chatMessage, setChatMessage] = useState('');
  const [chatSending, setChatSending] = useState(false);
  const [chatSocketStatus, setChatSocketStatus] = useState<'connecting' | 'connected' | 'fallback'>('fallback');
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const chatSocketRef = useRef<WebSocket | null>(null);
  const chatReconnectTimerRef = useRef<number | null>(null);
  const activeChatRoomRef = useRef<ChatRoom | null>(null);

  const friendIdSet = useMemo(() => new Set(friends.map((friend) => friend.id)), [friends]);
  const outgoingRequestUserIdSet = useMemo(
    () => new Set(friendRequests.outgoing.map((request) => request.receiver_id)),
    [friendRequests.outgoing]
  );
  const outgoingRequestByUserId = useMemo(
    () => new Map(friendRequests.outgoing.map((request) => [request.receiver_id, request])),
    [friendRequests.outgoing]
  );
  const incomingRequestUserIdSet = useMemo(
    () => new Set(friendRequests.incoming.map((request) => request.requester_id)),
    [friendRequests.incoming]
  );

  const buildChatSocketUrl = () => {
    const explicit = process.env.NEXT_PUBLIC_CHAT_WS_URL;
    if (explicit) return explicit;
    const apiBase = API_BASE_URL;
    if (apiBase.startsWith('http://') || apiBase.startsWith('https://')) {
      const url = new URL(apiBase);
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

  const handleSocketPayload = (payload: ChatSocketPayload) => {
    if (payload.type === 'ready') {
      setChatSocketStatus('connected');
      const activeRoom = activeChatRoomRef.current;
      if (activeRoom) sendSocket({ type: 'join', room_id: activeRoom.id });
      return;
    }
    if (payload.type === 'joined') {
      setActiveChatRoom(payload.room);
      setChatMessages(payload.messages || []);
      fetchFriends(false);
      return;
    }
    if (payload.type === 'messages') {
      if (activeChatRoomRef.current?.id === payload.room_id) setChatMessages(payload.messages || []);
      fetchFriends(false);
      return;
    }
    if (payload.type === 'message' || payload.type === 'sent') {
      if (activeChatRoomRef.current?.id === payload.room_id) applyIncomingMessage(payload.message);
      fetchFriends(false);
      return;
    }
    if (payload.type === 'read') {
      if (activeChatRoomRef.current?.id !== payload.room_id) return;
      setChatMessages((prev) => prev.map((message) => (
        message.sender_id !== payload.reader_id && !message.read_at
          ? { ...message, read_at: new Date().toISOString() }
          : message
      )));
      return;
    }
    if (payload.type === 'error') {
      if (payload.code === 'RoomClosed') toast('닫힌 채팅방에는 메시지를 보낼 수 없습니다.', 'error');
    }
  };

  const applyOverview = (data: Partial<FriendOverview>) => {
    const nextFriends = data.friends || [];
    const nextRequests = data.requests || { incoming: [], outgoing: [] };
    const nextRooms = data.rooms || [];
    setFriends(nextFriends);
    setFriendRequests(nextRequests);
    setChatRooms(nextRooms);
    setActiveChatRoom((current) => {
      if (!current) return current;
      return nextRooms.find((room) => room.id === current.id) || null;
    });
  };

  const fetchFriends = async (showLoading = true) => {
    if (!user) return;
    if (showLoading) setFriendLoading(true);
    try {
      const res = await apiFetch('/friends');
      if (res.ok) applyOverview(await res.json());
    } catch {
      toast('친구 정보를 불러오지 못했습니다.', 'error');
    } finally {
      if (showLoading) setFriendLoading(false);
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
      toast(data.already_friends || data.already_pending ? data.message : '친구 신청을 보냈습니다.', data.already_friends || data.already_pending ? 'info' : 'success');
      setFriendCandidates([]);
      setFriendSearch('');
      fetchFriends(false);
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
      fetchFriends(false);
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
      fetchFriends(false);
    } catch {
      toast('친구 신청 취소에 실패했습니다.', 'error');
    }
  };

  const openChatRoom = async (targetId: string) => {
    try {
      const res = await apiFetch('/friends/rooms/open', {
        method: 'POST',
        body: JSON.stringify({ user_id: targetId })
      });
      const data = await res.json();
      if (!res.ok) {
        toast(data.message || '채팅방을 열 수 없습니다.', 'error');
        return;
      }
      setActiveChatRoom(data);
      setFriendCandidates([]);
      setFriendSearch('');
      fetchFriends(false);
    } catch {
      toast('채팅방 열기에 실패했습니다.', 'error');
    }
  };

  const fetchChatMessages = async (roomId: number, showError = true) => {
    try {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        await apiFetch(`/friends/rooms/${roomId}/viewing`, { method: 'POST' }).catch(() => { /* noop */ });
      }
      const res = await apiFetch(`/friends/rooms/${roomId}/messages`);
      if (res.ok) {
        setChatMessages(await res.json());
        fetchFriends(false);
      }
    } catch {
      if (showError) toast('채팅 내역을 불러오지 못했습니다.', 'error');
    }
  };

  const sendChat = async () => {
    if (!activeChatRoom || !chatMessage.trim()) return;
    if (chatSocketStatus === 'connected' && sendSocket({ type: 'send', room_id: activeChatRoom.id, body: chatMessage.trim() })) {
      setChatMessage('');
      return;
    }
    setChatSending(true);
    try {
      const res = await apiFetch(`/friends/rooms/${activeChatRoom.id}/messages`, {
        method: 'POST',
        body: JSON.stringify({ body: chatMessage.trim() })
      });
      const data = await res.json();
      if (!res.ok) {
        toast(data.message || '메시지를 보낼 수 없습니다.', 'error');
        return;
      }
      setChatMessage('');
      await fetchChatMessages(activeChatRoom.id, false);
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
      fetchFriends(false);
    } catch {
      toast('친구 삭제에 실패했습니다.', 'error');
    }
  };

  const deleteClosedRoom = async (roomId: number) => {
    try {
      const res = await apiFetch(`/friends/rooms/${roomId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      if (activeChatRoom?.id === roomId) {
        setActiveChatRoom(null);
        setChatMessages([]);
      }
      fetchFriends(false);
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
      fetchFriends(false);
    } catch {
      toast('채팅방 상태 변경에 실패했습니다.', 'error');
    }
  };

  const formatChatTime = (value?: string) => {
    if (!value) return '';
    return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const formatChatDate = (value?: string) => {
    if (!value) return '';
    return new Date(value).toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' });
  };

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
        if (activeRoom) sendSocket({ type: 'join', room_id: activeRoom.id });
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

      socket.onerror = () => {
        socket.close();
      };
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
    if (!activeChatRoom) return;
    if (chatSocketStatus === 'connected') {
      sendSocket({ type: 'join', room_id: activeChatRoom.id });
      return;
    }
    fetchChatMessages(activeChatRoom.id);
    const timer = window.setInterval(() => {
      fetchChatMessages(activeChatRoom.id, false);
    }, 3500);
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        fetchChatMessages(activeChatRoom.id, false);
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
    chatScrollRef.current?.scrollTo({ top: chatScrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [chatMessages.length, activeChatRoom?.id]);

  if (!user) {
    return (
      <section className="cute-surface rounded-[2rem] p-8 text-center">
        <MessageCircle className="mx-auto mb-3 h-10 w-10 text-primary/70" />
        <h2 className="text-xl font-black">친구와 1:1 톡</h2>
        <p className="mt-2 text-sm text-muted-foreground">로그인하면 친구 신청과 1:1 톡을 사용할 수 있습니다.</p>
      </section>
    );
  }

  return (
    <div className="space-y-6">
      <section data-tour="friends-header" className="relative overflow-hidden rounded-[2.25rem] border border-primary/15 bg-gradient-to-br from-primary/12 via-card to-accent/10 p-6 shadow-sm dark:from-primary/18 dark:via-card dark:to-accent/12">
        <div className="pointer-events-none absolute -right-12 -top-16 h-40 w-40 rounded-full bg-primary/20 blur-3xl" />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-card/75 px-3 py-1 text-[11px] font-black text-primary shadow-sm backdrop-blur">
              <MessageCircle className="h-3.5 w-3.5" /> 친구
            </div>
            <h2 className="cute-outline-soft text-2xl font-black sm:text-3xl">친구와 1:1 톡</h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              닉네임으로 친구를 찾고, 친구끼리 조용한 1:1 톡을 주고받을 수 있습니다. 차단한 유저의 친구 신청은 자동으로 막힙니다.
            </p>
          </div>
          <button
            type="button"
            onClick={() => fetchFriends()}
            disabled={friendLoading}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-2xl border border-border bg-card/80 px-4 py-2 text-xs font-black text-muted-foreground transition hover:-translate-y-0.5 hover:bg-secondary hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${friendLoading ? 'animate-spin' : ''}`} /> 새로고침
          </button>
        </div>
        <div className="relative mt-4 inline-flex items-center gap-2 rounded-full border border-border bg-card/75 px-3 py-1.5 text-[10px] font-black text-muted-foreground shadow-sm backdrop-blur">
          <span className={`h-2 w-2 rounded-full ${chatSocketStatus === 'connected' ? 'bg-emerald-400' : chatSocketStatus === 'connecting' ? 'bg-amber-400' : 'bg-muted-foreground/40'}`} />
          {chatSocketStatus === 'connected' ? '실시간 톡 연결됨' : chatSocketStatus === 'connecting' ? '실시간 톡 연결 중' : 'HTTP 폴백 모드'}
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(18rem,0.82fr)_minmax(0,1.55fr)]">
        <aside className="space-y-4">
          <div data-tour="friends-search" className="cute-surface rounded-[2rem] p-4">
            <div className="flex gap-2">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  value={friendSearch}
                  onChange={(e) => setFriendSearch(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') searchFriends(); }}
                  placeholder={user.role === 'ADMIN' ? '닉네임 검색 또는 관리자 톡 열기' : '친구 닉네임 검색'}
                  className="min-w-0 w-full rounded-2xl border border-border bg-card px-9 py-2.5 text-xs font-bold focus:border-primary focus:outline-none"
                />
                {friendSearch && (
                  <button type="button" onClick={() => { setFriendSearch(''); setFriendCandidates([]); }} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground hover:bg-secondary">
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <button type="button" onClick={searchFriends} className="rounded-2xl bg-primary px-4 py-2 text-xs font-black text-primary-foreground shadow-sm shadow-primary/15">
                검색
              </button>
            </div>
            {friendCandidates.length > 0 && (
              <div className="mt-3 space-y-2">
                {friendCandidates.map((candidate) => {
                  const alreadyFriend = friendIdSet.has(candidate.id);
                  const outgoingPending = outgoingRequestUserIdSet.has(candidate.id);
                  const outgoingRequest = outgoingRequestByUserId.get(candidate.id);
                  const incomingPending = incomingRequestUserIdSet.has(candidate.id);
                  return (
                    <div key={candidate.id} className="flex items-center justify-between gap-2 rounded-2xl bg-card/80 px-3 py-2 shadow-sm">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <img src={candidate.avatar_url} alt={candidate.username} className="h-9 w-9 rounded-full border border-border object-cover" />
                        <div className="min-w-0">
                          <p className="truncate text-xs font-black">{candidate.username}</p>
                          <p className="truncate text-[10px] text-muted-foreground">{candidate.id}</p>
                        </div>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        {user.role === 'ADMIN' && (
                          <button type="button" onClick={() => openChatRoom(candidate.id)} className="inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-[10px] font-black text-primary-foreground">
                            <Shield className="h-3.5 w-3.5" /> 톡 열기
                          </button>
                        )}
                        {alreadyFriend ? (
                          <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-3 py-1.5 text-[10px] font-black text-emerald-600 dark:text-emerald-300">
                            친구
                          </span>
                        ) : outgoingPending ? (
                          <button
                            type="button"
                            onClick={() => outgoingRequest && cancelFriendInvite(outgoingRequest.id)}
                            className="inline-flex items-center rounded-full bg-muted px-3 py-1.5 text-[10px] font-black text-muted-foreground hover:bg-secondary"
                          >
                            신청 취소
                          </button>
                        ) : incomingPending ? (
                          <span className="inline-flex items-center rounded-full bg-primary/10 px-3 py-1.5 text-[10px] font-black text-primary">
                            받은 신청
                          </span>
                        ) : (
                          <button type="button" onClick={() => sendFriendInvite(candidate.id)} className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-3 py-1.5 text-[10px] font-black text-primary hover:bg-primary/15">
                            <UserPlus className="h-3.5 w-3.5" /> 신청
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {friendRequests.incoming.length > 0 && (
            <div className="space-y-2 rounded-[2rem] border border-primary/20 bg-primary/5 p-4 shadow-sm">
              <p className="text-[11px] font-black text-primary">받은 친구 신청</p>
              {friendRequests.incoming.map((request) => (
                <div key={request.id} className="flex items-center justify-between gap-2 rounded-2xl bg-card/80 px-3 py-2">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <img src={request.requester?.avatar_url} alt={request.requester?.username || '친구 신청'} className="h-8 w-8 rounded-full border border-border object-cover" />
                    <p className="truncate text-xs font-black">{request.requester?.username}</p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button type="button" onClick={() => respondFriendInvite(request.id, true)} className="rounded-full bg-primary px-2.5 py-1 text-[10px] font-black text-primary-foreground">수락</button>
                    <button type="button" onClick={() => respondFriendInvite(request.id, false)} className="rounded-full bg-secondary px-2.5 py-1 text-[10px] font-black text-muted-foreground">거절</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {friendRequests.outgoing.length > 0 && (
            <div className="space-y-2 rounded-[2rem] border border-border/70 bg-card/70 p-4 shadow-sm">
              <p className="text-[11px] font-black text-muted-foreground">보낸 친구 신청</p>
              {friendRequests.outgoing.map((request) => (
                <div key={request.id} className="flex items-center justify-between gap-2 rounded-2xl bg-secondary/30 px-3 py-2">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <img src={request.receiver?.avatar_url} alt={request.receiver?.username || '보낸 친구 신청'} className="h-8 w-8 rounded-full border border-border object-cover" />
                    <p className="truncate text-xs font-black">{request.receiver?.username}</p>
                  </div>
                  <button type="button" onClick={() => cancelFriendInvite(request.id)} className="shrink-0 rounded-full bg-rose-500/10 px-2.5 py-1 text-[10px] font-black text-rose-500">
                    취소
                  </button>
                </div>
              ))}
            </div>
          )}

          <div data-tour="friends-list" className="space-y-2 rounded-[2rem] border border-border/70 bg-card/70 p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <p className="flex items-center gap-1.5 text-[11px] font-black text-muted-foreground"><Users className="h-3.5 w-3.5" /> 친구 목록 ({friends.length})</p>
            </div>
            {friends.length === 0 ? (
              <p className="py-5 text-center text-[11px] text-muted-foreground">아직 친구가 없습니다.</p>
            ) : friends.map((friend) => (
              <div key={friend.id} className="flex items-center justify-between gap-2 rounded-2xl bg-secondary/30 px-3 py-2">
                <div className="flex min-w-0 items-center gap-2.5">
                  <img src={friend.avatar_url} alt={friend.username} className="h-9 w-9 rounded-full border border-border object-cover" />
                  <p className="truncate text-xs font-black">{friend.username}</p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button type="button" onClick={() => openChatRoom(friend.id)} className="rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-black text-primary">톡</button>
                  <button type="button" onClick={() => removeFriendUser(friend.id)} className="rounded-full bg-rose-500/10 px-2.5 py-1 text-[10px] font-black text-rose-500">삭제</button>
                </div>
              </div>
            ))}
          </div>
        </aside>

        <div data-tour="friends-chat" className="grid min-h-[38rem] overflow-hidden rounded-[2rem] border border-border bg-card/75 shadow-sm md:grid-cols-[15rem_minmax(0,1fr)]">
          <div className="border-b border-border/70 bg-secondary/20 p-3 md:border-b-0 md:border-r">
            <p className="mb-2 text-[11px] font-black text-muted-foreground">톡방</p>
            <div className="space-y-2">
              {chatRooms.length === 0 ? (
                <p className="py-7 text-center text-[11px] text-muted-foreground">열린 톡방이 없습니다.</p>
              ) : chatRooms.map((room) => (
                <button
                  key={room.id}
                  type="button"
                  onClick={() => setActiveChatRoom(room)}
                  className={`block w-full rounded-2xl px-3 py-2 text-left transition ${activeChatRoom?.id === room.id ? 'bg-primary text-primary-foreground shadow-sm shadow-primary/20' : 'bg-card/75 hover:bg-secondary/60'}`}
                >
                  <div className="flex items-center gap-2">
                    <img src={room.other_user.avatar_url} alt={room.other_user.username} className="h-8 w-8 rounded-full border border-border object-cover" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-black">{room.other_user.username}</p>
                      <p className="truncate text-[10px] opacity-75">{room.closed_at ? '닫힌 톡방' : room.last_message?.body || '대화를 시작해 보세요.'}</p>
                    </div>
                    {room.unread_count > 0 && (
                      <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1.5 text-[10px] font-black text-white">{room.unread_count}</span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="flex min-h-0 flex-col">
            {activeChatRoom ? (
              <>
                <div className="flex items-center justify-between gap-2 border-b border-border/70 bg-card/80 px-4 py-3 backdrop-blur">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <img src={activeChatRoom.other_user.avatar_url} alt={activeChatRoom.other_user.username} className="h-9 w-9 rounded-full border border-border object-cover" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-black">{activeChatRoom.other_user.username}</p>
                      <p className="text-[10px] font-bold text-muted-foreground">{activeChatRoom.closed_at ? '닫힌 톡방' : activeChatRoom.is_admin_room ? '관리자 1:1 톡' : '1:1 톡'}</p>
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    {user.role === 'ADMIN' && (
                      <button
                        type="button"
                        onClick={() => toggleAdminRoomClosed(activeChatRoom.id, activeChatRoom.can_send)}
                        className="rounded-full bg-secondary px-2.5 py-1 text-[10px] font-black text-muted-foreground"
                      >
                        {activeChatRoom.can_send ? '닫기' : '열기'}
                      </button>
                    )}
                    {user.role !== 'ADMIN' && !activeChatRoom.can_send && (
                      <button type="button" onClick={() => deleteClosedRoom(activeChatRoom.id)} className="rounded-full bg-rose-500/10 px-2.5 py-1 text-[10px] font-black text-rose-500">방 삭제</button>
                    )}
                  </div>
                </div>

                <div ref={chatScrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-secondary/10 px-4 py-4">
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
                          <div className={`max-w-[78%] rounded-2xl px-3 py-2 shadow-sm ${mine ? 'rounded-br-md bg-primary text-primary-foreground' : 'rounded-bl-md border border-border bg-card text-foreground'}`}>
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
                  {!activeChatRoom.can_send && (
                    <p className="mb-2 rounded-2xl bg-secondary/60 px-3 py-2 text-[11px] font-bold text-muted-foreground">
                      이 톡방은 닫혀 있어 새 메시지를 보낼 수 없습니다.
                    </p>
                  )}
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
                    <button
                      type="button"
                      onClick={sendChat}
                      disabled={!activeChatRoom.can_send || chatSending || !chatMessage.trim()}
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm shadow-primary/20 disabled:opacity-45"
                      aria-label="메시지 보내기"
                    >
                      <Send className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
                <MessageCircle className="mb-3 h-10 w-10 text-primary/70" />
                <p className="text-sm font-black">톡방을 선택해 주세요</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">친구 목록에서 톡을 누르면 대화를 시작할 수 있습니다.</p>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
};
