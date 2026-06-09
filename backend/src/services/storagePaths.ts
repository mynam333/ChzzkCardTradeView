import fs from 'fs';
import path from 'path';

const projectRoot = path.resolve(__dirname, '../../..');

const resolveStoragePath = (configuredValue: string | undefined, fallback: string): string => {
  const raw = configuredValue?.trim();
  if (!raw) return fallback;
  return path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(projectRoot, raw);
};

export const getSqliteDbPath = (): string =>
  resolveStoragePath(process.env.SQLITE_DB_PATH, path.join(projectRoot, 'local.sqlite'));

export const getUploadsDir = (): string =>
  resolveStoragePath(process.env.UPLOADS_DIR, path.join(projectRoot, 'public/uploads'));

export const ensureParentDirectory = (filePath: string): void => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
};

export const ensureDirectory = (dirPath: string): void => {
  fs.mkdirSync(dirPath, { recursive: true });
};
