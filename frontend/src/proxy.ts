import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Next.js Edge Runtime에서 라이브러리 의존성 없이 JWT 페이로드를 안전하게 디코딩하는 헬퍼
function getJwtPayload(token: string) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(jsonPayload);
  } catch {
    return null;
  }
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const bypassRoutes = ['/maintenance', '/login', '/auth/chzzk/callback'];
  const isBypass = bypassRoutes.some(route => pathname === route);

  try {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api';
    
    // 백엔드에 점검 상태를 Edge 단에서 호출 (10초 캐시 검토)
    const res = await fetch(`${apiUrl}/maintenance/status`, {
      next: { revalidate: 10 }
    });

    if (res.ok) {
      const data = await res.json();
      const maintenanceActive = !!data.active;

      if (maintenanceActive) {
        // 어드민 여부 검사 (JWT 쿠키 cctv_session 디코딩)
        const sessionToken = request.cookies.get('cctv_session')?.value;
        const payload = sessionToken ? getJwtPayload(sessionToken) : null;
        const isAdmin = payload?.role === 'ADMIN';

        // 어드민이 아니고 우회 경로가 아닌 경우 점검 페이지로 강제 리다이렉션
        if (!isAdmin && !isBypass) {
          return NextResponse.redirect(new URL('/maintenance', request.url));
        }
      } else {
        // 점검이 활성화되어 있지 않은데 /maintenance로 진입한 경우 메인으로 리다이렉션
        if (pathname === '/maintenance') {
          return NextResponse.redirect(new URL('/', request.url));
        }
      }
    }
  } catch (err) {
    console.error('[Middleware] 점검 상태 프리뷰 에러:', err);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * 아래 경로들을 제외한 페이지 경로에만 미들웨어 적용:
     * - api (API 라우트)
     * - _next/static, _next/image (정적 빌드 자원)
     * - favicon.ico (아이콘)
     * - uploads (로컬 이미지 저장소)
     * - 기타 확장자가 포함된 정적 리소스 파일
     */
    '/((?!api|_next/static|_next/image|favicon.ico|uploads|.*\\..*).*)',
  ],
};
