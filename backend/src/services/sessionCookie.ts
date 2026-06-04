import { Response } from 'express';
import { IS_PRODUCTION } from '../config';

/**
 * 세션 JWT를 담는 httpOnly 쿠키 이름.
 * JS(document.cookie)에서 접근 불가능하여 XSS로 인한 토큰 탈취를 방지합니다.
 */
export const SESSION_COOKIE_NAME = 'cctv_session';

const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // JWT 만료(7d)와 동일

// 운영 환경에서는 교차 출처(프론트↔API 다른 도메인) 쿠키 전송을 위해 SameSite=None; Secure 사용.
// 개발(localhost http)에서는 Secure가 불가하므로 Lax로 동작.
const cookieBaseOptions = () => ({
  httpOnly: true,
  secure: IS_PRODUCTION,
  sameSite: (IS_PRODUCTION ? 'none' : 'lax') as 'none' | 'lax',
  path: '/'
});

/** 로그인 성공 시 세션 JWT를 httpOnly 쿠키로 발급합니다. */
export const setSessionCookie = (res: Response, token: string): void => {
  res.cookie(SESSION_COOKIE_NAME, token, { ...cookieBaseOptions(), maxAge: SESSION_MAX_AGE_MS });
};

/** 로그아웃 시 세션 쿠키를 제거합니다. */
export const clearSessionCookie = (res: Response): void => {
  res.clearCookie(SESSION_COOKIE_NAME, cookieBaseOptions());
};
