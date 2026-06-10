import type { NextConfig } from "next";

const uniq = (values: string[]) => Array.from(new Set(values.filter(Boolean)));

const originFromUrl = (value?: string) => {
  if (!value || value.startsWith('/')) return '';
  try {
    return new URL(value).origin;
  } catch {
    return '';
  }
};

const publicApiOrigin = originFromUrl(process.env.NEXT_PUBLIC_API_URL);
const backendPublicOrigin = originFromUrl(process.env.BACKEND_PUBLIC_URL);

const connectSrc = uniq([
  "'self'",
  publicApiOrigin,
  backendPublicOrigin,
  'https://api.yuaru.com',
  'wss://api.yuaru.com',
  'http://localhost:5000',
  'http://localhost:2083',
  'http://localhost:2087',
  'ws://localhost:2083',
  'blob:',
  'https://ssl.pstatic.net'
]);

const imageSrc = uniq([
  "'self'",
  publicApiOrigin,
  backendPublicOrigin,
  'https://api.yuaru.com',
  'https://pstatic.net',
  'https://*.pstatic.net',
  'https://chzzk.naver.com',
  'https://*.naver.com',
  'https://api.dicebear.com',
  'http://localhost:2083',
  'http://localhost:2087',
  'data:',
  'blob:'
]);

const contentSecurityPolicy = [
  "default-src 'self'",
  "frame-ancestors 'none'",
  `connect-src ${connectSrc.join(' ')}`,
  `img-src ${imageSrc.join(' ')}`,
  "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com",
  "font-src 'self' https://cdn.jsdelivr.net https://fonts.gstatic.com data:",
  "manifest-src 'self'",
  "worker-src 'self' blob:",
  "media-src 'self' blob: data:",
  "base-uri 'self'",
  "form-action 'self'"
].join('; ');

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: contentSecurityPolicy
          },
          {
            key: "X-Frame-Options",
            value: "DENY"
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff"
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin"
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()"
          }
        ]
      }
    ];
  },
  async rewrites() {
    const backendUrl = process.env.BACKEND_INTERNAL_URL || 'http://localhost:5000';
    return [
      {
        source: '/api/:path*',
        destination: `${backendUrl}/api/:path*`,
      },
      {
        source: '/uploads/:path*',
        destination: `${backendUrl}/uploads/:path*`,
      }
    ];
  }
};

export default nextConfig;
