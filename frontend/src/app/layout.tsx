import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppProvider } from "./AppContext";

export const metadata: Metadata = {
  title: "CCTV - 치지직 카드 트레이드 뷰",
  description: "매일 무료 가챠를 돌려 치지직 최애 스트리머 카드를 수집하고, 실시간 시세 변동에 맞춰 거래하며 나만의 덱을 만들어보세요!",
  manifest: "/manifest.json",
  icons: {
    icon: "/icon.png",
    apple: "/icon.png",
  },
  openGraph: {
    type: "website",
    title: "CCTV - 치지직 카드 트레이드 뷰",
    description: "매일 무료 가챠를 돌려 치지직 최애 스트리머 카드를 수집하고, 실시간 시세 변동에 맞춰 거래하며 나만의 덱을 만들어보세요!",
    siteName: "치지직 카드 트레이드 뷰 (CCTV)",
    images: [
      {
        url: "/icon.png",
        width: 1200,
        height: 630,
        alt: "치지직 카드 트레이드 뷰",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "CCTV - 치지직 카드 트레이드 뷰",
    description: "매일 무료 가챠를 돌려 치지직 최애 스트리머 카드를 수집하고, 실시간 시세 변동에 맞춰 거래하며 나만의 덱을 만들어보세요!",
    images: ["/icon.png"],
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
    <html lang="ko" className="h-full antialiased dark" style={{ fontSize: "16px" }}>
      <body className="min-h-full flex flex-col bg-background text-foreground transition-colors duration-200">
        <AppProvider>
          {children}
        </AppProvider>
      </body>
    </html>
  );
}

