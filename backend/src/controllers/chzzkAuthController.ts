import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { userRepository } from '../repositories';

const CHZZK_CLIENT_ID = process.env.CHZZK_CLIENT_ID || '';
const CHZZK_CLIENT_SECRET = process.env.CHZZK_CLIENT_SECRET || '';
const CHZZK_API_URL = process.env.CHZZK_API_URL || 'https://api.chzzk.naver.com';
const JWT_SECRET = process.env.JWT_SECRET || 'chzzk_secret_key_2026';

/**
 * 1. 치지직 로그인 인터록 URL 반환 API
 */
export const getChzzkAuthUrl = (req: Request, res: Response) => {
  const { redirect_uri, state } = queryParser(req);
  
  if (!redirect_uri) {
    return res.status(400).json({ error: 'BadRequest', message: 'redirect_uri 쿼리 파라미터가 필요합니다.' });
  }

  const authUrl = `https://chzzk.naver.com/account-interlock?clientId=${CHZZK_CLIENT_ID}&redirectUri=${encodeURIComponent(redirect_uri)}&state=${encodeURIComponent(state || 'cctv_state')}`;
  
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
        state: state || 'cctv_state'
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`치지직 토큰 교환 실패: ${response.status} - ${errorText}`);
    }

    const tokenData = (await response.json()) as {
      accessToken: string;
      refreshToken: string;
      expiresIn: number;
      tokenType?: string;
    };

    // B. 발급받은 accessToken으로 치지직 사용자 프로필 조회 (공식 가이드 준수)
    let chzzkUser = { id: '', nickname: '', profileImageUrl: '' };

    try {
      // 공식 명세에 따라, 개인 유저 정보 조회 시에는 클라이언트 자격증명(Client-Id/Secret) 없이 
      // 오직 유저의 accessToken만을 Bearer 헤더에 담아서 안전하게 요청합니다.
      const profileResponse = await fetch('https://openapi.chzzk.naver.com/open/v1/users/me', {
        headers: {
          'Authorization': `Bearer ${tokenData.accessToken}`,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) CCTV-App/1.0'
        }
      });

      if (profileResponse.ok) {
        const profileData = (await profileResponse.json()) as any;
        if (profileData.code === 200 && profileData.content) {
          chzzkUser.id = profileData.content.channelId || ''; // 공식 문서 명세: channelId 가 사용자 식별자입니다.
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

    // E. DB 조회 또는 생성 (계정 자동 연동 및 정보 최신화)
    let user = await userRepository.findById(chzzkUser.id);
    if (!user) {
      user = {
        id: chzzkUser.id,
        username: chzzkUser.nickname,
        avatar_url: chzzkUser.profileImageUrl || null,
        role: 'USER',
        point: 0, // 첫 가입 유저 0 포인트
        last_free_draw: null,
        banned_until: null
      };
      await userRepository.create(user);
    } else {
      // 이미 가입된 유저의 경우, 로그인할 때마다 최신 치지직 닉네임과 프로필 사진으로 업데이트합니다.
      await userRepository.updateProfile(chzzkUser.id, chzzkUser.nickname, chzzkUser.profileImageUrl || null);
      // 로컬 JWT 토큰 발행을 위해 user 객체 정보도 갱신해줍니다.
      user.username = chzzkUser.nickname;
      if (chzzkUser.profileImageUrl) {
        user.avatar_url = chzzkUser.profileImageUrl;
      }
    }

    // D. JWT 토큰 발행
    const sessionToken = jwt.sign(
      { id: user.id, role: user.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.status(200).json({
      message: '치지직 인증을 통해 로그인되었습니다.',
      token: sessionToken,
      user: {
        id: user.id,
        username: user.username,
        avatar_url: user.avatar_url,
        role: user.role,
        point: user.point
      }
    });
  } catch (err: any) {
    console.error('[ChzzkAuthController] 콜백 처리 중 에러:', err);
    return res.status(500).json({
      error: 'InternalServerError',
      message: '치지직 로그인 처리 중 서버 내부 오류가 발생했습니다.',
      details: err.message
    });
  }
};

// 헬퍼 함수
const queryParser = (req: Request) => {
  return {
    redirect_uri: req.query.redirect_uri as string,
    state: req.query.state as string
  };
};

const cryptoHash = (str: string): string => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
};
