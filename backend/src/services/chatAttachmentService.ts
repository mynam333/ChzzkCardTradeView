import { spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';
import sharp from 'sharp';
import { ensureDirectory, getUploadsDir } from './storagePaths';

export const CHAT_ATTACHMENT_MAX_ACTIVE_BYTES = 100 * 1024 * 1024;
export const CHAT_ATTACHMENT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CHAT_GIF_MAX_UPLOAD_BYTES = Number(process.env.CHAT_GIF_MAX_UPLOAD_BYTES || 8 * 1024 * 1024);

type ProcessedChatAttachment = {
  url: string;
  mime: string;
  sizeBytes: number;
  width?: number | null;
  height?: number | null;
  expiresAt: Date;
  sourceHash: string;
};

const allowedMime = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif']);

const safeUserPart = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'user';

export const getChatAttachmentSourceHash = (file: Express.Multer.File) => {
  if (!file?.buffer?.length) throw new Error('업로드할 이미지가 없습니다.');
  return crypto
    .createHash('sha256')
    .update(file.mimetype)
    .update('\0')
    .update(file.buffer)
    .digest('hex');
};

const createLimiter = (maxConcurrency: number) => {
  const max = Math.max(1, Math.floor(maxConcurrency));
  let active = 0;
  const queue: Array<() => void> = [];
  const runNext = () => {
    if (active >= max) return;
    const next = queue.shift();
    if (!next) return;
    active += 1;
    next();
  };
  return async <T>(task: () => Promise<T>): Promise<T> => new Promise<T>((resolve, reject) => {
    queue.push(() => {
      task()
        .then(resolve, reject)
        .finally(() => {
          active -= 1;
          runNext();
        });
    });
    runNext();
  });
};

const staticImageLimiter = createLimiter(Number(process.env.CHAT_IMAGE_CONCURRENCY || 2));
const gifLimiter = createLimiter(Number(process.env.CHAT_GIF_CONCURRENCY || 1));

const runFfmpeg = (args: string[]) => new Promise<void>((resolve, reject) => {
  const child = spawn(process.env.FFMPEG_PATH || 'ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
    if (stderr.length > 4000) stderr = stderr.slice(-4000);
  });
  child.on('error', (err: any) => {
    if (err?.code === 'ENOENT') {
      reject(new Error('GIF 변환을 위해 서버에 ffmpeg가 필요합니다.'));
      return;
    }
    reject(err);
  });
  child.on('close', (code) => {
    if (code === 0) resolve();
    else reject(new Error(`GIF 변환 실패(ffmpeg ${code}): ${stderr || 'no stderr'}`));
  });
});

const getResizedDimensions = (width?: number, height?: number) => {
  if (!width || !height) return { width: null, height: null };
  const max = 1280;
  if (width <= max && height <= max) return { width, height };
  if (width >= height) return { width: max, height: Math.round((height * max) / width) };
  return { width: Math.round((width * max) / height), height: max };
};

const saveStaticImage = async (buffer: Buffer, outputPath: string) => {
  const image = sharp(buffer);
  const metadata = await image.metadata();
  const size = getResizedDimensions(metadata.width, metadata.height);
  await image
    .resize(size.width || undefined, size.height || undefined, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82 })
    .toFile(outputPath);
  return size;
};

const saveGifAsWebm = async (buffer: Buffer, outputPath: string) => {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'chikapo-chat-gif-'));
  const inputPath = path.join(tempDir, 'input.gif');
  try {
    await fsp.writeFile(inputPath, buffer);
    const metadata = await sharp(buffer, { animated: true }).metadata();
    const size = getResizedDimensions(metadata.width, metadata.height);
    await runFfmpeg([
      '-y',
      '-i', inputPath,
      '-vf', "scale='min(1280,iw)':'min(1280,ih)':force_original_aspect_ratio=decrease,fps=24",
      '-an',
      '-c:v', 'libvpx-vp9',
      '-b:v', '0',
      '-crf', '36',
      outputPath
    ]);
    return size;
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => { /* noop */ });
  }
};

export const processChatImageAttachment = async (
  userId: string,
  file: Express.Multer.File
): Promise<ProcessedChatAttachment> => {
  if (!file || !file.buffer?.length) throw new Error('업로드할 이미지가 없습니다.');
  if (!allowedMime.has(file.mimetype)) throw new Error('이미지 파일만 첨부할 수 있습니다.');

  const isGif = file.mimetype === 'image/gif';
  const sourceHash = getChatAttachmentSourceHash(file);
  if (isGif && file.size > CHAT_GIF_MAX_UPLOAD_BYTES) {
    throw new Error(`GIF 첨부는 ${Math.floor(CHAT_GIF_MAX_UPLOAD_BYTES / 1024 / 1024)}MB 이하만 가능합니다.`);
  }
  const extension = isGif ? 'webm' : 'webp';
  const mime = isGif ? 'video/webm' : 'image/webp';
  const now = Date.now();
  const folderName = `chat/${safeUserPart(userId)}`;
  const uploadDir = path.join(getUploadsDir(), folderName);
  ensureDirectory(uploadDir);

  const fileName = `chat_${now}_${Math.random().toString(36).slice(2, 10)}.${extension}`;
  const filePath = path.join(uploadDir, fileName);
  const size = isGif
    ? await gifLimiter(() => saveGifAsWebm(file.buffer, filePath))
    : await staticImageLimiter(() => saveStaticImage(file.buffer, filePath));
  const stat = await fsp.stat(filePath);

  return {
    url: `/uploads/${folderName}/${encodeURIComponent(fileName)}`,
    mime,
    sizeBytes: stat.size,
    width: size.width,
    height: size.height,
    expiresAt: new Date(now + CHAT_ATTACHMENT_TTL_MS),
    sourceHash
  };
};

export const deleteProcessedChatAttachment = (url?: string | null) => {
  if (!url) return;
  const marker = '/uploads/';
  const index = url.indexOf(marker);
  if (index < 0) return;
  let rel = url.slice(index + marker.length);
  try { rel = decodeURIComponent(rel); } catch { /* noop */ }
  const target = path.resolve(getUploadsDir(), rel);
  const relCheck = path.relative(getUploadsDir(), target);
  if (relCheck.startsWith('..') || path.isAbsolute(relCheck)) return;
  if (fs.existsSync(target)) fs.unlinkSync(target);
};
