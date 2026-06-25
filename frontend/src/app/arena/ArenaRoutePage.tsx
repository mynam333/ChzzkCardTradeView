'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { ArenaLayout } from '../ArenaLayout';
import { ArenaTab } from '../ArenaTab';
import type { ArenaSiteTab } from '../ArenaTab';

const arenaTabHref: Record<ArenaSiteTab, string> = {
  play: '/arena/play',
  inventory: '/arena/inventory',
  ranking: '/arena/ranking',
  style: '/arena/style',
  admin: '/arena/admin'
};

export const ArenaRoutePage: React.FC<{ activeTab: ArenaSiteTab }> = ({ activeTab }) => {
  const router = useRouter();

  const moveArenaTab = React.useCallback((tab: ArenaSiteTab) => {
    router.push(arenaTabHref[tab] || '/arena');
  }, [router]);

  return (
    <ArenaLayout activeTab={activeTab} onTabChange={moveArenaTab}>
      <ArenaTab activeSiteTab={activeTab} onSiteTabChange={moveArenaTab} hideSiteTabs />
    </ArenaLayout>
  );
};
