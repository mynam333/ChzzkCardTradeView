import type { Metadata } from 'next';
import React from 'react';

export const metadata: Metadata = {
  title: '아레나 | 치카포 : 치지직 카드 포럼',
  description: '좋아하는 스트리머 카드로 덱을 짜고 라운드마다 흐름을 뒤집는 치카포 5판 3선승 카드 아레나입니다.',
  icons: {
    icon: '/arena-icon.png',
    apple: '/arena-icon.png'
  },
  openGraph: {
    title: '아레나 | 치카포 : 치지직 카드 포럼',
    description: '응원하는 스트리머 카드를 내 팀의 핵심 역할로 세우고 조합과 배치로 승부를 보는 아레나입니다.',
    url: 'https://chikapo.yuaru.com/arena',
    images: [{ url: '/og-image.png', width: 1672, height: 941, alt: '치카포 아레나' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: '아레나 | 치카포',
    description: '좋아하는 스트리머 카드로 덱을 짜고 라운드마다 다른 승부를 만나보세요.',
  },
  alternates: {
    canonical: 'https://chikapo.yuaru.com/arena',
  },
};

export default function ArenaLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

