const timezoneSuffixPattern = /(?:[zZ]|[+-]\d{2}:?\d{2})$/;
const KST_OFFSET_SUFFIX = '+09:00';

export const parseAppDate = (value?: string | number | Date | null) => {
  if (value === undefined || value === null || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const trimmed = value.trim();
  if (!trimmed) return null;

  const normalized = timezoneSuffixPattern.test(trimmed)
    ? trimmed
    : `${trimmed.replace(' ', 'T')}${KST_OFFSET_SUFFIX}`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const formatLocalDate = (value?: string | number | Date | null, fallback = '') => {
  const date = parseAppDate(value);
  if (!date) return fallback;
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  }).format(date);
};

export const formatLocalDateTime = (
  value?: string | number | Date | null,
  options: Intl.DateTimeFormatOptions = {},
  fallback = ''
) => {
  const date = parseAppDate(value);
  if (!date) return fallback;
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    ...options
  }).format(date);
};

export const formatLocal = (
  value: string | number | Date | null | undefined,
  options: Intl.DateTimeFormatOptions,
  fallback = ''
) => {
  const date = parseAppDate(value);
  if (!date) return fallback;
  return new Intl.DateTimeFormat('ko-KR', options).format(date);
};

export const formatLocalDateTimeInput = (value?: string | number | Date | null) => {
  const date = parseAppDate(value);
  if (!date) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

export const localDateTimeInputToIso = (value?: string | null) => {
  if (!value) return null;
  const normalized = value.length === 16 ? `${value}:00` : value;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};
