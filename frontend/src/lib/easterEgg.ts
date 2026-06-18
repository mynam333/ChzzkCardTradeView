export type EasterEggTerminalCode = 'lostCard' | 'terminalLog' | 'liveSignal';

export type DailyFortune = {
  grade: '잔잔한 신호' | '반짝이는 신호' | 'LIVE 신호' | 'No.0000 신호';
  luckyTab: '상점' | '보관함' | '랭킹' | '미니게임' | '친구' | '내 정보';
  luckyColor: '민트' | '하늘색' | '노랑' | '분홍' | '흰색';
  message: string;
  caution: string;
};

export type EasterEggDiscovery = {
  theme?: boolean;
  keyboardBoot?: boolean;
  lostCard404?: boolean;
  fortune?: boolean;
  terminalLog?: boolean;
  liveSignal?: boolean;
};

const DISCOVERY_KEY = 'chikapo:easter-egg:discovered';
const FIRST_SEEN_KEY = 'chikapo:easter-egg:firstSeenAt';
const LAST_SEEN_KEY = 'chikapo:easter-egg:lastSeenAt';
const TERMINAL_CODES_KEY = 'chikapo:easter-egg:terminalCodes';

export const isDesktopEasterEggSurface = () => {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  if (params.get('easterEggDebug') === '1') return true;
  return window.matchMedia('(min-width: 768px)').matches;
};

export const resolveEasterEggTerminalCode = (raw: string): EasterEggTerminalCode | null => {
  const value = raw.trim().toUpperCase();
  if (value === 'NO.0404') return 'lostCard';
  if (value === 'CARD://LOST') return 'terminalLog';
  if (value === 'LIVE?') return 'liveSignal';
  return null;
};

const safeReadJson = <T,>(key: string, fallback: T): T => {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
};

const safeWriteJson = (key: string, value: unknown) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 로컬 저장소가 막힌 환경에서는 발견 기록만 생략합니다.
  }
};

const safeSetItem = (key: string, value: string) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // ignore
  }
};

const safeGetItem = (key: string) => {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

export const recordEasterEggDiscovery = (key: keyof EasterEggDiscovery) => {
  const now = new Date().toISOString();
  const current = safeReadJson<EasterEggDiscovery>(DISCOVERY_KEY, {});
  safeWriteJson(DISCOVERY_KEY, { ...current, [key]: true });
  if (!safeGetItem(FIRST_SEEN_KEY)) {
    safeSetItem(FIRST_SEEN_KEY, now);
  }
  safeSetItem(LAST_SEEN_KEY, now);
};

export const recordTerminalCode = (code: EasterEggTerminalCode) => {
  const current = safeReadJson<string[]>(TERMINAL_CODES_KEY, []);
  if (!current.includes(code)) safeWriteJson(TERMINAL_CODES_KEY, [...current, code]);
  recordEasterEggDiscovery(code === 'liveSignal' ? 'liveSignal' : 'terminalLog');
};

export const getKoreanDateKey = () => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === 'year')?.value || '0000';
  const month = parts.find((part) => part.type === 'month')?.value || '00';
  const day = parts.find((part) => part.type === 'day')?.value || '00';
  return `${year}-${month}-${day}`;
};

const hashString = (value: string) => {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const pick = <T,>(items: T[], seed: number, salt: number) => items[(seed + salt) % items.length];

const fortuneMessages = [
  '오늘은 새 카드를 뽑기보다 보관함을 정리하기 좋은 날입니다.',
  '오래 안 본 카드가 생각보다 예뻐 보일 수 있습니다.',
  '관심 있던 카드가 자꾸 눈에 들어오는 날입니다.',
  '즐겨찾기 별표를 달아둘 카드가 생길 수 있습니다.',
  '랭킹을 한 번 더 확인하면 재미있는 변화를 발견할 수 있습니다.',
  '오늘의 최애 신호가 평소보다 선명합니다.',
  '카드 단말기가 잠깐 관리자도 모르는 표정을 지었습니다.',
  '없는 카드 번호가 오늘의 운세에 끼어들었습니다.'
];

const cautionMessages = [
  '즉흥 구매 버튼과 오래 눈싸움하지 마세요.',
  '가격표보다 카드 이름을 먼저 보게 되는 날입니다.',
  '가챠 결과는 단말기도 예측하지 못합니다.',
  '반짝이는 효과가 실제 가치 상승을 뜻하지는 않습니다.'
];

export const getDailyFortune = (): DailyFortune => {
  const dateKey = getKoreanDateKey();
  const storageKey = `chikapo:easter-egg:fortune:${dateKey}`;
  const saved = safeReadJson<DailyFortune | null>(storageKey, null);
  if (saved) return saved;

  const seed = hashString(`chikapo:${dateKey}`);
  const fortune: DailyFortune = {
    grade: pick(['잔잔한 신호', '반짝이는 신호', 'LIVE 신호', 'No.0000 신호'], seed, 0),
    luckyTab: pick(['상점', '보관함', '랭킹', '미니게임', '친구', '내 정보'], seed, 7),
    luckyColor: pick(['민트', '하늘색', '노랑', '분홍', '흰색'], seed, 13),
    message: pick(fortuneMessages, seed, 23),
    caution: pick(cautionMessages, seed, 31)
  };

  safeWriteJson(storageKey, fortune);
  return fortune;
};
