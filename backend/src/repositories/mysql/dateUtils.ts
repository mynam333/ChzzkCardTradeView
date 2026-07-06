const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

const pad = (value: number) => String(value).padStart(2, '0');

const toKstParts = (date: Date) => {
  const kst = new Date(date.getTime() + KST_OFFSET_MS);
  return {
    year: kst.getUTCFullYear(),
    month: pad(kst.getUTCMonth() + 1),
    day: pad(kst.getUTCDate()),
    hour: pad(kst.getUTCHours()),
    minute: pad(kst.getUTCMinutes()),
    second: pad(kst.getUTCSeconds())
  };
};

const toKstOffsetIso = (date: Date): string => {
  const p = toKstParts(date);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}+09:00`;
};

export const toMysqlDateTime = (value: string | Date | null | undefined): string | null => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const p = toKstParts(date);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
};

export const toPostgresDateTime = (value: string | Date | null | undefined): string | null => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return toKstOffsetIso(date);
};

export const toSqlDateTime = (value: string | Date | null | undefined, dialect: 'mysql' | 'postgres' | null = 'mysql'): string | null =>
  dialect === 'postgres' ? toPostgresDateTime(value) : toMysqlDateTime(value);

export const parseMysqlDateTimeMs = (value: string | Date | null | undefined): number => {
  if (!value) return NaN;
  if (value instanceof Date) return value.getTime();
  const raw = String(value).trim();
  if (!raw) return NaN;
  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw);
  const normalized = hasTimezone
    ? raw.replace(' ', 'T')
    : `${raw.replace(' ', 'T')}+09:00`;
  return new Date(normalized).getTime();
};
