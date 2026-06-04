import { Request, Response } from 'express';
import { IS_PRODUCTION } from '../config';
import fs from 'fs';
import path from 'path';

/**
 * 이미지 프록시 — 치지직 CDN/외부 이미지를 동일 출처(+CORS 허용)로 우회 제공.
 * 프로필 카드 이미지 캡처(html-to-image) 시 캔버스 오염(taint) 및 표시 깨짐 방지 목적.
 *
 * 보안: SSRF 방지를 위해 허용된 호스트 화이트리스트만 프록시합니다.
 */

// 허용 호스트 접미사(서브도메인 포함). 치지직/네이버 CDN, dicebear, 자체 업로드 도메인 등.
const ALLOWED_HOST_SUFFIXES = [
  'pstatic.net',
  'naver.net',
  'navercorp.com',
  'nave.rs',
  'dicebear.com',
  'chzzk.naver.com'
];

const isAllowedHost = (hostname: string): boolean => {
  const h = hostname.toLowerCase();
  // 자체 백엔드 퍼블릭 호스트(업로드 정적 이미지) 허용
  try {
    const selfUrl = process.env.BACKEND_PUBLIC_URL;
    if (selfUrl) {
      const selfHost = new URL(selfUrl).hostname.toLowerCase();
      if (h === selfHost) return true;
    }
  } catch { /* noop */ }
  return ALLOWED_HOST_SUFFIXES.some((s) => h === s || h.endsWith(`.${s}`));
};

export const proxyImage = async (req: Request, res: Response) => {
  const raw = String(req.query.url || '').trim();
  if (!raw) {
    return res.status(400).json({ error: 'BadRequest', message: 'url 파라미터가 필요합니다.' });
  }

  // 1. 상대 경로(/uploads/...)인 경우 로컬 파일 시스템에서 직접 전송 (네트워크 미경유)
  if (raw.startsWith('/uploads/') || raw.startsWith('uploads/')) {
    const cleanPath = raw.startsWith('/') ? raw : '/' + raw;
    let decodedPath = '';
    try {
      decodedPath = decodeURIComponent(cleanPath);
    } catch {
      decodedPath = cleanPath;
    }

    const localFilePath = path.join(__dirname, '../../../public', decodedPath);
    const absoluteUploadsDir = path.resolve(path.join(__dirname, '../../../public/uploads'));
    const resolvedPath = path.resolve(localFilePath);

    if (!resolvedPath.startsWith(absoluteUploadsDir)) {
      return res.status(403).json({ error: 'Forbidden', message: '허용되지 않은 파일 경로입니다.' });
    }

    if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isFile()) {
      const contentType = resolvedPath.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      return res.status(200).sendFile(resolvedPath);
    } else {
      return res.status(404).json({ error: 'NotFound', message: '파일을 찾을 수 없습니다.' });
    }
  }

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return res.status(400).json({ error: 'BadRequest', message: '유효하지 않은 URL입니다.' });
  }

  // 2. 자체 서버를 가리키는 절대 경로인 경우 포트 변경 및 호스트 도메인 유연하게 로컬 파일로 우회
  const selfUrl = process.env.BACKEND_PUBLIC_URL;
  let isSelfHost = false;
  try {
    if (selfUrl) {
      const selfHost = new URL(selfUrl).hostname.toLowerCase();
      if (target.hostname.toLowerCase() === selfHost && target.pathname.startsWith('/uploads/')) {
        isSelfHost = true;
      }
    }
  } catch { /* noop */ }
  
  if (target.hostname.toLowerCase() === 'localhost' || target.hostname.toLowerCase() === '127.0.0.1') {
    if (target.pathname.startsWith('/uploads/')) {
      isSelfHost = true;
    }
  }

  if (isSelfHost) {
    let decodedPath = '';
    try {
      decodedPath = decodeURIComponent(target.pathname);
    } catch {
      decodedPath = target.pathname;
    }

    const localFilePath = path.join(__dirname, '../../../public', decodedPath);
    const absoluteUploadsDir = path.resolve(path.join(__dirname, '../../../public/uploads'));
    const resolvedPath = path.resolve(localFilePath);

    if (resolvedPath.startsWith(absoluteUploadsDir) && fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isFile()) {
      const contentType = resolvedPath.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      return res.status(200).sendFile(resolvedPath);
    }
    return res.status(404).json({ error: 'NotFound', message: '자체 업로드 파일을 찾을 수 없습니다.' });
  }

  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    return res.status(400).json({ error: 'BadRequest', message: '지원하지 않는 프로토콜입니다.' });
  }
  if (!isAllowedHost(target.hostname)) {
    return res.status(403).json({ error: 'Forbidden', message: '허용되지 않은 이미지 호스트입니다.' });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const upstream = await fetch(target.toString(), {
      signal: controller.signal,
      headers: {
        // 치지직 CDN은 일부 경우 referer/UA 검사를 하므로 기본값 부여
        'User-Agent': 'Mozilla/5.0 (compatible; CCTV-ImageProxy/1.0)',
        'Accept': 'image/*'
      }
    }).finally(() => clearTimeout(timeout));

    if (!upstream.ok) {
      return res.status(502).json({ error: 'BadGateway', message: `원본 이미지를 가져오지 못했습니다(${upstream.status}).` });
    }

    const contentType = upstream.headers.get('content-type') || 'image/jpeg';
    if (!contentType.startsWith('image/')) {
      return res.status(415).json({ error: 'UnsupportedMediaType', message: '이미지가 아닌 리소스입니다.' });
    }

    const buf = Buffer.from(await upstream.arrayBuffer());
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    return res.status(200).send(buf);
  } catch (err: any) {
    return res.status(502).json({
      error: 'BadGateway',
      message: '이미지 프록시 중 오류가 발생했습니다.',
      details: IS_PRODUCTION ? undefined : err.message
    });
  }
};
