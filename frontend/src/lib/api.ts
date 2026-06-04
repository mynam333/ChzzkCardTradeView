/**
 * api.ts - 백엔드 API 기본 URL 설정 유틸리티
 *
 * NEXT_PUBLIC_API_URL 환경변수가 설정된 경우 해당 값을 사용하고,
 * 설정되지 않은 경우 로컬 개발 서버(localhost:5000)로 폴백합니다.
 */

// 프론트엔드 .env에서 NEXT_PUBLIC_API_URL 값을 읽음
export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api';

/**
 * 백엔드 API fetch 래퍼 (JWT 토큰 자동 첨부)
 */
export const apiFetch = async (
  path: string,
  options: RequestInit = {}
): Promise<Response> => {
  const token =
    typeof window !== 'undefined'
      ? localStorage.getItem('cctv_jwt_token')
      : null;

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
  });

  // 밴 상태 체크 인터셉터 (403 BannedUser 예외)
  if (response.status === 403) {
    try {
      const clone = response.clone();
      const data = await clone.json();
      if (data && data.error === 'BannedUser') {
        if (typeof window !== 'undefined') {
          // 경고창을 띄우고 즉시 토큰 폐기 및 강제 이탈(홈 화면 리다이렉트)
          alert(data.message || '이용 정지 조치된 계정입니다.');
          localStorage.removeItem('cctv_jwt_token');
          window.location.href = '/';
        }
      }
    } catch (err) {
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
            window.location.href = '/maintenance';
          }
        }
      }
    } catch (err) {
      // JSON 파싱 에러는 안전하게 무시
    }
  }

  return response;
};
