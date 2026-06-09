# Cloudflare Origin Certificate 설정

백엔드가 Cloudflare 프록시 뒤에서 동작한다면 Cloudflare Origin Certificate의 `.pem` 인증서와 `.key` 개인키를 직접 로드할 수 있다.

## 환경 변수

```env
USE_HTTPS=true
CLOUDFLARE_ORIGIN_KEY_PATH=/etc/ssl/cloudflare/origin.key
CLOUDFLARE_ORIGIN_CERT_PATH=/etc/ssl/cloudflare/origin.pem
```

상대 경로를 넣으면 프로젝트 루트 기준으로 해석한다. 운영 서버에서는 절대 경로를 권장한다.

## Cloudflare 설정

Cloudflare Dashboard에서 Origin Certificate를 발급한 뒤:

1. Private key는 `.key` 파일로 저장한다.
2. Origin certificate는 `.pem` 파일로 저장한다.
3. 두 파일은 repository에 커밋하지 않고 서버의 안전한 경로에 배치한다.
4. Cloudflare SSL/TLS mode는 `Full (strict)`로 설정한다.

Cloudflare Origin Certificate는 Cloudflare와 origin 서버 사이의 TLS 용도다. 브라우저가 origin 서버에 직접 접속하면 일반 공개 인증기관 인증서처럼 신뢰되지 않을 수 있다.

## 호환 변수

다음 변수도 계속 지원한다.

```env
SSL_KEY_PATH=/etc/ssl/private/origin.key
SSL_CERT_PATH=/etc/ssl/certs/origin.pem
```

기존 Let's Encrypt 호환 변수도 유지된다.

```env
SSL_PRIVKEY_PATH=/etc/letsencrypt/live/example.com/privkey.pem
SSL_FULLCHAIN_PATH=/etc/letsencrypt/live/example.com/fullchain.pem
```
