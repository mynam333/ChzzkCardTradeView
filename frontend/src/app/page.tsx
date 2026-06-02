'use client';

import React from 'react';
import { AppProvider, useApp } from './AppContext';
import { MainLayout } from './MainLayout';
import { MainTab } from './MainTab';
import { ShopTab } from './ShopTab';
import { GachaTab } from './GachaTab';
import { RankingTab } from './RankingTab';
import { MyInfoTab } from './MyInfoTab';
import { AdminTab } from './AdminTab';

const CCTVAppContent: React.FC = () => {
  const { activeTab, user } = useApp();

  const renderActiveTab = () => {
    switch (activeTab) {
      case 'main':
        return <MainTab />;
      case 'shop':
        return <ShopTab />;
      case 'gacha':
        return <GachaTab />;
      case 'ranking':
        return <RankingTab />;
      case 'my-info':
        return <MyInfoTab />;
      case 'admin':
        // 관리자 전용 가드: ADMIN이 아니면 메인으로 폴백
        return user?.role === 'ADMIN' ? <AdminTab /> : <MainTab />;
      default:
        return <MainTab />;
    }
  };

  return (
    <MainLayout>
      {renderActiveTab()}
    </MainLayout>
  );
};

export default function Home() {
  return (
    <CCTVAppContent />
  );
}

