export const toMysqlDateTime = (value: string | Date | null | undefined): string | null => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toISOString().slice(0, 19).replace('T', ' ');
};

export const toPostgresDateTime = (value: string | Date | null | undefined): string | null => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toISOString();
};

export const toSqlDateTime = (value: string | Date | null | undefined, dialect: 'mysql' | 'postgres' | null = 'mysql'): string | null =>
  dialect === 'postgres' ? toPostgresDateTime(value) : toMysqlDateTime(value);

export const parseMysqlDateTimeMs = (value: string | Date | null | undefined): number => {
  if (!value) return NaN;
  if (value instanceof Date) return value.getTime();
  const raw = String(value).trim();
  if (!raw) return NaN;
  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw);
  const normalized = raw.includes('T') || hasTimezone
    ? raw.replace(' ', 'T')
    : `${raw.replace(' ', 'T')}Z`;
  return new Date(normalized).getTime();
};
