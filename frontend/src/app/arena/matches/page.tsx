import React, { Suspense } from 'react';
import { ArenaMatchQueryPage } from './ArenaMatchQueryPage';

export default function ArenaMatchesPage() {
  return (
    <Suspense fallback={null}>
      <ArenaMatchQueryPage />
    </Suspense>
  );
}
