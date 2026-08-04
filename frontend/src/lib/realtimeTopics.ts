export const getRealtimeTopicsForPathname = (pathname: string): string => {
  const topics = new Set(['maintenance', 'ranking']);
  if (pathname.startsWith('/shop')) {
    topics.add('shop');
    topics.add('market');
  }
  if (pathname.startsWith('/arena')) {
    topics.add('arena');
    topics.add('shop');
  }
  return Array.from(topics).join(',');
};
