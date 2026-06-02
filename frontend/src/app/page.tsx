'use client';

import React from 'react';
import { AppProvider, useApp } from './AppContext';
import { MainLayout } from './MainLayout';
import { MainTab } from './MainTab';
import { GachaTab } from './GachaTab';
import { RankingTab } from './RankingTab';
import { MyInfoTab } from './MyInfoTab';
import { AdminTab } from './AdminTab';
import { subscribeToPush, isPushSupported } from '@/lib/push';

const CCTVAppContent: React.FC = () => {
  const { activeTab, user, toast } = useApp();

  // 🔔 버튼: 실제 웹 푸시 알림 권한 요청 및 구독 등록
  const handleNotifyClick = async () => {
    if (!isPushSupported()) {
      toast('이 브라우저는 웹 푸시 알림을 지원하지 않습니다.', 'warning');
      return;
    }
    if (!user) {
      toast('알림을 받으려면 먼저 치지직 로그인이 필요합니다.', 'warning');
      return;
    }
    const result = await subscribeToPush();
    if (result.ok) {
      toast('실시간 푸시 알림 구독이 완료되었습니다!', 'success');
    } else {
      toast(result.message, 'error');
    }
  };

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
      case 'admin':
        // 관리자 전용 가드: ADMIN이 아니면 메인으로 폴백
        return user?.role === 'ADMIN' ? <AdminTab /> : <MainTab />;
      default:
        return <MainTab />;
    }
  };

  return (
    <MainLayout onNotifyClick={handleNotifyClick}>
      {renderActiveTab()}
    </MainLayout>
  );
};

export default function Home() {
  return (
    <CCTVAppContent />
  );
}

