import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";
import { AppProvider } from "./AppContext";
import { TutorialGuide } from "./TutorialGuide";
import { WebsiteJsonLd, WebAppJsonLd } from "./JsonLd";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://chikapo.yuaru.com";
const CLOUDFLARE_WEB_ANALYTICS_TOKEN = process.env.NEXT_PUBLIC_CLOUDFLARE_WEB_ANALYTICS_TOKEN || "";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "치카포 : 치지직 카드 포럼",
    template: "%s | 치카포",
  },
  description: "매일 무료 가챠를 돌려 치지직 최애 스트리머 카드를 수집하고, 실시간 시세 변동에 맞춰 거래하며 나만의 덱을 만들어보세요!",
  manifest: "/manifest.json",
  // 검색 로봇 기본 허용 (세부 제어는 robots.txt에서)
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  // 정규 URL 설정
  alternates: {
    canonical: SITE_URL,
  },
  // 키워드 (구글에서 직접 활용하지는 않지만 다른 검색엔진에서 참고)
  keywords: ['치카포', '치지직', '카드', '스트리머', '가챠', '트레이딩카드', '카드포럼', 'CHZZK', 'Chzzk'],
  // 저작자 정보
  authors: [{ name: '치카포', url: SITE_URL }],
  creator: '치카포',
  publisher: '치카포',
  icons: {
    icon: "/icon.png",
    apple: "/icon.png",
  },
  openGraph: {
    type: "website",
    locale: "ko_KR",
    url: SITE_URL,
    title: "치카포 : 치지직 카드 포럼",
    description: "매일 무료 가챠를 돌려 치지직 최애 스트리머 카드를 수집하고, 실시간 시세 변동에 맞춰 거래하며 나만의 덱을 만들어보세요!",
    siteName: "치카포 : 치지직 카드 포럼",
    images: [
      {
        url: "/og-image.png",
        width: 1672,
        height: 941,
        alt: "치카포 : 치지직 카드 포럼",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "치카포 : 치지직 카드 포럼",
    description: "매일 무료 가챠를 돌려 치지직 최애 스트리머 카드를 수집하고, 실시간 시세 변동에 맞춰 거래하며 나만의 덱을 만들어보세요!",
    images: ["/og-image.png"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko-KR" className="h-full antialiased" style={{ fontSize: "16px" }}>
      <head>
        {/* Google Search Console 소유권 인증 */}
        <meta name="google-site-verification" content="KQ4i9w640cJZF6iM9Tw5k5XthFvOwq78L8QOoQHWdxk" />
        <meta name="naver-site-verification" content="2ae2adc8f5ddb0ba930545664fdb3f8ecb81a0e7" />
        {/* 구글 리치 결과 및 AI 검색 이해도 향상을 위한 JSON-LD 구조화 데이터 */}
        <WebsiteJsonLd />
        <WebAppJsonLd />
      </head>
      <body lang="ko-KR" className="min-h-full flex flex-col bg-background text-foreground transition-colors duration-200">
        {CLOUDFLARE_WEB_ANALYTICS_TOKEN ? (
          <Script
            src="https://static.cloudflareinsights.com/beacon.min.js"
            strategy="afterInteractive"
            data-cf-beacon={JSON.stringify({ token: CLOUDFLARE_WEB_ANALYTICS_TOKEN })}
          />
        ) : null}
        <AppProvider>
          {children}
          {/* 튜토리얼은 라우트(탭) 전환 시에도 유지되도록 루트 레이아웃에 마운트 */}
          <TutorialGuide />
        </AppProvider>
      </body>
    </html>
  );
}
