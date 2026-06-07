import { Response } from 'express';
import { IS_PRODUCTION } from '../config';

/**
 * 세션 JWT를 담는 httpOnly 쿠키 이름.
 * JS(document.cookie)에서 접근 불가능하여 XSS로 인한 토큰 탈취를 방지합니다.
 */
export const SESSION_COOKIE_NAME = 'chikapo_session';
export const LEGACY_SESSION_COOKIE_NAME = 'cctv_session';
export const SESSION_COOKIE_NAMES = [SESSION_COOKIE_NAME, LEGACY_SESSION_COOKIE_NAME] as const;

export const OAUTH_STATE_COOKIE_NAME = 'chikapo_oauth_state';
export const LEGACY_OAUTH_STATE_COOKIE_NAME = 'cctv_oauth_state';
export const OAUTH_STATE_COOKIE_NAMES = [OAUTH_STATE_COOKIE_NAME, LEGACY_OAUTH_STATE_COOKIE_NAME] as const;

const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // JWT 만료(7d)와 동일

// 운영 환경 및 개발 환경 모두에서 가능하면 Secure 속성을 강제합니다.
// (단, localhost 개발 시 httpOnly, sameSite=lax는 동작하나 https가 아닐 경우 secure는 브라우저가 거부할 수 있으므로
// 실배포 도메인 주소에서는 무조건 secure: true가 설정되도록 IS_PRODUCTION 기준 설정을 따릅니다)
export const cookieBaseOptions = () => ({
  httpOnly: true,
  secure: IS_PRODUCTION, // HTTPS 배포 환경에서 필수
  sameSite: (IS_PRODUCTION ? 'none' : 'lax') as 'none' | 'lax',
  path: '/'
});

/** 로그인 성공 시 세션 JWT를 httpOnly 쿠키로 발급합니다. */
export const setSessionCookie = (res: Response, token: string): void => {
  res.cookie(SESSION_COOKIE_NAME, token, { ...cookieBaseOptions(), maxAge: SESSION_MAX_AGE_MS });
};

/** 로그아웃 시 세션 쿠키를 제거합니다. */
export const clearSessionCookie = (res: Response): void => {
  SESSION_COOKIE_NAMES.forEach(cookieName => {
    res.clearCookie(cookieName, cookieBaseOptions());
  });
};

/** OAuth 로그인 CSRF 방어용 state 값을 httpOnly 쿠키로 저장합니다. */
export const setOAuthStateCookie = (res: Response, state: string): void => {
  res.cookie(OAUTH_STATE_COOKIE_NAME, state, { ...cookieBaseOptions(), maxAge: 10 * 60 * 1000 });
};

/** OAuth 콜백 검증 완료/실패 시 state 쿠키를 제거합니다. */
export const clearOAuthStateCookie = (res: Response): void => {
  OAUTH_STATE_COOKIE_NAMES.forEach(cookieName => {
    res.clearCookie(cookieName, cookieBaseOptions());
  });
};
