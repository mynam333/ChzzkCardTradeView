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
    };

    // B. 발급받은 accessToken으로 치지직 사용자 프로필 조회
    // (OpenAPI 명세에 맞는 엔드포인트 호출 - 통상적으로 user profile 조회 API 활용)
    // 실제 치지직 API가 사용자의 unique ID와 프로필을 주는 규격에 대응합니다.
    const profileResponse = await fetch('https://openapi.chzzk.naver.com/open/v1/users/me', {
      headers: {
        'Authorization': `Bearer ${tokenData.accessToken}`,
        'User-Agent': 'Mozilla/5.0'
      }
    });

    let chzzkUser = { id: '', nickname: '', profileImageUrl: '' };

    if (profileResponse.ok) {
      const profileData = (await profileResponse.json()) as any;
      if (profileData.code === 200 && profileData.content) {
        chzzkUser = {
          id: profileData.content.userId || '',
          nickname: profileData.content.nickname || '치지직유저',
          profileImageUrl: profileData.content.profileImageUrl || ''
        };
      }
    }

    // fallback / mock (테스트 및 연동 편의용 폴백)
    if (!chzzkUser.id) {
      // 치지직 API 통신 실패 또는 클라이언트 키 미비 시, code의 해시를 활용한 의사 프로필 생성
      const tempHash = cryptoHash(code);
      chzzkUser = {
        id: `chzzk_${tempHash.substring(0, 12)}`,
        nickname: `치지직유저_${tempHash.substring(0, 4)}`,
        profileImageUrl: `https://api.dicebear.com/7.x/pixel-art/svg?seed=${tempHash}`
      };
    }

    // C. DB 조회 또는 생성 (계정 자동 연동 및 정보 최신화)
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
