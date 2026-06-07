import type { Metadata } from 'next';
import React from 'react';

/**
 * /arcade 라우트 전용 레이아웃
 * 'use client'인 ArcadePage에 별도 메타데이터를 부여하기 위한 서버 컴포넌트 레이아웃
 */
export const metadata: Metadata = {
  title: '아케이드 | 치카포 : 치지직 카드 포럼',
  description: '치카포 아케이드에서 미니게임을 즐기고 코인을 획득하세요! 다양한 게임으로 추가 보상을 받을 수 있습니다.',
  openGraph: {
    title: '아케이드 | 치카포 : 치지직 카드 포럼',
    description: '치카포 아케이드에서 미니게임을 즐기고 코인을 획득하세요!',
    url: 'https://chikapo.yuaru.com/arcade',
    images: [{ url: '/og-image.png', width: 1672, height: 941, alt: '치카포 아케이드' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: '아케이드 | 치카포',
    description: '치카포 아케이드에서 미니게임을 즐기고 코인을 획득하세요!',
  },
  alternates: {
    canonical: 'https://chikapo.yuaru.com/arcade',
  },
};

export default function ArcadeLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
