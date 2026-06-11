const CHAT_ROOM_VIEW_TTL_MS = 15_000;
const activeRoomViewers = new Map<number, Map<string, number>>();

export const markChatRoomViewing = (roomId: number, userId: string) => {
  const now = Date.now();
  let viewers = activeRoomViewers.get(roomId);
  if (!viewers) {
    viewers = new Map<string, number>();
    activeRoomViewers.set(roomId, viewers);
  }
  viewers.set(userId, now + CHAT_ROOM_VIEW_TTL_MS);
};

export const clearChatRoomViewing = (roomId: number, userId: string) => {
  const viewers = activeRoomViewers.get(roomId);
  if (!viewers) return;
  viewers.delete(userId);
  if (viewers.size === 0) activeRoomViewers.delete(roomId);
};

export const isChatRoomViewing = (roomId: number, userId: string) => {
  const viewers = activeRoomViewers.get(roomId);
  if (!viewers) return false;

  const expiresAt = viewers.get(userId);
  if (!expiresAt) return false;
  if (expiresAt <= Date.now()) {
    viewers.delete(userId);
    if (viewers.size === 0) activeRoomViewers.delete(roomId);
    return false;
  }
  return true;
};
