# CCTV (cctv.yuaru.com) 보안 점검 리포트

> **대상**: `https://cctv.yuaru.com` (프론트) · `https://api.yuaru.com:2053/api` (백엔드)
> **점검 일자**: 2026-06-05
> **범위**: 로그인하지 않은 상태에서 발견 가능한 취약점 (비인증 블랙박스)
> **수행 원칙(RoE)**: 비파괴(non-destructive) — 읽기 전용 GET / 소규모 버스트(≤40)만 사용. 데이터 변조·삭제·무차별 대입·DoS **미수행**.
> **방법**: 수동 정찰 + 버전/CVE 검사 + 7개 차원 다중 에이전트 분석 → 적대적 검증(false positive 제거) → 완전성 스윕
> **상태**: "파괴 범위" 테스트는 스테이징/로컬 복제본에서 진행 예정 (미수행)

---

## 0. 총평

백엔드 설계는 **예상보다 견고**합니다. 인가(authz), CORS, OAuth 검증, SSRF 방어, 시크릿 관리, Next.js 버전(16.2.6 = 최신 패치)이 모두 잘 되어 있습니다.
다만 배포 전 반드시 막아야 할 **운영 실수 2건(에러 정보 노출 + 레이트 리밋 부재)**과, 트레이딩 게임 특성상 중요한 **데이터 과다 노출**이 있습니다.

### 식별된 스택
| 구성 | 내용 |
|---|---|
| 프론트엔드 | **Next.js 16.2.6** (App Router, Turbopack), React 19.3.0-canary, **Vercel** 호스팅 |
| 백엔드 | **Node/Express + Helmet + cors**, `Cloudflare` 앞단, 포트 2053, 경로 `/home/ubuntu/ChzzkCardTradeView/backend/dist/app.js` (실행계정 `ubuntu`) |
| 인증 | **치지직(네이버) OAuth**, 토큰은 **httpOnly 쿠키**(`cctv_session`), localStorage엔 플래그 `cctv_auth="1"`만 |
| 앱 성격 | 치지직 스트리머 카드 수집/시세 트레이드 가챠 게임 |

### 심각도 요약
| 우선순위 | 개수 | 항목 |
|---|---|---|
| 🔴 P1 (배포 전 **필수**) | 2 | 스택트레이스 노출 · 레이트 리밋 전무 |
| 🟠 P2 (배포 전 **권장**) | 4 | /streamers 과다노출 · 쿠키 Secure 누락 · 프론트 보안헤더 · register 서버재검증 |
| 🟡 P3 (하드닝) | 8 | CORS 500 · og:image · API CSP · 서비스워커 리다이렉트 외 |
| 🔒 로그인 후 검증 필요 | 5 | 경제 엔드포인트 어뷰징 · IDOR · 관리자 role 외 |

---

## 1. 🔴 P1 — 배포 전 반드시 수정

### P1-1. 에러 응답에 Node 스택트레이스 + 서버 절대경로 노출 (High)

**분류**: 정보 노출 / Verbose Error Handling (CWE-209)
**위치**: `https://api.yuaru.com:2053/api/*` (전역 에러 핸들러)
**비인증 악용**: ✅ 가능 (여러 경로)

비로그인 상태에서 **여러 벡터**로 트리거됩니다:
- 비허용 `Origin` 헤더 전송 → **HTTP 500** + 전체 스택
- 잘못된 JSON 본문(`{"a":`)을 `/auth/logout`(미인증 호출 가능)에 POST → **HTTP 400** + 스택

**노출 증거**:
```
Error: CORS 정책에 의해 차단된 오리진입니다: https://evil.example
  at origin (/home/ubuntu/ChzzkCardTradeView/backend/dist/app.js:43:22)
  at /home/ubuntu/ChzzkCardTradeView/node_modules/cors/lib/index.js:219:13
  ... at /home/ubuntu/ChzzkCardTradeView/node_modules/helmet/index.cjs:531:6

SyntaxError: Unexpected end of JSON input
  at parse (/home/ubuntu/ChzzkCardTradeView/node_modules/body-parser/lib/types/json.js:92:19)
  at /home/ubuntu/ChzzkCardTradeView/node_modules/raw-body/index.js:238:16
```
→ 서버 절대경로·OS 계정(`ubuntu`)·의존성(cors/body-parser/raw-body/helmet)·코드 라인이 그대로 노출. **이게 보인다는 것 자체가 `NODE_ENV`가 production이 아님을 강하게 시사**(성능/캐싱에도 악영향).

> **검증 정정**: 처음엔 "모든 500에 적용"이라 평가했으나, 실제로는 **CORS 거부·본문 파싱 오류·미처리 예외 경로**에 한정됨(일반 404는 `Cannot GET` 만 반환, 스택 미노출). 그래도 비인증 다중 벡터라 High 유지.

**해결책** (`app.ts`):
```js
// 1) CORS 거부를 throw하지 말 것 (500의 근본 원인)
const ALLOWED = new Set(['https://cctv.yuaru.com']);
app.use(cors({
  origin: (origin, cb) => cb(null, !origin || ALLOWED.has(origin)), // 거부 시 throw 대신 false
  credentials: true,
  methods: ['GET','POST','PATCH','DELETE'],
  allowedHeaders: ['Content-Type','Authorization'],
  maxAge: 600,
}));

// 2) 모든 라우트 뒤 전역 에러 핸들러 — 스택을 절대 응답에 싣지 않음
app.use((err, req, res, next) => {
  logger.error(err.stack);                       // 서버 로그에만
  const status = err.status || err.statusCode || 500;
  res.status(status).json({ error: status === 400 ? 'BadRequest' : 'InternalError' });
});
```
```bash
# 3) 반드시 production으로 기동 (PM2/systemd/Docker 환경변수 점검)
NODE_ENV=production node dist/app.js
```

---

### P1-2. 애플리케이션 레벨 레이트 리밋 전무 (High)

**분류**: Rate Limiting / DoS / Resource Exhaustion (CWE-770)
**위치**: `https://api.yuaru.com:2053/api/*` (전 엔드포인트)
**비인증 악용**: ✅ 가능

**증거**: 40개 동시 GET `/maintenance/status` 전부 200, 30회 연속 `/auth/chzzk/url` 전부 200, `RateLimit-*`/`Retry-After` 헤더 **전무**. 앞단 Cloudflare는 L3/4만 보호, 앱 레벨 제한은 0.

**영향**: 곧 출시할 **가챠/트레이드 게임**에서 치명적. 로그인 후 `draw`/`buy`/`trade`를 봇이 초당 수십 회 호출 시 경제 붕괴. 미인증 영역에서도 OAuth state 무한 생성·전체 데이터 스크래핑 가능.

**해결책**:
```js
const rateLimit = require('express-rate-limit');
app.set('trust proxy', 1);                              // Cloudflare 뒤이므로 필수
const key = (req) => req.headers['cf-connecting-ip'] || req.ip;

app.use('/api', rateLimit({ windowMs: 60_000, max: 100, standardHeaders: true, keyGenerator: key }));
app.use('/api/auth', rateLimit({ windowMs: 60_000, max: 15, keyGenerator: key }));  // 인증은 더 엄격
// 경제 엔드포인트는 "사용자ID 기준" 별도 한도 + 일일 한도(DB 원자적 검증) — 로그인 후 로직
```
다중 인스턴스면 `rate-limit-redis`로 store 공유. Cloudflare 대시보드에도 Rate Limiting Rule 병행 권장.

---

## 2. 🟠 P2 — 배포 전 권장

### P2-1. `/api/streamers` 과다 노출 (Medium) — 트레이딩 게임이라 특히 중요

**분류**: 과다 정보 노출 / Broken Object/Property Level Authorization
**위치**: `GET https://api.yuaru.com:2053/api/streamers` (미인증)
**비인증 악용**: ✅ 가능

미인증으로 147개 레코드 전량(약 131KB)이 반환되며 다음이 포함됨:
- **`registered_by`** (32자리 사용자 채널 해시, 22건) → 누가 무엇을 등록했는지 **사용자 열거**
- **`base_value`, `prev_value`, `value_1h_ago`, `broadcast_multiplier`, `activity_score`, `broadcast_minutes`** → **카드 시세 산정 알고리즘 입력값 전체** → 시세 예측·자동 차익거래(인사이더성 봇 트레이딩) 가능
- `?limit`/`?offset` 무시(페이지네이션 없음, `?limit=99999`도 동일 131KB) + `Cache-Control` 없음(`cf-cache-status: DYNAMIC`) → 스크래핑·오리진/DB 반복 부하

**해결책** — 응답 DTO 화이트리스트 + 캐시:
```js
res.set('Cache-Control', 'public, max-age=60');        // + Cloudflare Cache Rule
res.json(rows.map(s => ({
  channelId: s.channel_id, name: s.name, logoUrl: s.logo_url,
  followerCount: s.follower_count, value: s.base_value, // 표시용 1개만
})));   // registered_by, *_multiplier, prev_value, value_1h_ago 등은 제외 (SELECT * 금지)
```

### P2-2. 인증 쿠키에 `Secure` 속성 누락 (Medium)

**위치**: `Set-Cookie: cctv_oauth_state` (`/auth/chzzk/url`), `cctv_session` (`/auth/logout`)
**증거**: `cctv_oauth_state=...; Max-Age=600; Path=/; HttpOnly; SameSite=Lax` — **`Secure` 없음**. `cctv_session` 삭제 쿠키도 동일. HttpOnly·SameSite=Lax는 적용됨.
**영향**: HSTS로 완화되지만 최초 방문/서브도메인 평문 창에서 OAuth state·세션 쿠키가 평문 전송될 여지.

**해결책**:
```js
res.cookie('cctv_oauth_state', v, { httpOnly:true, secure:true, sameSite:'lax', maxAge:600000, path:'/' });
res.clearCookie('cctv_session', { httpOnly:true, secure:true, sameSite:'lax', path:'/' }); // 삭제도 동일 속성
```
세션 쿠키는 가능하면 `SameSite=Strict` + `__Host-` 프리픽스 검토. `app.set('trust proxy', 1)` 후 `X-Forwarded-Proto` 기반 secure 동작 보장.

### P2-3. 프론트엔드(Vercel) 보안 헤더 부재 (Medium, 현실 악용성은 낮음)

**위치**: `/`, `/login`, `/admin` 등 전 프론트 응답
**증거**: CSP·X-Frame-Options·X-Content-Type-Options·Referrer-Policy·Permissions-Policy **전무**. HTML에 불필요한 `Access-Control-Allow-Origin: *`. HSTS는 `max-age=63072000`만(`includeSubDomains`/`preload` 없음). 번들에 프레임버스팅 로직도 없음 → 이론상 클릭재킹.

> **검증 정정**: `/login`은 치지직으로 즉시 리다이렉트하는 shim이고 실제 로그인은 치지직 도메인(자체 프레임 방어)에서 발생 → **클릭재킹 현실 악용성은 낮음**. 그래도 심층 방어로 추가 권장.

**해결책** (`next.config.js`):
```js
async headers() {
  return [{ source: '/:path*', headers: [
    { key:'Content-Security-Policy', value:"default-src 'self'; frame-ancestors 'none'; connect-src 'self' https://api.yuaru.com:2053; img-src 'self' https://nng-phinf.pstatic.net data:; script-src 'self' 'unsafe-inline'" },
    { key:'X-Frame-Options', value:'DENY' },
    { key:'X-Content-Type-Options', value:'nosniff' },
    { key:'Referrer-Policy', value:'strict-origin-when-cross-origin' },
    { key:'Permissions-Policy', value:'camera=(), microphone=(), geolocation=()' },
  ]}];
}
```
HTML의 `Access-Control-Allow-Origin: *` 제거, HSTS에 `includeSubDomains; preload` 추가.

### P2-4. `/streamers/register`가 클라이언트 값을 신뢰할 가능성 (Medium · 로그인 후 검증 필요)

**위치**: `POST /api/streamers/register` (인증 필요)
**증거**: 번들상 등록 시 `followerCount`/`channelName`/`channelImageUrl`을 **클라이언트가 전송**하고, "팔로워 150명 이상" 게이트가 **클라이언트 측에만** 존재(`if(150 > Number(u.followerCount)) ...`).
**영향**: 서버가 이 값을 그대로 신뢰하면 게이트 우회·위조 채널 등록 → 카드 발행 주체 무결성 훼손.

**해결책**: 서버는 `channelId`만 신뢰, 나머지는 **치지직 공식 API로 재조회**해 덮어쓰기. 150 조건도 재조회 값으로 검증.
```js
const ch = await chzzk.getChannel(channelId);
if (ch.followerCount < 150) return res.status(403).json({ error: 'NotEligible' });
// channelName/imageUrl/followerCount는 ch에서 가져온 권위 값만 저장
```
> 서버 재검증 여부는 로그인 필요로 미확정 → 4장 "로그인 후 검증" 목록 포함.

---

## 3. 🟡 P3 — 하드닝

| # | 항목 | 위치 | 조치 |
|---|---|---|---|
| P3-1 | CORS 거부가 403 아닌 **500** 반환 | API 전역 | P1-1의 `cb(null,false)`로 해결 |
| P3-2 | `og:image`/`twitter:image` = `http://localhost:3000/icon.png` | 프론트 메타데이터 | `metadataBase = new URL(process.env.NEXT_PUBLIC_SITE_URL)` + 상대경로 |
| P3-3 | **API 응답에 CSP 헤더 부재** (Helmet CSP 비활성) | API 전역 | `helmet({ contentSecurityPolicy:{ directives:{ defaultSrc:["'none'"], frameAncestors:["'none'"] }}})` |
| P3-4 | 서비스워커 `notificationclick`이 푸시 `url`로 **무검증 이동** (PWA 오픈리다이렉트) | `/sw.js` | `new URL(raw, origin).origin === self.location.origin`인 동일출처 경로만 `client.navigate`/`openWindow` |
| P3-5 | `redirect_uri` 검증이 역슬래시/공백/대문자/배열 통과 (느슨한 매칭, WHATWG 파서 differential) | `/auth/chzzk/url` | `new URL()` 파싱 후 `protocol/hostname/port/username` 정확 검사, 제어문자 즉시 400 |
| P3-6 | 관리자 상점 `style_json.css`가 전역 `<style>`에 **무이스케이프 주입** (Stored CSS Injection) | `admin1.js` | 속성/값 화이트리스트, `url()` 호스트 제한, `@import`/`position:fixed` 차단 |
| P3-7 | credentialed JSON에 `Cache-Control: no-store` 없음 | API 전역 | `/api`에 캐시 정책 미들웨어 |
| P3-8 | 로그아웃 CSRF | `/auth/logout` | 대체로 완화됨(자체 Origin 가드로 외부 출처 차단·GET 404). SameSite=Strict로 마무리 |

---

## 4. 🔒 로그인해야 검증 가능 — 출시 전 직접 확인 필요

미인증으로는 **확정 불가**한 항목(정직하게 분리). 가챠 게임의 가장 큰 리스크일 수 있으니 **로그인 상태로 점검 필수**:

1. **경제 엔드포인트 어뷰징** — `draw`/`shop/buy`/`trades`에 **사용자ID 기준 레이트리밋 + 일일한도 + 멱등성**이 서버 강제되는지. 클라이언트가 보낸 가격/수량(`quantity=-1`, `price=0`, 정수 오버플로우)을 서버가 재검증하는지. 동시 요청 경합(race) 테스트.
2. **IDOR** — 타인의 `card_id`/`trade_id`로 GET/PATCH 시 403인지 (객체 소유권 검증).
3. **관리자 인가** — 일반 인증 사용자가 `/admin/*` 호출 시 **401이 아닌 403**인지 (role=ADMIN 서버 강제). 신규 발견 `/admin/coupons`, `/admin/reset`, `/admin/uploads/orphans/delete`, `/admin/push/schedule` 포함.
4. **세션 쿠키 속성** — 로그인 성공 시 `cctv_session` 발급 쿠키의 Secure/SameSite/만료/서버측 무효화.
5. **쿠폰** — 코드 브루트포스 방지·1회용 보장.

> ⚠️ **적대적 검증 메모**: 워크플로 한 에이전트가 "번들에서 `/cards/draw` 등 경로 확인"이라 보고했으나, 검증 결과 **다운로드된 번들엔 그 리터럴이 없었음**(401 프로빙으로만 존재 확인). 해당 게임 UI 청크는 지연 로딩이라 미수집 — 위 1번은 추정이 아닌 실측 검증 필요.

---

## 5. 🟢 잘 되어 있는 부분 (확인된 positives)

- ✅ **Next.js 16.2.6 = 2026-05 보안 릴리스의 패치 버전** (13개 CVE 전부 수정). 미들웨어 인증우회(CVE-2025-29927)·`/_next/image` SSRF 라이브 테스트 모두 차단. 미들웨어 기반 인증 미사용으로 구조적으로도 안전
- ✅ **모든 `/admin/*` 비인증 401** — 헤더 인젝션(`X-User-Id`,`X-Admin`,`X-Forwarded-For` 등)·경로 정규화(`/Admin`,`//`,`%73`,`../`) 우회 전부 차단
- ✅ **CORS 정확 일치 잠금** — 후행점/포트/대문자/서브도메인/`null`/`data:`/`file:`/널바이트 우회 전부 차단, `*`+credentials 위험 조합 없음, `Vary: Origin` 정상
- ✅ **OAuth** — `redirect_uri` 핵심 우회(`//evil`,`@evil`,`#`,`?`,CRLF,널바이트,더블인코딩,HPP,배열) 차단, `state` 고유·HttpOnly 쿠키 바인딩, CRLF 무해화(응답분할 불가)
- ✅ **토큰이 httpOnly 쿠키** (localStorage엔 플래그 `"1"`만) → XSS로도 토큰 탈취 불가
- ✅ **`/image-proxy` SSRF 방어 견고** — 호스트 화이트리스트(`*.pstatic.net`), 메타데이터 IP(169.254.169.254)·localhost·접미사/접두사/`@`/`#` 우회 전부 403, `file://`/`gopher://` 400
- ✅ **`/_next/image` SSRF 안전** — 외부/내부/메타데이터/상대경로 전부 400 (remotePatterns 적용)
- ✅ **번들에 하드코딩 시크릿 0** (VAPID 공개키만 노출=정상), **DOM-XSS 싱크 없음**, 위험 postMessage 없음, 디버그 플래그 없음
- ✅ **API Helmet 헤더 양호** — nosniff, X-Frame-Options SAMEORIGIN, COOP, CORP, Referrer-Policy no-referrer, X-Permitted-Cross-Domain-Policies none, X-XSS-Protection 0(최신 권고)
- ✅ 소스맵(`.js.map`) 403, TRACE 405, **X-Powered-By 숨김**, `.env`/`.git`/`package.json` 404
- ✅ JSON 본문 크기 제한(약 11MB에서 413), 프로토타입 오염(`__proto__`) 페이로드 미인증 401 차단
- ✅ Cloudflare 정상 배치, origin-leak 서브도메인 미발견, 평문 HTTP(:2053) 400 거부(TLS 강제)
- ✅ `meta robots noindex` 적용(베타 색인 방지), RSC 페이로드에 사용자 데이터 미포함

---

## 6. 버전 / CVE 검사 상세

### Next.js 16.2.6 — 최신 패치 버전 ✅
2026-05-07 배포된 보안 릴리스로 **13개 CVE를 한꺼번에 수정한 바로 그 버전**. 사용자는 취약 버전이 아니라 수정 타깃 버전 사용 중.

| 취약점 | 16.2.6 상태 |
|---|---|
| 미들웨어/프록시 인증 우회 4종 (High) | ✅ 패치 (게다가 본 앱은 미들웨어 인증 미사용 → 이중 안전) |
| RSC DoS (CVE-2026-23870) | ✅ 패치 |
| WebSocket 업그레이드 SSRF | ✅ 패치 |
| RSC 캐시 포이즈닝 | ✅ 패치 |
| CSP nonce XSS | ✅ 패치 |
| RSC 치명적 취약점(2025-12) | ✅ 번들 React canary에 포함 |

라이브 테스트(`x-middleware-subrequest` 4종 페이로드, `/_next/image` SSRF) 모두 차단 확인.

### 백엔드 의존성 — 외부에서 확인 불가 (사각지대) ⚠️
`X-Powered-By` 숨김(좋은 설정)으로 Express/Helmet/cors/jsonwebtoken/web-push/DB 드라이버 버전을 비인증으로는 특정 불가. **서버에서 직접 점검 필요**:
```bash
npm audit --production
npm ls jsonwebtoken web-push express cors helmet
```
- `jsonwebtoken` — Bearer 토큰 사용 → 9.0.0 미만이면 알고리즘 혼동 CVE 대상
- `web-push` — VAPID 푸시(`/push/vapid-key` 확인됨) 사용 → 버전 점검
- GitHub Dependabot / Snyk 연동 권장

---

## 7. ✅ 배포 전 체크리스트

```
[ ] NODE_ENV=production 으로 기동 + 전역 JSON 에러 핸들러 (스택 숨김)   ← P1-1
[ ] CORS origin 콜백 throw 제거 → cb(null,false)                      ← P1-1
[ ] express-rate-limit (trust proxy + cf-connecting-ip)               ← P1-2
[ ] /streamers 응답 DTO 화이트리스트 + Cache-Control                  ← P2-1
[ ] 모든 쿠키 secure:true (clearCookie 포함)                          ← P2-2
[ ] next.config.js 보안 헤더 (CSP/XFO/nosniff/Referrer)               ← P2-3
[ ] /streamers/register 서버측 치지직 재조회                          ← P2-4
[ ] og:image metadataBase 환경변수화                                  ← P3-2
[ ] API Helmet CSP 활성화                                             ← P3-3
[ ] sw.js 알림 url 동일출처 제한                                       ← P3-4
[ ] redirect_uri 엄격 파싱 검증                                        ← P3-5
[ ] 관리자 CSS 입력 화이트리스트                                       ← P3-6
[ ] npm audit (백엔드 의존성 CVE)                                      ← 6장
[ ] (로그인 후) 경제 엔드포인트 서버검증·레이트리밋·IDOR·관리자 role  ← 4장 필수
```

---

## 부록 A. 발견된 API 엔드포인트 맵

**공개(미인증 200)**: `/maintenance/status`, `/announcements`, `/announcements/popups`, `/streamers`, `/push/vapid-key`, `/auth/chzzk/url`, `/image-proxy?url=`

**인증 필요(미인증 401, 정상)**: `/users/me`, `/notifications`, `/notifications/read-all`, `/notifications/{id}/read`, `/inventory`(번들), `/streamers/search`, `/streamers/register`, `/push/subscribe`

**관리자(미인증 401, 정상)**: `/admin/stats`, `/admin/users`, `/admin/users/{id}/ban|unban`, `/admin/users/banned/bulk-update`, `/admin/reports`, `/admin/reports/{id}/resolve`, `/admin/shop/items`, `/admin/shop/items/{id}`, `/admin/shop/items/{id}/reset-purchases`, `/admin/config/draw-cost`, `/admin/config/free-draw`, `/admin/coupons`, `/admin/reset`, `/admin/reset/info`, `/admin/uploads/orphans`, `/admin/uploads/orphans/delete`, `/admin/streamers/{id}/delete`, `/admin/streamers/{id}/image/{e}`, `/admin/announcements`, `/admin/announcements/{id}`, `/admin/announcements/{id}/popup`, `/admin/push/schedule`, `/admin/push/sent`, `/admin/maintenance/status`

**기타**: `/auth/logout` (POST, 미인증 200 — 자체 Origin 가드 보유)

## 부록 B. 방법론 / 한계

- **비파괴 원칙**: 읽기 GET·OPTIONS·소규모 버스트(≤40)만. 변조/삭제/무차별 대입/DoS 미수행.
- **비인증 한계**: IDOR, 경제 로직, 관리자 role 인가, 세션 쿠키 발급 속성 등은 로그인 필요로 미검증(4장 참조).
- **제3자 범위 제외**: Cloudflare·Vercel·네이버(치지직) 인프라는 점검 대상에서 제외.
- **파괴 테스트**: 사용자 요청으로 스테이징/로컬 복제본에서 별도 진행 예정(부하·인젝션·경합·인증 우회·경제 조작). 본 리포트 시점 미수행.

---

*본 리포트는 소유자 자산에 대한 배포 전 방어적 보안 점검으로 수행되었습니다.*
