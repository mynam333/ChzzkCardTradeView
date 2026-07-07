'use client';

import { useSearchParams } from 'next/navigation';
import { ArenaV2MatchPageClient } from './ArenaV2MatchPageClient';

export const ArenaMatchQueryPage: React.FC = () => {
  const searchParams = useSearchParams();
  const matchId = searchParams.get('match_id') || searchParams.get('id');
  return <ArenaV2MatchPageClient matchId={matchId} />;
};
