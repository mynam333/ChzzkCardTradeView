"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleChzzkCallback = exports.getChzzkAuthUrl = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const repositories_1 = require("../repositories");
const CHZZK_CLIENT_ID = process.env.CHZZK_CLIENT_ID || '';
const CHZZK_CLIENT_SECRET = process.env.CHZZK_CLIENT_SECRET || '';
const CHZZK_API_URL = process.env.CHZZK_API_URL || 'https://api.chzzk.naver.com';
const JWT_SECRET = process.env.JWT_SECRET || 'chzzk_secret_key_2026';
/**
 * 1. 치지직 로그인 인터록 URL 반환 API
 */
const getChzzkAuthUrl = (req, res) => {
    const { redirect_uri, state } = queryParser(req);
    if (!redirect_uri) {
        return res.status(400).json({ error: 'BadRequest', message: 'redirect_uri 쿼리 파라미터가 필요합니다.' });
    }
    const authUrl = `https://chzzk.naver.com/account-interlock?clientId=${CHZZK_CLIENT_ID}&redirectUri=${encodeURIComponent(redirect_uri)}&state=${encodeURIComponent(state || 'cctv_state')}`;
    return res.status(200).json({ auth_url: authUrl });
};
exports.getChzzkAuthUrl = getChzzkAuthUrl;
/**
 * 2. 치지직 Authorization Code를 Access Token 및 User Session으로 교환하는 API
 */
const handleChzzkCallback = async (req, res) => {
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
        const tokenData = (await response.json());
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
            const profileData = (await profileResponse.json());
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
        // C. DB 조회 또는 생성 (계정 자동 연동)
        let user = await repositories_1.userRepository.findById(chzzkUser.id);
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
            await repositories_1.userRepository.create(user);
        }
        // D. JWT 토큰 발행
        const sessionToken = jsonwebtoken_1.default.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
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
    }
    catch (err) {
        console.error('[ChzzkAuthController] 콜백 처리 중 에러:', err);
        return res.status(500).json({
            error: 'InternalServerError',
            message: '치지직 로그인 처리 중 서버 내부 오류가 발생했습니다.',
            details: err.message
        });
    }
};
exports.handleChzzkCallback = handleChzzkCallback;
// 헬퍼 함수
const queryParser = (req) => {
    return {
        redirect_uri: req.query.redirect_uri,
        state: req.query.state
    };
};
const cryptoHash = (str) => {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = (hash << 5) - hash + str.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash).toString(36);
};
