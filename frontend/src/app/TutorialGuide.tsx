'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Gamepad2,
  Home,
  Layers,
  MessageCircleHeart,
  PauseCircle,
  PlayCircle,
  Sparkles,
  Store,
  TrendingUp,
  User,
  UserRound,
  X
} from 'lucide-react';
import { TabId, useApp } from './AppContext';
import { apiFetch } from '@/lib/api';

type TutorialSection =
  | 'welcome'
  | 'main'
  | 'shop'
  | 'inventory'
  | 'arcade'
  | 'ranking'
  | 'my-info'
  | 'wrap-up';

type TutorialStep = {
  id: string;
  section: TutorialSection;
  tab: TabId;
  title: string;
  lines: string[];
  tip?: string;
  actionLabel?: string;
  target?: string;
  waitForEvent?: string;
  grantGachaTicket?: boolean;
  shopSubTab?: 'gacha_shop' | 'market' | 'history';
  demo?: 'inventory-menu' | 'minigame-result';
};

type HighlightRect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

const TUTORIAL_VERSION = '2026-06-08-v1';
const MANUAL_START_EVENT = 'chikapo-start-tutorial';
const UARU_CHANNEL_ID = '6d395c84c99777272f872171b4dfc122';

const sectionLabels: Record<TutorialSection, string> = {
  welcome: '시작',
  main: '메인',
  shop: '상점',
  inventory: '보관함',
  arcade: '미니게임',
  ranking: '랭킹',
  'my-info': '내 정보',
  'wrap-up': '마무리'
};

const sectionIcons: Record<TutorialSection, typeof Sparkles> = {
  welcome: Sparkles,
  main: Home,
  shop: Store,
  inventory: Layers,
  arcade: Gamepad2,
  ranking: TrendingUp,
  'my-info': User,
  'wrap-up': CheckCircle2
};

const tutorialSteps: TutorialStep[] = [
  {
    id: 'hello',
    section: 'welcome',
    tab: 'main',
    title: '치카포에 온 걸 환영해요',
    lines: [
      '지금부터 사이트를 천천히 둘러볼게요.',
      '한 번에 하나씩, 실제 탭을 이동하면서 필요한 기능만 자연스럽게 익히면 됩니다.'
    ],
    tip: '언제든 스킵할 수 있고, 내 정보 탭에서 다시 볼 수 있어요.'
  },
  {
    id: 'how-to-use',
    section: 'welcome',
    tab: 'main',
    title: '진행 방식',
    lines: [
      '아래의 다음 버튼을 누르면 제가 알맞은 화면으로 안내해요.',
      '중간에 직접 눌러보고 싶다면 창을 잠시 접어 둔 뒤 화면을 만져봐도 됩니다.'
    ]
  },
  {
    id: 'main-landing',
    section: 'main',
    tab: 'main',
    title: '메인은 오늘의 출발점이에요',
    lines: [
      '여기서는 치카포가 어떤 서비스인지 한눈에 볼 수 있어요.',
      '로그인하면 카드 수집, 미니게임, 랭킹 같은 기능들이 본격적으로 열립니다.'
    ],
    actionLabel: '메인 둘러보기',
    target: 'main-landing'
  },
  {
    id: 'main-news',
    section: 'main',
    tab: 'main',
    title: '플랫폼 새소식 확인하기',
    lines: [
      '운영 공지나 이벤트는 플랫폼 새소식에 짧게 표시돼요.',
      '제목을 누르면 자세한 공지 게시글을 모달 게시판으로 읽을 수 있습니다.'
    ],
    tip: '중요 공지는 별도 팝업으로도 뜰 수 있고, 다시 보지 않기를 누르면 해당 공지는 다시 나오지 않아요.',
    target: 'main-news'
  },
  {
    id: 'main-hot',
    section: 'main',
    tab: 'main',
    title: '지금 인기 있는 흐름 보기',
    lines: [
      '메인에는 실시간으로 눈에 띄는 스트리머와 서비스 핵심 흐름이 모여 있어요.',
      '처음이라면 여기서 분위기를 보고 상점이나 랭킹으로 넘어가면 좋습니다.'
    ]
  },
  {
    id: 'main-login',
    section: 'main',
    tab: 'main',
    title: '로그인이 필요한 이유',
    lines: [
      '카드 보관함, 포인트, 쿠폰, 미니게임 기록은 내 계정에 저장돼요.',
      '치지직 연동 로그인만 하면 별도 가입 없이 바로 시작할 수 있습니다.'
    ]
  },
  {
    id: 'shop-entry',
    section: 'shop',
    tab: 'shop',
    title: '상점으로 이동했어요',
    lines: [
      '상점에서는 스트리머 카드를 소환하고, 코스메틱을 사고, 오픈마켓 매물을 살펴볼 수 있어요.',
      '포인트를 쓰는 기능이 많으니 버튼을 누르기 전 설명을 꼭 확인해 주세요.'
    ],
    actionLabel: '상점 기능 보기',
    target: 'shop-gacha-board',
    shopSubTab: 'gacha_shop'
  },
  {
    id: 'shop-gacha',
    section: 'shop',
    tab: 'shop',
    title: '카드 즉시 소환',
    lines: [
      '이번에는 설명만 듣지 말고 직접 한 번 눌러볼게요.',
      '제가 체험용 추가 무료 소환 티켓 1장을 넣어둘 테니, 강조된 소환 버튼을 직접 눌러주세요.'
    ],
    tip: '이 보상은 계정당 1회만 지급됩니다. 이미 받았다면 보유 무료 티켓이나 포인트로 체험할 수 있어요.',
    target: 'shop-gacha-button',
    grantGachaTicket: true,
    waitForEvent: 'chikapo:gacha-result',
    shopSubTab: 'gacha_shop',
    actionLabel: '소환 결과 기다리는 중'
  },
  {
    id: 'shop-gacha-result',
    section: 'shop',
    tab: 'shop',
    title: '방금 나온 카드를 확인해요',
    lines: [
      '카드가 나왔어요. 결과 카드에는 스트리머 이름, 방송 상태, 시세 가치, 시리얼 번호가 함께 표시됩니다.',
      '확인한 카드는 이미 보관함에 들어가 있으니, 나중에 보관함에서 다시 볼 수 있어요.'
    ],
    tip: '결과 카드를 충분히 봤다면 아래 버튼으로 이어가면 됩니다.',
    actionLabel: '카드 확인 완료',
    target: 'shop-gacha-result-card',
    shopSubTab: 'gacha_shop'
  },
  {
    id: 'shop-effects',
    section: 'shop',
    tab: 'shop',
    title: '소환 연출 즐기기',
    lines: [
      '가챠를 실행하면 전용 연출이 나오고 결과 카드가 강조되어 표시돼요.',
      '연출이 끝난 뒤에는 보관함에서 카드를 다시 확인하면 됩니다.'
    ],
    target: 'shop-gacha-result-card',
    shopSubTab: 'gacha_shop'
  },
  {
    id: 'shop-cosmetic',
    section: 'shop',
    tab: 'shop',
    title: '코스메틱 상점',
    lines: [
      '포인트로 카드 테두리나 이름 효과를 구매할 수 있어요.',
      '구매한 코스메틱은 보관함에서 원하는 카드에 장착할 수 있습니다.'
    ],
    tip: '코스메틱은 카드의 개성을 살리는 장식이라, 수집한 카드를 더 예쁘게 보여줄 때 좋아요.',
    target: 'shop-cosmetics',
    shopSubTab: 'gacha_shop'
  },
  {
    id: 'shop-market',
    section: 'shop',
    tab: 'shop',
    title: '오픈마켓',
    lines: [
      '다른 유저가 등록한 카드를 포인트로 구매할 수 있어요.',
      '스트리머 이름이나 판매자를 검색하고, 정렬 옵션으로 원하는 매물을 좁혀보세요.'
    ],
    target: 'shop-market',
    shopSubTab: 'market'
  },
  {
    id: 'shop-my-listings',
    section: 'shop',
    tab: 'shop',
    title: '내 판매 관리',
    lines: [
      '내가 등록한 매물은 상점에서 상태를 확인하고 취소할 수 있어요.',
      '단, 판매 등록 중인 카드는 거래가 끝나거나 취소되기 전까지 다른 작업이 제한됩니다.'
    ],
    target: 'shop-my-listings',
    shopSubTab: 'market'
  },
  {
    id: 'inventory-entry',
    section: 'inventory',
    tab: 'inventory',
    title: '보관함은 수집의 중심이에요',
    lines: [
      '내가 가진 모든 스트리머 카드를 여기서 확인합니다.',
      '카드를 누르면 크게 보고, 우클릭이나 길게 누르기로 카드 작업 메뉴를 열 수 있어요.'
    ],
    actionLabel: '보관함 열기',
    target: 'inventory-list'
  },
  {
    id: 'inventory-sort',
    section: 'inventory',
    tab: 'inventory',
    title: '카드 찾고 정렬하기',
    lines: [
      '카드가 많아지면 검색과 정렬이 중요해져요.',
      '최신 획득순, 가치순, 이름 같은 기준으로 보유 카드를 빠르게 정리할 수 있습니다.'
    ],
    target: 'inventory-filters'
  },
  {
    id: 'inventory-actions',
    section: 'inventory',
    tab: 'inventory',
    title: '카드 작업 메뉴',
    lines: [
      '우클릭 메뉴에서는 코스메틱 장착, 시스템 판매, 마켓 등록 같은 작업을 할 수 있어요.',
      '판매나 마켓 등록은 되돌리기 어려운 부분이 있으니 확인 모달을 천천히 읽어 주세요.'
    ],
    tip: "모바일에서는 길게 눌러서 우클릭 메뉴를 열 수 있어요.",
    target: 'inventory-list',
    demo: 'inventory-menu'
  },
  {
    id: 'inventory-bulk',
    section: 'inventory',
    tab: 'inventory',
    title: '여러 장을 한 번에 관리하기',
    lines: [
      '같은 카드가 여러 장이면 선택 카드 일괄 판매 기능을 사용할 수 있어요.',
      '중복 카드를 정리하면서 포인트를 확보할 때 유용합니다.'
    ],
    target: 'inventory-bulk-actions'
  },
  {
    id: 'inventory-trade',
    section: 'inventory',
    tab: 'inventory',
    title: '1:1 교환',
    lines: [
      '다른 유저와 카드를 직접 교환할 수 있어요.',
      '교환은 제안, 상대 확인, 최종 승인 단계를 거쳐 체결되므로 실수 가능성을 줄여줍니다.'
    ],
    tip: '교환 중인 카드는 중복 판매나 마켓 등록이 제한될 수 있어요.',
    target: 'inventory-trade-actions'
  },
  {
    id: 'inventory-cosmetic',
    section: 'inventory',
    tab: 'inventory',
    title: '코스메틱 장착',
    lines: [
      '상점에서 산 테두리와 이름 효과는 보관함 카드에 장착합니다.',
      '코스메틱을 포함해 마켓에 판매할지도 등록할 때 선택할 수 있어요.'
    ],
    target: 'inventory-list'
  },
  {
    id: 'inventory-card-detail',
    section: 'inventory',
    tab: 'inventory',
    title: '확대 카드 보기',
    lines: [
      '카드를 클릭하면 큰 카드로 자세히 볼 수 있어요.',
      '확대된 카드는 3D 반응 효과가 적용되어 실제 카드처럼 움직입니다.'
    ],
    target: 'inventory-list'
  },
  {
    id: 'arcade-entry',
    section: 'arcade',
    tab: 'arcade',
    title: '미니게임 아케이드',
    lines: [
      '미니게임에서는 매일 지정된 오늘의 게임에 도전해 포인트를 얻을 수 있어요.',
      '오늘의 게임은 한국 시간 기준으로 매일 자정에 바뀝니다.'
    ],
    actionLabel: '미니게임 보기',
    target: 'arcade-header'
  },
  {
    id: 'arcade-coins',
    section: 'arcade',
    tab: 'arcade',
    title: '아케이드 동전',
    lines: [
      '일반 미니게임은 미니게임용 동전을 사용해 플레이합니다.',
      '동전은 현재 기본적으로 한 시간에 한 번 충전되지만, 가끔 이벤트 등으로 변동되기도 한답니다.'
    ],
    target: 'arcade-tickets'
  },
  {
    id: 'arcade-daily',
    section: 'arcade',
    tab: 'arcade',
    title: '오늘의 미니게임',
    lines: [
      '오늘 플레이 가능한 게임은 하루에 하나만 보여요.',
      '카드 짝 맞추기, 인물 맞추기, 3x4 회전 퍼즐처럼 게임마다 규칙과 제한 시간이 다릅니다.'
    ],
    target: 'arcade-daily-game'
  },
  {
    id: 'arcade-practice',
    section: 'arcade',
    tab: 'arcade',
    title: '연습 게임',
    lines: [
      '연습 게임은 오늘의 게임과 관계없이 모든 게임을 체험할 수 있어요.',
      '동전을 쓰지 않지만 포인트도 지급되지 않으니, 규칙을 익히는 용도로 사용하면 됩니다.'
    ],
    tip: '연습 게임 목록은 기본적으로 접혀 있어서 필요할 때만 펼치면 돼요.',
    target: 'arcade-practice'
  },
  {
    id: 'arcade-results',
    section: 'arcade',
    tab: 'arcade',
    title: '결과 확인',
    lines: [
      '인물 맞추기와 퍼즐은 종료 후 원본 이미지와 정답 닉네임을 보여줘요.',
      '틀렸더라도 어떤 스트리머였는지 자연스럽게 익힐 수 있습니다.'
    ],
    target: 'arcade-practice',
    demo: 'minigame-result'
  },
  {
    id: 'arcade-network',
    section: 'arcade',
    tab: 'arcade',
    title: '중간에 끊겨도 이어가기',
    lines: [
      '연결이 불안정해 STARTED 상태에서 끊긴 게임은 이어서 시작하도록 보정되어 있어요.',
      '결과 채점 중에는 화면 안내가 끝날 때까지 잠시 기다려 주세요.'
    ]
  },
  {
    id: 'ranking-entry',
    section: 'ranking',
    tab: 'ranking',
    title: '랭킹을 볼 차례예요',
    lines: [
      '랭킹에서는 컬렉터 자산, 스트리머 시세, 등락률 흐름을 확인할 수 있어요.',
      '내 카드 가치가 어떻게 움직이는지 보는 재미가 있는 화면입니다.'
    ],
    actionLabel: '랭킹 확인',
    target: 'ranking-header'
  },
  {
    id: 'ranking-user',
    section: 'ranking',
    tab: 'ranking',
    title: '컬렉터 랭킹',
    lines: [
      '유저가 보유한 카드 총 가치로 순위가 매겨져요.',
      '희귀 카드와 인기 스트리머 카드를 모을수록 랭킹 경쟁에서 유리합니다.'
    ],
    target: 'ranking-list'
  },
  {
    id: 'ranking-market',
    section: 'ranking',
    tab: 'ranking',
    title: '스트리머 시세',
    lines: [
      '스트리머 카드의 기준 가치와 최근 변화를 볼 수 있어요.',
      '마켓에서 사고팔기 전, 시세를 먼저 보는 습관을 들이면 포인트 관리가 편해집니다.'
    ],
    target: 'ranking-list'
  },
  {
    id: 'ranking-change',
    section: 'ranking',
    tab: 'ranking',
    title: '등락률 읽기',
    lines: [
      '등락률은 최근 흐름을 빠르게 보여주는 지표예요.',
      '단기 변동만 보고 무리하게 거래하기보다, 내가 좋아하는 카드의 흐름을 참고하는 정도로 보면 좋습니다.'
    ],
    target: 'ranking-tabs'
  },
  {
    id: 'my-info-entry',
    section: 'my-info',
    tab: 'my-info',
    title: '내 정보로 이동했어요',
    lines: [
      '내 정보에서는 계정 상태와 대표 카드, 쿠폰, 알림, 개인정보 설정을 관리합니다.',
      '개인 설정은 대부분 이 화면에 모여 있다고 생각하면 됩니다.'
    ],
    actionLabel: '내 정보 보기',
    target: 'my-info-profile'
  },
  {
    id: 'my-info-profile',
    section: 'my-info',
    tab: 'my-info',
    title: '프로필과 대표 카드',
    lines: [
      '대표 카드는 내 프로필에 보여줄 카드를 고르는 기능이에요.',
      '보유 카드 중 마음에 드는 카드를 골라 나를 표현할 수 있습니다.'
    ],
    target: 'my-info-profile'
  },
  {
    id: 'my-info-titles',
    section: 'my-info',
    tab: 'my-info',
    title: '칭호 장착',
    lines: [
      '획득한 칭호가 있다면 대표 칭호로 장착할 수 있어요.',
      '프로필이나 다른 화면에서 나만의 상태를 보여주는 작은 장식입니다.'
    ],
    target: 'my-info-titles'
  },
  {
    id: 'my-info-images',
    section: 'my-info',
    tab: 'my-info',
    title: '스트리머 카드 이미지 관리',
    lines: [
      '본인 계정이 스트리머 카드로 등록되어 있다면 등급별 카드 이미지를 직접 관리할 수 있어요.',
      '이미지 등록에는 책임 동의와 규격 변환 과정이 있으니 안내를 꼼꼼히 확인해 주세요.'
    ],
    target: 'my-info-images'
  },
  {
    id: 'my-info-coupon',
    section: 'my-info',
    tab: 'my-info',
    title: '쿠폰 등록',
    lines: [
      '쿠폰 코드를 입력하면 포인트나 무료 소환 티켓 같은 보상을 받을 수 있어요.',
      '푸시 알림이나 링크로 받은 쿠폰은 내 정보의 입력칸에 자동으로 채워질 수 있습니다.'
    ],
    target: 'my-info-coupon'
  },
  {
    id: 'my-info-push',
    section: 'my-info',
    tab: 'my-info',
    title: '푸시 알림과 앱 설치',
    lines: [
      '알림을 허용하면 공지, 이벤트, 카드 삭제 보상 같은 중요한 소식을 받을 수 있어요.',
      '설치 가능한 환경에서는 같은 버튼으로 PWA 앱 설치도 함께 시도합니다.'
    ],
    target: 'my-info-push'
  },
  {
    id: 'my-info-block',
    section: 'my-info',
    tab: 'my-info',
    title: '유저 차단 관리',
    lines: [
      '원하지 않는 유저는 차단해서 교환 제안을 막을 수 있어요.',
      '차단 목록은 언제든 다시 해제할 수 있습니다.'
    ],
    target: 'my-info-blocks'
  },
  {
    id: 'my-info-privacy',
    section: 'my-info',
    tab: 'my-info',
    title: '개인정보와 탈퇴',
    lines: [
      '개인정보 처리방침에서는 어떤 정보를 어떤 목적으로 쓰는지 확인할 수 있어요.',
      '회원 탈퇴는 안전장치를 거쳐야 실행되며, 실행 후에는 복구할 수 없습니다.'
    ],
    target: 'my-info-privacy'
  },
  {
    id: 'my-info-replay',
    section: 'my-info',
    tab: 'my-info',
    title: '튜토리얼 다시 보기',
    lines: [
      '방금 보고 있는 이 안내도 내 정보 탭에서 다시 시작할 수 있어요.',
      '기능이 많아서 헷갈릴 때는 언제든 처음부터 다시 둘러보면 됩니다.'
    ],
    target: 'my-info-tutorial'
  },
  {
    id: 'wrap-up-use-flow',
    section: 'wrap-up',
    tab: 'main',
    title: '추천 이용 흐름',
    lines: [
      '처음에는 메인에서 공지를 보고, 상점에서 무료 소환을 확인한 뒤 보관함을 정리해 보세요.',
      '그 다음 미니게임으로 포인트를 모으고 랭킹에서 내 위치를 확인하면 흐름이 자연스럽습니다.'
    ]
  },
  {
    id: 'wrap-up-safe',
    section: 'wrap-up',
    tab: 'main',
    title: '실수 방지 팁',
    lines: [
      '판매, 마켓 등록, 회원 탈퇴처럼 되돌리기 어려운 기능은 확인창을 꼭 읽어 주세요.',
      '거래 중인 카드는 다른 작업이 제한될 수 있으니 보관함의 상태 표시도 함께 확인하면 좋습니다.'
    ]
  },
  {
    id: 'wrap-up-done',
    section: 'wrap-up',
    tab: 'main',
    title: '이제 직접 즐겨보세요',
    lines: [
      '필요한 큰 흐름은 모두 둘러봤어요.',
      '이 안내는 내 정보에서 다시 볼 수 있으니, 이제 마음 편하게 카드 수집을 시작하면 됩니다.'
    ],
    actionLabel: '튜토리얼 완료'
  }
];

const completedStorageKey = (userId: string | number) => `chikapo_tutorial_completed:${TUTORIAL_VERSION}:${userId}`;
const sessionStorageKey = (userId: string | number) => `chikapo_tutorial_session_seen:${TUTORIAL_VERSION}:${userId}`;

export const TutorialGuide: React.FC = () => {
  const { user, activeTab, setActiveTab, refreshUserData, toast } = useApp();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [highlightRect, setHighlightRect] = useState<HighlightRect | null>(null);
  const [waitingSatisfied, setWaitingSatisfied] = useState(false);
  const [actionStatus, setActionStatus] = useState('');
  const [gachaRewardClaiming, setGachaRewardClaiming] = useState(false);
  const [uaruImageUrl, setUaruImageUrl] = useState(`https://api.dicebear.com/10.x/fun-emoji/svg?seed=${UARU_CHANNEL_ID}`);

  const step = tutorialSteps[stepIndex];
  const sectionStepNumbers = useMemo(() => {
    const counts = new Map<TutorialSection, number>();
    return tutorialSteps.map((item) => {
      const nextCount = (counts.get(item.section) ?? 0) + 1;
      counts.set(item.section, nextCount);
      return nextCount;
    });
  }, []);
  const sectionTotal = useMemo(() => {
    return tutorialSteps.filter((item) => item.section === step.section).length;
  }, [step.section]);
  const SectionIcon = sectionIcons[step.section];
  const progress = Math.round(((stepIndex + 1) / tutorialSteps.length) * 100);
  const canGoBack = stepIndex > 0;
  const isLastStep = stepIndex === tutorialSteps.length - 1;
  const isWaitingForAction = !!step.waitForEvent && !waitingSatisfied;
  const targetSelector = step.target ? `[data-tour="${step.target}"]` : '';

  const startTutorial = (initialStep = 0) => {
    setStepIndex(initialStep);
    setWaitingSatisfied(false);
    setActionStatus('');
    setCollapsed(false);
    setOpen(true);
  };

  const markCompleted = () => {
    if (!user?.id) return;
    localStorage.setItem(completedStorageKey(user.id), '1');
    sessionStorage.setItem(sessionStorageKey(user.id), '1');
  };

  const finishTutorial = () => {
    markCompleted();
    setOpen(false);
    setCollapsed(false);
    setHighlightRect(null);
  };

  const skipTutorial = () => {
    markCompleted();
    setOpen(false);
    setCollapsed(false);
    setHighlightRect(null);
  };

  const goToStep = (nextIndex: number) => {
    setWaitingSatisfied(false);
    setActionStatus('');
    setStepIndex(Math.max(0, Math.min(tutorialSteps.length - 1, nextIndex)));
  };

  useEffect(() => {
    if (!user?.id) return;

    const handleManualStart = () => startTutorial(0);
    window.addEventListener(MANUAL_START_EVENT, handleManualStart);
    return () => window.removeEventListener(MANUAL_START_EVENT, handleManualStart);
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id || open) return;
    if (localStorage.getItem(completedStorageKey(user.id)) === '1') return;
    if (sessionStorage.getItem(sessionStorageKey(user.id)) === '1') return;

    sessionStorage.setItem(sessionStorageKey(user.id), '1');
    const timer = window.setTimeout(() => startTutorial(0), 900);
    return () => window.clearTimeout(timer);
  }, [open, user?.id]);

  useEffect(() => {
    if (!open || collapsed) return;
    if (activeTab !== step.tab) {
      setActiveTab(step.tab);
    }
  }, [activeTab, collapsed, open, setActiveTab, step.tab]);

  useEffect(() => {
    if (!open || collapsed || !step.shopSubTab) return;
    window.dispatchEvent(new CustomEvent('chikapo:tutorial-shop-subtab', {
      detail: { subTab: step.shopSubTab }
    }));
  }, [collapsed, open, step.id, step.shopSubTab]);

  useEffect(() => {
    setWaitingSatisfied(false);
    setActionStatus('');
  }, [step.id]);

  useEffect(() => {
    if (!open || collapsed || !step.waitForEvent) return;

    const handleStepEvent = (event: Event) => {
      const customEvent = event as CustomEvent<{ card?: { name?: string } }>;
      const cardName = customEvent.detail?.card?.name;
      setWaitingSatisfied(true);
      setActionStatus(cardName ? `${cardName} 카드가 나왔어요. 결과 카드를 확인해 주세요.` : '체험이 완료됐어요. 이어서 진행할 수 있습니다.');
    };

    window.addEventListener(step.waitForEvent, handleStepEvent);
    return () => window.removeEventListener(step.waitForEvent!, handleStepEvent);
  }, [collapsed, open, step.waitForEvent]);

  useEffect(() => {
    if (!open || collapsed || !user?.id || !step.grantGachaTicket) return;

    let cancelled = false;
    const claimTicket = async () => {
      setGachaRewardClaiming(true);
      try {
        const res = await apiFetch('/tutorial/rewards/gacha-ticket', { method: 'POST' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setActionStatus(data.message || '튜토리얼 티켓 지급에 실패했습니다. 보유 티켓이나 포인트로 체험할 수 있어요.');
          return;
        }
        if (cancelled) return;
        setActionStatus(data.message || '소환 버튼을 직접 눌러주세요.');
        await refreshUserData(false);
        if (data.granted) toast('튜토리얼 체험용 추가 무료 소환 티켓 1장을 지급했습니다.', 'success');
      } catch {
        if (!cancelled) setActionStatus('티켓 지급 요청 중 오류가 발생했습니다. 체험을 건너뛰고 계속 진행할 수 있어요.');
      } finally {
        if (!cancelled) setGachaRewardClaiming(false);
      }
    };

    claimTicket();
    return () => {
      cancelled = true;
    };
  }, [collapsed, open, refreshUserData, step.grantGachaTicket, step.id, toast, user?.id]);

  useEffect(() => {
    if (!open || collapsed || !targetSelector) {
      setHighlightRect(null);
      return;
    }

    let frame = 0;
    const measure = (shouldScroll = false) => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const target = document.querySelector<HTMLElement>(targetSelector);
        if (!target) {
          setHighlightRect(null);
          return;
        }
        if (shouldScroll) {
          target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
        }
        const rect = target.getBoundingClientRect();
        const padding = 10;
        setHighlightRect({
          top: Math.max(8, rect.top - padding),
          left: Math.max(8, rect.left - padding),
          width: Math.min(window.innerWidth - 16, rect.width + padding * 2),
          height: Math.min(window.innerHeight - 16, rect.height + padding * 2)
        });
      });
    };

    const initialTimer = window.setTimeout(() => measure(true), activeTab === step.tab ? 120 : 420);
    const refreshTimer = window.setTimeout(() => measure(false), 850);
    const handleViewportChange = () => measure(false);
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);

    return () => {
      window.clearTimeout(initialTimer);
      window.clearTimeout(refreshTimer);
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [activeTab, collapsed, open, step.id, step.tab, targetSelector]);

  useEffect(() => {
    if (!open || step.demo !== 'minigame-result') return;

    let cancelled = false;
    apiFetch(`/streamers/${UARU_CHANNEL_ID}`)
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (cancelled || !data) return;
        const streamer = data.streamer || data;
        const imageUrl = streamer.custom_image_url || streamer.logo_url;
        if (imageUrl) setUaruImageUrl(imageUrl);
      })
      .catch(() => { /* 예시 이미지는 기본 이미지로 대체 */ });

    return () => {
      cancelled = true;
    };
  }, [open, step.demo]);

  if (!user || !open) return null;

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        className="fixed bottom-24 right-4 z-[80] flex items-center gap-2 rounded-full border border-primary/25 bg-card/95 px-4 py-3 text-xs font-black text-foreground shadow-[0_18px_50px_rgba(24,112,210,0.24)] backdrop-blur-xl transition hover:-translate-y-0.5 md:bottom-8 md:right-8 dark:bg-card/90"
      >
        <MessageCircleHeart className="h-4 w-4 text-primary" />
        튜토리얼 계속 보기
      </button>
    );
  }

  return (
    <>
      {highlightRect && (
        <div className="pointer-events-none fixed inset-0 z-[70]" aria-hidden="true">
          <div className="absolute left-0 right-0 top-0 bg-slate-950/45 backdrop-blur-[1.5px] dark:bg-black/58" style={{ height: highlightRect.top }} />
          <div className="absolute left-0 bg-slate-950/45 backdrop-blur-[1.5px] dark:bg-black/58" style={{ top: highlightRect.top, width: highlightRect.left, height: highlightRect.height }} />
          <div className="absolute right-0 bg-slate-950/45 backdrop-blur-[1.5px] dark:bg-black/58" style={{ top: highlightRect.top, left: highlightRect.left + highlightRect.width, height: highlightRect.height }} />
          <div className="absolute bottom-0 left-0 right-0 bg-slate-950/45 backdrop-blur-[1.5px] dark:bg-black/58" style={{ top: highlightRect.top + highlightRect.height }} />
          <div
            className="absolute rounded-[1.65rem] border-2 border-sky-300 shadow-[0_0_0_6px_rgba(14,165,233,0.22),0_0_36px_rgba(14,165,233,0.58)] ring-2 ring-white/80 dark:border-cyan-200 dark:ring-white/35"
            style={{
              top: highlightRect.top,
              left: highlightRect.left,
              width: highlightRect.width,
              height: highlightRect.height
            }}
          />
        </div>
      )}

      {step.demo === 'inventory-menu' && (
        <div className="pointer-events-none fixed right-4 top-24 z-[75] w-56 rounded-2xl border border-border bg-card/96 p-2 text-xs font-bold text-foreground shadow-[0_18px_60px_rgba(15,23,42,0.24)] backdrop-blur-xl md:right-10">
          <p className="px-3 py-2 text-[10px] font-black text-primary">카드 메뉴 예시</p>
          {['🎨 코스메틱 장착', '💰 카드 판매하기', '🏪 마켓 판매 등록', '🚩 카드 이미지 신고'].map((label) => (
            <div key={label} className="rounded-xl px-3 py-2 text-muted-foreground">
              {label}
            </div>
          ))}
        </div>
      )}

      {step.demo === 'minigame-result' && (
        <div className="pointer-events-none fixed left-1/2 top-16 z-[75] hidden w-[min(42rem,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-[1.75rem] border border-border bg-card/96 shadow-[0_24px_80px_rgba(15,23,42,0.28)] backdrop-blur-xl md:block">
          <div className="border-b border-border bg-gradient-to-br from-emerald-50 via-card to-sky-50 px-5 py-4 dark:from-emerald-500/15 dark:via-card dark:to-sky-500/10">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                <CheckCircle2 className="h-5 w-5" />
              </span>
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-700 dark:text-emerald-300">Example Result</p>
                <h3 className="text-base font-black text-foreground">미니게임 결과 예시</h3>
              </div>
            </div>
          </div>
          <div className="grid md:grid-cols-[0.95fr_1.05fr]">
            <div className="border-r border-border bg-secondary/20 p-5">
              <div className="mx-auto max-w-[14rem]">
                <div className="relative aspect-[3/4] overflow-hidden rounded-2xl border border-border bg-zinc-950">
                  <img src={uaruImageUrl} alt="스트리머 원본 이미지 예시" className="h-full w-full object-contain" />
                </div>
                <div className="-mt-4 mx-3 relative flex items-center gap-3 rounded-2xl border border-border bg-card/95 px-4 py-3 shadow-xl">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <UserRound className="h-4.5 w-4.5" />
                  </span>
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-[0.16em] text-muted-foreground">Streamer</p>
                    <p className="text-sm font-black text-foreground">유아루</p>
                  </div>
                </div>
              </div>
            </div>
            <div className="flex flex-col justify-center p-5">
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50/80 px-4 py-3 text-xs font-bold leading-relaxed text-foreground/85 dark:border-emerald-500/20 dark:bg-emerald-500/10">
                게임이 끝나면 이런 식으로 원본 이미지와 정답 닉네임이 함께 공개됩니다.
              </div>
              <p className="mt-3 text-[11px] font-bold text-muted-foreground">
                예시 스트리머: 유아루 · channel id {UARU_CHANNEL_ID}
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[80] flex justify-center px-3 pb-24 md:bottom-6 md:px-6 md:pb-0">
      <section
        role="dialog"
        aria-modal="false"
        aria-labelledby="tutorial-guide-title"
        className="pointer-events-auto w-full max-w-2xl overflow-hidden rounded-[2rem] border border-primary/20 bg-card/95 text-foreground shadow-[0_24px_80px_rgba(24,112,210,0.22)] backdrop-blur-2xl dark:border-white/10 dark:bg-card/90 dark:shadow-[0_24px_80px_rgba(0,0,0,0.42)]"
      >
        <div className="h-1.5 bg-secondary">
          <div
            className="h-full rounded-r-full bg-gradient-to-r from-primary via-sky-400 to-accent transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>

        <div className="relative overflow-hidden p-4 sm:p-5">
          <div className="pointer-events-none absolute -right-10 -top-16 h-36 w-36 rounded-full bg-primary/12 blur-2xl dark:bg-primary/18" />
          <div className="pointer-events-none absolute -bottom-20 left-8 h-32 w-32 rounded-full bg-accent/20 blur-2xl dark:bg-accent/10" />

          <div className="relative flex items-start gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-primary/20 bg-gradient-to-br from-white via-secondary/80 to-primary/15 text-primary shadow-inner dark:from-white/15 dark:via-secondary/60 dark:to-primary/20">
              <SectionIcon className="h-6 w-6" />
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="cute-pill rounded-full px-2.5 py-1 text-[10px] font-black">
                  {sectionLabels[step.section]} {sectionStepNumbers[stepIndex]}/{sectionTotal}
                </span>
                <span className="text-[10px] font-black text-primary">
                  전체 {stepIndex + 1}/{tutorialSteps.length}
                </span>
              </div>
              <h2 id="tutorial-guide-title" className="mt-2 text-lg font-black leading-tight text-foreground sm:text-xl">
                {step.title}
              </h2>
            </div>

            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => setCollapsed(true)}
                className="rounded-full border border-border bg-secondary/70 p-2 text-muted-foreground transition hover:-translate-y-0.5 hover:text-foreground"
                aria-label="튜토리얼 잠시 접기"
                title="잠시 접기"
              >
                <PauseCircle className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={skipTutorial}
                className="rounded-full border border-border bg-secondary/70 p-2 text-muted-foreground transition hover:-translate-y-0.5 hover:text-foreground"
                aria-label="튜토리얼 스킵"
                title="스킵"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="relative mt-4 rounded-[1.5rem] border border-border/70 bg-secondary/55 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)] dark:bg-white/[0.04]">
            <div className="mb-3 flex items-center gap-2 text-xs font-black text-primary">
              <MessageCircleHeart className="h-4 w-4" />
              치카포 가이드
            </div>
            <div className="space-y-2 text-sm font-bold leading-relaxed text-foreground/90">
              {step.lines.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
            {step.tip && (
              <p className="mt-3 rounded-2xl border border-primary/15 bg-primary/10 px-3 py-2 text-xs font-bold leading-relaxed text-primary dark:bg-primary/10">
                {step.tip}
              </p>
            )}
            {(actionStatus || gachaRewardClaiming || isWaitingForAction) && (
              <p className="mt-3 rounded-2xl border border-sky-300/40 bg-sky-100/80 px-3 py-2 text-xs font-black leading-relaxed text-sky-700 dark:border-sky-300/20 dark:bg-sky-400/10 dark:text-sky-200">
                {gachaRewardClaiming ? '튜토리얼 체험용 무료 소환 티켓을 준비하는 중입니다...' : actionStatus || '강조된 위치에서 직접 조작하면 다음 단계가 열립니다.'}
              </p>
            )}
          </div>

          <div className="relative mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <button
              type="button"
              onClick={skipTutorial}
              className="order-2 text-xs font-black text-muted-foreground underline-offset-4 transition hover:text-foreground hover:underline sm:order-1"
            >
              이번엔 건너뛰기
            </button>

            <div className="order-1 flex items-center gap-2 sm:order-2">
              <button
                type="button"
                onClick={() => goToStep(stepIndex - 1)}
                disabled={!canGoBack}
                className="cute-wiggle-hover inline-flex items-center justify-center gap-1.5 rounded-2xl border border-border bg-secondary/80 px-4 py-2.5 text-xs font-black text-foreground transition disabled:cursor-not-allowed disabled:opacity-50"
              >
                <ArrowLeft className="h-4 w-4" />
                이전
              </button>
              <button
                type="button"
                onClick={() => {
                  if (isWaitingForAction) return;
                  if (isLastStep) {
                    finishTutorial();
                    return;
                  }
                  goToStep(stepIndex + 1);
                }}
                disabled={isWaitingForAction}
                className="cute-wiggle-hover inline-flex flex-1 items-center justify-center gap-1.5 rounded-2xl bg-primary px-5 py-2.5 text-xs font-black text-primary-foreground shadow-lg shadow-primary/20 transition hover:-translate-y-0.5 hover:bg-primary/95 disabled:cursor-not-allowed disabled:opacity-55 sm:flex-none"
              >
                {isLastStep ? (
                  <>
                    <CheckCircle2 className="h-4 w-4" />
                    {step.actionLabel ?? '완료'}
                  </>
                ) : (
                  <>
                    <PlayCircle className="h-4 w-4" />
                    {step.actionLabel ?? '다음'}
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>
              {isWaitingForAction && (
                <button
                  type="button"
                  onClick={() => goToStep(stepIndex + 1)}
                  className="rounded-2xl border border-border bg-secondary/80 px-3 py-2.5 text-[11px] font-black text-muted-foreground transition hover:text-foreground"
                >
                  체험 건너뛰기
                </button>
              )}
            </div>
          </div>
        </div>
      </section>
      </div>
    </>
  );
};

export const startChikapoTutorial = () => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(MANUAL_START_EVENT));
};
