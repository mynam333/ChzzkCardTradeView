/**
 * config.ts - 중앙 환경 변수 로더 및 검증
 *
 * server.ts가 dotenv를 먼저 로드한 뒤 app.ts → (각 컨트롤러) 순으로 import되므로
 * 이 모듈이 평가되는 시점에는 process.env가 이미 채워져 있습니다.
 *
 * 보안상 반드시 존재해야 하는 값(JWT_SECRET 등)이 누락되면 즉시 throw 하여
 * 하드코딩된 폴백 키로 서버가 기동되는 사고를 차단합니다.
 */

const isProd = process.env.NODE_ENV === 'production';

/**
 * 필수 환경 변수를 읽고, 없으면 명확한 에러를 던집니다.
 */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(
      `[Config] 필수 환경 변수 ${name}가 설정되지 않았습니다. backend/.env 파일을 확인하세요.`
    );
  }
  return value;
}

// 운영 환경 여부 (에러 응답 상세 노출 제어 등에 사용)
export const IS_PRODUCTION = isProd;

// 자체 세션 JWT 서명 비밀키 (하드코딩 폴백 제거 - 반드시 .env에 설정해야 함)
export const JWT_SECRET = requireEnv('JWT_SECRET');

// 토큰 암호화 키 (별도 미지정 시 JWT_SECRET으로부터 파생)
export const TOKEN_ENCRYPTION_SECRET =
  process.env.TOKEN_ENCRYPTION_KEY || JWT_SECRET;

/**
 * CORS 허용 오리진 화이트리스트.
 * CORS_ALLOWED_ORIGINS="https://a.com,https://b.com" 형태로 콤마 구분.
 * 미설정 시 개발 편의를 위해 localhost(3000)만 허용합니다.
 */
export const CORS_ALLOWED_ORIGINS: string[] = (
  process.env.CORS_ALLOWED_ORIGINS ||
  'http://localhost:3000,http://127.0.0.1:3000'
)
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);
