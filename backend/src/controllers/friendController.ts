import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/admin';
import { IS_PRODUCTION } from '../config';
import { userRepository } from '../repositories';
import { createRealtimeNotification } from '../services/notificationDelivery';
import { sendPushToUser } from './pushController';
import {
  CHAT_ATTACHMENT_MAX_ACTIVE_BYTES,
  deleteProcessedChatAttachment,
  getChatAttachmentSourceHash,
  processChatImageAttachment
} from '../services/chatAttachmentService';
import {
  cancelFriendRequest,
  createFriendRequest,
  deleteSavedChatAttachment,
  findReusableChatAttachment,
  getActiveChatAttachmentBytes,
  getOrCreateChatRoom,
  getReusableChatAttachmentById,
  getRoomForUser,
  getUserSummary,
  hideClosedChatRoom,
  listRecentChatAttachments,
  listChatRooms,
  listFriendRequests,
  listFriends,
  listMessages,
  markRoomMessagesRead,
  removeFriend,
  respondFriendRequest,
  saveChatAttachmentRecord,
  sendChatAttachmentMessage,
  sendChatMessage,
  setChatRoomClosed,
  setChatRoomMuted
} from '../services/friendChatService';
import { clearChatRoomViewing, isChatRoomViewing, markChatRoomViewing } from '../services/chatPresence';

const jsonError = (res: Response, status: number, message: string, details?: string, error?: string) =>
  res.status(status).json({ error: error || (status >= 500 ? 'InternalServerError' : 'BadRequest'), message, details: IS_PRODUCTION ? undefined : details });

const currentUser = (req: AuthenticatedRequest) => req.user;

const notificationLinkToPath = (link: string): string => {
  const trimmed = String(link || '').trim();
  if (!trimmed) return '/';
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      return `${url.pathname}${url.search}${url.hash}` || '/';
    } catch {
      return '/';
    }
  }
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
};

const notifyUser = async (userId: string, title: string, body: string, link = 'friends', groupKey?: string) => {
  await createRealtimeNotification({ user_id: userId, title, body, link, group_key: groupKey });
  sendPushToUser(userId, title, body, notificationLinkToPath(link)).catch(() => { /* 푸시 실패는 본 요청을 막지 않습니다. */ });
};

export const searchFriendCandidates = async (req: AuthenticatedRequest, res: Response) => {
  const user = currentUser(req);
  if (!user) return jsonError(res, 401, '로그인이 필요합니다.');

  const keyword = String(req.query.keyword || '').trim();
  if (!keyword) return jsonError(res, 400, '검색어가 필요합니다.');

  try {
    const users = await userRepository.searchByUsername(keyword, 12);
    return res.status(200).json(users
      .filter((candidate) => candidate.id !== user.id)
      .map((candidate) => ({
        id: candidate.id,
        username: candidate.username,
        avatar_url: candidate.avatar_url || `https://api.dicebear.com/10.x/fun-emoji/svg?seed=${candidate.id}`,
        role: candidate.role
      })));
  } catch (err: any) {
    return jsonError(res, 500, '친구 검색 실패', err.message);
  }
};

export const getFriendOverview = async (req: AuthenticatedRequest, res: Response) => {
  const user = currentUser(req);
  if (!user) return jsonError(res, 401, '로그인이 필요합니다.');
  try {
    const friends = await listFriends(user.id).catch((err: any) => {
      console.error('[FriendController] listFriends 실패:', err?.message || err);
      throw err;
    });
    const requests = await listFriendRequests(user.id).catch((err: any) => {
      console.error('[FriendController] listFriendRequests 실패:', err?.message || err);
      throw err;
    });
    const rooms = await listChatRooms(user.id).catch((err: any) => {
      console.error('[FriendController] listChatRooms 실패:', err?.message || err);
      throw err;
    });
    return res.status(200).json({ friends, requests, rooms });
  } catch (err: any) {
    console.error('[FriendController] getFriendOverview 실패:', err?.message || err);
    return jsonError(res, 500, '친구 정보 조회 실패', err.message);
  }
};

export const sendFriendRequest = async (req: AuthenticatedRequest, res: Response) => {
  const user = currentUser(req);
  if (!user) return jsonError(res, 401, '로그인이 필요합니다.');

  const targetId = String(req.body?.user_id || '').trim();
  if (!targetId || targetId === user.id) return jsonError(res, 400, '친구 신청 대상이 올바르지 않습니다.');

  try {
    const target = await getUserSummary(targetId);
    if (!target) return jsonError(res, 404, '대상 유저를 찾을 수 없습니다.');

    const blockedByTarget = await userRepository.isBlocked(targetId, user.id);
    const blockedByRequester = await userRepository.isBlocked(user.id, targetId);
    if (blockedByTarget || blockedByRequester) {
      return res.status(403).json({ error: 'Blocked', message: '차단 관계가 있어 친구 신청을 보낼 수 없습니다.' });
    }

    const request = await createFriendRequest(user.id, targetId);
    try {
      await notifyUser(targetId, '친구 신청 도착', `${user.username}님이 친구 신청을 보냈습니다.`, 'friends');
    } catch (notifyErr: any) {
      console.error('[FriendController] 친구 신청 알림 발송 실패:', notifyErr?.message || notifyErr);
    }
    return res.status(201).json({ request, message: '친구 신청을 보냈습니다.' });
  } catch (err: any) {
    if (err.message === 'AlreadyFriends') {
      return res.status(200).json({ ok: true, already_friends: true, message: '이미 친구인 유저입니다.' });
    }
    if (err.message === 'PendingRequestExists') {
      return res.status(200).json({ ok: true, already_pending: true, message: '이미 대기 중인 친구 신청이 있습니다.' });
    }
    return jsonError(res, 500, '친구 신청 실패', err.message);
  }
};

export const respondToFriendRequest = async (req: AuthenticatedRequest, res: Response) => {
  const user = currentUser(req);
  if (!user) return jsonError(res, 401, '로그인이 필요합니다.');

  const requestId = Number(req.params.request_id);
  const accept = req.body?.accept === true;
  if (!requestId) return jsonError(res, 400, '친구 신청 ID가 필요합니다.');

  try {
    const { request, room } = await respondFriendRequest(requestId, user.id, accept);
    const responderName = user.username;
    if (accept) {
      await notifyUser(request.requester_id, '친구 신청 수락', `${responderName}님이 친구 신청을 수락했습니다. 이제 1:1 톡을 사용할 수 있습니다.`, 'friends');
    } else {
      await notifyUser(request.requester_id, '친구 신청 거절', `${responderName}님이 친구 신청을 거절했습니다.`, 'friends');
    }
    return res.status(200).json({ ok: true, accepted: accept, room });
  } catch (err: any) {
    return jsonError(res, 400, '처리할 수 없는 친구 신청입니다.', err.message);
  }
};

export const cancelOutgoingFriendRequest = async (req: AuthenticatedRequest, res: Response) => {
  const user = currentUser(req);
  if (!user) return jsonError(res, 401, '로그인이 필요합니다.');

  const requestId = Number(req.params.request_id);
  if (!requestId) return jsonError(res, 400, '친구 신청 ID가 필요합니다.');

  try {
    await cancelFriendRequest(requestId, user.id);
    return res.status(200).json({ ok: true, canceled: true, message: '친구 신청을 취소했습니다.' });
  } catch (err: any) {
    return jsonError(res, 400, '취소할 수 없는 친구 신청입니다.', err.message);
  }
};

export const deleteFriend = async (req: AuthenticatedRequest, res: Response) => {
  const user = currentUser(req);
  if (!user) return jsonError(res, 401, '로그인이 필요합니다.');
  const friendId = String(req.params.user_id || '').trim();
  if (!friendId) return jsonError(res, 400, '친구 ID가 필요합니다.');
  try {
    await removeFriend(user.id, friendId);
    return res.status(200).json({ ok: true, message: '친구를 삭제했습니다.' });
  } catch (err: any) {
    return jsonError(res, 500, '친구 삭제 실패', err.message);
  }
};

export const getChatRooms = async (req: AuthenticatedRequest, res: Response) => {
  const user = currentUser(req);
  if (!user) return jsonError(res, 401, '로그인이 필요합니다.');
  try {
    return res.status(200).json(await listChatRooms(user.id));
  } catch (err: any) {
    return jsonError(res, 500, '채팅방 조회 실패', err.message);
  }
};

export const openChatRoom = async (req: AuthenticatedRequest, res: Response) => {
  const user = currentUser(req);
  if (!user) return jsonError(res, 401, '로그인이 필요합니다.');
  const targetId = String(req.body?.user_id || '').trim();
  if (!targetId || targetId === user.id) return jsonError(res, 400, '대상 유저가 올바르지 않습니다.');
  try {
    const isAdminOpen = user.role === 'ADMIN';
    if (!isAdminOpen) {
      const friends = await listFriends(user.id);
      if (!friends.some((friend) => friend.id === targetId)) return jsonError(res, 403, '친구에게만 1:1 톡을 열 수 있습니다.');
    }
    const room = await getOrCreateChatRoom(user.id, targetId, isAdminOpen);
    return res.status(200).json(room);
  } catch (err: any) {
    return jsonError(res, 500, '채팅방 열기 실패', err.message);
  }
};

export const closeChatRoom = async (req: AuthenticatedRequest, res: Response) => {
  const user = currentUser(req);
  if (!user) return jsonError(res, 401, '로그인이 필요합니다.');
  if (user.role !== 'ADMIN') return jsonError(res, 403, '관리자만 채팅방을 닫거나 다시 열 수 있습니다.');
  const roomId = Number(req.params.room_id);
  const closed = req.body?.closed !== false;
  try {
    await setChatRoomClosed(roomId, user.id, closed);
    return res.status(200).json({ ok: true, closed });
  } catch (err: any) {
    return jsonError(res, 500, '채팅방 상태 변경 실패', err.message);
  }
};

export const deleteClosedChatRoom = async (req: AuthenticatedRequest, res: Response) => {
  const user = currentUser(req);
  if (!user) return jsonError(res, 401, '로그인이 필요합니다.');
  const roomId = Number(req.params.room_id);
  try {
    await hideClosedChatRoom(roomId, user.id);
    return res.status(200).json({ ok: true });
  } catch (err: any) {
    return jsonError(res, 400, '닫힌 채팅방만 삭제할 수 있습니다.', err.message);
  }
};

export const setChatRoomMute = async (req: AuthenticatedRequest, res: Response) => {
  const user = currentUser(req);
  if (!user) return jsonError(res, 401, '로그인이 필요합니다.');
  const roomId = Number(req.params.room_id);
  const muted = req.body?.muted === true;
  if (!roomId) return jsonError(res, 400, '채팅방 ID가 필요합니다.');
  try {
    const room = await setChatRoomMuted(roomId, user.id, muted);
    return res.status(200).json({ ok: true, muted, room });
  } catch (err: any) {
    return jsonError(res, 404, '채팅방 알림 설정을 변경할 수 없습니다.', err.message);
  }
};

export const getChatMessages = async (req: AuthenticatedRequest, res: Response) => {
  const user = currentUser(req);
  if (!user) return jsonError(res, 401, '로그인이 필요합니다.');
  const roomId = Number(req.params.room_id);
  try {
    markChatRoomViewing(roomId, user.id);
    const beforeId = req.query.before_id ? Number(req.query.before_id) : null;
    const afterId = req.query.after_id ? Number(req.query.after_id) : null;
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    const messages = await listMessages(roomId, user.id, { beforeId, afterId, limit });
    return res.status(200).json(messages);
  } catch (err: any) {
    return jsonError(res, 404, '채팅방을 찾을 수 없습니다.', err.message);
  }
};

export const createChatMessage = async (req: AuthenticatedRequest, res: Response) => {
  const user = currentUser(req);
  if (!user) return jsonError(res, 401, '로그인이 필요합니다.');
  const roomId = Number(req.params.room_id);
  const body = String(req.body?.body || '').trim();
  if (!body || body.length > 1000) return jsonError(res, 400, '메시지는 1~1000자만 보낼 수 있습니다.');

  try {
    const room = await getRoomForUser(roomId, user.id);
    if (!room) return jsonError(res, 404, '채팅방을 찾을 수 없습니다.');
    const receiverId = room.user_a_id === user.id ? room.user_b_id : room.user_a_id;
    const receiverViewing = isChatRoomViewing(roomId, receiverId);
    const receiverMuted = room.user_a_id === receiverId ? room.muted_for_a : room.muted_for_b;
    const result = await sendChatMessage(roomId, user.id, body, receiverViewing);

    if (!receiverViewing && !receiverMuted) {
      await notifyUser(receiverId, `${user.username}님의 1:1 톡`, body.length > 80 ? `${body.slice(0, 80)}...` : body, `friends?room=${roomId}`, `friend-chat:${user.id}`);
    }

    return res.status(201).json(result.message);
  } catch (err: any) {
    if (err.message === 'RoomClosed') return jsonError(res, 403, '닫힌 채팅방에는 메시지를 보낼 수 없습니다.');
    return jsonError(res, 500, '메시지 전송 실패', err.message);
  }
};

export const createChatImageMessage = async (req: AuthenticatedRequest, res: Response) => {
  const user = currentUser(req);
  if (!user) return jsonError(res, 401, '로그인이 필요합니다.');
  const roomId = Number(req.params.room_id);
  if (!roomId) return jsonError(res, 400, '채팅방 ID가 필요합니다.');
  if (!req.file) return jsonError(res, 400, '첨부할 이미지가 필요합니다.');
  const file = req.file;

  let pendingProcessedUrl: string | null = null;
  let savedAttachment: Awaited<ReturnType<typeof findReusableChatAttachment>> = null;
  let messageCreated = false;
  try {
    const room = await getRoomForUser(roomId, user.id);
    if (!room) return jsonError(res, 404, '채팅방을 찾을 수 없습니다.');

    const sourceHash = getChatAttachmentSourceHash(file);
    const reusableAttachment = await findReusableChatAttachment(user.id, sourceHash);
    const attachment = reusableAttachment || await (async () => {
      const activeBytes = await getActiveChatAttachmentBytes(user.id);
      if (activeBytes >= CHAT_ATTACHMENT_MAX_ACTIVE_BYTES || activeBytes + file.size > CHAT_ATTACHMENT_MAX_ACTIVE_BYTES) {
        throw new Error('ChatAttachmentLimitExceeded');
      }

      const processed = await processChatImageAttachment(user.id, file);
      pendingProcessedUrl = processed.url;
      if (activeBytes + processed.sizeBytes > CHAT_ATTACHMENT_MAX_ACTIVE_BYTES) {
        deleteProcessedChatAttachment(processed.url);
        pendingProcessedUrl = null;
        throw new Error('ChatAttachmentLimitExceeded');
      }
      const saved = await saveChatAttachmentRecord(user.id, sourceHash, processed);
      pendingProcessedUrl = null;
      savedAttachment = saved;
      return saved;
    })();
    if (reusableAttachment) {
      savedAttachment = reusableAttachment;
    }

    const receiverId = room.user_a_id === user.id ? room.user_b_id : room.user_a_id;
    const receiverViewing = isChatRoomViewing(roomId, receiverId);
    const receiverMuted = room.user_a_id === receiverId ? room.muted_for_a : room.muted_for_b;
    const result = await sendChatAttachmentMessage(roomId, user.id, attachment, receiverViewing);
    messageCreated = true;

    if (!receiverViewing && !receiverMuted) {
      await notifyUser(receiverId, `${user.username}님의 1:1 톡`, '이미지를 보냈습니다.', `friends?room=${roomId}`, `friend-chat:${user.id}`);
    }

    return res.status(201).json(result.message);
  } catch (err: any) {
    if (pendingProcessedUrl) deleteProcessedChatAttachment(pendingProcessedUrl);
    if (savedAttachment && !savedAttachment.reused && !messageCreated) await deleteSavedChatAttachment(savedAttachment).catch(() => { /* noop */ });
    if (err.message === 'RoomClosed') return jsonError(res, 403, '닫힌 채팅방에는 메시지를 보낼 수 없습니다.');
    if (err.message === 'ChatAttachmentLimitExceeded') {
      return jsonError(res, 413, '이미지 첨부 보관 한도 100MB를 초과했습니다. 오래된 첨부가 만료된 뒤 다시 시도해 주세요.', undefined, 'ChatAttachmentLimitExceeded');
    }
    const badRequest = /이미지|ffmpeg|GIF|변환|첨부/.test(String(err.message || ''));
    return jsonError(res, badRequest ? 400 : 500, badRequest ? err.message : '이미지 메시지 전송 실패', err.message);
  }
};

export const getRecentChatAttachments = async (req: AuthenticatedRequest, res: Response) => {
  const user = currentUser(req);
  if (!user) return jsonError(res, 401, '로그인이 필요합니다.');
  try {
    const page = await listRecentChatAttachments(user.id, {
      cursor: typeof req.query.cursor === 'string' ? req.query.cursor : null,
      limit: req.query.limit ? Number(req.query.limit) : undefined
    });
    return res.status(200).json(page);
  } catch (err: any) {
    return jsonError(res, 500, '최근 첨부함을 불러오지 못했습니다.', err.message);
  }
};

export const reuseChatAttachmentMessage = async (req: AuthenticatedRequest, res: Response) => {
  const user = currentUser(req);
  if (!user) return jsonError(res, 401, '로그인이 필요합니다.');
  const roomId = Number(req.params.room_id);
  const attachmentId = Number(req.body?.attachment_id);
  if (!roomId) return jsonError(res, 400, '채팅방 ID가 필요합니다.');
  if (!attachmentId) return jsonError(res, 400, '첨부 ID가 필요합니다.');

  try {
    const room = await getRoomForUser(roomId, user.id);
    if (!room) return jsonError(res, 404, '채팅방을 찾을 수 없습니다.');

    const attachment = await getReusableChatAttachmentById(user.id, attachmentId);
    if (!attachment) return jsonError(res, 404, '재사용할 수 있는 첨부를 찾을 수 없습니다.');

    const receiverId = room.user_a_id === user.id ? room.user_b_id : room.user_a_id;
    const receiverViewing = isChatRoomViewing(roomId, receiverId);
    const receiverMuted = room.user_a_id === receiverId ? room.muted_for_a : room.muted_for_b;
    const result = await sendChatAttachmentMessage(roomId, user.id, attachment, receiverViewing);

    if (!receiverViewing && !receiverMuted) {
      await notifyUser(receiverId, `${user.username}님의 1:1 톡`, '이미지를 보냈습니다.', `friends?room=${roomId}`, `friend-chat:${user.id}`);
    }

    return res.status(201).json(result.message);
  } catch (err: any) {
    if (err.message === 'RoomClosed') return jsonError(res, 403, '닫힌 채팅방에는 메시지를 보낼 수 없습니다.');
    return jsonError(res, 500, '이미지 재사용 전송 실패', err.message);
  }
};

export const markRoomViewing = async (req: AuthenticatedRequest, res: Response) => {
  const user = currentUser(req);
  if (!user) return jsonError(res, 401, '로그인이 필요합니다.');
  const roomId = Number(req.params.room_id);
  try {
    markChatRoomViewing(roomId, user.id);
    await markRoomMessagesRead(roomId, user.id);
    return res.status(200).json({ ok: true });
  } catch (err: any) {
    return jsonError(res, 404, '채팅방을 찾을 수 없습니다.', err.message);
  }
};

export const clearRoomViewing = async (req: AuthenticatedRequest, res: Response) => {
  const user = currentUser(req);
  if (!user) return jsonError(res, 401, '로그인이 필요합니다.');
  const roomId = Number(req.params.room_id);
  clearChatRoomViewing(roomId, user.id);
  return res.status(200).json({ ok: true });
};
