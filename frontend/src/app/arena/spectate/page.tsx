import React, { Suspense } from 'react';
import { ArenaV2MatchPageClient } from '../matches/ArenaV2MatchPageClient';

export default function ArenaSpectatePage() {
  return (
    <Suspense fallback={null}>
      <ArenaV2MatchPageClient mode="spectate" />
    </Suspense>
  );
}
