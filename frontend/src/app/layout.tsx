import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppProvider } from "./AppContext";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"),
  title: "치카포 : 치지직 카드 포럼",
  description: "매일 무료 가챠를 돌려 치지직 최애 스트리머 카드를 수집하고, 실시간 시세 변동에 맞춰 거래하며 나만의 덱을 만들어보세요!",
  manifest: "/manifest.json",
  icons: {
    icon: "/icon.png",
    apple: "/icon.png",
  },
  openGraph: {
    type: "website",
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
    <html lang="ko" className="h-full antialiased dark" style={{ fontSize: "16px" }}>
      <body className="min-h-full flex flex-col bg-background text-foreground transition-colors duration-200">
        <AppProvider>
          {children}
        </AppProvider>
      </body>
    </html>
  );
}
