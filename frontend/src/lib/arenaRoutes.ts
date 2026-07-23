export const getArenaMatchHref = (matchId: string) =>
  `/arena/matches?match_id=${encodeURIComponent(matchId)}`;
