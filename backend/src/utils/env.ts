export const readIntegerEnv = (
  name: string,
  fallback: number,
  options: { min?: number; max?: number } = {}
) => {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed)) return fallback;

  let value = Math.floor(parsed);
  if (options.min !== undefined) value = Math.max(options.min, value);
  if (options.max !== undefined) value = Math.min(options.max, value);
  return value;
};

const DATA_SIZE_UNITS: Record<string, number> = {
  b: 1,
  kb: 1024,
  k: 1024,
  mb: 1024 * 1024,
  m: 1024 * 1024,
  gb: 1024 * 1024 * 1024,
  g: 1024 * 1024 * 1024
};

export const readBytesEnv = (
  name: string,
  fallbackBytes: number,
  options: { minBytes?: number; maxBytes?: number } = {}
) => {
  const raw = process.env[name]?.trim();
  if (!raw) return fallbackBytes;

  const match = raw.match(/^(\d+(?:\.\d+)?)\s*([a-zA-Z]+)?$/);
  if (!match) return fallbackBytes;

  const amount = Number(match[1]);
  const unit = (match[2] || 'b').toLowerCase();
  const multiplier = DATA_SIZE_UNITS[unit];
  if (!Number.isFinite(amount) || !multiplier) return fallbackBytes;

  let value = Math.floor(amount * multiplier);
  if (options.minBytes !== undefined) value = Math.max(options.minBytes, value);
  if (options.maxBytes !== undefined) value = Math.min(options.maxBytes, value);
  return value;
};

export const bytesToWholeMb = (bytes: number) => Math.floor(bytes / 1024 / 1024);
