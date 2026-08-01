import { Request, Response } from 'express';
import crypto from 'crypto';
import { minigameRepository, userRepository } from '../repositories';
import { IS_PRODUCTION, CORS_ALLOWED_ORIGINS } from '../config';
import { encryptToken } from '../services/cryptoService';
import {
  setSessionCookie,
  clearSessionCookie,
  setOAuthStateCookie,
  clearOAuthStateCookie,
  OAUTH_STATE_COOKIE_NAMES
} from '../services/sessionCookie';
import { getActiveAccountInteractionRestriction } from '../services/accountInteractionRestriction';
import {
  AuthSessionLookupTimeoutError,
  createAuthSessionToken,
  getRequestSessionToken,
  revokeAuthSessionToken
} from '../services/authSessionService';

const CHZZK_CLIENT_ID = process.env.CHZZK_CLIENT_ID || '';
const CHZZK_CLIENT_SECRET = process.env.CHZZK_CLIENT_SECRET || '';
const CHZZK_API_URL = process.env.CHZZK_API_URL || 'https://api.chzzk.naver.com';
class ChzzkTokenExchangeError extends Error {
  constructor(
    public statusCode: number,
    public responseBody: string
  ) {
    super(`치지직 토큰 교환 실패: ${statusCode} - ${responseBody}`);
  }
}

/**
 * 1. 치지직 로그인 인터록 URL 반환 API
 */
export const getChzzkAuthUrl = (req: Request, res: Response) => {
  const { redirect_uri } = queryParser(req);
  
  if (!redirect_uri) {
    return res.status(400).json({ error: 'BadRequest', message: 'redirect_uri 쿼리 파라미터가 필요합니다.' });
  }

  let redirectOrigin: string;
  try {
    const parsedUrl = new URL(redirect_uri);
    redirectOrigin = parsedUrl.origin;
    
    // 포트가 명시적으로 다르면 다르게 인식하도록, 역슬래시나 @ 등의 오동작 방지
    if (parsedUrl.username || parsedUrl.password || parsedUrl.search || parsedUrl.hash) {
      // 제어 문자나 비정상 크리덴셜 주입 차단
      return res.status(400).json({ error: 'BadRequest', message: 'redirect_uri 형식이 잘못되었습니다.' });
    }
  } catch {
    return res.status(400).json({ error: 'BadRequest', message: 'redirect_uri 형식이 올바르지 않습니다.' });
  }

  // 정확한 origin 비교 검사
  const isAllowedRedirect = CORS_ALLOWED_ORIGINS.some(allowed => {
    try {
      return new URL(allowed).origin === redirectOrigin;
    } catch {
      return allowed === redirectOrigin;
    }
  });

  if (!isAllowedRedirect) {
    return res.status(400).json({ error: 'BadRequest', message: '허용되지 않은 로그인 리다이렉트 출처입니다.' });
  }

  const state = crypto.randomBytes(24).toString('base64url');
  setOAuthStateCookie(res, state);

  const authUrl = `https://chzzk.naver.com/account-interlock?clientId=${CHZZK_CLIENT_ID}&redirectUri=${encodeURIComponent(redirect_uri)}&state=${encodeURIComponent(state)}`;
  
  return res.status(200).json({ auth_url: authUrl });
};

/**
 * 2. 치지직 Authorization Code를 Access Token 및 User Session으로 교환하는 API
 */
export const handleChzzkCallback = async (req: Request, res: Response) => {
  const { code, state } = req.body;

  if (!code) {
    return res.status(400).json({ error: 'BadRequest', message: 'code(Authorization Code)가 필요합니다.' });
  }

  const cookies = (req as any).cookies || {};
  const expectedState = OAUTH_STATE_COOKIE_NAMES
    .map(cookieName => cookies[cookieName])
    .find(Boolean);
  if (!state || !expectedState || state !== expectedState) {
    clearOAuthStateCookie(res);
    return res.status(400).json({
      error: 'InvalidOAuthState',
      message: '로그인 요청 상태값이 일치하지 않습니다. 다시 로그인해 주세요.'
    });
  }
  clearOAuthStateCookie(res);

  try {
    // A. 치지직 OpenAPI Token Endpoint로 POST 요청 수행
    const tokenUrl = 'https://openapi.chzzk.naver.com/auth/v1/token';
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0'
      },
      body: JSON.stringify({
        grantType: 'authorization_code',
        clientId: CHZZK_CLIENT_ID,
        clientSecret: CHZZK_CLIENT_SECRET,
        code,
        state: state || 'chikapo_state'
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new ChzzkTokenExchangeError(response.status, errorText);
    }

    const rawTokenBody = await response.text();

    const tokenData = JSON.parse(rawTokenBody) as {
      code: number;
      message: string;
      content?: {
        accessToken: string;
        refreshToken: string;
        expiresIn: number;
        tokenType?: string;
      };
    };

    const tokenContent = tokenData.content || (tokenData as any);
    const finalAccessToken = tokenContent.accessToken || (tokenContent as any).access_token || null;
    const finalRefreshToken = tokenContent.refreshToken || (tokenContent as any).refresh_token || null;
    const expiresIn = Number(tokenContent.expiresIn || (tokenContent as any).expires_in || 0);
    const tokenExpiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null;

    // B. 발급받은 accessToken으로 치지직 사용자 프로필 조회 (공식 가이드 준수)
    let chzzkUser = { id: '', nickname: '', profileImageUrl: '' };

    try {
      const profileHeaders = {
        'Authorization': `Bearer ${finalAccessToken}`,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chikapo-App/1.0'
      };

      const profileResponse = await fetch('https://openapi.chzzk.naver.com/open/v1/users/me', {
        headers: profileHeaders
      });

      if (profileResponse.ok) {
        const rawProfileBody = await profileResponse.text();
        const profileData = JSON.parse(rawProfileBody) as any;
        if (profileData.code === 200 && profileData.content) {
          chzzkUser.id = profileData.content.channelId || '';
          chzzkUser.nickname = profileData.content.nickname || '';
        } else {
          console.warn('[ChzzkAuthController] 공식 API 응답 코드 오류:', profileData.code, profileData.message);
        }
      } else {
        const errBody = await profileResponse.text();
        console.warn(`[ChzzkAuthController] 공식 API 호출 응답 실패 (${profileResponse.status}):`, errBody);
      }
    } catch (e: any) {
      console.error('[ChzzkAuthController] 공식 OpenAPI 사용자 프로필 획득 중 심각한 예외 발생:', e.message);
    }

    // C. 프로필 이미지가 비어있는 경우, channelId를 기반으로 비공식 채널 프로필 API를 추가 호출하여 프로필 이미지 수급
    if (chzzkUser.id && !chzzkUser.profileImageUrl) {
      try {
        const channelProfileResponse = await fetch(`https://api.chzzk.naver.com/service/v1/channels/${chzzkUser.id}`, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        });
        if (channelProfileResponse.ok) {
          const channelData = (await channelProfileResponse.json()) as any;
          if (channelData.code === 200 && channelData.content) {
            chzzkUser.profileImageUrl = channelData.content.channelImageUrl || '';
          }
        }
      } catch (e) {
        console.warn(`[ChzzkAuthController] channelId(${chzzkUser.id}) 기반 비공식 프로필 이미지 조회 실패:`, e);
      }
    }

    // D. 보안 강화: 유저 정보를 획득하지 못했다면 모크 유저 생성을 하지 않고 에러를 반환하여 로그인 가입 차단
    if (!chzzkUser.id || !chzzkUser.nickname) {
      return res.status(401).json({
        error: 'ChzzkAuthenticationFailed',
        message: '치지직 공식 API로부터 사용자 프로필(고유 식별 정보)을 회수하지 못했습니다. 설정된 Client ID / Secret 또는 인가 코드 만료 상태를 점검해 주세요.'
      });
    }

    // 치지직 OAuth 토큰은 DB에 평문으로 저장하지 않고 AES-256-GCM으로 암호화하여 보관
    const encAccessToken = encryptToken(finalAccessToken);
    const encRefreshToken = encryptToken(finalRefreshToken);

    // E. DB 조회 또는 생성 (계정 자동 연동 및 정보 최신화)
    let user = await userRepository.findById(chzzkUser.id);
    const deletedAccount = await userRepository.findDeletedAccount(chzzkUser.id);
    const interactionRestrictedUntil = getActiveAccountInteractionRestriction(deletedAccount);
    if (!user) {
      user = {
        id: chzzkUser.id,
        username: chzzkUser.nickname,
        avatar_url: chzzkUser.profileImageUrl || null,
        role: 'USER',
        point: 0, // 첫 가입 유저 0 포인트
        last_free_draw: null,
        banned_until: null,
        access_token: encAccessToken,
        refresh_token: encRefreshToken
      };
      await userRepository.create(user);
    } else {
      // 이미 가입된 유저의 경우, 로그인할 때마다 최신 치지직 닉네임, 프로필 사진 및 액세스 토큰으로 업데이트합니다.
      await userRepository.updateProfile(chzzkUser.id, chzzkUser.nickname, chzzkUser.profileImageUrl || null, encAccessToken, encRefreshToken);
      // 로컬 JWT 토큰 발행을 위해 user 객체 정보도 갱신해줍니다.
      user.username = chzzkUser.nickname;
      if (chzzkUser.profileImageUrl) {
        user.avatar_url = chzzkUser.profileImageUrl;
      }
      user.access_token = finalAccessToken;
      user.refresh_token = finalRefreshToken;
    }

    // 토큰 만료 시각 저장 (리프레시 기준점)
    await userRepository.updateTokens(user.id, encAccessToken, encRefreshToken, tokenExpiresAt);
    await minigameRepository.getTicketStatus(user.id).catch((err: any) => {
      console.warn('[ChzzkAuthController] 미니게임 티켓 초기화 실패:', err?.message || err);
    });

    // E-2. 차단(밴) 계정은 로그인 시점에 안내하고 토큰을 발급하지 않음
    if (user.banned_until) {
      const banExpiration = new Date(user.banned_until);
      if (banExpiration > new Date()) {
        const isPermanent = banExpiration.getFullYear() > 2099;
        const formatted = banExpiration.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
        const reasonSuffix = user.ban_reason ? ` (사유: ${user.ban_reason})` : '';
        return res.status(403).json({
          error: 'BannedUser',
          message: isPermanent
            ? `해당 계정은 규정 위반으로 영구 이용 정지 상태입니다.${reasonSuffix}`
            : `해당 계정은 이용이 제한되어 로그인할 수 없습니다. (제한 만료: ${formatted})${reasonSuffix}`,
          banned_until: user.banned_until,
          ban_reason: user.ban_reason
        });
      }
    }

    // D. JWT 토큰 발행
    const sessionToken = await createAuthSessionToken(user.id, user.role);

    // httpOnly 쿠키로 세션 발급(XSS 토큰 탈취 방지). JS 응답에는 세션 토큰을 노출하지 않습니다.
    setSessionCookie(res, sessionToken);

    return res.status(200).json({
      message: '치지직 인증을 통해 로그인되었습니다.',
      user: {
        id: user.id,
        username: user.username,
        avatar_url: user.avatar_url,
        role: user.role,
        point: user.point,
        last_free_draw: user.last_free_draw
      },
      interaction_restricted_until: interactionRestrictedUntil?.toISOString() || null
    });
  } catch (err: any) {
    if (err instanceof ChzzkTokenExchangeError && err.statusCode === 403) {
      console.warn('[ChzzkAuthController] 치지직 인증 코드 교환 실패:', err.responseBody);
      return res.status(400).json({
        error: 'InvalidAuthorizationCode',
        message: '로그인 인증 코드가 만료되었거나 이미 사용되었습니다. 다시 로그인해 주세요.'
      });
    }

    console.error('[ChzzkAuthController] 콜백 처리 중 에러:', err);
    return res.status(500).json({
      error: 'InternalServerError',
      message: '치지직 로그인 처리 중 서버 내부 오류가 발생했습니다.',
      details: IS_PRODUCTION ? undefined : err.message
    });
  }
};

/**
 * 로그아웃 — 서버 세션을 폐기한 뒤 httpOnly 세션 쿠키 제거
 */
export const logout = async (req: Request, res: Response) => {
  const token = getRequestSessionToken(req);
  if (token) {
    try {
      await revokeAuthSessionToken(token);
    } catch (err: any) {
      // 이미 만료되었거나 손상된 토큰은 로컬 쿠키만 제거하면 됩니다.
      if (
        err?.name !== 'JsonWebTokenError' &&
        err?.name !== 'TokenExpiredError' &&
        err?.name !== 'NotBeforeError' &&
        err?.name !== 'InvalidAuthSessionError'
      ) {
        console.error('[ChzzkAuthController] 로그아웃 세션 폐기 실패:', err?.message || err);
        if (err instanceof AuthSessionLookupTimeoutError) res.setHeader('Retry-After', '3');
        return res.status(503).json({
          error: 'AuthServiceBusy',
          message: '로그아웃을 안전하게 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'
        });
      }
    }
  }
  clearSessionCookie(res);
  return res.status(200).json({ message: '로그아웃되었습니다.' });
};

// 헬퍼 함수
const queryParser = (req: Request) => {
  return {
    redirect_uri: req.query.redirect_uri as string,
    state: req.query.state as string
  };
};
