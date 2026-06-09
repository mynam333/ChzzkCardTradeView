import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { ensureDirectory, getUploadsDir } from './storagePaths';

const UPLOADS_DIR = getUploadsDir();
ensureDirectory(UPLOADS_DIR);

/**
 * 커스텀 이미지 URL이 자체 업로드 디렉터리 내부의 로컬 파일을 가리키면 해당 파일을 삭제합니다.
 * (외부 URL·치지직 CDN·dicebear 등은 무시) — 슬롯 교체/초기화 시 직전 파일이 잔존(orphan)하는 것을 방지.
 * @returns 실제로 삭제했으면 true
 */
export const deleteLocalUploadByUrl = (url?: string | null): boolean => {
  if (!url) return false;
  try {
    // URL 또는 상대경로에서 /uploads/ 이후 경로 추출
    let pathname = url;
    try { pathname = new URL(url).pathname; } catch { /* 상대경로일 수 있음 */ }
    const marker = '/uploads/';
    const idx = pathname.indexOf(marker);
    if (idx < 0) return false;
    let rel: string;
    try { rel = decodeURIComponent(pathname.slice(idx + marker.length)); }
    catch { rel = pathname.slice(idx + marker.length); }
    if (!rel) return false;

    // 경로 탈출 방지: uploads 디렉터리 내부인지 검증
    const target = path.resolve(UPLOADS_DIR, rel);
    const relCheck = path.relative(UPLOADS_DIR, target);
    if (relCheck.startsWith('..') || path.isAbsolute(relCheck)) return false;

    if (fs.existsSync(target) && fs.statSync(target).isFile()) {
      fs.unlinkSync(target);
      // 비어버린 상위 폴더 정리(스트리머별 폴더)
      try {
        const dir = path.dirname(target);
        if (dir !== UPLOADS_DIR && fs.existsSync(dir) && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
      } catch { /* noop */ }
      return true;
    }
  } catch (e: any) {
    console.warn('[ImageService] 이전 업로드 파일 삭제 실패:', e?.message);
  }
  return false;
};

/**
 * 업로드된 이미지 버퍼를 받아 최대 가로/세로 1280px 범위 내에서
 * 원본 종횡비를 유지하며 리사이징하고, WebP 포맷으로 변환합니다.
 *
 * @param fileBuffer 원본 이미지 바이너리 버퍼
 * @returns WebP 포맷으로 인코딩된 리사이즈 이미지 버퍼
 */
export const resizeAndConvertToWebp = async (fileBuffer: Buffer): Promise<Buffer> => {
  try {
    const image = sharp(fileBuffer);
    const metadata = await image.metadata();

    let width = metadata.width;
    let height = metadata.height;
    const MAX_SIZE = 1280;

    // 1280px를 초과할 경우 비율 리사이즈 계산
    if (width && height && (width > MAX_SIZE || height > MAX_SIZE)) {
      if (width > height) {
        height = Math.round((height * MAX_SIZE) / width);
        width = MAX_SIZE;
      } else {
        width = Math.round((width * MAX_SIZE) / height);
        height = MAX_SIZE;
      }
    }

    // 리사이징 적용 및 WebP 포맷(압축 품질 80%)으로 인코딩
    const processedBuffer = await image
      .resize(width, height)
      .webp({ quality: 80 })
      .toBuffer();

    return processedBuffer;
  } catch (error: any) {
    console.error('[ImageService] 이미지 가공 중 오류 발생:', error);
    throw new Error(`이미지 변환 실패: ${error.message}`);
  }
};

/**
 * DB에 저장된 이미지 경로를 현재 서버 환경의 올바른 절대 경로 URL로 변환합니다.
 * - 상대 경로(예: /uploads/...)인 경우: 환경변수 BACKEND_PUBLIC_URL을 붙여 절대 경로로 만듭니다.
 * - 타 포트 절대 경로(예: https://api.yuaru.com:5000/uploads/...)인 경우: 포트를 현재 백엔드 환경에 맞게 치환합니다.
 */
export const formatUploadUrl = (url: string | null | undefined): string | null => {
  if (!url) return null;
  
  const backendBase = (process.env.BACKEND_PUBLIC_URL || '').replace(/\/$/, '');
  
  // 1. 상대 경로인 경우 바로 백엔드 주소를 붙여서 리턴
  if (url.startsWith('/uploads/') || url.startsWith('uploads/')) {
    const cleanPath = url.startsWith('/') ? url : '/' + url;
    return backendBase ? `${backendBase}${cleanPath}` : cleanPath;
  }
  
  // 2. 다른 주소나 포트가 포함된 절대 경로인 경우
  if (url.includes('/uploads/')) {
    try {
      const parsed = new URL(url);
      const marker = '/uploads/';
      const idx = parsed.pathname.indexOf(marker);
      if (idx >= 0) {
        const cleanPath = parsed.pathname.slice(idx);
        return backendBase ? `${backendBase}${cleanPath}` : cleanPath;
      }
    } catch { /* noop */ }
  }
  
  return url;
};
