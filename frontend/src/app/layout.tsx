import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CCTV - 치지직 카드 트레이드 뷰",
  description: "치지직 스트리머들의 프로필 사진으로 나만의 실시간 트레이딩 카드 팩을 수집하고 거래하세요.",
  manifest: "/manifest.json",
  icons: {
    icon: "/icon.png",
    apple: "/icon.png",
  }
};

export const viewport: Viewport = {
  themeColor: "#00c73c",
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
        {children}
      </body>
    </html>
  );
}
