/**
 * api.ts - 백엔드 API 기본 URL 설정 유틸리티
 *
 * NEXT_PUBLIC_API_URL 환경변수가 설정된 경우 해당 값을 사용하고,
 * 설정되지 않은 경우 로컬 개발 서버(localhost:5000)로 폴백합니다.
 */

// 프론트엔드 .env에서 NEXT_PUBLIC_API_URL 값을 읽음
export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || '/api';

/**
 * 로그인 상태 플래그.
 * 실제 인증은 httpOnly 세션 쿠키(JS 접근 불가)로 처리되며, 여기에는 민감한 JWT를
 * 저장하지 않습니다. UI에서 "로그인했는가"만 빠르게 판별하기 위한 비민감 플래그입니다.
 */
const AUTH_FLAG_KEY = 'cctv_auth';
export const setAuthFlag = (): void => {
  if (typeof window !== 'undefined') localStorage.setItem(AUTH_FLAG_KEY, '1');
};
export const clearAuthFlag = (): void => {
  if (typeof window !== 'undefined') localStorage.removeItem(AUTH_FLAG_KEY);
};
export const isAuthed = (): boolean =>
  typeof window !== 'undefined' && !!localStorage.getItem(AUTH_FLAG_KEY);

/**
 * 백엔드 API fetch 래퍼.
 * 인증은 httpOnly 세션 쿠키로 전송되므로(credentials: 'include') JS가 토큰을 다루지 않습니다.
 */
export const apiFetch = async (
  path: string,
  options: RequestInit = {}
): Promise<Response> => {
  const headers = new Headers(options.headers);
  const hasBody = options.body !== undefined && options.body !== null;
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;

  if (hasBody && !isFormData && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
    // httpOnly 세션 쿠키 전송 (CORS credentials)
    credentials: 'include',
  });

  // 밴 상태 체크 인터셉터 (403 BannedUser 예외)
  if (response.status === 403) {
    try {
      const clone = response.clone();
      const data = await clone.json();
      if (data && data.error === 'BannedUser') {
        if (typeof window !== 'undefined') {
          // alert()과 window.location 대신 브라우저 커스텀 이벤트를 발행하여 React 영역에서 처리하도록 위임
          window.dispatchEvent(new CustomEvent('cctv-user-banned', { 
            detail: { message: data.message || '이용 정지 조치된 계정입니다.' } 
          }));
          clearAuthFlag();
        }
      }
    } catch {
      // JSON 파싱 에러는 안전하게 무시
    }
  }

  // 점검 상태 체크 인터셉터 (503 Maintenance 예외)
  if (response.status === 503) {
    try {
      const clone = response.clone();
      const data = await clone.json();
      if (data && data.error === 'Maintenance') {
        if (typeof window !== 'undefined') {
          const bypassRoutes = ['/maintenance', '/login', '/auth/chzzk/callback'];
          const isBypass = bypassRoutes.some(route => window.location.pathname === route);
          if (!isBypass) {
            window.dispatchEvent(new CustomEvent('cctv-maintenance-triggered'));
          }
        }
      }
    } catch {
      // JSON 파싱 에러는 안전하게 무시
    }
  }

  return response;
};
