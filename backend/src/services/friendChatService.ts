import { deleteLocalUploadByUrl, formatUploadUrl } from './imageService';
import { getDbMode, getMysqlDb, getSqliteDb, getSupabaseClient } from './db';
import { extractFirstUrl, getLinkPreviewForText, type ChatLinkPreview } from './linkPreviewService';
import { notificationRepository } from '../repositories';

export type FriendRequestStatus = 'pending' | 'accepted' | 'rejected' | 'canceled';

export type ChatUserSummary = {
  id: string;
  username: string;
  avatar_url: string | null;
  role?: 'USER' | 'ADMIN';
  last_seen_at?: string | null;
};

export type FriendRequestRow = {
  id: number;
  requester_id: string;
  receiver_id: string;
  status: FriendRequestStatus;
  created_at: string;
  responded_at?: string | null;
  requester?: ChatUserSummary;
  receiver?: ChatUserSummary;
};

export type ChatRoomRow = {
  id: number;
  user_a_id: string;
  user_b_id: string;
  is_admin_room: boolean;
  closed_at?: string | null;
  closed_by_user_id?: string | null;
  deleted_for_a: boolean;
  deleted_for_b: boolean;
  hidden_after_a?: string | null;
  hidden_after_b?: string | null;
  muted_for_a: boolean;
  muted_for_b: boolean;
  is_muted: boolean;
  created_at: string;
  updated_at: string;
  other_user: ChatUserSummary;
  last_message?: ChatMessageRow | null;
  unread_count: number;
  can_send: boolean;
};

export type ChatMessageRow = {
  id: number;
  room_id: number;
  sender_id: string;
  body: string;
  message_type: 'text' | 'image';
  attachment_url?: string | null;
  attachment_mime?: string | null;
  attachment_size_bytes?: number | null;
  attachment_width?: number | null;
  attachment_height?: number | null;
  attachment_expires_at?: string | null;
  attachment_deleted_at?: string | null;
  attachment_expired?: boolean;
  link_preview?: ChatLinkPreview | null;
  created_at: string;
  read_at?: string | null;
};

export type ChatAttachmentInput = {
  attachmentId?: number | null;
  url: string;
  mime: string;
  sizeBytes: number;
  width?: number | null;
  height?: number | null;
  expiresAt: Date;
  reused?: boolean;
};

export type RecentChatAttachment = {
  id: number;
  url: string;
  mime: string;
  size_bytes: number;
  width?: number | null;
  height?: number | null;
  last_used_at: string;
  expires_at: string;
};

export type RecentChatAttachmentPage = {
  attachments: RecentChatAttachment[];
  nextCursor: string | null;
  hasMore: boolean;
};

const pair = (a: string, b: string) => a.localeCompare(b) <= 0 ? [a, b] : [b, a];
const bool = (value: any) => value === true || value === 1 || value === '1';

const avatarFallback = (id: string) => `https://api.dicebear.com/10.x/fun-emoji/svg?seed=${encodeURIComponent(id)}`;

const normalizeUtcDateTime = (value: any): string => {
  if (!value) return value;
  if (value instanceof Date) return value.toISOString();
  const raw = String(value);
  const timezoneLessDateTime = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/;
  return timezoneLessDateTime.test(raw) ? `${raw.replace(' ', 'T')}Z` : raw;
};

const mapUser = (row: any): ChatUserSummary => ({
  id: row.id,
  username: row.username,
  avatar_url: row.avatar_url || avatarFallback(row.id),
  role: row.role,
  last_seen_at: row.last_seen_at ? normalizeUtcDateTime(row.last_seen_at) : null
});

const mapMessage = (row: any): ChatMessageRow => ({
  ...(() => {
    const attachmentUrl = row.effective_attachment_url ?? row.attachment_url;
    const attachmentMime = row.effective_attachment_mime ?? row.attachment_mime;
    const attachmentSizeBytes = row.effective_attachment_size_bytes ?? row.attachment_size_bytes;
    const attachmentWidth = row.effective_attachment_width ?? row.attachment_width;
    const attachmentHeight = row.effective_attachment_height ?? row.attachment_height;
    const attachmentExpiresAt = row.effective_attachment_expires_at ?? row.attachment_expires_at;
    const attachmentDeletedAt = row.effective_attachment_deleted_at ?? row.attachment_deleted_at;
    const expiresAt = attachmentExpiresAt ? new Date(normalizeUtcDateTime(attachmentExpiresAt)).getTime() : 0;
    const expired = Boolean(attachmentDeletedAt) || Boolean(expiresAt && expiresAt <= Date.now());
    let linkPreview: ChatLinkPreview | null = null;
    if (row.link_preview_json) {
      try { linkPreview = JSON.parse(row.link_preview_json); } catch { linkPreview = null; }
    }
    return {
      id: Number(row.id),
      room_id: Number(row.room_id),
      sender_id: row.sender_id,
      body: row.body,
      message_type: row.message_type === 'image' ? 'image' : 'text',
      attachment_url: expired ? null : formatUploadUrl(attachmentUrl),
      attachment_mime: attachmentMime ?? null,
      attachment_size_bytes: attachmentSizeBytes == null ? null : Number(attachmentSizeBytes),
      attachment_width: attachmentWidth == null ? null : Number(attachmentWidth),
      attachment_height: attachmentHeight == null ? null : Number(attachmentHeight),
      attachment_expires_at: attachmentExpiresAt ? normalizeUtcDateTime(attachmentExpiresAt) : null,
      attachment_deleted_at: attachmentDeletedAt ? normalizeUtcDateTime(attachmentDeletedAt) : null,
      attachment_expired: expired,
      link_preview: linkPreview,
      created_at: normalizeUtcDateTime(row.created_at),
      read_at: row.read_at ? normalizeUtcDateTime(row.read_at) : null
    };
  })()
});

const mapRoom = (row: any): ChatRoomRow => ({
  id: Number(row.id),
  user_a_id: row.user_a_id,
  user_b_id: row.user_b_id,
  is_admin_room: bool(row.is_admin_room),
  closed_at: row.closed_at ?? null,
  closed_by_user_id: row.closed_by_user_id ?? null,
  deleted_for_a: bool(row.deleted_for_a),
  deleted_for_b: bool(row.deleted_for_b),
  hidden_after_a: row.hidden_after_a ? normalizeUtcDateTime(row.hidden_after_a) : null,
  hidden_after_b: row.hidden_after_b ? normalizeUtcDateTime(row.hidden_after_b) : null,
  muted_for_a: bool(row.muted_for_a),
  muted_for_b: bool(row.muted_for_b),
  is_muted: bool(row.is_muted),
  created_at: row.created_at,
  updated_at: row.updated_at,
  other_user: mapUser({
    id: row.other_id,
    username: row.other_username,
    avatar_url: row.other_avatar_url,
    role: row.other_role,
    last_seen_at: row.other_last_seen_at
  }),
  last_message: row.last_message_id ? mapMessage({
    id: row.last_message_id,
    room_id: row.id,
    sender_id: row.last_sender_id,
    body: row.last_body,
    created_at: row.last_created_at,
    read_at: row.last_read_at
  }) : null,
  unread_count: Number(row.unread_count || 0),
  can_send: !row.closed_at
});

export const getUserSummary = async (userId: string): Promise<ChatUserSummary | null> => {
  const mode = getDbMode();
  if (mode === 'MYSQL') {
    const row = await getMysqlDb().get<any>('SELECT id, username, avatar_url, role, last_seen_at FROM users WHERE id = ?', userId);
    return row ? mapUser(row) : null;
  }
  if (mode === 'SUPABASE') {
    const { data } = await getSupabaseClient().from('users').select('id, username, avatar_url, role, last_seen_at').eq('id', userId).maybeSingle();
    return data ? mapUser(data) : null;
  }
  const row = getSqliteDb().prepare('SELECT id, username, avatar_url, role, last_seen_at FROM users WHERE id = ?').get(userId) as any;
  return row ? mapUser(row) : null;
};

export const areFriends = async (a: string, b: string): Promise<boolean> => {
  const [userA, userB] = pair(a, b);
  const mode = getDbMode();
  if (mode === 'MYSQL') {
    return Boolean(await getMysqlDb().get('SELECT 1 FROM friendships WHERE user_a_id = ? AND user_b_id = ? LIMIT 1', userA, userB));
  }
  if (mode === 'SUPABASE') {
    const { data } = await getSupabaseClient().from('friendships').select('user_a_id').eq('user_a_id', userA).eq('user_b_id', userB).maybeSingle();
    return Boolean(data);
  }
  return Boolean(getSqliteDb().prepare('SELECT 1 FROM friendships WHERE user_a_id = ? AND user_b_id = ? LIMIT 1').get(userA, userB));
};

export const listFriends = async (userId: string): Promise<ChatUserSummary[]> => {
  const mode = getDbMode();
  const mysqlSql = `
    SELECT u.id, u.username, u.avatar_url, u.role, u.last_seen_at
      FROM friendships f
      JOIN users u
        ON u.id COLLATE utf8mb4_unicode_ci = (
          CASE WHEN f.user_a_id = ? COLLATE utf8mb4_unicode_ci THEN f.user_b_id ELSE f.user_a_id END
        ) COLLATE utf8mb4_unicode_ci
     WHERE f.user_a_id = ? COLLATE utf8mb4_unicode_ci
        OR f.user_b_id = ? COLLATE utf8mb4_unicode_ci
     ORDER BY u.username ASC
  `;
  const sql = `
    SELECT u.id, u.username, u.avatar_url, u.role, u.last_seen_at
      FROM friendships f
      JOIN users u ON u.id = CASE WHEN f.user_a_id = ? THEN f.user_b_id ELSE f.user_a_id END
     WHERE f.user_a_id = ? OR f.user_b_id = ?
     ORDER BY u.username ASC
  `;
  if (mode === 'MYSQL') return (await getMysqlDb().all<any>(mysqlSql, userId, userId, userId)).map(mapUser);
  if (mode === 'SUPABASE') {
    const { data } = await getSupabaseClient()
      .from('friendships')
      .select('user_a_id, user_b_id')
      .or(`user_a_id.eq.${userId},user_b_id.eq.${userId}`);
    const ids = (data || []).map((f: any) => f.user_a_id === userId ? f.user_b_id : f.user_a_id);
    if (ids.length === 0) return [];
    const { data: users } = await getSupabaseClient().from('users').select('id, username, avatar_url, role, last_seen_at').in('id', ids);
    return (users || []).map(mapUser).sort((a, b) => a.username.localeCompare(b.username));
  }
  return (getSqliteDb().prepare(sql).all(userId, userId, userId) as any[]).map(mapUser);
};

const listRequestsSql = (where: string) => `
  SELECT fr.*,
         requester.username AS requester_username,
         requester.avatar_url AS requester_avatar_url,
         requester.role AS requester_role,
         receiver.username AS receiver_username,
         receiver.avatar_url AS receiver_avatar_url,
         receiver.role AS receiver_role
    FROM friend_requests fr
    JOIN users requester ON requester.id = fr.requester_id
    JOIN users receiver ON receiver.id = fr.receiver_id
   WHERE ${where}
   ORDER BY fr.id DESC
`;

const listRequestsMysqlSql = (where: string) => `
  SELECT fr.*,
         requester.username AS requester_username,
         requester.avatar_url AS requester_avatar_url,
         requester.role AS requester_role,
         receiver.username AS receiver_username,
         receiver.avatar_url AS receiver_avatar_url,
         receiver.role AS receiver_role
    FROM friend_requests fr
    JOIN users requester ON requester.id COLLATE utf8mb4_unicode_ci = fr.requester_id COLLATE utf8mb4_unicode_ci
    JOIN users receiver ON receiver.id COLLATE utf8mb4_unicode_ci = fr.receiver_id COLLATE utf8mb4_unicode_ci
   WHERE ${where}
   ORDER BY fr.id DESC
`;

const mapRequest = (row: any): FriendRequestRow => ({
  id: Number(row.id),
  requester_id: row.requester_id,
  receiver_id: row.receiver_id,
  status: row.status,
  created_at: row.created_at,
  responded_at: row.responded_at ?? null,
  requester: mapUser({ id: row.requester_id, username: row.requester_username, avatar_url: row.requester_avatar_url, role: row.requester_role }),
  receiver: mapUser({ id: row.receiver_id, username: row.receiver_username, avatar_url: row.receiver_avatar_url, role: row.receiver_role })
});

export const listFriendRequests = async (userId: string) => {
  const mode = getDbMode();
  const incomingSql = listRequestsSql("fr.receiver_id = ? AND fr.status = 'pending'");
  const outgoingSql = listRequestsSql("fr.requester_id = ? AND fr.status = 'pending'");
  const incomingMysqlSql = listRequestsMysqlSql("fr.receiver_id = ? COLLATE utf8mb4_unicode_ci AND fr.status = 'pending'");
  const outgoingMysqlSql = listRequestsMysqlSql("fr.requester_id = ? COLLATE utf8mb4_unicode_ci AND fr.status = 'pending'");
  if (mode === 'MYSQL') {
    const [incoming, outgoing] = await Promise.all([
      getMysqlDb().all<any>(incomingMysqlSql, userId),
      getMysqlDb().all<any>(outgoingMysqlSql, userId)
    ]);
    return { incoming: incoming.map(mapRequest), outgoing: outgoing.map(mapRequest) };
  }
  if (mode === 'SUPABASE') {
    const { data } = await getSupabaseClient()
      .from('friend_requests')
      .select('*')
      .or(`requester_id.eq.${userId},receiver_id.eq.${userId}`)
      .eq('status', 'pending')
      .order('id', { ascending: false });
    const users = await Promise.all(Array.from(new Set((data || []).flatMap((r: any) => [r.requester_id, r.receiver_id]))).map(getUserSummary));
    const userMap = new Map(users.filter(Boolean).map((u) => [u!.id, u!]));
    const mapped = (data || []).map((r: any) => ({ ...r, requester: userMap.get(r.requester_id), receiver: userMap.get(r.receiver_id) }));
    return { incoming: mapped.filter((r: any) => r.receiver_id === userId), outgoing: mapped.filter((r: any) => r.requester_id === userId) };
  }
  const db = getSqliteDb();
  return {
    incoming: (db.prepare(incomingSql).all(userId) as any[]).map(mapRequest),
    outgoing: (db.prepare(outgoingSql).all(userId) as any[]).map(mapRequest)
  };
};

export const createFriendRequest = async (requesterId: string, receiverId: string): Promise<FriendRequestRow> => {
  const mode = getDbMode();
  if (await areFriends(requesterId, receiverId)) throw new Error('AlreadyFriends');
  if (mode === 'MYSQL') {
    const db = getMysqlDb();
    const existing = await db.get<any>(
      "SELECT * FROM friend_requests WHERE status = 'pending' AND ((requester_id = ? AND receiver_id = ?) OR (requester_id = ? AND receiver_id = ?)) LIMIT 1",
      requesterId, receiverId, receiverId, requesterId
    );
    if (existing) throw new Error('PendingRequestExists');
    const result = await db.run(
      "INSERT INTO friend_requests (requester_id, receiver_id, status, created_at) VALUES (?, ?, 'pending', UTC_TIMESTAMP())",
      requesterId, receiverId
    );
    const row = await db.get<any>(listRequestsMysqlSql('fr.id = ?'), result.insertId);
    return mapRequest(row);
  }
  if (mode === 'SUPABASE') {
    const { data: existing } = await getSupabaseClient()
      .from('friend_requests')
      .select('*')
      .eq('status', 'pending')
      .or(`and(requester_id.eq.${requesterId},receiver_id.eq.${receiverId}),and(requester_id.eq.${receiverId},receiver_id.eq.${requesterId})`);
    if ((existing || []).length > 0) throw new Error('PendingRequestExists');
    const { data, error } = await getSupabaseClient()
      .from('friend_requests')
      .insert({ requester_id: requesterId, receiver_id: receiverId, status: 'pending' })
      .select('*')
      .single();
    if (error) throw error;
    return data as FriendRequestRow;
  }
  const db = getSqliteDb();
  const existing = db.prepare(
    "SELECT * FROM friend_requests WHERE status = 'pending' AND ((requester_id = ? AND receiver_id = ?) OR (requester_id = ? AND receiver_id = ?)) LIMIT 1"
  ).get(requesterId, receiverId, receiverId, requesterId);
  if (existing) throw new Error('PendingRequestExists');
  const result = db.prepare("INSERT INTO friend_requests (requester_id, receiver_id, status) VALUES (?, ?, 'pending')").run(requesterId, receiverId);
  return mapRequest(db.prepare(listRequestsSql('fr.id = ?')).get(result.lastInsertRowid));
};

export const respondFriendRequest = async (requestId: number, userId: string, accept: boolean) => {
  const mode = getDbMode();
  const request = mode === 'MYSQL'
    ? await getMysqlDb().get<any>('SELECT * FROM friend_requests WHERE id = ?', requestId)
    : mode === 'SUPABASE'
      ? (await getSupabaseClient().from('friend_requests').select('*').eq('id', requestId).maybeSingle()).data as any
      : getSqliteDb().prepare('SELECT * FROM friend_requests WHERE id = ?').get(requestId) as any;
  if (!request || request.receiver_id !== userId || request.status !== 'pending') throw new Error('InvalidRequest');

  const status: FriendRequestStatus = accept ? 'accepted' : 'rejected';
  const [userA, userB] = pair(request.requester_id, request.receiver_id);
  if (mode === 'MYSQL') {
    const db = getMysqlDb();
    await db.run('UPDATE friend_requests SET status = ?, responded_at = UTC_TIMESTAMP() WHERE id = ?', status, requestId);
    if (accept) await db.run('INSERT IGNORE INTO friendships (user_a_id, user_b_id, created_at) VALUES (?, ?, UTC_TIMESTAMP())', userA, userB);
  } else if (mode === 'SUPABASE') {
    await getSupabaseClient().from('friend_requests').update({ status, responded_at: new Date().toISOString() }).eq('id', requestId);
    if (accept) await getSupabaseClient().from('friendships').upsert({ user_a_id: userA, user_b_id: userB });
  } else {
    const db = getSqliteDb();
    db.prepare("UPDATE friend_requests SET status = ?, responded_at = datetime('now') WHERE id = ?").run(status, requestId);
    if (accept) db.prepare("INSERT OR IGNORE INTO friendships (user_a_id, user_b_id, created_at) VALUES (?, ?, datetime('now'))").run(userA, userB);
  }
  // 채팅방은 친구 수락 시점이 아니라 첫 메시지를 보낼 때 생성합니다.
  // 대화창을 잠깐 열어본 것만으로 빈 방이 목록에 남지 않게 하기 위함입니다.
  return { request, room: null };
};

export const cancelFriendRequest = async (requestId: number, userId: string) => {
  const mode = getDbMode();
  const request = mode === 'MYSQL'
    ? await getMysqlDb().get<any>('SELECT * FROM friend_requests WHERE id = ?', requestId)
    : mode === 'SUPABASE'
      ? (await getSupabaseClient().from('friend_requests').select('*').eq('id', requestId).maybeSingle()).data as any
      : getSqliteDb().prepare('SELECT * FROM friend_requests WHERE id = ?').get(requestId) as any;

  if (!request || request.requester_id !== userId || request.status !== 'pending') throw new Error('InvalidRequest');

  if (mode === 'MYSQL') {
    await getMysqlDb().run("UPDATE friend_requests SET status = 'canceled', responded_at = UTC_TIMESTAMP() WHERE id = ?", requestId);
  } else if (mode === 'SUPABASE') {
    await getSupabaseClient().from('friend_requests').update({ status: 'canceled', responded_at: new Date().toISOString() }).eq('id', requestId);
  } else {
    getSqliteDb().prepare("UPDATE friend_requests SET status = 'canceled', responded_at = datetime('now') WHERE id = ?").run(requestId);
  }

  return request as FriendRequestRow;
};

export const removeFriend = async (userId: string, friendId: string) => {
  const [userA, userB] = pair(userId, friendId);
  const mode = getDbMode();
  const room = await getRoomByUsers(userId, friendId);
  if (mode === 'MYSQL') {
    await getMysqlDb().run('DELETE FROM friendships WHERE user_a_id = ? AND user_b_id = ?', userA, userB);
    if (room) await getMysqlDb().run(
      `UPDATE chat_rooms
          SET closed_at = COALESCE(closed_at, UTC_TIMESTAMP()),
              closed_by_user_id = ?,
              deleted_for_a = CASE WHEN user_a_id = ? THEN 1 ELSE deleted_for_a END,
              deleted_for_b = CASE WHEN user_b_id = ? THEN 1 ELSE deleted_for_b END,
              hidden_after_a = CASE WHEN user_a_id = ? THEN UTC_TIMESTAMP() ELSE hidden_after_a END,
              hidden_after_b = CASE WHEN user_b_id = ? THEN UTC_TIMESTAMP() ELSE hidden_after_b END,
              updated_at = UTC_TIMESTAMP()
        WHERE id = ?`,
      userId, userId, userId, userId, userId, room.id
    );
  } else if (mode === 'SUPABASE') {
    await getSupabaseClient().from('friendships').delete().eq('user_a_id', userA).eq('user_b_id', userB);
    if (room) await getSupabaseClient().from('chat_rooms').update({
      closed_at: room.closed_at || new Date().toISOString(),
      closed_by_user_id: userId,
      deleted_for_a: room.user_a_id === userId ? true : room.deleted_for_a,
      deleted_for_b: room.user_b_id === userId ? true : room.deleted_for_b,
      hidden_after_a: room.user_a_id === userId ? new Date().toISOString() : room.hidden_after_a,
      hidden_after_b: room.user_b_id === userId ? new Date().toISOString() : room.hidden_after_b,
      updated_at: new Date().toISOString()
    }).eq('id', room.id);
  } else {
    const db = getSqliteDb();
    db.prepare('DELETE FROM friendships WHERE user_a_id = ? AND user_b_id = ?').run(userA, userB);
    if (room) db.prepare(
      `UPDATE chat_rooms
          SET closed_at = COALESCE(closed_at, datetime('now')),
              closed_by_user_id = ?,
              deleted_for_a = CASE WHEN user_a_id = ? THEN 1 ELSE deleted_for_a END,
              deleted_for_b = CASE WHEN user_b_id = ? THEN 1 ELSE deleted_for_b END,
              hidden_after_a = CASE WHEN user_a_id = ? THEN datetime('now') ELSE hidden_after_a END,
              hidden_after_b = CASE WHEN user_b_id = ? THEN datetime('now') ELSE hidden_after_b END,
              updated_at = datetime('now')
        WHERE id = ?`
    ).run(userId, userId, userId, userId, userId, room.id);
  }
};

export const getRoomByUsers = async (a: string, b: string): Promise<ChatRoomRow | null> => {
  const [userA, userB] = pair(a, b);
  const mode = getDbMode();
  const baseParams = [a, a, a, a, a, a, a, a];
  if (mode === 'MYSQL') {
    const row = await getMysqlDb().get<any>(
      `${roomSelectMysqlSql(a)}
       WHERE cr.user_a_id = ? COLLATE utf8mb4_unicode_ci
         AND cr.user_b_id = ? COLLATE utf8mb4_unicode_ci
         AND ((cr.user_a_id = ? COLLATE utf8mb4_unicode_ci AND cr.deleted_for_a = 0) OR (cr.user_b_id = ? COLLATE utf8mb4_unicode_ci AND cr.deleted_for_b = 0))
       LIMIT 1`,
      ...baseParams, userA, userB, a, a
    );
    return row ? mapRoom(row) : null;
  }
  if (mode === 'SUPABASE') return (await listChatRooms(a, { includeEmpty: true })).find((room) => room.user_a_id === userA && room.user_b_id === userB) || null;
  const row = getSqliteDb().prepare(
    `${roomSelectSql(a)}
     WHERE cr.user_a_id = ?
       AND cr.user_b_id = ?
       AND ((cr.user_a_id = ? AND cr.deleted_for_a = 0) OR (cr.user_b_id = ? AND cr.deleted_for_b = 0))
     LIMIT 1`
  ).get(...baseParams, userA, userB, a, a) as any;
  return row ? mapRoom(row) : null;
};

const roomSelectSql = (viewerId: string) => `
  SELECT cr.*,
         CASE WHEN cr.user_a_id = ? THEN cr.muted_for_a ELSE cr.muted_for_b END AS is_muted,
         CASE WHEN cr.user_a_id = ? THEN cr.user_b_id ELSE cr.user_a_id END AS other_id,
         u.username AS other_username,
         u.avatar_url AS other_avatar_url,
         u.role AS other_role,
         u.last_seen_at AS other_last_seen_at,
         lm.id AS last_message_id,
         lm.sender_id AS last_sender_id,
         lm.body AS last_body,
         lm.created_at AS last_created_at,
         lm.read_at AS last_read_at,
         (SELECT COUNT(*)
            FROM chat_messages unread
           WHERE unread.room_id = cr.id
             AND unread.sender_id <> ?
             AND unread.read_at IS NULL
             AND (
               CASE WHEN cr.user_a_id = ? THEN cr.hidden_after_a ELSE cr.hidden_after_b END IS NULL
               OR unread.created_at > CASE WHEN cr.user_a_id = ? THEN cr.hidden_after_a ELSE cr.hidden_after_b END
             )) AS unread_count
    FROM chat_rooms cr
    JOIN users u ON u.id = CASE WHEN cr.user_a_id = ? THEN cr.user_b_id ELSE cr.user_a_id END
    LEFT JOIN chat_messages lm ON lm.id = (
      SELECT id
        FROM chat_messages
       WHERE room_id = cr.id
         AND (
           CASE WHEN cr.user_a_id = ? THEN cr.hidden_after_a ELSE cr.hidden_after_b END IS NULL
           OR created_at > CASE WHEN cr.user_a_id = ? THEN cr.hidden_after_a ELSE cr.hidden_after_b END
         )
       ORDER BY id DESC
       LIMIT 1
    )
`;

const roomSelectMysqlSql = (viewerId: string) => `
  SELECT cr.*,
         CASE WHEN cr.user_a_id = ? COLLATE utf8mb4_unicode_ci THEN cr.muted_for_a ELSE cr.muted_for_b END AS is_muted,
         CASE WHEN cr.user_a_id = ? COLLATE utf8mb4_unicode_ci THEN cr.user_b_id ELSE cr.user_a_id END AS other_id,
         u.username AS other_username,
         u.avatar_url AS other_avatar_url,
         u.role AS other_role,
         u.last_seen_at AS other_last_seen_at,
         lm.id AS last_message_id,
         lm.sender_id AS last_sender_id,
         lm.body AS last_body,
         lm.created_at AS last_created_at,
         lm.read_at AS last_read_at,
         (SELECT COUNT(*)
            FROM chat_messages unread
           WHERE unread.room_id = cr.id
             AND unread.sender_id <> ? COLLATE utf8mb4_unicode_ci
             AND unread.read_at IS NULL
             AND (
               CASE WHEN cr.user_a_id = ? COLLATE utf8mb4_unicode_ci THEN cr.hidden_after_a ELSE cr.hidden_after_b END IS NULL
               OR unread.created_at > CASE WHEN cr.user_a_id = ? COLLATE utf8mb4_unicode_ci THEN cr.hidden_after_a ELSE cr.hidden_after_b END
             )) AS unread_count
    FROM chat_rooms cr
    JOIN users u
      ON u.id COLLATE utf8mb4_unicode_ci = (
        CASE WHEN cr.user_a_id = ? COLLATE utf8mb4_unicode_ci THEN cr.user_b_id ELSE cr.user_a_id END
      ) COLLATE utf8mb4_unicode_ci
    LEFT JOIN chat_messages lm ON lm.id = (
      SELECT id
        FROM chat_messages
       WHERE room_id = cr.id
         AND (
           CASE WHEN cr.user_a_id = ? COLLATE utf8mb4_unicode_ci THEN cr.hidden_after_a ELSE cr.hidden_after_b END IS NULL
           OR created_at > CASE WHEN cr.user_a_id = ? COLLATE utf8mb4_unicode_ci THEN cr.hidden_after_a ELSE cr.hidden_after_b END
         )
       ORDER BY id DESC
       LIMIT 1
    )
`;

export const listChatRooms = async (userId: string, options: { includeEmpty?: boolean } = {}): Promise<ChatRoomRow[]> => {
  const mode = getDbMode();
  const emptyRoomCondition = options.includeEmpty
    ? ''
    : 'AND (lm.id IS NOT NULL OR cr.is_admin_room = 1 OR cr.closed_at IS NOT NULL)';
  const sql = `${roomSelectSql(userId)}
   WHERE ((cr.user_a_id = ? AND cr.deleted_for_a = 0) OR (cr.user_b_id = ? AND cr.deleted_for_b = 0))
     ${emptyRoomCondition}
   ORDER BY cr.updated_at DESC, cr.id DESC`;
  const mysqlSql = `${roomSelectMysqlSql(userId)}
   WHERE ((cr.user_a_id = ? COLLATE utf8mb4_unicode_ci AND cr.deleted_for_a = 0) OR (cr.user_b_id = ? COLLATE utf8mb4_unicode_ci AND cr.deleted_for_b = 0))
     ${emptyRoomCondition}
   ORDER BY cr.updated_at DESC, cr.id DESC`;
  const params = [userId, userId, userId, userId, userId, userId, userId, userId, userId, userId];
  if (mode === 'MYSQL') return (await getMysqlDb().all<any>(mysqlSql, ...params)).map(mapRoom);
  if (mode === 'SUPABASE') return [];
  return (getSqliteDb().prepare(sql).all(...params) as any[]).map(mapRoom);
};

export const getRoomForUser = async (roomId: number, userId: string): Promise<ChatRoomRow | null> => {
  const mode = getDbMode();
  const baseParams = [userId, userId, userId, userId, userId, userId, userId, userId];
  if (mode === 'MYSQL') {
    const row = await getMysqlDb().get<any>(
      `${roomSelectMysqlSql(userId)}
       WHERE cr.id = ?
         AND ((cr.user_a_id = ? COLLATE utf8mb4_unicode_ci AND cr.deleted_for_a = 0) OR (cr.user_b_id = ? COLLATE utf8mb4_unicode_ci AND cr.deleted_for_b = 0))
       LIMIT 1`,
      ...baseParams, roomId, userId, userId
    );
    return row ? mapRoom(row) : null;
  }
  if (mode === 'SUPABASE') return (await listChatRooms(userId, { includeEmpty: true })).find((room) => room.id === roomId) || null;
  const row = getSqliteDb().prepare(
    `${roomSelectSql(userId)}
     WHERE cr.id = ?
       AND ((cr.user_a_id = ? AND cr.deleted_for_a = 0) OR (cr.user_b_id = ? AND cr.deleted_for_b = 0))
     LIMIT 1`
  ).get(...baseParams, roomId, userId, userId) as any;
  return row ? mapRoom(row) : null;
};

export const getOrCreateChatRoom = async (a: string, b: string, isAdminRoom: boolean): Promise<ChatRoomRow> => {
  const [userA, userB] = pair(a, b);
  const mode = getDbMode();
  let roomId: number | null = null;
  if (mode === 'MYSQL') {
    const db = getMysqlDb();
    let existing = await db.get<any>('SELECT id FROM chat_rooms WHERE user_a_id = ? AND user_b_id = ? LIMIT 1', userA, userB);
    if (!existing) {
      const result = await db.run(
        'INSERT INTO chat_rooms (user_a_id, user_b_id, is_admin_room, created_at, updated_at) VALUES (?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())',
        userA, userB, isAdminRoom ? 1 : 0
      );
      existing = { id: result.insertId };
    } else {
      const deletedCol = userA === a ? 'deleted_for_a' : 'deleted_for_b';
      await db.run(
        `UPDATE chat_rooms
            SET ${deletedCol} = 0,
                closed_at = NULL,
                closed_by_user_id = NULL,
                is_admin_room = GREATEST(is_admin_room, ?),
                updated_at = UTC_TIMESTAMP()
          WHERE id = ?`,
        isAdminRoom ? 1 : 0, existing.id
      );
    }
    roomId = Number(existing.id);
  } else if (mode === 'SUPABASE') {
    let { data } = await getSupabaseClient().from('chat_rooms').select('id').eq('user_a_id', userA).eq('user_b_id', userB).maybeSingle();
    if (!data) {
      const inserted = await getSupabaseClient().from('chat_rooms').insert({ user_a_id: userA, user_b_id: userB, is_admin_room: isAdminRoom }).select('id').single();
      data = inserted.data;
    } else {
      const patch: Record<string, any> = {
        [userA === a ? 'deleted_for_a' : 'deleted_for_b']: false,
        closed_at: null,
        closed_by_user_id: null,
        updated_at: new Date().toISOString()
      };
      if (isAdminRoom) patch.is_admin_room = true;
      await getSupabaseClient().from('chat_rooms').update(patch).eq('id', data.id);
    }
    roomId = data?.id ? Number(data.id) : null;
  } else {
    const db = getSqliteDb();
    let existing = db.prepare('SELECT id FROM chat_rooms WHERE user_a_id = ? AND user_b_id = ? LIMIT 1').get(userA, userB) as any;
    if (!existing) {
      const result = db.prepare('INSERT INTO chat_rooms (user_a_id, user_b_id, is_admin_room) VALUES (?, ?, ?)').run(userA, userB, isAdminRoom ? 1 : 0);
      existing = { id: result.lastInsertRowid };
    } else {
      const deletedCol = userA === a ? 'deleted_for_a' : 'deleted_for_b';
      db.prepare(`UPDATE chat_rooms
                     SET ${deletedCol} = 0,
                         closed_at = NULL,
                         closed_by_user_id = NULL,
                         is_admin_room = CASE WHEN ? = 1 THEN 1 ELSE is_admin_room END,
                         updated_at = datetime('now')
                   WHERE id = ?`)
        .run(isAdminRoom ? 1 : 0, existing.id);
    }
    roomId = Number(existing.id);
  }
  const room = roomId ? await getRoomForUser(roomId, a) : await getRoomByUsers(a, b);
  if (!room) throw new Error('RoomCreateFailed');
  return room;
};

export const setChatRoomClosed = async (roomId: number, actorId: string, closed: boolean) => {
  const mode = getDbMode();
  if (mode === 'MYSQL') {
    await getMysqlDb().run(
      `UPDATE chat_rooms SET closed_at = ${closed ? 'UTC_TIMESTAMP()' : 'NULL'}, closed_by_user_id = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?`,
      closed ? actorId : null, roomId
    );
  } else if (mode === 'SUPABASE') {
    await getSupabaseClient().from('chat_rooms').update({ closed_at: closed ? new Date().toISOString() : null, closed_by_user_id: closed ? actorId : null, updated_at: new Date().toISOString() }).eq('id', roomId);
  } else {
    getSqliteDb().prepare(`UPDATE chat_rooms SET closed_at = ${closed ? "datetime('now')" : 'NULL'}, closed_by_user_id = ?, updated_at = datetime('now') WHERE id = ?`).run(closed ? actorId : null, roomId);
  }
};

export const hideClosedChatRoom = async (roomId: number, userId: string) => {
  const room = await getRoomForUser(roomId, userId);
  if (!room || !room.closed_at) throw new Error('RoomNotClosed');
  const col = room.user_a_id === userId ? 'deleted_for_a' : 'deleted_for_b';
  const hiddenCol = room.user_a_id === userId ? 'hidden_after_a' : 'hidden_after_b';
  const mode = getDbMode();
  if (mode === 'MYSQL') await getMysqlDb().run(`UPDATE chat_rooms SET ${col} = 1, ${hiddenCol} = UTC_TIMESTAMP() WHERE id = ?`, roomId);
  else if (mode === 'SUPABASE') await getSupabaseClient().from('chat_rooms').update({ [col]: true, [hiddenCol]: new Date().toISOString() }).eq('id', roomId);
  else getSqliteDb().prepare(`UPDATE chat_rooms SET ${col} = 1, ${hiddenCol} = datetime('now') WHERE id = ?`).run(roomId);
};

export const setChatRoomMuted = async (roomId: number, userId: string, muted: boolean): Promise<ChatRoomRow> => {
  const room = await getRoomForUser(roomId, userId);
  if (!room) throw new Error('RoomNotFound');
  const col = room.user_a_id === userId ? 'muted_for_a' : 'muted_for_b';
  const mode = getDbMode();
  if (mode === 'MYSQL') {
    await getMysqlDb().run(`UPDATE chat_rooms SET ${col} = ? WHERE id = ?`, muted ? 1 : 0, roomId);
  } else if (mode === 'SUPABASE') {
    await getSupabaseClient().from('chat_rooms').update({ [col]: muted }).eq('id', roomId);
  } else {
    getSqliteDb().prepare(`UPDATE chat_rooms SET ${col} = ? WHERE id = ?`).run(muted ? 1 : 0, roomId);
  }
  const updated = await getRoomForUser(roomId, userId);
  if (!updated) throw new Error('RoomNotFound');
  return updated;
};

export const listMessages = async (
  roomId: number,
  userId: string,
  options: { beforeId?: number | null; afterId?: number | null; limit?: number } = {}
): Promise<ChatMessageRow[]> => {
  const room = await getRoomForUser(roomId, userId);
  if (!room) throw new Error('RoomNotFound');
  const limit = Math.min(Math.max(Math.floor(Number(options.limit || 50)), 1), 100);
  const beforeId = options.beforeId && Number.isFinite(options.beforeId) ? Math.floor(Number(options.beforeId)) : null;
  const afterId = !beforeId && options.afterId && Number.isFinite(options.afterId) ? Math.floor(Number(options.afterId)) : null;
  const hiddenAfter = room.user_a_id === userId ? room.hidden_after_a : room.hidden_after_b;
  const hiddenAfterSql = hiddenAfter ? hiddenAfter.replace('T', ' ').replace(/Z$/, '') : null;
  const mode = getDbMode();
  if (mode === 'MYSQL') {
    await getMysqlDb().run(
      `UPDATE chat_messages
          SET read_at = COALESCE(read_at, UTC_TIMESTAMP())
        WHERE room_id = ?
          AND sender_id <> ?
          AND read_at IS NULL
          ${afterId ? 'AND id > ?' : ''}
          AND (? IS NULL OR created_at > ?)`,
      ...(afterId
        ? [roomId, userId, afterId, hiddenAfterSql, hiddenAfterSql]
        : [roomId, userId, hiddenAfterSql, hiddenAfterSql])
    );
    const selectSql = `
      SELECT recent.*,
             ca.url AS effective_attachment_url,
             ca.mime AS effective_attachment_mime,
             ca.size_bytes AS effective_attachment_size_bytes,
             ca.width AS effective_attachment_width,
             ca.height AS effective_attachment_height,
             ca.expires_at AS effective_attachment_expires_at,
             ca.deleted_at AS effective_attachment_deleted_at
        FROM (
          SELECT *
            FROM chat_messages
           WHERE room_id = ?
             ${beforeId ? 'AND id < ?' : ''}
             ${afterId ? 'AND id > ?' : ''}
             AND (? IS NULL OR created_at > ?)
           ORDER BY id ${afterId ? 'ASC' : 'DESC'}
           LIMIT ?
        ) recent
        LEFT JOIN chat_attachments ca ON ca.id = recent.attachment_id
       ORDER BY recent.id ASC`;
    const rows = beforeId
      ? await getMysqlDb().all<any>(selectSql, roomId, beforeId, hiddenAfterSql, hiddenAfterSql, limit)
      : afterId
        ? await getMysqlDb().all<any>(selectSql, roomId, afterId, hiddenAfterSql, hiddenAfterSql, limit)
      : await getMysqlDb().all<any>(selectSql, roomId, hiddenAfterSql, hiddenAfterSql, limit);
    return rows.map(mapMessage);
  }
  if (mode === 'SUPABASE') {
    let readQuery = getSupabaseClient().from('chat_messages').update({ read_at: new Date().toISOString() }).eq('room_id', roomId).neq('sender_id', userId).is('read_at', null);
    if (hiddenAfter) readQuery = readQuery.gt('created_at', hiddenAfter);
    if (afterId) readQuery = readQuery.gt('id', afterId);
    await readQuery;
    let query = getSupabaseClient()
      .from('chat_messages')
      .select('*')
      .eq('room_id', roomId)
      .order('id', { ascending: Boolean(afterId) })
      .limit(limit);
    if (beforeId) query = query.lt('id', beforeId);
    if (afterId) query = query.gt('id', afterId);
    if (hiddenAfter) query = query.gt('created_at', hiddenAfter);
    const { data } = await query;
    return (afterId ? (data || []) : (data || []).reverse()).map(mapMessage);
  }
  const db = getSqliteDb();
  db.prepare(`UPDATE chat_messages SET read_at = COALESCE(read_at, datetime('now')) WHERE room_id = ? AND sender_id <> ? AND read_at IS NULL ${afterId ? 'AND id > ?' : ''} AND (? IS NULL OR created_at > ?)`)
    .run(...(afterId ? [roomId, userId, afterId, hiddenAfterSql, hiddenAfterSql] : [roomId, userId, hiddenAfterSql, hiddenAfterSql]));
  const selectSql = `
    SELECT recent.*,
           ca.url AS effective_attachment_url,
           ca.mime AS effective_attachment_mime,
           ca.size_bytes AS effective_attachment_size_bytes,
           ca.width AS effective_attachment_width,
           ca.height AS effective_attachment_height,
           ca.expires_at AS effective_attachment_expires_at,
           ca.deleted_at AS effective_attachment_deleted_at
      FROM (
        SELECT *
          FROM chat_messages
         WHERE room_id = ?
           ${beforeId ? 'AND id < ?' : ''}
           ${afterId ? 'AND id > ?' : ''}
           AND (? IS NULL OR created_at > ?)
         ORDER BY id ${afterId ? 'ASC' : 'DESC'}
         LIMIT ?
      ) recent
      LEFT JOIN chat_attachments ca ON ca.id = recent.attachment_id
     ORDER BY recent.id ASC`;
  const rows = beforeId
    ? db.prepare(selectSql).all(roomId, beforeId, hiddenAfterSql, hiddenAfterSql, limit)
    : afterId
      ? db.prepare(selectSql).all(roomId, afterId, hiddenAfterSql, hiddenAfterSql, limit)
    : db.prepare(selectSql).all(roomId, hiddenAfterSql, hiddenAfterSql, limit);
  return (rows as any[]).map(mapMessage);
};

export const markRoomMessagesRead = async (roomId: number, userId: string): Promise<ChatRoomRow> => {
  const room = await getRoomForUser(roomId, userId);
  if (!room) throw new Error('RoomNotFound');
  const otherUserId = room.user_a_id === userId ? room.user_b_id : room.user_a_id;
  const hiddenAfter = room.user_a_id === userId ? room.hidden_after_a : room.hidden_after_b;
  const hiddenAfterSql = hiddenAfter ? hiddenAfter.replace('T', ' ').replace(/Z$/, '') : null;
  const mode = getDbMode();
  if (mode === 'MYSQL') {
    await getMysqlDb().run(
      `UPDATE chat_messages
          SET read_at = COALESCE(read_at, UTC_TIMESTAMP())
        WHERE room_id = ?
          AND sender_id <> ?
          AND read_at IS NULL
          AND (? IS NULL OR created_at > ?)`,
      roomId,
      userId,
      hiddenAfterSql,
      hiddenAfterSql
    );
  } else if (mode === 'SUPABASE') {
    let query = getSupabaseClient()
      .from('chat_messages')
      .update({ read_at: new Date().toISOString() })
      .eq('room_id', roomId)
      .neq('sender_id', userId)
      .is('read_at', null);
    if (hiddenAfter) query = query.gt('created_at', hiddenAfter);
    await query;
  } else {
    getSqliteDb()
      .prepare("UPDATE chat_messages SET read_at = COALESCE(read_at, datetime('now')) WHERE room_id = ? AND sender_id <> ? AND read_at IS NULL AND (? IS NULL OR created_at > ?)")
      .run(roomId, userId, hiddenAfterSql, hiddenAfterSql);
  }
  await notificationRepository.markGroupRead(userId, `friend-chat:${otherUserId}`).catch((err: any) => {
    console.error('[FriendChatService] 채팅 알림 읽음 처리 실패:', err?.message || err);
  });
  return room;
};

type ChatMessageUpdateNotifier = (roomId: number, message: ChatMessageRow) => void | Promise<void>;
const chatMessageUpdateNotifiers = new Set<ChatMessageUpdateNotifier>();
const linkPreviewQueue: Array<{ roomId: number; messageId: number; body: string }> = [];
const queuedLinkPreviewMessageIds = new Set<number>();
let activeLinkPreviewJobs = 0;
const LINK_PREVIEW_CONCURRENCY = 2;

export const registerChatMessageUpdateNotifier = (notifier: ChatMessageUpdateNotifier) => {
  chatMessageUpdateNotifiers.add(notifier);
  return () => chatMessageUpdateNotifiers.delete(notifier);
};

const notifyChatMessageUpdated = async (roomId: number, message: ChatMessageRow) => {
  await Promise.all(Array.from(chatMessageUpdateNotifiers).map((notifier) => Promise.resolve(notifier(roomId, message)).catch(() => { /* noop */ })));
};

const updateMessageLinkPreview = async (messageId: number, preview: ChatLinkPreview | null): Promise<ChatMessageRow | null> => {
  if (!preview) return null;
  const previewJson = JSON.stringify(preview);
  const mode = getDbMode();
  let row: any;
  if (mode === 'MYSQL') {
    await getMysqlDb().run('UPDATE chat_messages SET link_preview_json = ? WHERE id = ? AND link_preview_json IS NULL', previewJson, messageId);
    row = await getMysqlDb().get('SELECT * FROM chat_messages WHERE id = ? LIMIT 1', messageId);
  } else if (mode === 'SUPABASE') {
    await getSupabaseClient().from('chat_messages').update({ link_preview_json: previewJson }).eq('id', messageId).is('link_preview_json', null);
    const { data } = await getSupabaseClient().from('chat_messages').select('*').eq('id', messageId).maybeSingle();
    row = data;
  } else {
    getSqliteDb().prepare('UPDATE chat_messages SET link_preview_json = ? WHERE id = ? AND link_preview_json IS NULL').run(previewJson, messageId);
    row = getSqliteDb().prepare('SELECT * FROM chat_messages WHERE id = ? LIMIT 1').get(messageId);
  }
  return row ? mapMessage(row) : null;
};

const drainLinkPreviewQueue = () => {
  while (activeLinkPreviewJobs < LINK_PREVIEW_CONCURRENCY && linkPreviewQueue.length > 0) {
    const job = linkPreviewQueue.shift()!;
    activeLinkPreviewJobs += 1;
    queuedLinkPreviewMessageIds.delete(job.messageId);
    getLinkPreviewForText(job.body)
      .then((preview) => updateMessageLinkPreview(job.messageId, preview))
      .then((message) => {
        if (message?.link_preview) return notifyChatMessageUpdated(job.roomId, message);
      })
      .catch((err) => console.warn('[LinkPreviewQueue] 링크 프리뷰 처리 실패:', err?.message || err))
      .finally(() => {
        activeLinkPreviewJobs -= 1;
        drainLinkPreviewQueue();
      });
  }
};

const enqueueLinkPreviewForMessage = (roomId: number, messageId: number, body: string) => {
  if (!extractFirstUrl(body) || queuedLinkPreviewMessageIds.has(messageId)) return;
  queuedLinkPreviewMessageIds.add(messageId);
  linkPreviewQueue.push({ roomId, messageId, body });
  setTimeout(drainLinkPreviewQueue, 0);
};

export const sendChatMessage = async (roomId: number, senderId: string, body: string, markReadForReceiver: boolean): Promise<{ message: ChatMessageRow; room: ChatRoomRow; receiverId: string }> => {
  const room = await getRoomForUser(roomId, senderId);
  if (!room) throw new Error('RoomNotFound');
  const receiverId = room.user_a_id === senderId ? room.user_b_id : room.user_a_id;
  const mode = getDbMode();
  let row: any;
  if (mode === 'MYSQL') {
    if (!room.can_send) {
      await getMysqlDb().run('UPDATE chat_rooms SET closed_at = NULL, closed_by_user_id = NULL, updated_at = UTC_TIMESTAMP() WHERE id = ?', roomId);
    }
    const result = await getMysqlDb().run(
      `INSERT INTO chat_messages (room_id, sender_id, body, read_at, created_at)
       VALUES (?, ?, ?, ${markReadForReceiver ? 'UTC_TIMESTAMP()' : 'NULL'}, UTC_TIMESTAMP())`,
      roomId, senderId, body
    );
    await getMysqlDb().run('UPDATE chat_rooms SET closed_at = NULL, closed_by_user_id = NULL, updated_at = UTC_TIMESTAMP(), deleted_for_a = 0, deleted_for_b = 0 WHERE id = ?', roomId);
    row = await getMysqlDb().get('SELECT * FROM chat_messages WHERE id = ?', result.insertId);
  } else if (mode === 'SUPABASE') {
    if (!room.can_send) {
      await getSupabaseClient().from('chat_rooms').update({ closed_at: null, closed_by_user_id: null, updated_at: new Date().toISOString() }).eq('id', roomId);
    }
    const { data } = await getSupabaseClient().from('chat_messages').insert({ room_id: roomId, sender_id: senderId, body, read_at: markReadForReceiver ? new Date().toISOString() : null }).select('*').single();
    await getSupabaseClient().from('chat_rooms').update({ closed_at: null, closed_by_user_id: null, updated_at: new Date().toISOString(), deleted_for_a: false, deleted_for_b: false }).eq('id', roomId);
    row = data;
  } else {
    const db = getSqliteDb();
    if (!room.can_send) {
      db.prepare("UPDATE chat_rooms SET closed_at = NULL, closed_by_user_id = NULL, updated_at = datetime('now') WHERE id = ?").run(roomId);
    }
    const result = db.prepare(`INSERT INTO chat_messages (room_id, sender_id, body, read_at) VALUES (?, ?, ?, ${markReadForReceiver ? "datetime('now')" : 'NULL'})`).run(roomId, senderId, body);
    db.prepare("UPDATE chat_rooms SET closed_at = NULL, closed_by_user_id = NULL, updated_at = datetime('now'), deleted_for_a = 0, deleted_for_b = 0 WHERE id = ?").run(roomId);
    row = db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(result.lastInsertRowid);
  }
  const message = mapMessage(row);
  enqueueLinkPreviewForMessage(roomId, message.id, body);
  return { message, room, receiverId };
};

const toMysqlDateTime = (value: Date) => value.toISOString().slice(0, 19).replace('T', ' ');

const mapAttachmentRow = (row: any, expiresAt?: Date): ChatAttachmentInput => ({
  attachmentId: Number(row.id),
  url: row.url,
  mime: row.mime,
  sizeBytes: Number(row.size_bytes),
  width: row.width == null ? null : Number(row.width),
  height: row.height == null ? null : Number(row.height),
  expiresAt: expiresAt || new Date(normalizeUtcDateTime(row.expires_at)),
  reused: true
});

const mapRecentAttachmentRow = (row: any): RecentChatAttachment => ({
  id: Number(row.id),
  url: formatUploadUrl(row.url) || '',
  mime: row.mime,
  size_bytes: Number(row.size_bytes),
  width: row.width == null ? null : Number(row.width),
  height: row.height == null ? null : Number(row.height),
  last_used_at: normalizeUtcDateTime(row.last_used_at) || '',
  expires_at: normalizeUtcDateTime(row.expires_at) || ''
});

const encodeRecentAttachmentCursor = (row: any) => {
  const time = normalizeUtcDateTime(row.last_used_at) || '';
  return `${encodeURIComponent(time)}:${Number(row.id)}`;
};

const decodeRecentAttachmentCursor = (cursor?: string | null): { time: string; id: number } | null => {
  if (!cursor) return null;
  const [rawTime, rawId] = cursor.split(':');
  const id = Number(rawId);
  if (!rawTime || !Number.isFinite(id) || id <= 0) return null;
  try {
    return { time: decodeURIComponent(rawTime).replace('T', ' ').replace(/Z$/, ''), id };
  } catch {
    return null;
  }
};

export const listRecentChatAttachments = async (
  userId: string,
  options: { cursor?: string | null; limit?: number } = {}
): Promise<RecentChatAttachmentPage> => {
  const mode = getDbMode();
  const limit = Math.min(Math.max(Math.floor(Number(options.limit || 40)), 1), 80);
  const cursor = decodeRecentAttachmentCursor(options.cursor);
  if (mode === 'MYSQL') {
    const rows = await getMysqlDb().all<any>(
      `SELECT id, url, mime, size_bytes, width, height, last_used_at, expires_at
         FROM chat_attachments
        WHERE owner_user_id = ?
          AND deleted_at IS NULL
          AND expires_at > UTC_TIMESTAMP()
          AND (? IS NULL OR last_used_at < ? OR (last_used_at = ? AND id < ?))
        ORDER BY last_used_at DESC, id DESC
        LIMIT ?`,
      userId,
      cursor?.time ?? null,
      cursor?.time ?? null,
      cursor?.time ?? null,
      cursor?.id ?? 0,
      limit + 1
    );
    const pageRows = rows.slice(0, limit);
    return {
      attachments: pageRows.map(mapRecentAttachmentRow),
      nextCursor: rows.length > limit && pageRows.length > 0 ? encodeRecentAttachmentCursor(pageRows[pageRows.length - 1]) : null,
      hasMore: rows.length > limit
    };
  }
  if (mode === 'LOCAL_SQL') {
    const rows = getSqliteDb().prepare(
      `SELECT id, url, mime, size_bytes, width, height, last_used_at, expires_at
         FROM chat_attachments
        WHERE owner_user_id = ?
          AND deleted_at IS NULL
          AND datetime(expires_at) > datetime('now')
          AND (? IS NULL OR datetime(last_used_at) < datetime(?) OR (last_used_at = ? AND id < ?))
        ORDER BY datetime(last_used_at) DESC, id DESC
        LIMIT ?`
    ).all(userId, cursor?.time ?? null, cursor?.time ?? null, cursor?.time ?? null, cursor?.id ?? 0, limit + 1) as any[];
    const pageRows = rows.slice(0, limit);
    return {
      attachments: pageRows.map(mapRecentAttachmentRow),
      nextCursor: rows.length > limit && pageRows.length > 0 ? encodeRecentAttachmentCursor(pageRows[pageRows.length - 1]) : null,
      hasMore: rows.length > limit
    };
  }
  return { attachments: [], nextCursor: null, hasMore: false };
};

export const getReusableChatAttachmentById = async (userId: string, attachmentId: number): Promise<ChatAttachmentInput | null> => {
  const mode = getDbMode();
  const nextExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  if (mode === 'MYSQL') {
    const row = await getMysqlDb().get<any>(
      `SELECT id, url, mime, size_bytes, width, height, expires_at
         FROM chat_attachments
        WHERE id = ?
          AND owner_user_id = ?
          AND deleted_at IS NULL
          AND expires_at > UTC_TIMESTAMP()
        LIMIT 1`,
      attachmentId,
      userId
    );
    if (!row) return null;
    await getMysqlDb().run('UPDATE chat_attachments SET last_used_at = UTC_TIMESTAMP(), expires_at = ? WHERE id = ?', toMysqlDateTime(nextExpiresAt), row.id);
    return mapAttachmentRow(row, nextExpiresAt);
  }
  if (mode === 'LOCAL_SQL') {
    const row = getSqliteDb().prepare(
      `SELECT id, url, mime, size_bytes, width, height, expires_at
         FROM chat_attachments
        WHERE id = ?
          AND owner_user_id = ?
          AND deleted_at IS NULL
          AND datetime(expires_at) > datetime('now')
        LIMIT 1`
    ).get(attachmentId, userId) as any;
    if (!row) return null;
    getSqliteDb().prepare("UPDATE chat_attachments SET last_used_at = datetime('now'), expires_at = ? WHERE id = ?").run(nextExpiresAt.toISOString(), row.id);
    return mapAttachmentRow(row, nextExpiresAt);
  }
  return null;
};

export const findReusableChatAttachment = async (userId: string, sourceHash: string): Promise<ChatAttachmentInput | null> => {
  const mode = getDbMode();
  const nextExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  if (mode === 'MYSQL') {
    const row = await getMysqlDb().get<any>(
      `SELECT id, url, mime, size_bytes, width, height, expires_at
         FROM chat_attachments
        WHERE owner_user_id = ?
          AND source_hash = ?
          AND deleted_at IS NULL
          AND expires_at > UTC_TIMESTAMP()
        LIMIT 1`,
      userId,
      sourceHash
    );
    if (!row) return null;
    await getMysqlDb().run(
      'UPDATE chat_attachments SET last_used_at = UTC_TIMESTAMP(), expires_at = ? WHERE id = ?',
      toMysqlDateTime(nextExpiresAt),
      row.id
    );
    return mapAttachmentRow(row, nextExpiresAt);
  }
  if (mode === 'LOCAL_SQL') {
    const row = getSqliteDb().prepare(
      `SELECT id, url, mime, size_bytes, width, height, expires_at
         FROM chat_attachments
        WHERE owner_user_id = ?
          AND source_hash = ?
          AND deleted_at IS NULL
          AND datetime(expires_at) > datetime('now')
        LIMIT 1`
    ).get(userId, sourceHash) as any;
    if (!row) return null;
    getSqliteDb().prepare("UPDATE chat_attachments SET last_used_at = datetime('now'), expires_at = ? WHERE id = ?").run(nextExpiresAt.toISOString(), row.id);
    return mapAttachmentRow(row, nextExpiresAt);
  }
  return null;
};

export const saveChatAttachmentRecord = async (userId: string, sourceHash: string, attachment: ChatAttachmentInput): Promise<ChatAttachmentInput> => {
  const mode = getDbMode();
  if (mode === 'MYSQL') {
    const previous = await getMysqlDb().get<any>('SELECT id, url FROM chat_attachments WHERE owner_user_id = ? AND source_hash = ? LIMIT 1', userId, sourceHash);
    if (previous?.url && previous.url !== attachment.url) deleteLocalUploadByUrl(previous.url);
    await getMysqlDb().run(
      `INSERT INTO chat_attachments
        (owner_user_id, source_hash, url, mime, size_bytes, width, height, last_used_at, expires_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), ?, NULL)
       ON DUPLICATE KEY UPDATE
         url = VALUES(url),
         mime = VALUES(mime),
         size_bytes = VALUES(size_bytes),
         width = VALUES(width),
         height = VALUES(height),
         last_used_at = UTC_TIMESTAMP(),
         expires_at = VALUES(expires_at),
         deleted_at = NULL`,
      userId,
      sourceHash,
      attachment.url,
      attachment.mime,
      attachment.sizeBytes,
      attachment.width ?? null,
      attachment.height ?? null,
      toMysqlDateTime(attachment.expiresAt)
    );
    const row = await getMysqlDb().get<any>('SELECT id, url, mime, size_bytes, width, height, expires_at FROM chat_attachments WHERE owner_user_id = ? AND source_hash = ? LIMIT 1', userId, sourceHash);
    return { ...mapAttachmentRow(row, attachment.expiresAt), reused: false };
  }
  if (mode === 'LOCAL_SQL') {
    const previous = getSqliteDb().prepare('SELECT id, url FROM chat_attachments WHERE owner_user_id = ? AND source_hash = ? LIMIT 1').get(userId, sourceHash) as any;
    if (previous?.url && previous.url !== attachment.url) deleteLocalUploadByUrl(previous.url);
    getSqliteDb().prepare(
      `INSERT INTO chat_attachments
        (owner_user_id, source_hash, url, mime, size_bytes, width, height, last_used_at, expires_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, NULL)
       ON CONFLICT(owner_user_id, source_hash) DO UPDATE SET
         url = excluded.url,
         mime = excluded.mime,
         size_bytes = excluded.size_bytes,
         width = excluded.width,
         height = excluded.height,
         last_used_at = datetime('now'),
         expires_at = excluded.expires_at,
         deleted_at = NULL`
    ).run(userId, sourceHash, attachment.url, attachment.mime, attachment.sizeBytes, attachment.width ?? null, attachment.height ?? null, attachment.expiresAt.toISOString());
    const row = getSqliteDb().prepare('SELECT id, url, mime, size_bytes, width, height, expires_at FROM chat_attachments WHERE owner_user_id = ? AND source_hash = ? LIMIT 1').get(userId, sourceHash) as any;
    return { ...mapAttachmentRow(row, attachment.expiresAt), reused: false };
  }
  return attachment;
};

export const deleteSavedChatAttachment = async (attachment: ChatAttachmentInput) => {
  if (!attachment.attachmentId) {
    deleteLocalUploadByUrl(attachment.url);
    return;
  }
  const mode = getDbMode();
  deleteLocalUploadByUrl(attachment.url);
  if (mode === 'MYSQL') {
    await getMysqlDb().run('UPDATE chat_attachments SET deleted_at = UTC_TIMESTAMP() WHERE id = ?', attachment.attachmentId);
  } else if (mode === 'LOCAL_SQL') {
    getSqliteDb().prepare("UPDATE chat_attachments SET deleted_at = datetime('now') WHERE id = ?").run(attachment.attachmentId);
  }
};

export const getActiveChatAttachmentBytes = async (userId: string): Promise<number> => {
  const mode = getDbMode();
  if (mode === 'MYSQL') {
    const row = await getMysqlDb().get<{ total: any }>(
      `SELECT
          COALESCE((SELECT SUM(size_bytes)
                      FROM chat_attachments
                     WHERE owner_user_id = ?
                       AND deleted_at IS NULL
                       AND expires_at > UTC_TIMESTAMP()), 0)
          + COALESCE((SELECT SUM(attachment_size_bytes)
                        FROM chat_messages
                       WHERE sender_id = ?
                         AND attachment_id IS NULL
                         AND message_type = 'image'
                         AND attachment_url IS NOT NULL
                         AND attachment_deleted_at IS NULL
                         AND (attachment_expires_at IS NULL OR attachment_expires_at > UTC_TIMESTAMP())), 0) AS total`,
      userId,
      userId
    );
    return Number(row?.total || 0);
  }
  if (mode === 'SUPABASE') {
    const { data } = await getSupabaseClient()
      .from('chat_messages')
      .select('attachment_size_bytes')
      .eq('sender_id', userId)
      .eq('message_type', 'image')
      .is('attachment_deleted_at', null)
      .gt('attachment_expires_at', new Date().toISOString());
    return (data || []).reduce((sum: number, row: any) => sum + Number(row.attachment_size_bytes || 0), 0);
  }
  const row = getSqliteDb().prepare(
    `SELECT
        COALESCE((SELECT SUM(size_bytes)
                    FROM chat_attachments
                   WHERE owner_user_id = ?
                     AND deleted_at IS NULL
                     AND datetime(expires_at) > datetime('now')), 0)
        + COALESCE((SELECT SUM(attachment_size_bytes)
                      FROM chat_messages
                     WHERE sender_id = ?
                       AND attachment_id IS NULL
                       AND message_type = 'image'
                       AND attachment_url IS NOT NULL
                       AND attachment_deleted_at IS NULL
                       AND (attachment_expires_at IS NULL OR datetime(attachment_expires_at) > datetime('now'))), 0) AS total`
  ).get(userId, userId) as any;
  return Number(row?.total || 0);
};

export const sendChatAttachmentMessage = async (
  roomId: number,
  senderId: string,
  attachment: ChatAttachmentInput,
  markReadForReceiver: boolean
): Promise<{ message: ChatMessageRow; room: ChatRoomRow; receiverId: string }> => {
  const room = await getRoomForUser(roomId, senderId);
  if (!room) throw new Error('RoomNotFound');
  const receiverId = room.user_a_id === senderId ? room.user_b_id : room.user_a_id;
  const mode = getDbMode();
  let row: any;
  if (mode === 'MYSQL') {
    if (!room.can_send) {
      await getMysqlDb().run('UPDATE chat_rooms SET closed_at = NULL, closed_by_user_id = NULL, updated_at = UTC_TIMESTAMP() WHERE id = ?', roomId);
    }
    const result = await getMysqlDb().run(
      `INSERT INTO chat_messages
        (room_id, sender_id, body, message_type, attachment_id, attachment_url, attachment_mime, attachment_size_bytes, attachment_width, attachment_height, attachment_expires_at, read_at, created_at)
       VALUES (?, ?, ?, 'image', ?, ?, ?, ?, ?, ?, ?, ${markReadForReceiver ? 'UTC_TIMESTAMP()' : 'NULL'}, UTC_TIMESTAMP())`,
      roomId,
      senderId,
      '이미지',
      attachment.attachmentId ?? null,
      attachment.url,
      attachment.mime,
      attachment.sizeBytes,
      attachment.width ?? null,
      attachment.height ?? null,
      toMysqlDateTime(attachment.expiresAt)
    );
    await getMysqlDb().run('UPDATE chat_rooms SET closed_at = NULL, closed_by_user_id = NULL, updated_at = UTC_TIMESTAMP(), deleted_for_a = 0, deleted_for_b = 0 WHERE id = ?', roomId);
    row = await getMysqlDb().get('SELECT * FROM chat_messages WHERE id = ?', result.insertId);
  } else if (mode === 'SUPABASE') {
    if (!room.can_send) {
      await getSupabaseClient().from('chat_rooms').update({ closed_at: null, closed_by_user_id: null, updated_at: new Date().toISOString() }).eq('id', roomId);
    }
    const { data } = await getSupabaseClient().from('chat_messages').insert({
      room_id: roomId,
      sender_id: senderId,
      body: '이미지',
      message_type: 'image',
      attachment_url: attachment.url,
      attachment_mime: attachment.mime,
      attachment_size_bytes: attachment.sizeBytes,
      attachment_width: attachment.width ?? null,
      attachment_height: attachment.height ?? null,
      attachment_expires_at: attachment.expiresAt.toISOString(),
      read_at: markReadForReceiver ? new Date().toISOString() : null
    }).select('*').single();
    await getSupabaseClient().from('chat_rooms').update({ closed_at: null, closed_by_user_id: null, updated_at: new Date().toISOString(), deleted_for_a: false, deleted_for_b: false }).eq('id', roomId);
    row = data;
  } else {
    const db = getSqliteDb();
    if (!room.can_send) {
      db.prepare("UPDATE chat_rooms SET closed_at = NULL, closed_by_user_id = NULL, updated_at = datetime('now') WHERE id = ?").run(roomId);
    }
    const result = db.prepare(
      `INSERT INTO chat_messages
        (room_id, sender_id, body, message_type, attachment_id, attachment_url, attachment_mime, attachment_size_bytes, attachment_width, attachment_height, attachment_expires_at, read_at)
       VALUES (?, ?, ?, 'image', ?, ?, ?, ?, ?, ?, ?, ${markReadForReceiver ? "datetime('now')" : 'NULL'})`
    ).run(
      roomId,
      senderId,
      '이미지',
      attachment.attachmentId ?? null,
      attachment.url,
      attachment.mime,
      attachment.sizeBytes,
      attachment.width ?? null,
      attachment.height ?? null,
      attachment.expiresAt.toISOString()
    );
    db.prepare("UPDATE chat_rooms SET closed_at = NULL, closed_by_user_id = NULL, updated_at = datetime('now'), deleted_for_a = 0, deleted_for_b = 0 WHERE id = ?").run(roomId);
    row = db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(result.lastInsertRowid);
  }
  return { message: mapMessage(row), room, receiverId };
};

export const getChatMessageForRoom = async (roomId: number, messageId: number, userId: string): Promise<ChatMessageRow | null> => {
  const room = await getRoomForUser(roomId, userId);
  if (!room) throw new Error('RoomNotFound');
  const mode = getDbMode();
  let row: any;
  if (mode === 'MYSQL') {
    row = await getMysqlDb().get(
      `SELECT m.*,
              ca.url AS effective_attachment_url,
              ca.mime AS effective_attachment_mime,
              ca.size_bytes AS effective_attachment_size_bytes,
              ca.width AS effective_attachment_width,
              ca.height AS effective_attachment_height,
              ca.expires_at AS effective_attachment_expires_at,
              ca.deleted_at AS effective_attachment_deleted_at
         FROM chat_messages m
         LEFT JOIN chat_attachments ca ON ca.id = m.attachment_id
        WHERE m.id = ? AND m.room_id = ?
        LIMIT 1`,
      messageId,
      roomId
    );
  }
  else if (mode === 'SUPABASE') {
    const { data } = await getSupabaseClient().from('chat_messages').select('*').eq('id', messageId).eq('room_id', roomId).maybeSingle();
    row = data;
  } else {
    row = getSqliteDb().prepare(
      `SELECT m.*,
              ca.url AS effective_attachment_url,
              ca.mime AS effective_attachment_mime,
              ca.size_bytes AS effective_attachment_size_bytes,
              ca.width AS effective_attachment_width,
              ca.height AS effective_attachment_height,
              ca.expires_at AS effective_attachment_expires_at,
              ca.deleted_at AS effective_attachment_deleted_at
         FROM chat_messages m
         LEFT JOIN chat_attachments ca ON ca.id = m.attachment_id
        WHERE m.id = ? AND m.room_id = ?
        LIMIT 1`
    ).get(messageId, roomId);
  }
  return row ? mapMessage(row) : null;
};

export const deleteExpiredChatAttachments = async (): Promise<number> => {
  const mode = getDbMode();
  let rows: any[] = [];
  if (mode === 'MYSQL') {
    const attachmentRows = await getMysqlDb().all<any>(
      `SELECT id, url
         FROM chat_attachments
        WHERE deleted_at IS NULL
          AND expires_at <= UTC_TIMESTAMP()
        LIMIT 200`
    );
    for (const row of attachmentRows) {
      deleteLocalUploadByUrl(row.url);
      await getMysqlDb().run('UPDATE chat_attachments SET deleted_at = UTC_TIMESTAMP() WHERE id = ?', row.id);
    }
    rows = await getMysqlDb().all<any>(
      `SELECT id, attachment_url
         FROM chat_messages
        WHERE message_type = 'image'
          AND attachment_id IS NULL
          AND attachment_url IS NOT NULL
          AND attachment_deleted_at IS NULL
          AND attachment_expires_at <= UTC_TIMESTAMP()
        LIMIT 200`
    );
    for (const row of rows) {
      deleteLocalUploadByUrl(row.attachment_url);
      await getMysqlDb().run('UPDATE chat_messages SET attachment_url = NULL, attachment_deleted_at = UTC_TIMESTAMP() WHERE id = ?', row.id);
    }
    return attachmentRows.length + rows.length;
  }
  if (mode === 'SUPABASE') {
    const { data } = await getSupabaseClient()
      .from('chat_messages')
      .select('id, attachment_url')
      .eq('message_type', 'image')
      .is('attachment_deleted_at', null)
      .not('attachment_url', 'is', null)
      .lte('attachment_expires_at', new Date().toISOString())
      .limit(200);
    rows = data || [];
    for (const row of rows) {
      deleteLocalUploadByUrl(row.attachment_url);
      await getSupabaseClient().from('chat_messages').update({ attachment_url: null, attachment_deleted_at: new Date().toISOString() }).eq('id', row.id);
    }
    return rows.length;
  }
  rows = getSqliteDb().prepare(
    `SELECT id, url
       FROM chat_attachments
      WHERE deleted_at IS NULL
        AND datetime(expires_at) <= datetime('now')
      LIMIT 200`
  ).all() as any[];
  for (const row of rows) {
    deleteLocalUploadByUrl(row.url);
    getSqliteDb().prepare("UPDATE chat_attachments SET deleted_at = datetime('now') WHERE id = ?").run(row.id);
  }
  const legacyRows = getSqliteDb().prepare(
    `SELECT id, attachment_url
       FROM chat_messages
      WHERE message_type = 'image'
        AND attachment_id IS NULL
        AND attachment_url IS NOT NULL
        AND attachment_deleted_at IS NULL
        AND datetime(attachment_expires_at) <= datetime('now')
      LIMIT 200`
  ).all() as any[];
  for (const row of legacyRows) {
    deleteLocalUploadByUrl(row.attachment_url);
    getSqliteDb().prepare("UPDATE chat_messages SET attachment_url = NULL, attachment_deleted_at = datetime('now') WHERE id = ?").run(row.id);
  }
  return rows.length + legacyRows.length;
};

let attachmentCleanupTimer: NodeJS.Timeout | null = null;
export const startChatAttachmentCleanupScheduler = () => {
  if (attachmentCleanupTimer) return;
  const run = () => {
    deleteExpiredChatAttachments()
      .then((count) => {
        if (count > 0) console.log(`[ChatAttachmentCleanup] 만료 이미지 ${count}개를 폐기했습니다.`);
      })
      .catch((err) => console.warn('[ChatAttachmentCleanup] 만료 이미지 정리 실패:', err?.message || err));
  };
  run();
  attachmentCleanupTimer = setInterval(run, 60 * 60 * 1000);
};
