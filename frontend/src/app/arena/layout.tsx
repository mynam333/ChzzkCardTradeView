import type { Metadata } from 'next';
import React from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';

export const metadata: Metadata = {
  title: '아레나 | 치카포 : 치지직 카드 포럼',
  description: '응원하는 스트리머 카드로 2x3 보드를 장악하는 치카포 아레나입니다.',
  icons: {
    icon: '/arena-icon.png',
    apple: '/arena-icon.png'
  },
  openGraph: {
    title: '아레나 | 치카포 : 치지직 카드 포럼',
    description: '응원하는 스트리머 카드를 2x3 보드에 배치하고 40초 턴 안에서 이동, 배치, 교체를 선택하는 아레나입니다.',
    url: 'https://chikapo.yuaru.com/arena',
    images: [{ url: '/og-image.png', width: 1672, height: 941, alt: '치카포 아레나' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: '아레나 | 치카포',
    description: '14~20장 덱과 2x3 보드로 즐기는 치카포 아레나입니다.',
  },
  alternates: {
    canonical: 'https://chikapo.yuaru.com/arena',
  },
};

export default function ArenaLayout({ children }: { children: React.ReactNode }) {
  return <TooltipProvider delay={180} closeDelay={80} timeout={320}>{children}</TooltipProvider>;
}

