import React, { Suspense } from 'react';
import { ArenaSpectatePageClient } from './ArenaSpectatePageClient';

export default function ArenaSpectatePage() {
  return (
    <Suspense fallback={null}>
      <ArenaSpectatePageClient />
    </Suspense>
  );
}
