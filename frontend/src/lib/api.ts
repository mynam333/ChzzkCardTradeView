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

  return fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
  });
};
