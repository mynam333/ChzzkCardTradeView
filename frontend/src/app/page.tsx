'use client';

import React from 'react';
import { AppProvider, useApp } from './AppContext';
import { MainLayout } from './MainLayout';
import { MainTab } from './MainTab';
import { GachaTab } from './GachaTab';
import { RankingTab } from './RankingTab';
import { MyInfoTab } from './MyInfoTab';

const CCTVAppContent: React.FC = () => {
  const { activeTab } = useApp();

  const renderActiveTab = () => {
    switch (activeTab) {
      case 'main':
        return <MainTab />;
      case 'gacha':
        return <GachaTab />;
      case 'ranking':
        return <RankingTab />;
      case 'my-info':
        return <MyInfoTab />;
      default:
        return <MainTab />;
    }
  };

  return (
    <MainLayout onNotifyClick={() => alert('실시간 PWA 알림 권한 허용이 완료되었습니다.')}>
      {renderActiveTab()}
    </MainLayout>
  );
};

export default function Home() {
  return (
    <AppProvider>
      <CCTVAppContent />
    </AppProvider>
  );
}
