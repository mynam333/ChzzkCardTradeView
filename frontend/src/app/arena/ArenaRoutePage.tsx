'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { ArenaLayout } from '../ArenaLayout';
import { ArenaV2Experience } from './ArenaV2Experience';
import type { ArenaSiteTab } from './types';

const arenaTabHref: Record<ArenaSiteTab, string> = {
  play: '/arena/play',
  inventory: '/arena/inventory',
  ranking: '/arena/ranking',
  wiki: '/arena/wiki',
  style: '/arena/style',
  'my-card': '/arena/my-card',
  admin: '/arena/admin'
};

export const ArenaRoutePage: React.FC<{ activeTab: ArenaSiteTab }> = ({ activeTab }) => {
  const router = useRouter();

  const moveArenaSection = React.useCallback((tab: ArenaSiteTab) => {
    router.push(arenaTabHref[tab] || '/arena');
  }, [router]);

  return (
    <ArenaLayout activeTab={activeTab} onTabChange={moveArenaSection}>
      <ArenaV2Experience activeTab={activeTab} />
    </ArenaLayout>
  );
};
