import { MetadataRoute } from 'next';

/**
 * Next.js App Router 방식의 동적 sitemap.xml 생성
 * 검색엔진이 사이트 구조를 쉽게 파악할 수 있도록 주요 페이지를 명시합니다.
 * 
 * 참고: 로그인이 필요한 페이지(/admin, /my-info 등)는 포함하지 않습니다.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://chikapo.yuaru.com';
  const now = new Date();

  return [
    {
      // 메인 홈 페이지 - 핫 스트리머 카드 목록
      url: `${baseUrl}/`,
      lastModified: now,
      changeFrequency: 'hourly',   // 실시간 시세 변동으로 자주 변경됨
      priority: 1.0,
    },
    {
      // 상점 페이지
      url: `${baseUrl}/shop`,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 0.8,
    },
    {
      // 랭킹 페이지
      url: `${baseUrl}/ranking`,
      lastModified: now,
      changeFrequency: 'hourly',
      priority: 0.8,
    },
    {
      // 아케이드(미니게임) 페이지
      url: `${baseUrl}/arcade`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.6,
    },
    {
      // 로그인 페이지
      url: `${baseUrl}/login`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.4,
    },
  ];
}
