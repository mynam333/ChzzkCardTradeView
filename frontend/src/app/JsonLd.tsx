/**
 * JSON-LD 구조화 데이터 컴포넌트
 * 구글 리치 결과(Rich Results)와 AI 검색 엔진 이해도를 높이기 위한 스키마 마크업
 * 서버 컴포넌트에서만 사용해야 합니다.
 */

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://chikapo.yuaru.com';

/** 사이트 전체 WebSite 스키마 (검색창 sitelinks 노출에 필요) */
export function WebsiteJsonLd() {
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: '치카포 : 치지직 카드 포럼',
    alternateName: '치카포',
    url: SITE_URL,
    description: '매일 무료 가챠를 돌려 치지직 최애 스트리머 카드를 수집하고, 실시간 시세 변동에 맞춰 거래하며 나만의 덱을 만들어보세요!',
    inLanguage: 'ko-KR',
    // 구글 사이트링크 검색창 활성화
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${SITE_URL}/?q={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  );
}

/** 웹 앱 스키마 */
export function WebAppJsonLd() {
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: '치카포 : 치지직 카드 포럼',
    url: SITE_URL,
    description: '치지직 스트리머 카드 수집 및 거래 플랫폼. 매일 무료 가챠, 실시간 시세, 랭킹 시스템을 제공합니다.',
    applicationCategory: 'GameApplication',
    operatingSystem: 'Web Browser',
    inLanguage: 'ko-KR',
    isAccessibleForFree: true,
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'KRW',
      availability: 'https://schema.org/InStock',
    },
    image: `${SITE_URL}/og-image.png`,
    screenshot: `${SITE_URL}/og-image.png`,
    author: {
      '@type': 'Organization',
      name: '치카포',
      url: SITE_URL,
    },
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  );
}
