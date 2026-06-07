import type { Metadata } from 'next';
import React from 'react';

/**
 * /ranking 라우트 전용 레이아웃
 * 'use client'인 RankingPage에 별도 메타데이터를 부여하기 위한 서버 컴포넌트 레이아웃
 */
export const metadata: Metadata = {
  title: '실시간 랭킹 | 치카포 : 치지직 카드 포럼',
  description: '치카포 실시간 스트리머 카드 랭킹을 확인하세요. 자산 순위, 카드 보유 순위, 인기 스트리머 순위를 실시간으로 확인할 수 있습니다.',
  openGraph: {
    title: '실시간 랭킹 | 치카포 : 치지직 카드 포럼',
    description: '치카포 실시간 스트리머 카드 랭킹을 확인하세요.',
    url: 'https://chikapo.yuaru.com/ranking',
    images: [{ url: '/og-image.png', width: 1672, height: 941, alt: '치카포 실시간 랭킹' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: '실시간 랭킹 | 치카포',
    description: '치카포 실시간 스트리머 카드 랭킹을 확인하세요.',
  },
  alternates: {
    canonical: 'https://chikapo.yuaru.com/ranking',
  },
};

export default function RankingLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
