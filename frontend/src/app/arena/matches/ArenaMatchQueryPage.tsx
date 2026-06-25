'use client';

import { useSearchParams } from 'next/navigation';
import { ArenaMatchPageClient } from './ArenaMatchPageClient';

export const ArenaMatchQueryPage: React.FC = () => {
  const searchParams = useSearchParams();
  const matchId = searchParams.get('match_id') || searchParams.get('id');
  return <ArenaMatchPageClient matchId={matchId} />;
};
