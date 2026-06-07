import type { Metadata } from 'next';
import React from 'react';

/**
 * /shop 라우트 전용 레이아웃
 * 'use client'인 ShopPage에 별도 메타데이터를 부여하기 위한 서버 컴포넌트 레이아웃
 */
export const metadata: Metadata = {
  title: '상점 | 치카포 : 치지직 카드 포럼',
  description: '치카포 상점에서 스트리머 카드 팩, 특별 아이템 등을 구매하세요.',
  openGraph: {
    title: '상점 | 치카포 : 치지직 카드 포럼',
    description: '치카포 상점에서 스트리머 카드 팩, 특별 아이템 등을 구매하세요.',
    url: 'https://chikapo.yuaru.com/shop',
    images: [{ url: '/og-image.png', width: 1672, height: 941, alt: '치카포 상점' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: '상점 | 치카포',
    description: '치카포 상점에서 스트리머 카드 팩, 특별 아이템 등을 구매하세요.',
  },
  alternates: {
    canonical: 'https://chikapo.yuaru.com/shop',
  },
};

export default function ShopLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
