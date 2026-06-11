import { getDbMode, getMysqlDb, getSqliteDb, getSupabaseClient } from './db';

export type FriendRequestStatus = 'pending' | 'accepted' | 'rejected' | 'canceled';

export type ChatUserSummary = {
  id: string;
  username: string;
  avatar_url: string | null;
  role?: 'USER' | 'ADMIN';
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
  created_at: string;
  read_at?: string | null;
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
  role: row.role
});

const mapMessage = (row: any): ChatMessageRow => ({
  id: Number(row.id),
  room_id: Number(row.room_id),
  sender_id: row.sender_id,
  body: row.body,
  created_at: normalizeUtcDateTime(row.created_at),
  read_at: row.read_at ? normalizeUtcDateTime(row.read_at) : null
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
  created_at: row.created_at,
  updated_at: row.updated_at,
  other_user: mapUser({
    id: row.other_id,
    username: row.other_username,
    avatar_url: row.other_avatar_url,
    role: row.other_role
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
    const row = await getMysqlDb().get<any>('SELECT id, username, avatar_url, role FROM users WHERE id = ?', userId);
    return row ? mapUser(row) : null;
  }
  if (mode === 'SUPABASE') {
    const { data } = await getSupabaseClient().from('users').select('id, username, avatar_url, role').eq('id', userId).maybeSingle();
    return data ? mapUser(data) : null;
  }
  const row = getSqliteDb().prepare('SELECT id, username, avatar_url, role FROM users WHERE id = ?').get(userId) as any;
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
    SELECT u.id, u.username, u.avatar_url, u.role
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
    SELECT u.id, u.username, u.avatar_url, u.role
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
    const { data: users } = await getSupabaseClient().from('users').select('id, username, avatar_url, role').in('id', ids);
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
  const rooms = await listChatRooms(a, { includeEmpty: true });
  return rooms.find((room) => room.user_a_id === userA && room.user_b_id === userB) || null;
};

const roomSelectSql = (viewerId: string) => `
  SELECT cr.*,
         CASE WHEN cr.user_a_id = ? THEN cr.user_b_id ELSE cr.user_a_id END AS other_id,
         u.username AS other_username,
         u.avatar_url AS other_avatar_url,
         u.role AS other_role,
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
         CASE WHEN cr.user_a_id = ? COLLATE utf8mb4_unicode_ci THEN cr.user_b_id ELSE cr.user_a_id END AS other_id,
         u.username AS other_username,
         u.avatar_url AS other_avatar_url,
         u.role AS other_role,
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
  const params = [userId, userId, userId, userId, userId, userId, userId, userId, userId];
  if (mode === 'MYSQL') return (await getMysqlDb().all<any>(mysqlSql, ...params)).map(mapRoom);
  if (mode === 'SUPABASE') return [];
  return (getSqliteDb().prepare(sql).all(...params) as any[]).map(mapRoom);
};

export const getOrCreateChatRoom = async (a: string, b: string, isAdminRoom: boolean): Promise<ChatRoomRow> => {
  const [userA, userB] = pair(a, b);
  const mode = getDbMode();
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
  }
  const room = (await listChatRooms(a, { includeEmpty: true })).find((r) => r.user_a_id === userA && r.user_b_id === userB);
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
  const room = (await listChatRooms(userId)).find((r) => r.id === roomId);
  if (!room || !room.closed_at) throw new Error('RoomNotClosed');
  const col = room.user_a_id === userId ? 'deleted_for_a' : 'deleted_for_b';
  const hiddenCol = room.user_a_id === userId ? 'hidden_after_a' : 'hidden_after_b';
  const mode = getDbMode();
  if (mode === 'MYSQL') await getMysqlDb().run(`UPDATE chat_rooms SET ${col} = 1, ${hiddenCol} = UTC_TIMESTAMP() WHERE id = ?`, roomId);
  else if (mode === 'SUPABASE') await getSupabaseClient().from('chat_rooms').update({ [col]: true, [hiddenCol]: new Date().toISOString() }).eq('id', roomId);
  else getSqliteDb().prepare(`UPDATE chat_rooms SET ${col} = 1, ${hiddenCol} = datetime('now') WHERE id = ?`).run(roomId);
};

export const getRoomForUser = async (roomId: number, userId: string): Promise<ChatRoomRow | null> => {
  return (await listChatRooms(userId, { includeEmpty: true })).find((room) => room.id === roomId) || null;
};

export const listMessages = async (
  roomId: number,
  userId: string,
  options: { beforeId?: number | null; limit?: number } = {}
): Promise<ChatMessageRow[]> => {
  const room = await getRoomForUser(roomId, userId);
  if (!room) throw new Error('RoomNotFound');
  const limit = Math.min(Math.max(Math.floor(Number(options.limit || 50)), 1), 100);
  const beforeId = options.beforeId && Number.isFinite(options.beforeId) ? Math.floor(Number(options.beforeId)) : null;
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
      roomId, userId, hiddenAfterSql, hiddenAfterSql
    );
    const rows = beforeId
      ? await getMysqlDb().all<any>('SELECT * FROM (SELECT * FROM chat_messages WHERE room_id = ? AND id < ? AND (? IS NULL OR created_at > ?) ORDER BY id DESC LIMIT ?) recent ORDER BY id ASC', roomId, beforeId, hiddenAfterSql, hiddenAfterSql, limit)
      : await getMysqlDb().all<any>('SELECT * FROM (SELECT * FROM chat_messages WHERE room_id = ? AND (? IS NULL OR created_at > ?) ORDER BY id DESC LIMIT ?) recent ORDER BY id ASC', roomId, hiddenAfterSql, hiddenAfterSql, limit);
    return rows.map(mapMessage);
  }
  if (mode === 'SUPABASE') {
    let readQuery = getSupabaseClient().from('chat_messages').update({ read_at: new Date().toISOString() }).eq('room_id', roomId).neq('sender_id', userId).is('read_at', null);
    if (hiddenAfter) readQuery = readQuery.gt('created_at', hiddenAfter);
    await readQuery;
    let query = getSupabaseClient()
      .from('chat_messages')
      .select('*')
      .eq('room_id', roomId)
      .order('id', { ascending: false })
      .limit(limit);
    if (beforeId) query = query.lt('id', beforeId);
    if (hiddenAfter) query = query.gt('created_at', hiddenAfter);
    const { data } = await query;
    return (data || []).reverse().map(mapMessage);
  }
  const db = getSqliteDb();
  db.prepare("UPDATE chat_messages SET read_at = COALESCE(read_at, datetime('now')) WHERE room_id = ? AND sender_id <> ? AND read_at IS NULL AND (? IS NULL OR created_at > ?)").run(roomId, userId, hiddenAfterSql, hiddenAfterSql);
  const rows = beforeId
    ? db.prepare('SELECT * FROM (SELECT * FROM chat_messages WHERE room_id = ? AND id < ? AND (? IS NULL OR created_at > ?) ORDER BY id DESC LIMIT ?) recent ORDER BY id ASC').all(roomId, beforeId, hiddenAfterSql, hiddenAfterSql, limit)
    : db.prepare('SELECT * FROM (SELECT * FROM chat_messages WHERE room_id = ? AND (? IS NULL OR created_at > ?) ORDER BY id DESC LIMIT ?) recent ORDER BY id ASC').all(roomId, hiddenAfterSql, hiddenAfterSql, limit);
  return (rows as any[]).map(mapMessage);
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
  return { message: mapMessage(row), room, receiverId };
};
