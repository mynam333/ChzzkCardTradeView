import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/admin';
import { IS_PRODUCTION } from '../config';
import { userRepository } from '../repositories';
import { createRealtimeNotification } from './notificationController';
import { sendPushToUser } from './pushController';
import {
  createFriendRequest,
  getOrCreateChatRoom,
  getRoomForUser,
  getUserSummary,
  hideClosedChatRoom,
  listChatRooms,
  listFriendRequests,
  listFriends,
  listMessages,
  removeFriend,
  respondFriendRequest,
  sendChatMessage,
  setChatRoomClosed
} from '../services/friendChatService';
import { clearChatRoomViewing, isChatRoomViewing, markChatRoomViewing } from '../services/chatPresence';

const jsonError = (res: Response, status: number, message: string, details?: string) =>
  res.status(status).json({ error: status >= 500 ? 'InternalServerError' : 'BadRequest', message, details: IS_PRODUCTION ? undefined : details });

const currentUser = (req: AuthenticatedRequest) => req.user;

const notifyUser = async (userId: string, title: string, body: string, link = 'friends') => {
  await createRealtimeNotification({ user_id: userId, title, body, link });
  sendPushToUser(userId, title, body, `/${link.split('?')[0]}`).catch(() => { /* 푸시 실패는 본 요청을 막지 않습니다. */ });
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
    const [friends, requests, rooms] = await Promise.all([
      listFriends(user.id),
      listFriendRequests(user.id),
      listChatRooms(user.id)
    ]);
    return res.status(200).json({ friends, requests, rooms });
  } catch (err: any) {
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
    await notifyUser(targetId, '친구 신청 도착', `${user.username}님이 친구 신청을 보냈습니다.`, 'friends');
    return res.status(201).json({ request, message: '친구 신청을 보냈습니다.' });
  } catch (err: any) {
    if (err.message === 'AlreadyFriends') return jsonError(res, 400, '이미 친구인 유저입니다.');
    if (err.message === 'PendingRequestExists') return jsonError(res, 400, '이미 대기 중인 친구 신청이 있습니다.');
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
    }
    return res.status(200).json({ ok: true, accepted: accept, room });
  } catch (err: any) {
    return jsonError(res, 400, '처리할 수 없는 친구 신청입니다.', err.message);
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

export const getChatMessages = async (req: AuthenticatedRequest, res: Response) => {
  const user = currentUser(req);
  if (!user) return jsonError(res, 401, '로그인이 필요합니다.');
  const roomId = Number(req.params.room_id);
  try {
    markChatRoomViewing(roomId, user.id);
    const messages = await listMessages(roomId, user.id);
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
    const result = await sendChatMessage(roomId, user.id, body, receiverViewing);

    if (!receiverViewing) {
      await notifyUser(receiverId, `${user.username}님의 1:1 톡`, body.length > 80 ? `${body.slice(0, 80)}...` : body, 'friends');
    }

    return res.status(201).json(result.message);
  } catch (err: any) {
    if (err.message === 'RoomClosed') return jsonError(res, 403, '닫힌 채팅방에는 메시지를 보낼 수 없습니다.');
    return jsonError(res, 500, '메시지 전송 실패', err.message);
  }
};

export const markRoomViewing = async (req: AuthenticatedRequest, res: Response) => {
  const user = currentUser(req);
  if (!user) return jsonError(res, 401, '로그인이 필요합니다.');
  const roomId = Number(req.params.room_id);
  markChatRoomViewing(roomId, user.id);
  return res.status(200).json({ ok: true });
};

export const clearRoomViewing = async (req: AuthenticatedRequest, res: Response) => {
  const user = currentUser(req);
  if (!user) return jsonError(res, 401, '로그인이 필요합니다.');
  const roomId = Number(req.params.room_id);
  clearChatRoomViewing(roomId, user.id);
  return res.status(200).json({ ok: true });
};
