'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { createPortal } from 'react-dom';
import { useApp } from './AppContext';
import { API_BASE_URL, apiFetch } from '@/lib/api';
import {
  Gamepad2,
  Timer,
  Trophy,
  RefreshCw,
  X,
  Sparkles,
  HelpCircle,
  Clock,
  ChevronLeft,
  ChevronDown,
  CalendarClock,
  Eye,
  Flag,
  UserRound
} from 'lucide-react';
import { ReportCardModal, type ReportTargetCard } from './ReportCardModal';
import { BlindableCardImage } from './BlindableCardImage';
import { proxiedImage } from '@/lib/cosmetics';
import {
  CROP_DETECTIVE_IMAGE_REQUEST_PROFILES,
  areCropDetectiveAssetsSettled,
  createCropDetectiveCssCropGeometry,
  createCropDetectiveImageSourceChain,
  type CropDetectiveImageSource
} from './cropDetectiveImageSources';

type GameType = 'quiz' | 'puzzle' | 'match' | 'value_duel' | 'crop_detective';
type QuizChoice = {
  channel_id: string;
  name: string;
};

type ArcadeCardOption = {
  channel_id: string;
  name: string;
  image_url: string;
  fallback_image_url?: string | null;
  star: number;
};

type ValueDuelRound = {
  round: number;
  left: ArcadeCardOption;
  right: ArcadeCardOption;
};

type QuizRound = {
  round: number;
  image_url: string;
  choices: QuizChoice[];
};

type CropDetectiveRound = {
  round: number;
  crop: {
    x: number;
    y: number;
    size: number;
    rotation?: number;
  };
  source_image_url: string;
  source_fallback_image_url?: string | null;
  choices: ArcadeCardOption[];
};

type MatchCardSource = {
  card_id?: string | number;
  channel_id: string;
  name: string;
  logo_url?: string | null;
};

type MatchCard = MatchCardSource & {
  card_id: string;
  isFlipped: boolean;
  isMatched: boolean;
};

type PuzzlePiece = {
  id: number;
  rotation: number;
};

type PuzzleMove =
  | { type: 'swap'; from: number; to: number }
  | { type: 'rotate'; index: number };

type MatchedPair = {
  first_card_id: string;
  second_card_id: string;
};

type MinigameData = {
  image_url?: string;
  choices?: QuizChoice[];
  cards?: MatchCardSource[];
  puzzle_pieces?: PuzzlePiece[];
  rounds?: Array<QuizRound | ValueDuelRound | CropDetectiveRound>;
  total_rounds?: number;
  round_deadline_at?: string | null;
};

type MinigameResult = {
  correct: boolean;
  message: string;
  earned_points: number;
  new_balance: number;
  practice_mode?: boolean;
  answer?: {
    channel_id: string;
    name: string;
    image_url: string;
    star: number;
  };
};

type SubmitPayload = {
  success?: boolean;
  answer_channel_id?: string;
  puzzle_pieces?: Array<{ id: number; rotation: number }>;
  puzzle_moves?: PuzzleMove[];
  matched_pairs?: MatchedPair[];
  /** Practice-only compatibility with servers that still issue the legacy six-card source list. */
  matched_channel_ids?: string[];
  answers?: Array<{ round: number; selected_channel_id: string }>;
};

type SubmitRetryState = {
  payload: SubmitPayload;
  attempt: number;
};

type RoundFeedback = {
  round: number;
  selected_channel_id?: string;
  correct: boolean;
  correct_channel_ids: string[];
  timed_out?: boolean;
  locked?: boolean;
};

type TicketStatusResponse = {
  current_tickets: number;
  max_tickets?: number;
  base_tickets?: number;
  bonus_tickets?: number;
  seconds_until_next_ticket: number;
  ticket_charge_interval_minutes?: number;
  today_game: GameType;
  kst_date: string;
  next_game_at: string;
  seconds_until_game_change: number;
};

type StartGameResponse = {
  session_id: string;
  game_type?: GameType;
  game_data: MinigameData;
  message?: string;
  practice_mode?: boolean;
  resumed_session?: boolean;
  interrupted_session_closed?: boolean;
  round_progress?: {
    outcomes: Array<{ round: number; selected_channel_id: string | null }>;
    next_round: number;
    correct_count: number;
    total_rounds?: number;
    round_deadline_at?: string | null;
  };
  total_rounds?: number;
  round_deadline_at?: string | null;
  timing?: {
    server_now: string;
    session_started_at: string | null;
    session_started_at_kst?: string | null;
    server_elapsed_ms: number;
    preplay_ms: number;
    time_limit_ms: number;
    time_remaining_ms: number;
    submit_allowance_ms: number;
  };
  today_game?: GameType;
  kst_date?: string;
  next_game_at?: string;
};

type RoundAnswerResponse = {
  message?: string;
  server_now?: string;
  correct?: boolean;
  correct_channel_ids?: string[];
  timed_out?: boolean;
  has_next_round?: boolean;
  next_round?: QuizRound | ValueDuelRound | CropDetectiveRound | null;
  next_round_deadline_at?: string | null;
  total_rounds?: number;
};

type RoundStartResponse = {
  success?: boolean;
  message?: string;
  round?: number;
  round_data?: ValueDuelRound;
  round_deadline_at?: string;
  server_now?: string;
  total_rounds?: number;
};

type PendingPaidRound = {
  roundIndex: number;
  localDeadlineAt: number | null;
};

const GAME_TYPES: GameType[] = ['quiz', 'puzzle', 'match', 'value_duel', 'crop_detective'];

const DAILY_GAME_DETAILS: Record<GameType, {
  title: string;
  description: string;
  bonus: string;
  Icon: React.ComponentType<{ className?: string }>;
  accent: string;
  iconBackground: string;
  badge: string;
  glow: string;
}> = {
  quiz: {
    title: '송출 오류난 스트리머 맞추기',
    description: '무작위 스트리머 카드가 전송 오류가 났습니다. 15초 내로 복원되는 카드를 보고 누구인지 맞춰보세요!',
    bonus: '3초 안에 정답 시 보너스 200 P',
    Icon: HelpCircle,
    accent: 'text-emerald-600 dark:text-emerald-400',
    iconBackground: 'bg-emerald-100 dark:bg-emerald-500/10',
    badge: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-400',
    glow: 'from-emerald-500/15 via-transparent to-transparent'
  },
  puzzle: {
    title: '3x4 회전 퍼즐',
    description: '120초 안에 섞인 조각을 드래그로 교체하고, 탭해서 90도씩 회전시켜 올바른 카드 이미지를 복구하세요.',
    bonus: '30초 안에 완성 시 보너스 200 P',
    Icon: Sparkles,
    accent: 'text-teal-700 dark:text-teal-300',
    iconBackground: 'bg-teal-100 dark:bg-teal-500/10',
    badge: 'border-teal-200 bg-teal-50 text-teal-800 dark:border-teal-500/20 dark:bg-teal-500/10 dark:text-teal-300',
    glow: 'from-teal-500/18 via-transparent to-transparent'
  },
  match: {
    title: '스트리머 짝맞추기',
    description: '처음 2초간 공개되는 카드를 기억한 뒤, 30초 안에 뒤집힌 스트리머 카드의 짝을 모두 맞춰보세요!',
    bonus: '10초 안에 완성 시 보너스 200 P',
    Icon: Trophy,
    accent: 'text-sky-700 dark:text-sky-300',
    iconBackground: 'bg-sky-100 dark:bg-sky-500/10',
    badge: 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-500/20 dark:bg-sky-500/10 dark:text-sky-300',
    glow: 'from-sky-500/18 via-transparent to-transparent'
  },
  value_duel: {
    title: '시세 듀얼',
    description: '5문제 동안 두 스트리머 카드 중 현재 시세가 더 높은 쪽을 10초 안에 고르세요. 3문제 이상 맞히면 성공입니다.',
    bonus: '5문제 모두 정답 시 보너스 200 P',
    Icon: Trophy,
    accent: 'text-amber-700 dark:text-amber-300',
    iconBackground: 'bg-amber-100 dark:bg-amber-500/10',
    badge: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300',
    glow: 'from-amber-500/18 via-transparent to-transparent'
  },
  crop_detective: {
    title: '카드 확대 탐정',
    description: '확대된 카드 조각을 보고 4개의 후보 카드 중 같은 이미지에서 나온 카드를 찾으세요. 3문제 이상 맞히면 성공입니다.',
    bonus: '5문제 모두 정답 시 보너스 200 P',
    Icon: Eye,
    accent: 'text-fuchsia-700 dark:text-fuchsia-300',
    iconBackground: 'bg-fuchsia-100 dark:bg-fuchsia-500/10',
    badge: 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-800 dark:border-fuchsia-500/20 dark:bg-fuchsia-500/10 dark:text-fuchsia-300',
    glow: 'from-fuchsia-500/18 via-transparent to-transparent'
  }
};

const PUZZLE_COLUMNS = 3;
const PUZZLE_ROWS = 4;
const PUZZLE_PIECE_COUNT = PUZZLE_COLUMNS * PUZZLE_ROWS;
const MAX_PUZZLE_MOVES = 128;
const PUZZLE_TIME_LIMIT_SECONDS = 120;
const PUZZLE_HINT_PENALTY_SECONDS = 10;
const PUZZLE_HINT_DURATION_MS = 2000;
const MATCH_TIME_LIMIT_SECONDS = 30;
const ROUND_GAME_TOTAL_ROUNDS = 5;
const ROUND_GAME_ROUND_SECONDS = 10;
const QUIZ_TIME_LIMIT_SECONDS = 10;
type QuizBlurType = 'gaussian' | 'mosaic' | 'motion' | 'radial';
const QUIZ_BLUR_TYPES: QuizBlurType[] = ['gaussian', 'mosaic', 'motion', 'radial'];
const QUIZ_DISTORTION_SCALE = 0.25;
const QUIZ_GAUSSIAN_MAX_BLUR_PX = 100 * QUIZ_DISTORTION_SCALE;
// 방향형(모션) 블러: 한 방향으로 강하게 밀린 듯한 선형 모션 스미어.
// N장의 평행 이동 사본을 누적 평균(alpha=1/(i+1))하여 진짜 모션 블러를 만든다.
const QUIZ_MOTION_SAMPLES = 28;
const QUIZ_MOTION_TRAVEL_RATIO = 0.72; // 캔버스 긴 변 대비 최대 이동 비율
// 모자이크 블러: 픽셀 블록 크기 (독립 상수)
const QUIZ_MOSAIC_MAX_BLOCK_PX = 34;
// 회전형 블러: 둥글게 뒤틀린 듯한 강한 회전 스핀 스미어.
// N장의 회전 사본을 누적 평균 + 바깥일수록 확대해 소용돌이처럼 휘말리게 한다.
const QUIZ_RADIAL_SAMPLES = 28;
const QUIZ_RADIAL_MAX_SPIN_DEG = 95;      // 최대 회전 스프레드(±47.5°)
const QUIZ_RADIAL_MAX_SWIRL_SCALE = 0.18; // 외곽 잔상 최대 18% 확대(소용돌이)

// [-0.5, 0.5] 구간을 균등 분할하되 중앙(0)에서 바깥 순서로 정렬한 위치 배열.
// 첫(불투명) 사본이 중앙 정렬본이 되어 누적 평균 시 스미어가 한쪽으로 쏠리지 않게 한다.
const buildCenterOutOrder = (count: number): number[] => {
  if (count <= 1) return [0];
  const positions: number[] = [];
  for (let i = 0; i < count; i += 1) positions.push(i / (count - 1) - 0.5);
  return positions.sort((a, b) => Math.abs(a) - Math.abs(b));
};

const getObjectCoverSourceRect = (
  image: HTMLImageElement,
  targetWidth: number,
  targetHeight: number
) => {
  const sourceRatio = image.naturalWidth / image.naturalHeight;
  const targetRatio = targetWidth / targetHeight;
  let sourceWidth = image.naturalWidth;
  let sourceHeight = image.naturalHeight;
  let sourceX = 0;
  let sourceY = 0;

  if (sourceRatio > targetRatio) {
    sourceWidth = image.naturalHeight * targetRatio;
    sourceX = (image.naturalWidth - sourceWidth) / 2;
  } else {
    sourceHeight = image.naturalWidth / targetRatio;
    sourceY = (image.naturalHeight - sourceHeight) / 2;
  }

  return { sourceX, sourceY, sourceWidth, sourceHeight };
};

const CanvasBlurQuizImage: React.FC<{
  src: string;
  intensity: number;
  angle: number;
  mode: 'motion' | 'radial';
}> = ({ src, intensity, angle, mode }) => {
  const { isImageBlinded } = useApp();
  const blinded = isImageBlinded(src);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const imageRef = React.useRef<HTMLImageElement | null>(null);
  const rafRef = React.useRef<number | null>(null);
  const intensityRef = React.useRef(intensity);
  const angleRef = React.useRef(angle);
  const [ready, setReady] = useState(false);

  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas || !image || !image.naturalWidth || !image.naturalHeight) return;

    const width = Math.max(1, Math.round(canvas.clientWidth));
    const height = Math.max(1, Math.round(canvas.clientHeight));
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const backingWidth = Math.round(width * pixelRatio);
    const backingHeight = Math.round(height * pixelRatio);

    if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
      canvas.width = backingWidth;
      canvas.height = backingHeight;
    }

    const context = canvas.getContext('2d');
    if (!context) return;

    const { sourceX, sourceY, sourceWidth, sourceHeight } = getObjectCoverSourceRect(image, width, height);
    const normalizedIntensity = Math.max(0, Math.min(100, intensityRef.current)) / 100;
    const radians = (angleRef.current * Math.PI) / 180;

    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, width, height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';

    const drawLayer = ({
      offsetX = 0,
      offsetY = 0,
      rotation = 0,
      scale = 1,
      opacity = 1,
      filter = 'none',
      blendMode = 'source-over'
    }: {
      offsetX?: number;
      offsetY?: number;
      rotation?: number;
      scale?: number;
      opacity?: number;
      filter?: string;
      blendMode?: GlobalCompositeOperation;
    }) => {
      context.save();
      context.globalAlpha = opacity;
      context.globalCompositeOperation = blendMode;
      context.filter = filter;
      context.translate(width / 2 + offsetX, height / 2 + offsetY);
      context.rotate(rotation);
      context.scale(scale, scale);
      context.drawImage(
        image,
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
        -width / 2,
        -height / 2,
        width,
        height
      );
      context.restore();
    };

    // 동일 이미지를 캔버스에 가득 채워 여러 번 누적 평균(alpha=1/(i+1))하여
    // '평균 기반' 강한 블러를 만든다. 마지막에 선명한 원본을 덮지 않으므로
    // 강도가 높을수록 원본을 알아볼 수 없을 만큼 강하게 뭉개진다.
    const longSide = Math.max(width, height);
    const contrast = 1 + normalizedIntensity * 0.15;

    if (mode === 'motion') {
      // 방향형: angle 방향으로 강하게 밀린 선형 모션 블러
      const travel = normalizedIntensity * longSide * QUIZ_MOTION_TRAVEL_RATIO;
      const dirX = Math.cos(radians);
      const dirY = Math.sin(radians);
      const samples = QUIZ_MOTION_SAMPLES;
      // 인접 사본 사이 간극을 메워 줄무늬(밴딩)를 방지하는 소량 블러
      const sampleBlur = Math.min(8, (travel / samples) * 0.9);
      const filter = `blur(${Math.max(0.4, sampleBlur)}px) contrast(${contrast})`;

      const positions = buildCenterOutOrder(samples); // 중앙→바깥 순서
      for (let i = 0; i < samples; i += 1) {
        const t = positions[i];
        drawLayer({
          offsetX: dirX * t * travel,
          offsetY: dirY * t * travel,
          opacity: 1 / (i + 1),
          filter
        });
      }
    } else {
      // 회전형: 중심을 기준으로 둥글게 뒤틀린 강한 회전 스핀 블러
      const spin = (normalizedIntensity * QUIZ_RADIAL_MAX_SPIN_DEG * Math.PI) / 180;
      const samples = QUIZ_RADIAL_SAMPLES;
      const sampleBlur = Math.min(7, normalizedIntensity * 4);
      const filter = `blur(${Math.max(0.4, sampleBlur)}px) contrast(${contrast})`;

      const positions = buildCenterOutOrder(samples);
      for (let i = 0; i < samples; i += 1) {
        const t = positions[i];
        // 바깥쪽(|t| 큰) 사본일수록 더 회전·확대 → 소용돌이처럼 휘말리는 느낌
        const swirlScale = 1 + normalizedIntensity * QUIZ_RADIAL_MAX_SWIRL_SCALE * Math.abs(t) * 2;
        drawLayer({
          rotation: t * spin,
          scale: swirlScale,
          opacity: 1 / (i + 1),
          filter
        });
      }
    }

    context.filter = 'none';
    context.globalAlpha = 1;
    context.globalCompositeOperation = 'source-over';
    setReady(true);
  }, [mode]);

  const scheduleDraw = useCallback(() => {
    if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      drawCanvas();
    });
  }, [drawCanvas]);

  useEffect(() => {
    intensityRef.current = intensity;
    angleRef.current = angle;
    scheduleDraw();
  }, [angle, intensity, scheduleDraw]);

  useEffect(() => {
    setReady(false);
    imageRef.current = null;
    if (blinded) return;
    const image = new Image();
    image.decoding = 'async';
    image.fetchPriority = 'high';
    image.onload = () => {
      imageRef.current = image;
      scheduleDraw();
    };
    image.src = src;
    if (image.complete) {
      imageRef.current = image;
      scheduleDraw();
    }

    return () => {
      image.onload = null;
      if (imageRef.current === image) imageRef.current = null;
    };
  }, [blinded, scheduleDraw, src]);

  useEffect(() => {
    if (blinded) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(scheduleDraw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [blinded, scheduleDraw]);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
    };
  }, []);

  if (blinded) {
    return <BlindableCardImage src={src} alt="블러 퀴즈 카드" className="h-full w-full object-cover" />;
  }

  return (
    <div className="relative h-full w-full overflow-hidden bg-zinc-950 contain-paint">
      {!ready && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[radial-gradient(circle_at_50%_42%,rgba(14,165,233,0.28),rgba(2,6,23,0.96)_62%)] text-[10px] font-black tracking-[0.24em] text-cyan-100/80">
          <RefreshCw className="h-5 w-5 animate-spin text-cyan-200" />
          SIGNAL BUFFERING
        </div>
      )}
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={mode === 'motion' ? '방향형 모션 블러 처리된 퀴즈 카드' : '회전형 블러 처리된 퀴즈 카드'}
        className={`h-full w-full select-none pointer-events-none transition-opacity duration-150 ${ready ? 'opacity-100' : 'opacity-0'}`}
      />
    </div>
  );
};

const MotionBlurQuizImage: React.FC<{ src: string; intensity: number; angle: number }> = (props) => (
  <CanvasBlurQuizImage {...props} mode="motion" />
);

const RadialBlurQuizImage: React.FC<{ src: string; intensity: number; angle: number }> = (props) => (
  <CanvasBlurQuizImage {...props} mode="radial" />
);

const MosaicQuizImage: React.FC<{ src: string; intensity: number }> = ({ src, intensity }) => {
  const { isImageBlinded } = useApp();
  const blinded = isImageBlinded(src);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const imageRef = React.useRef<HTMLImageElement | null>(null);
  const intensityRef = React.useRef(intensity);

  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas || !image || !image.naturalWidth || !image.naturalHeight) return;

    const width = Math.max(1, Math.round(canvas.clientWidth));
    const height = Math.max(1, Math.round(canvas.clientHeight));
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const backingWidth = Math.round(width * pixelRatio);
    const backingHeight = Math.round(height * pixelRatio);

    if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
      canvas.width = backingWidth;
      canvas.height = backingHeight;
    }

    const context = canvas.getContext('2d');
    if (!context) return;

    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, width, height);

    // object-cover와 동일하게 중앙을 기준으로 원본의 표시 영역을 계산합니다.
    const sourceRatio = image.naturalWidth / image.naturalHeight;
    const targetRatio = width / height;
    let sourceWidth = image.naturalWidth;
    let sourceHeight = image.naturalHeight;
    let sourceX = 0;
    let sourceY = 0;

    if (sourceRatio > targetRatio) {
      sourceWidth = image.naturalHeight * targetRatio;
      sourceX = (image.naturalWidth - sourceWidth) / 2;
    } else {
      sourceHeight = image.naturalWidth / targetRatio;
      sourceY = (image.naturalHeight - sourceHeight) / 2;
    }

    const normalizedIntensity = Math.max(0, Math.min(100, intensityRef.current)) / 100;
    if (normalizedIntensity <= 0.01) {
      context.drawImage(
        image,
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
        0,
        0,
        width,
        height
      );
      return;
    }

    const blockSize = Math.max(
      2,
      Math.round(2 + normalizedIntensity * (QUIZ_MOSAIC_MAX_BLOCK_PX - 2))
    );
    context.imageSmoothingEnabled = false;

    for (let y = 0; y < height; y += blockSize) {
      const tileHeight = Math.min(blockSize, height - y);
      for (let x = 0; x < width; x += blockSize) {
        const tileWidth = Math.min(blockSize, width - x);
        const sampleX = sourceX + ((x + tileWidth / 2) / width) * sourceWidth;
        const sampleY = sourceY + ((y + tileHeight / 2) / height) * sourceHeight;

        // 원본의 한 지점을 각 블록 전체에 그려 실제 블록형 모자이크를 만듭니다.
        context.drawImage(
          image,
          Math.max(0, Math.min(image.naturalWidth - 1, Math.floor(sampleX))),
          Math.max(0, Math.min(image.naturalHeight - 1, Math.floor(sampleY))),
          1,
          1,
          x,
          y,
          tileWidth + 0.5,
          tileHeight + 0.5
        );
      }
    }
  }, []);

  useEffect(() => {
    intensityRef.current = intensity;
    drawCanvas();
  }, [drawCanvas, intensity]);

  useEffect(() => {
    imageRef.current = null;
    if (blinded) return;
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (canvas && context) {
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
    }

    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      imageRef.current = image;
      drawCanvas();
    };
    image.src = src;

    return () => {
      image.onload = null;
      if (imageRef.current === image) imageRef.current = null;
    };
  }, [blinded, drawCanvas, src]);

  useEffect(() => {
    if (blinded) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(drawCanvas);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [blinded, drawCanvas]);

  if (blinded) {
    return <BlindableCardImage src={src} alt="모자이크 퀴즈 카드" className="h-full w-full object-cover" />;
  }

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label="모자이크 처리된 퀴즈 카드"
      className="h-full w-full bg-zinc-950 select-none pointer-events-none"
    />
  );
};

const PUZZLE_ANIMATED_IMAGE_PATTERN = /\.(?:gif|webp|apng)(?:[?#]|$)/i;
type PuzzleStillFrameSource = HTMLImageElement | ImageBitmap;
const puzzleStillFrameCache = new Map<string, Promise<PuzzleStillFrameSource>>();

const isLikelyAnimatedPuzzleImage = (src: string) => PUZZLE_ANIMATED_IMAGE_PATTERN.test(src);

const loadPuzzleStillFrameSource = (src: string): Promise<PuzzleStillFrameSource> => {
  const cached = puzzleStillFrameCache.get(src);
  if (cached) return cached;

  const promise = (async (): Promise<PuzzleStillFrameSource> => {
    if (typeof fetch === 'function' && typeof createImageBitmap === 'function') {
      try {
        const response = await fetch(src, { cache: 'force-cache', credentials: 'same-origin' });
        if (response.ok) {
          const blob = await response.blob();
          return await createImageBitmap(blob, { imageOrientation: 'from-image' });
        }
      } catch {
        // Cross-origin image fetches can fail even when <img> display is allowed. Fall back to HTMLImageElement.
      }
    }

    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.decoding = 'async';
      image.fetchPriority = 'high';
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Failed to load puzzle still frame image.'));
      image.src = src;
    });
  })();

  puzzleStillFrameCache.set(src, promise);
  return promise;
};

const getPuzzleStillFrameSourceSize = (source: PuzzleStillFrameSource) => (
  source instanceof HTMLImageElement
    ? { width: source.naturalWidth, height: source.naturalHeight }
    : { width: source.width, height: source.height }
);

const drawPuzzlePieceStillFrame = (canvas: HTMLCanvasElement, source: PuzzleStillFrameSource, pieceId: number) => {
  const { width: sourceNaturalWidth, height: sourceNaturalHeight } = getPuzzleStillFrameSourceSize(source);
  if (!sourceNaturalWidth || !sourceNaturalHeight) return;

  const displaySize = Math.max(1, Math.round(canvas.clientWidth || 80));
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(displaySize * pixelRatio);
  canvas.height = Math.round(displaySize * pixelRatio);

  const context = canvas.getContext('2d');
  if (!context) return;

  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, displaySize, displaySize);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';

  const targetRatio = PUZZLE_COLUMNS / PUZZLE_ROWS;
  const sourceRatio = sourceNaturalWidth / sourceNaturalHeight;
  let cropWidth = sourceNaturalWidth;
  let cropHeight = sourceNaturalHeight;
  let cropX = 0;
  let cropY = 0;

  if (sourceRatio > targetRatio) {
    cropWidth = sourceNaturalHeight * targetRatio;
    cropX = (sourceNaturalWidth - cropWidth) / 2;
  } else {
    cropHeight = sourceNaturalWidth / targetRatio;
    cropY = (sourceNaturalHeight - cropHeight) / 2;
  }

  const column = pieceId % PUZZLE_COLUMNS;
  const row = Math.floor(pieceId / PUZZLE_COLUMNS);
  const sourcePieceWidth = cropWidth / PUZZLE_COLUMNS;
  const sourcePieceHeight = cropHeight / PUZZLE_ROWS;

  context.drawImage(
    source,
    cropX + column * sourcePieceWidth,
    cropY + row * sourcePieceHeight,
    sourcePieceWidth,
    sourcePieceHeight,
    0,
    0,
    displaySize,
    displaySize
  );
};

const PuzzlePieceImage: React.FC<{ src: string; pieceId: number }> = ({ src, pieceId }) => {
  const { isImageBlinded } = useApp();
  const blinded = isImageBlinded(src);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const stillSourceRef = React.useRef<PuzzleStillFrameSource | null>(null);
  const column = pieceId % PUZZLE_COLUMNS;
  const row = Math.floor(pieceId / PUZZLE_COLUMNS);
  const freezeAnimation = isLikelyAnimatedPuzzleImage(src);

  useEffect(() => {
    if (!freezeAnimation || !src || blinded) return;
    let cancelled = false;
    stillSourceRef.current = null;

    loadPuzzleStillFrameSource(src)
      .then((source) => {
        if (cancelled) return;
        stillSourceRef.current = source;
        const canvas = canvasRef.current;
        if (canvas) drawPuzzlePieceStillFrame(canvas, source, pieceId);
      })
      .catch(() => {
        stillSourceRef.current = null;
      });

    return () => {
      cancelled = true;
    };
  }, [blinded, freezeAnimation, pieceId, src]);

  useEffect(() => {
    if (!freezeAnimation || blinded) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const redraw = () => {
      const source = stillSourceRef.current;
      if (source) drawPuzzlePieceStillFrame(canvas, source, pieceId);
    };
    redraw();
    const observer = new ResizeObserver(redraw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [blinded, freezeAnimation, pieceId]);

  if (blinded) {
    return <BlindableCardImage src={src} alt="퍼즐 카드" className="h-full w-full object-cover" allowUnblind={false} />;
  }

  if (freezeAnimation) {
    return (
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full select-none"
      />
    );
  }

  return (
    <img
      src={src}
      alt=""
      draggable={false}
      aria-hidden="true"
      className="pointer-events-none absolute max-w-none select-none"
      style={{
        width: `${PUZZLE_COLUMNS * 100}%`,
        height: `${PUZZLE_ROWS * 100}%`,
        left: `${-column * 100}%`,
        top: `${-row * 100}%`,
        objectFit: 'cover',
        objectPosition: 'center'
      }}
    />
  );
};
const GameTimeLimit: React.FC<{
  timeLeft: number;
  totalSeconds: number;
  dangerSeconds: number;
  bonusLabel: string;
  pausedLabel?: string;
}> = ({ timeLeft, totalSeconds, dangerSeconds, bonusLabel, pausedLabel }) => (
  <div className="flex w-full max-w-2xl flex-col gap-2 px-1">
    <div className="flex items-center justify-between">
      {pausedLabel ? (
        <div className="flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-xs font-black text-emerald-400 shadow-sm animate-pulse sm:px-4 sm:py-2 sm:text-sm">
          <span>👀</span>
          <span>{pausedLabel}</span>
        </div>
      ) : (
        <div className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-black shadow-sm transition-all duration-300 sm:px-4 sm:py-2 sm:text-sm ${timeLeft <= dangerSeconds
          ? 'bg-rose-500/20 text-rose-400 border-rose-500/40 animate-bounce'
          : 'bg-secondary/80 text-foreground border-border/70'
          }`}>
          {timeLeft <= dangerSeconds ? (
            <span className="animate-pulse">🔥</span>
          ) : (
            <Timer className={`h-3.5 w-3.5 ${timeLeft <= dangerSeconds * 2 ? 'animate-spin' : ''} text-primary`} />
          )}
          <span>남은 시간: <strong className="cute-number-font text-sm sm:text-base">{timeLeft}</strong>초</span>
        </div>
      )}

      <div className="flex items-center gap-1 rounded-full border border-border/40 bg-secondary/50 px-2.5 py-1.5 text-[10px] font-extrabold text-muted-foreground sm:px-3.5 sm:py-2 sm:text-xs">
        <span>⏱️ {bonusLabel}</span>
      </div>
    </div>

    {!pausedLabel && (
      <div className="relative h-2 w-full overflow-hidden rounded-full border border-border/20 bg-secondary/60 shadow-inner sm:h-2.5">
        <div
          className={`h-full rounded-full transition-all duration-1000 ease-linear ${timeLeft <= dangerSeconds
            ? 'bg-gradient-to-r from-rose-500 to-red-600 shadow-[0_0_8px_rgba(239,68,68,0.5)]'
            : 'bg-gradient-to-r from-emerald-400 to-primary shadow-[0_0_8px_rgba(16,185,129,0.4)]'
            }`}
          style={{ width: `${Math.max(0, Math.min(100, (timeLeft / totalSeconds) * 100))}%` }}
        />
      </div>
    )}
  </div>
);

const normalizeRotation = (rotation: number) => ((rotation % 360) + 360) % 360;

const getRandomQuizBlurType = (previousType?: QuizBlurType | null): QuizBlurType => {
  const candidates = previousType
    ? QUIZ_BLUR_TYPES.filter((type) => type !== previousType)
    : QUIZ_BLUR_TYPES;
  return candidates[Math.floor(Math.random() * candidates.length)] || 'gaussian';
};

const isPuzzleSolved = (pieces: PuzzlePiece[]) =>
  pieces.length === PUZZLE_PIECE_COUNT &&
  pieces.every((piece, index) => piece.id === index && normalizeRotation(piece.rotation) === 0);

const shuffleNumbers = (values: number[]) => {
  const shuffled = [...values];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};

const createInitialPuzzlePieces = (): PuzzlePiece[] => {
  const shuffledIds = shuffleNumbers(Array.from({ length: PUZZLE_PIECE_COUNT }, (_, index) => index));

  if (shuffledIds.every((id, index) => id === index)) {
    [shuffledIds[0], shuffledIds[5]] = [shuffledIds[5], shuffledIds[0]];
  }

  const pieces = shuffledIds.map((id) => ({
    id,
    rotation: [0, 90, 180, 270][Math.floor(Math.random() * 4)]
  }));

  if (pieces.filter(piece => normalizeRotation(piece.rotation) !== 0).length < 3) {
    pieces[0] = { ...pieces[0], rotation: 90 };
    pieces[5] = { ...pieces[5], rotation: 180 };
    pieces[11] = { ...pieces[11], rotation: 270 };
  }

  return pieces;
};

const parseServerPuzzlePieces = (rawPieces: unknown): PuzzlePiece[] | null => {
  if (!Array.isArray(rawPieces) || rawPieces.length !== PUZZLE_PIECE_COUNT) return null;

  const seenIds = new Set<number>();
  const pieces: PuzzlePiece[] = [];
  for (const rawPiece of rawPieces) {
    const id = Number((rawPiece as PuzzlePiece | undefined)?.id);
    const rotation = Number((rawPiece as PuzzlePiece | undefined)?.rotation);
    if (
      !Number.isInteger(id) ||
      id < 0 ||
      id >= PUZZLE_PIECE_COUNT ||
      seenIds.has(id) ||
      !Number.isFinite(rotation)
    ) return null;
    seenIds.add(id);
    pieces.push({ id, rotation });
  }

  return seenIds.size === PUZZLE_PIECE_COUNT ? pieces : null;
};

const parseServerMatchDeck = (rawCards: MatchCardSource[] | undefined): MatchCard[] | null => {
  if (!Array.isArray(rawCards) || rawCards.length !== 12) return null;

  const cardIds = new Set<string>();
  const channelCounts = new Map<string, number>();
  const deck: MatchCard[] = [];
  for (const rawCard of rawCards) {
    const cardId = rawCard?.card_id === undefined || rawCard?.card_id === null
      ? ''
      : String(rawCard.card_id).trim();
    const channelId = String(rawCard?.channel_id || '').trim();
    const name = String(rawCard?.name || '').trim();
    if (!cardId || cardIds.has(cardId) || !channelId || !name) return null;

    cardIds.add(cardId);
    channelCounts.set(channelId, (channelCounts.get(channelId) || 0) + 1);
    deck.push({
      card_id: cardId,
      channel_id: channelId,
      name,
      logo_url: rawCard.logo_url,
      isFlipped: true,
      isMatched: false
    });
  }

  if (channelCounts.size !== 6 || Array.from(channelCounts.values()).some((count) => count !== 2)) return null;
  return deck;
};

const createLegacyPracticeMatchDeck = (rawCards: MatchCardSource[], sessionId: string): MatchCard[] | null => {
  if (
    rawCards.length !== 6 ||
    new Set(rawCards.map((card) => String(card?.channel_id || '').trim())).size !== 6
  ) return null;

  return [...rawCards, ...rawCards]
    .map((card, index) => ({
      ...card,
      card_id: `practice:${sessionId}:${index}`,
      isFlipped: true,
      isMatched: false
    }))
    .sort(() => 0.5 - Math.random());
};

const isRoundGame = (game: GameType | null): game is 'quiz' | 'value_duel' | 'crop_detective' =>
  game === 'quiz' || game === 'value_duel' || game === 'crop_detective';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object');

const isQuizChoice = (value: unknown): value is QuizChoice =>
  isRecord(value) &&
  typeof value.channel_id === 'string' && Boolean(value.channel_id.trim()) &&
  typeof value.name === 'string' && Boolean(value.name.trim());

const isArcadeCardOption = (value: unknown): value is ArcadeCardOption =>
  isRecord(value) &&
  typeof value.channel_id === 'string' && Boolean(value.channel_id.trim()) &&
  typeof value.name === 'string' && Boolean(value.name.trim()) &&
  typeof value.image_url === 'string' && Boolean(value.image_url.trim()) &&
  Number.isFinite(Number(value.star));

const hasUniqueChannelIds = (choices: Array<{ channel_id: string }>) =>
  new Set(choices.map((choice) => choice.channel_id.trim())).size === choices.length;

const isQuizRound = (round: unknown): round is QuizRound => {
  if (!isRecord(round) || !Number.isInteger(Number(round.round)) || Number(round.round) < 0) return false;
  if (typeof round.image_url !== 'string' || !round.image_url.trim() || !Array.isArray(round.choices)) return false;
  return round.choices.length === 2 && round.choices.every(isQuizChoice) && hasUniqueChannelIds(round.choices);
};

const isValueDuelRound = (round: unknown): round is ValueDuelRound => {
  if (!isRecord(round) || !Number.isInteger(Number(round.round)) || Number(round.round) < 0) return false;
  if (!isArcadeCardOption(round.left) || !isArcadeCardOption(round.right)) return false;
  return round.left.channel_id.trim() !== round.right.channel_id.trim();
};

const isCropDetectiveRound = (round: unknown): round is CropDetectiveRound => {
  if (!isRecord(round) || !Number.isInteger(Number(round.round)) || Number(round.round) < 0) return false;
  if (
    typeof round.source_image_url !== 'string' ||
    !round.source_image_url.trim() ||
    !isRecord(round.crop) ||
    !Number.isFinite(Number(round.crop.x)) ||
    !Number.isFinite(Number(round.crop.y)) ||
    !Number.isFinite(Number(round.crop.size)) ||
    Number(round.crop.size) <= 0 ||
    !Array.isArray(round.choices) ||
    round.choices.length !== 4 ||
    !round.choices.every(isArcadeCardOption)
  ) return false;
  return hasUniqueChannelIds(round.choices);
};

const isRoundForGame = (
  gameType: GameType,
  round: unknown
) => {
  if (gameType === 'quiz') return isQuizRound(round);
  if (gameType === 'value_duel') return isValueDuelRound(round);
  if (gameType === 'crop_detective') return isCropDetectiveRound(round);
  return false;
};

const getLocalRoundDeadline = (rawDeadline: unknown, serverClockOffsetMs: number): number | null => {
  if (typeof rawDeadline !== 'string' || !rawDeadline.trim()) return null;
  const serverDeadlineMs = Date.parse(rawDeadline);
  if (!Number.isFinite(serverDeadlineMs)) return null;
  const now = Date.now();
  const remainingMs = serverDeadlineMs - (now + serverClockOffsetMs);
  return now + Math.max(0, remainingMs);
};

const getVisibleRoundTimeLeft = (deadlineAt: number, now = Date.now()) =>
  Math.max(
    0,
    Math.min(ROUND_GAME_ROUND_SECONDS, Math.ceil((deadlineAt - now) / 1000))
  );

const clampCropValue = (value: number, min: number, max: number) => {
  if (max <= min) return 0.5;
  return Math.max(min, Math.min(max, value));
};

const CROP_DETECTIVE_CARD_ASPECT_RATIO = 5 / 8;

const getRotatedCropHalfExtent = (size: number, rotation: number) => {
  const radians = (rotation * Math.PI) / 180;
  return (size * (Math.abs(Math.cos(radians)) + Math.abs(Math.sin(radians)))) / 2;
};

const getCropDetectiveBounds = (size: number, rotation: number) => {
  const horizontalHalfExtent = getRotatedCropHalfExtent(size, rotation);
  const verticalHalfExtent = horizontalHalfExtent * CROP_DETECTIVE_CARD_ASPECT_RATIO;
  return {
    minX: Math.min(0.5, horizontalHalfExtent + 0.025),
    maxX: Math.max(0.5, 1 - horizontalHalfExtent - 0.025),
    minY: Math.min(0.5, verticalHalfExtent + 0.025),
    maxY: Math.max(0.5, 1 - verticalHalfExtent - 0.025)
  };
};

type ActiveMinigameSessionResponse = {
  active_session: StartGameResponse | null;
};

type CropDetectiveProgressSnapshot = {
  version: 1;
  userId: string;
  sessionId: string;
  roundIndex: number;
  roundAnswers: Array<{ round: number; selected_channel_id: string }>;
  roundCorrectCount: number;
  roundFeedback: RoundFeedback | null;
  roundTimeLeft?: number;
  roundDeadlineAt?: number | null;
  savedAt: number;
};

const CROP_PROGRESS_STORAGE_PREFIX = 'chikapo:crop-detective-progress:';
const cropProgressStorageKey = (userId: string, sessionId: string) =>
  `${CROP_PROGRESS_STORAGE_PREFIX}${userId}:${sessionId}`;

type ParsedServerRoundProgress = {
  nextRound: number;
  complete: boolean;
  correctCount: number;
  answers: Array<{ round: number; selected_channel_id: string }>;
};

type PaidRoundContract = {
  rounds: Array<QuizRound | ValueDuelRound | CropDetectiveRound>;
  totalRounds: number;
  currentRoundIndex: number;
  complete: boolean;
  progress: ParsedServerRoundProgress | null;
  localDeadlineAt: number | null;
  serverClockOffsetMs: number;
};

const parseServerRoundProgress = (
  rawProgress: StartGameResponse['round_progress'],
  totalRounds: number
): ParsedServerRoundProgress | null => {
  if (!rawProgress || !Array.isArray(rawProgress.outcomes)) return null;
  const nextRound = Number(rawProgress.next_round);
  const correctCount = Number(rawProgress.correct_count);
  if (
    !Number.isInteger(nextRound) ||
    nextRound < 0 ||
    nextRound > totalRounds ||
    !Number.isInteger(correctCount) ||
    correctCount < 0 ||
    correctCount > totalRounds ||
    rawProgress.outcomes.length !== nextRound
  ) return null;

  const outcomes = rawProgress.outcomes
    .map((outcome) => ({
      round: Number(outcome?.round),
      selected_channel_id: outcome?.selected_channel_id === null
        ? null
        : String(outcome?.selected_channel_id || '').trim()
    }))
    .sort((a, b) => a.round - b.round);
  if (outcomes.some((outcome, index) => (
    !Number.isInteger(outcome.round) ||
    outcome.round !== index ||
    (outcome.selected_channel_id !== null && !outcome.selected_channel_id)
  ))) return null;

  return {
    nextRound: Math.min(nextRound, Math.max(0, totalRounds - 1)),
    complete: nextRound === totalRounds,
    correctCount,
    answers: outcomes
      .filter((outcome): outcome is { round: number; selected_channel_id: string } => outcome.selected_channel_id !== null)
      .map((outcome) => ({ round: outcome.round, selected_channel_id: outcome.selected_channel_id }))
  };
};

const hasValidDisclosedRounds = (
  gameType: GameType,
  rounds: Array<QuizRound | ValueDuelRound | CropDetectiveRound>,
  expectedLength: number
) => (
  rounds.length === expectedLength &&
  rounds.every((round, index) => Number(round?.round) === index && isRoundForGame(gameType, round))
);

const parsePaidRoundContract = (
  data: StartGameResponse,
  gameType: GameType
): PaidRoundContract | null => {
  if (
    !isRoundGame(gameType) ||
    data.practice_mode === true ||
    typeof data.session_id !== 'string' ||
    !data.session_id.trim() ||
    !data.game_data ||
    !Array.isArray(data.game_data.rounds)
  ) return null;

  const totalRounds = Number(data.game_data.total_rounds);
  if (
    !Number.isInteger(totalRounds) ||
    totalRounds !== ROUND_GAME_TOTAL_ROUNDS ||
    (data.total_rounds !== undefined && Number(data.total_rounds) !== totalRounds) ||
    (data.game_type !== undefined && data.game_type !== gameType)
  ) return null;

  const serverNowMs = Date.parse(data.timing?.server_now || '');
  if (!Number.isFinite(serverNowMs)) return null;
  const clockOffsetMs = serverNowMs - Date.now();
  const resumed = data.resumed_session === true;
  let progress: ParsedServerRoundProgress | null = null;
  let currentRoundIndex = 0;
  let complete = false;
  let rawDeadline: unknown = Object.prototype.hasOwnProperty.call(data.game_data, 'round_deadline_at')
    ? data.game_data.round_deadline_at
    : data.round_deadline_at;
  let expectedDisclosedRounds = 1;

  if (resumed) {
    if (gameType !== 'crop_detective' || Number(data.round_progress?.total_rounds) !== totalRounds) return null;
    progress = parseServerRoundProgress(data.round_progress, totalRounds);
    if (!progress) return null;
    currentRoundIndex = progress.nextRound;
    complete = progress.complete;
    expectedDisclosedRounds = complete ? totalRounds : currentRoundIndex + 1;
    rawDeadline = Object.prototype.hasOwnProperty.call(data.round_progress || {}, 'round_deadline_at')
      ? data.round_progress?.round_deadline_at
      : rawDeadline;
  } else if (data.round_progress !== undefined) {
    return null;
  }

  const rounds = data.game_data.rounds;
  if (!hasValidDisclosedRounds(gameType, rounds, expectedDisclosedRounds)) return null;

  const localDeadlineAt = getLocalRoundDeadline(rawDeadline, clockOffsetMs);
  // A paid crop round is intentionally issued without a deadline. The image
  // renderer arms it exactly once, immediately before serving the protected
  // clue, so a failed or still-loading image cannot consume play time.
  if (!complete && localDeadlineAt === null) {
    if (gameType !== 'crop_detective' || rawDeadline !== null) return null;
  }

  return {
    rounds,
    totalRounds,
    currentRoundIndex,
    complete,
    progress,
    localDeadlineAt: complete ? null : localDeadlineAt,
    serverClockOffsetMs: clockOffsetMs
  };
};

const parsePracticeRoundTotal = (data: StartGameResponse, gameType: GameType): number | null => {
  if (!isRoundGame(gameType) || !Array.isArray(data.game_data?.rounds)) return null;
  const rounds = data.game_data.rounds;
  const declaredTotal = data.game_data.total_rounds === undefined
    ? rounds.length
    : Number(data.game_data.total_rounds);
  if (
    !Number.isInteger(declaredTotal) ||
    declaredTotal !== ROUND_GAME_TOTAL_ROUNDS ||
    (data.total_rounds !== undefined && Number(data.total_rounds) !== declaredTotal) ||
    !hasValidDisclosedRounds(gameType, rounds, declaredTotal)
  ) return null;
  return declaredTotal;
};

const clearCropDetectiveProgress = (userId?: string | null, sessionId?: string | null) => {
  if (typeof window === 'undefined' || !userId || !sessionId) return;
  try {
    window.sessionStorage.removeItem(cropProgressStorageKey(userId, sessionId));
  } catch {
    // Storage can be unavailable in private or restricted browsing contexts.
  }
};

const getCropDetectiveStillImage = (
  url?: string | null,
  width: number = CROP_DETECTIVE_IMAGE_REQUEST_PROFILES.choice.width,
  quality: number = CROP_DETECTIVE_IMAGE_REQUEST_PROFILES.choice.quality
) => {
  if (!url) return '/icon.png';
  return proxiedImage(url, { width, quality }) || '/icon.png';
};

const MINIGAME_IMAGE_REFERENCE_PREFIX = 'minigame-image:v1:';
const isProtectedMinigameImage = (url?: string | null) =>
  Boolean(url?.startsWith(MINIGAME_IMAGE_REFERENCE_PREFIX));
const resolveMinigameImage = (url?: string | null) => {
  if (!url) return '/icon.png';
  return isProtectedMinigameImage(url) ? (proxiedImage(url) || '/icon.png') : url;
};

const CROP_ANALYSIS_CANVAS_WIDTH = 240;
const CROP_ANALYSIS_CANVAS_HEIGHT = Math.round(CROP_ANALYSIS_CANVAS_WIDTH / CROP_DETECTIVE_CARD_ASPECT_RATIO);
const CROP_ALPHA_GRID_SIZE = 13;
const CROP_ALPHA_THRESHOLD = 40;
const CROP_MIN_OPAQUE_RATIO = 0.82;
const CROP_MIN_DETAIL_SCORE = 0.16;
const CROP_GOOD_CONTENT_SCORE = 0.52;
const CROP_ALPHA_CANDIDATE_COUNT = 64;
const CROP_IMAGE_BACKEND_RETRY_VARIANT = 2;
const CROP_IMAGE_PRELOAD_CACHE_LIMIT = 80;

const hashStringToSeed = (value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const createSeededRandom = (seed: number) => {
  let state = seed || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) / 4294967296);
  };
};

const buildCropCandidates = (
  baseX: number,
  baseY: number,
  bounds: { minX: number; maxX: number; minY: number; maxY: number },
  seedSource: string
) => {
  const clampX = (value: number) => clampCropValue(value, bounds.minX, bounds.maxX);
  const clampY = (value: number) => clampCropValue(value, bounds.minY, bounds.maxY);
  const random = createSeededRandom(hashStringToSeed(seedSource));
  const candidates: Array<{ x: number; y: number }> = [{ x: baseX, y: baseY }];
  const rangeX = Math.max(0, bounds.maxX - bounds.minX);
  const rangeY = Math.max(0, bounds.maxY - bounds.minY);
  const range = Math.max(rangeX, rangeY);
  const pushCandidate = (x: number, y: number) => {
    const candidate = { x: clampX(x), y: clampY(y) };
    const exists = candidates.some(item => Math.abs(item.x - candidate.x) < 0.001 && Math.abs(item.y - candidate.y) < 0.001);
    if (!exists) candidates.push(candidate);
  };

  for (const radiusRatio of [0.18, 0.32, 0.46]) {
    for (let step = 0; step < 6; step += 1) {
      const angle = random() * Math.PI * 2;
      const radius = range * radiusRatio * (0.55 + random() * 0.45);
      pushCandidate(baseX + Math.cos(angle) * radius, baseY + Math.sin(angle) * radius);
    }
  }

  let randomAttempts = 0;
  while (candidates.length < CROP_ALPHA_CANDIDATE_COUNT && randomAttempts < CROP_ALPHA_CANDIDATE_COUNT * 8) {
    pushCandidate(bounds.minX + random() * rangeX, bounds.minY + random() * rangeY);
    randomAttempts += 1;
  }

  pushCandidate(0.5, 0.5);
  return candidates;
};

type CropContentScore = {
  opaqueRatio: number;
  detailScore: number;
  score: number;
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const getCropContentScore = (
  imageData: ImageData,
  candidate: { x: number; y: number },
  size: number,
  rotation: number
): CropContentScore => {
  const { data, width, height } = imageData;
  const radians = (-rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const cropPixelSize = size * width;
  const centerX = candidate.x * width;
  const centerY = candidate.y * height;
  let opaque = 0;
  let total = 0;
  const samples: Array<{ opaque: boolean; r: number; g: number; b: number; luma: number }> = [];

  for (let row = 0; row < CROP_ALPHA_GRID_SIZE; row += 1) {
    for (let col = 0; col < CROP_ALPHA_GRID_SIZE; col += 1) {
      const dx = ((col + 0.5) / CROP_ALPHA_GRID_SIZE - 0.5) * cropPixelSize;
      const dy = ((row + 0.5) / CROP_ALPHA_GRID_SIZE - 0.5) * cropPixelSize;
      const sourceX = centerX + dx * cos - dy * sin;
      const sourceY = centerY + dx * sin + dy * cos;
      if (sourceX < 0 || sourceX >= width || sourceY < 0 || sourceY >= height) {
        samples.push({ opaque: false, r: 0, g: 0, b: 0, luma: 0 });
        total += 1;
        continue;
      }
      const pixelX = Math.min(width - 1, Math.max(0, Math.floor(sourceX)));
      const pixelY = Math.min(height - 1, Math.max(0, Math.floor(sourceY)));
      const offset = (pixelY * width + pixelX) * 4;
      const alpha = data[offset + 3];
      const isOpaque = alpha >= CROP_ALPHA_THRESHOLD;
      const r = data[offset];
      const g = data[offset + 1];
      const b = data[offset + 2];
      const luma = r * 0.299 + g * 0.587 + b * 0.114;
      if (isOpaque) opaque += 1;
      samples.push({ opaque: isOpaque, r, g, b, luma });
      total += 1;
    }
  }

  const opaqueRatio = total > 0 ? opaque / total : 0;
  if (opaque < 3) return { opaqueRatio, detailScore: 0, score: opaqueRatio * 0.2 };

  let rTotal = 0;
  let gTotal = 0;
  let bTotal = 0;
  let lumaTotal = 0;
  for (const sample of samples) {
    if (!sample.opaque) continue;
    rTotal += sample.r;
    gTotal += sample.g;
    bTotal += sample.b;
    lumaTotal += sample.luma;
  }

  const rMean = rTotal / opaque;
  const gMean = gTotal / opaque;
  const bMean = bTotal / opaque;
  const lumaMean = lumaTotal / opaque;
  let lumaVariance = 0;
  let chromaVariance = 0;
  for (const sample of samples) {
    if (!sample.opaque) continue;
    lumaVariance += (sample.luma - lumaMean) ** 2;
    chromaVariance += ((sample.r - rMean) ** 2 + (sample.g - gMean) ** 2 + (sample.b - bMean) ** 2) / 3;
  }

  const lumaStdDev = Math.sqrt(lumaVariance / opaque);
  const chromaStdDev = Math.sqrt(chromaVariance / opaque);
  let edgeTotal = 0;
  let edgeCount = 0;
  for (let row = 0; row < CROP_ALPHA_GRID_SIZE; row += 1) {
    for (let col = 0; col < CROP_ALPHA_GRID_SIZE; col += 1) {
      const index = row * CROP_ALPHA_GRID_SIZE + col;
      const sample = samples[index];
      if (!sample?.opaque) continue;
      const right = col + 1 < CROP_ALPHA_GRID_SIZE ? samples[index + 1] : null;
      const bottom = row + 1 < CROP_ALPHA_GRID_SIZE ? samples[index + CROP_ALPHA_GRID_SIZE] : null;
      if (right?.opaque) {
        edgeTotal += Math.abs(sample.luma - right.luma);
        edgeCount += 1;
      }
      if (bottom?.opaque) {
        edgeTotal += Math.abs(sample.luma - bottom.luma);
        edgeCount += 1;
      }
    }
  }

  const edgeMean = edgeCount > 0 ? edgeTotal / edgeCount : 0;
  const detailScore = clamp01(
    clamp01((lumaStdDev - 5) / 42) * 0.44 +
    clamp01(edgeMean / 36) * 0.42 +
    clamp01((chromaStdDev - 6) / 54) * 0.14
  );
  const score = opaqueRatio * 0.42 + detailScore * 0.58;
  return { opaqueRatio, detailScore, score };
};

const isCropContentGoodEnough = (contentScore: CropContentScore) =>
  contentScore.opaqueRatio >= CROP_MIN_OPAQUE_RATIO &&
  contentScore.detailScore >= CROP_MIN_DETAIL_SCORE &&
  contentScore.score >= CROP_GOOD_CONTENT_SCORE;

const drawImageCover = (
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  width: number,
  height: number
) => {
  const naturalWidth = Math.max(1, image.naturalWidth);
  const naturalHeight = Math.max(1, image.naturalHeight);
  const scale = Math.max(width / naturalWidth, height / naturalHeight);
  const renderedWidth = naturalWidth * scale;
  const renderedHeight = naturalHeight * scale;
  context.clearRect(0, 0, width, height);
  context.drawImage(
    image,
    (width - renderedWidth) / 2,
    (height - renderedHeight) / 2,
    renderedWidth,
    renderedHeight
  );
};

const getCropDetectiveRoundKey = (round: CropDetectiveRound) =>
  `${round.round}-${round.source_image_url}-${round.crop.x}-${round.crop.y}-${round.crop.size}-${round.crop.rotation || 0}`;

const withCropDetectiveRetryToken = (url: string, attempt: number) => {
  if (attempt <= 0 || !url || url.startsWith('data:') || url.startsWith('blob:')) return url;
  return `${url}${url.includes('?') ? '&' : '?'}retry=${Math.min(CROP_IMAGE_BACKEND_RETRY_VARIANT, attempt)}`;
};

const getCropDetectiveImageSources = (
  url?: string | null,
  fallbackUrl?: string | null,
  profile: { readonly width: number; readonly quality: number } = CROP_DETECTIVE_IMAGE_REQUEST_PROFILES.choice
): CropDetectiveImageSource[] => {
  const rawUrl = String(url || '/icon.png').trim() || '/icon.png';
  const originalProxyUrl = proxiedImage(rawUrl) || rawUrl;
  const isRelativeLocalUpload = /^\/?uploads\//i.test(rawUrl);
  let isAbsoluteLocalUpload = false;
  if (!isRelativeLocalUpload) {
    try {
      const baseOrigin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
      const sourceUrl = new URL(rawUrl, baseOrigin);
      const apiUrl = new URL(API_BASE_URL, baseOrigin);
      isAbsoluteLocalUpload = sourceUrl.origin === apiUrl.origin && sourceUrl.pathname.startsWith('/uploads/');
    } catch {
      // Malformed URLs continue through the proxy/raw fallback chain.
    }
  }
  return createCropDetectiveImageSourceChain({
    resizedProxyUrl: getCropDetectiveStillImage(rawUrl, profile.width, profile.quality),
    originalProxyUrl,
    rawUrl,
    backendFallbackUrl: fallbackUrl
      ? getCropDetectiveStillImage(fallbackUrl, profile.width, profile.quality)
      : withCropDetectiveRetryToken(originalProxyUrl, CROP_IMAGE_BACKEND_RETRY_VARIANT),
    fallbackSeed: rawUrl,
    preferOriginal: profile === CROP_DETECTIVE_IMAGE_REQUEST_PROFILES.preview && (isRelativeLocalUpload || isAbsoluteLocalUpload)
  });
};

type LoadedCropDetectiveImage = {
  url: string;
  image: HTMLImageElement | null;
  usedLocalFallback: boolean;
};

const cropDetectiveImagePreloadCache = new Map<string, Promise<HTMLImageElement | null>>();

const preloadCropDetectiveImage = (url: string, retainResolved = true) => {
  const cached = cropDetectiveImagePreloadCache.get(url);
  if (cached) return cached;

  const request = new Promise<HTMLImageElement | null>((resolve) => {
    const image = new Image();
    let settled = false;
    const finish = (result: HTMLImageElement | null) => {
      if (settled) return;
      settled = true;
      image.onload = null;
      image.onerror = null;
      resolve(result);
    };

    if (!url.startsWith('data:') && !url.startsWith('blob:')) image.crossOrigin = 'anonymous';
    image.decoding = 'async';
    image.onload = () => {
      const finishLoaded = () => finish(image.naturalWidth > 0 ? image : null);
      if (typeof image.decode !== 'function') {
        finishLoaded();
        return;
      }
      image.decode().then(finishLoaded).catch(finishLoaded);
    };
    image.onerror = () => finish(null);
    image.src = url;
  });

  cropDetectiveImagePreloadCache.set(url, request);
  void request.then((image) => {
    if ((!image || !retainResolved) && cropDetectiveImagePreloadCache.get(url) === request) {
      cropDetectiveImagePreloadCache.delete(url);
    }
  });
  if (cropDetectiveImagePreloadCache.size > CROP_IMAGE_PRELOAD_CACHE_LIMIT) {
    const oldestKey = cropDetectiveImagePreloadCache.keys().next().value;
    if (oldestKey) cropDetectiveImagePreloadCache.delete(oldestKey);
  }
  return request;
};

const useCropDetectiveImageSource = (
  generationKey: string,
  sources: readonly CropDetectiveImageSource[],
  timeoutMs: number = CROP_DETECTIVE_IMAGE_REQUEST_PROFILES.choice.timeoutMs,
  retainResolved: boolean = CROP_DETECTIVE_IMAGE_REQUEST_PROFILES.choice.retainResolved
): LoadedCropDetectiveImage | null => {
  const sourceSignature = sources.map((source) => `${source.kind}:${source.url}`).join('\u0001');
  const [loadedState, setLoadedState] = useState<{
    generationKey: string;
    sourceSignature: string;
    loaded: LoadedCropDetectiveImage | null;
  }>({ generationKey: '', sourceSignature: '', loaded: null });
  const currentLoaded = loadedState.generationKey === generationKey && loadedState.sourceSignature === sourceSignature
    ? loadedState.loaded
    : null;

  useEffect(() => {
    let cancelled = false;
    let timeoutId: number | null = null;
    const deadlineAt = Date.now() + Math.max(0, timeoutMs);

    const trySource = async (sourceIndex: number): Promise<void> => {
      if (cancelled) return;
      const source = sources[sourceIndex] || sources[sources.length - 1];
      if (!source) return;

      // A deterministic data URL has no network dependency, but it still has to
      // decode successfully before the round can be revealed and timed.
      if (source.guaranteed) {
        const image = await preloadCropDetectiveImage(source.url, true);
        if (cancelled || !image) return;
        setLoadedState({
          generationKey,
          sourceSignature,
          loaded: {
            url: source.url,
            image,
            usedLocalFallback: true
          }
        });
        return;
      }

      const remainingMs = deadlineAt - Date.now();
      if (remainingMs <= 0) {
        await trySource(sourceIndex + 1);
        return;
      }

      const timeout = new Promise<null>((resolve) => {
        timeoutId = window.setTimeout(() => resolve(null), remainingMs);
      });
      const image = await Promise.race([preloadCropDetectiveImage(source.url, retainResolved), timeout]);
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      timeoutId = null;
      if (cancelled) return;

      if (image) {
        setLoadedState({
          generationKey,
          sourceSignature,
          loaded: {
            url: source.url,
            image,
            usedLocalFallback: false
          }
        });
        return;
      }

      // Each asset advances independently; one failed card never poisons the round.
      await trySource(sourceIndex + 1);
    };

    void trySource(0);
    return () => {
      cancelled = true;
      if (timeoutId !== null) window.clearTimeout(timeoutId);
    };
  }, [generationKey, retainResolved, sourceSignature, sources, timeoutMs]);

  return currentLoaded;
};

const CardImageTile: React.FC<{
  card: ArcadeCardOption;
  imageUrlOverride?: string;
  selected?: boolean;
  correct?: boolean;
  wrong?: boolean;
  disabled?: boolean;
  imageBlindEnabled?: boolean;
  darkImageBackground?: boolean;
  showStarLabel?: boolean;
  freezeImage?: boolean;
  hideImageUntilRevealed?: boolean;
  onClick?: () => void;
}> = ({
  card,
  imageUrlOverride,
  selected = false,
  correct = false,
  wrong = false,
  disabled = false,
  imageBlindEnabled = false,
  darkImageBackground = false,
  showStarLabel = true,
  freezeImage = false,
  hideImageUntilRevealed = false,
  onClick
}) => {
  const imageUrl = imageUrlOverride || (
    freezeImage
      ? getCropDetectiveStillImage(card.image_url)
      : card.image_url || '/icon.png'
  );
  const nativeDisabled = disabled && !imageBlindEnabled;
  const shouldHideImage = hideImageUntilRevealed && !correct && !wrong;

  return (
    <button
      type="button"
      onClick={() => {
        if (disabled) return;
        onClick?.();
      }}
      onContextMenu={(event) => {
        if (!imageBlindEnabled) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      disabled={nativeDisabled}
      className={`cute-card-pop relative min-w-0 overflow-hidden rounded-2xl border bg-card text-left shadow-sm transition active:scale-95 disabled:pointer-events-none ${
        correct
          ? 'border-emerald-400 bg-emerald-500/12 ring-2 ring-emerald-400/50'
          : wrong
            ? 'border-rose-400 bg-rose-500/12 ring-2 ring-rose-400/50'
            : selected
              ? 'border-primary bg-primary/10 ring-2 ring-primary/35'
              : 'border-border hover:-translate-y-0.5 hover:border-primary/35'
      }`}
      title="우클릭으로 같은 이미지를 블라인드/해제"
    >
      <div className={`relative aspect-[5/8] w-full overflow-hidden ${darkImageBackground ? 'bg-zinc-950' : 'bg-secondary/50'}`}>
        <BlindableCardImage
          src={imageUrl}
          alt={card.name}
          className={`h-full w-full object-cover ${shouldHideImage ? 'opacity-0' : 'opacity-100'}`}
          decoding="async"
          draggable={false}
          imageBlindMenuEnabled={imageBlindEnabled}
          onError={(event) => {
            if (!event.currentTarget.src.endsWith('/icon.png')) {
              event.currentTarget.src = '/icon.png';
            }
          }}
        />
        {shouldHideImage ? (
          <div className="absolute inset-0 flex h-full w-full flex-col items-center justify-center gap-2 bg-[radial-gradient(circle_at_50%_25%,rgba(232,121,249,0.22),rgba(24,24,27,0.96)_68%)] px-3 text-center text-white">
            <RefreshCw className="h-6 w-6 animate-spin opacity-80" aria-hidden="true" />
            <span className="text-[10px] font-black text-white/80">후보 이미지 로딩</span>
          </div>
        ) : null}
      </div>
      <div className="px-2.5 py-2 sm:px-3">
        <p className="truncate text-[11px] font-black text-foreground sm:text-sm">{card.name}</p>
        {showStarLabel && (
          <p className="mt-0.5 text-[9px] font-bold text-muted-foreground">{card.star > 0 ? `${card.star}성 카드` : '기본 카드'}</p>
        )}
      </div>
    </button>
  );
};

type CropPreviewProps = {
  round: CropDetectiveRound;
  revealed: boolean;
  forceDeterministicFallback?: boolean;
  onPrepared?: (roundKey: string, options?: {
    forceLocalFallback?: boolean;
    localDeadlineAt?: number;
  }) => void;
  onLoadFailed?: (roundKey: string) => Promise<boolean>;
};

const ProtectedCropPreview: React.FC<CropPreviewProps> = ({
  round,
  revealed,
  forceDeterministicFallback = false,
  onPrepared,
  onLoadFailed
}) => {
  const roundKey = getCropDetectiveRoundKey(round);
  const primaryUrl = resolveMinigameImage(round.source_image_url);
  const requestUrl = forceDeterministicFallback && primaryUrl && primaryUrl !== '/icon.png'
    ? `${primaryUrl}${primaryUrl.includes('?') ? '&' : '?'}fallback=deterministic`
    : primaryUrl;
  const [displayUrl, setDisplayUrl] = useState('');
  const [forceLocalFallback, setForceLocalFallback] = useState(false);
  const [localDeadlineAt, setLocalDeadlineAt] = useState<number | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'loaded' | 'recovering'>(() =>
    !requestUrl || requestUrl === '/icon.png' ? 'recovering' : 'loading'
  );
  const [recoveryAttempt, setRecoveryAttempt] = useState(0);

  // Fetching the already-cropped image lets the browser read the server's
  // non-sensitive fallback-mode header. When the worker had to synthesize the
  // clue, all four candidate tiles switch to their matching deterministic
  // artwork, so an upstream outage can never create a clue with no valid answer.
  useEffect(() => {
    if (!requestUrl || requestUrl === '/icon.png') return;

    const controller = new AbortController();
    let cancelled = false;
    let objectUrl = '';
    const timeout = window.setTimeout(() => controller.abort(), 8_000);
    void fetch(requestUrl, {
      credentials: 'include',
      cache: 'no-store',
      signal: controller.signal
    }).then(async (response) => {
      if (!response.ok) throw new Error(`protected crop ${response.status}`);
      const serverDeadlineMs = Date.parse(response.headers.get('X-Minigame-Round-Deadline') || '');
      const serverNowMs = Date.parse(response.headers.get('X-Minigame-Server-Now') || '');
      if (!Number.isFinite(serverDeadlineMs) || !Number.isFinite(serverNowMs)) {
        throw new Error('protected crop timing headers are missing');
      }
      const responseLocalDeadlineAt = Date.now() + Math.max(0, serverDeadlineMs - serverNowMs);
      const responseUsesDeterministicFallback =
        response.headers.get('X-Minigame-Image-Fallback') === 'deterministic';
      if (forceDeterministicFallback && !responseUsesDeterministicFallback) {
        throw new Error('protected crop fallback mode mismatch');
      }
      const blob = await response.blob();
      if (!blob.type.startsWith('image/')) throw new Error('protected crop is not an image');
      if (cancelled) return;
      objectUrl = URL.createObjectURL(blob);
      setForceLocalFallback(responseUsesDeterministicFallback);
      setLocalDeadlineAt(responseLocalDeadlineAt);
      setDisplayUrl(objectUrl);
    }).catch(() => {
      if (!cancelled) setLoadState('recovering');
    }).finally(() => window.clearTimeout(timeout));

    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timeout);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [forceDeterministicFallback, requestUrl]);

  useEffect(() => {
    if (loadState !== 'recovering' || !onLoadFailed) return;
    let cancelled = false;
    const retryDelayMs = recoveryAttempt === 0
      ? 0
      : Math.min(10_000, 750 * (2 ** Math.min(recoveryAttempt - 1, 4)));
    const timeout = window.setTimeout(() => {
      void onLoadFailed(roundKey)
        .then((recovered) => {
          if (!cancelled && !recovered) setRecoveryAttempt((attempt) => attempt + 1);
        })
        .catch(() => {
          if (!cancelled) setRecoveryAttempt((attempt) => attempt + 1);
        });
    }, retryDelayMs);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [loadState, onLoadFailed, recoveryAttempt, roundKey]);

  return (
    <div
      role="img"
      aria-label="확대된 카드 이미지 조각"
      aria-busy={loadState === 'loading' || loadState === 'recovering'}
      className="relative aspect-square w-[min(20rem,58vw)] overflow-hidden rounded-[1.75rem] border border-fuchsia-300/45 bg-zinc-950 shadow-[0_18px_45px_rgba(192,38,211,0.2)]"
      onContextMenu={(event) => event.preventDefault()}
    >
      {displayUrl ? (
        // The protected response was fetched with the httpOnly session cookie;
        // a local object URL prevents a second network request before reveal.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={displayUrl}
          alt=""
          className={`absolute inset-0 h-full w-full object-cover transition-opacity ${revealed && loadState === 'loaded' ? 'opacity-100' : 'opacity-0'}`}
          draggable={false}
          onLoad={() => {
            if (localDeadlineAt === null) {
              setLoadState('recovering');
              return;
            }
            setLoadState('loaded');
            onPrepared?.(roundKey, { forceLocalFallback, localDeadlineAt });
          }}
          onError={() => {
            URL.revokeObjectURL(displayUrl);
            setDisplayUrl('');
            setLoadState('recovering');
          }}
        />
      ) : null}
      {loadState === 'recovering' ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[radial-gradient(circle_at_50%_32%,rgba(217,70,239,0.2),rgba(9,9,11,0.98)_70%)] px-5 text-center text-white">
          <RefreshCw className="h-7 w-7 animate-spin text-fuchsia-300" aria-hidden="true" />
          <span className="text-xs font-black text-white/90">확대 이미지 자동 복구 중</span>
          <span className="text-[10px] font-bold text-white/60">연결을 확인한 뒤 현재 라운드를 안전하게 이어갑니다.</span>
        </div>
      ) : !revealed ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[radial-gradient(circle_at_50%_32%,rgba(217,70,239,0.2),rgba(9,9,11,0.98)_70%)] text-white">
          <RefreshCw className="h-7 w-7 animate-spin text-fuchsia-300" aria-hidden="true" />
          <span className="text-[10px] font-black tracking-wide text-white/75">확대 이미지 준비 중</span>
        </div>
      ) : null}
      <div className="pointer-events-none absolute inset-0 border-[10px] border-white/8" />
      {revealed && loadState === 'loaded' ? (
        <div className="pointer-events-none absolute left-3 top-3 rounded-full border border-white/20 bg-black/45 px-2 py-1 text-[9px] font-black tracking-[0.14em] text-white/80">
          ZOOM CROP
        </div>
      ) : null}
    </div>
  );
};

const ClientCropPreview: React.FC<CropPreviewProps> = ({ round, revealed, onPrepared }) => {
  const size = Math.max(0.04, Math.min(0.5, Number(round.crop?.size || 0.08)));
  const rotation = ((Math.floor(Number(round.crop?.rotation || 0)) % 360) + 360) % 360;
  const cropBounds = getCropDetectiveBounds(size, rotation);
  const { minX, maxX, minY, maxY } = cropBounds;
  const x = clampCropValue(Number(round.crop?.x || 0.5), minX, maxX);
  const y = clampCropValue(Number(round.crop?.y || 0.5), minY, maxY);
  const roundKey = getCropDetectiveRoundKey(round);
  const generationKey = `${roundKey}:crop`;
  const sources = useMemo(
    () => getCropDetectiveImageSources(
      round.source_image_url,
      round.source_fallback_image_url,
      CROP_DETECTIVE_IMAGE_REQUEST_PROFILES.preview
    ),
    [round.source_fallback_image_url, round.source_image_url]
  );
  const loadedSource = useCropDetectiveImageSource(
    generationKey,
    sources,
    CROP_DETECTIVE_IMAGE_REQUEST_PROFILES.preview.timeoutMs,
    CROP_DETECTIVE_IMAGE_REQUEST_PROFILES.preview.retainResolved
  );
  const localFallbackUrl = sources[sources.length - 1]?.url || '/icon.png';
  const [previewState, setPreviewState] = useState<{
    roundKey: string;
    imageUrl: string;
    cropX: number;
    cropY: number;
  }>({ roundKey: '', imageUrl: '', cropX: 0.5, cropY: 0.5 });
  const currentPreview = previewState.roundKey === roundKey ? previewState : null;
  const preparedRoundRef = useRef('');

  const notifyPrepared = useCallback(() => {
    if (preparedRoundRef.current === roundKey) return;
    preparedRoundRef.current = roundKey;
    onPrepared?.(roundKey);
  }, [onPrepared, roundKey]);

  useEffect(() => {
    if (!loadedSource) return;
    let cancelled = false;
    const applyDirectPreview = (crop: { x: number; y: number }) => {
      queueMicrotask(() => {
        if (cancelled) return;
        setPreviewState({
          roundKey,
          imageUrl: loadedSource.url,
          cropX: crop.x,
          cropY: crop.y
        });
        notifyPrepared();
      });
    };

    try {
      if (!loadedSource.image || typeof document === 'undefined') {
        applyDirectPreview({ x, y });
        return () => {
          cancelled = true;
        };
      }

      const displayCanvas = document.createElement('canvas');
      displayCanvas.width = CROP_ANALYSIS_CANVAS_WIDTH;
      displayCanvas.height = CROP_ANALYSIS_CANVAS_HEIGHT;
      const context = displayCanvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('Crop detective canvas is unavailable.');

      drawImageCover(context, loadedSource.image, displayCanvas.width, displayCanvas.height);
      const imageData = context.getImageData(0, 0, displayCanvas.width, displayCanvas.height);
      const candidates = buildCropCandidates(
        x,
        y,
        { minX, maxX, minY, maxY },
        `${round.source_image_url}:${round.round}:${size}:${rotation}:${x}:${y}`
      );
      let bestCrop = { x, y };
      let bestScore = getCropContentScore(imageData, bestCrop, size, rotation);
      let bestGoodCrop: { x: number; y: number } | null = null;
      let bestGoodScore = -1;
      for (const candidate of candidates) {
        const contentScore = getCropContentScore(imageData, candidate, size, rotation);
        if (contentScore.score > bestScore.score) {
          bestScore = contentScore;
          bestCrop = candidate;
        }
        if (isCropContentGoodEnough(contentScore) && contentScore.score > bestGoodScore) {
          bestGoodScore = contentScore.score;
          bestGoodCrop = candidate;
        }
      }

      // Keep the small canvas for content analysis only. Rendering the decoded
      // high-resolution source directly avoids a 12-24px -> 640px upscale and
      // a second lossy WebP encoding pass.
      applyDirectPreview(bestGoodCrop || bestCrop);
    } catch {
      // Canvas can be unavailable or tainted even after a successful image load. The
      // clipped CSS transform preserves the clue without exposing the full answer.
      applyDirectPreview({ x, y });
    }

    return () => {
      cancelled = true;
    };
  }, [loadedSource, maxX, maxY, minX, minY, notifyPrepared, rotation, round.round, round.source_image_url, roundKey, size, x, y]);

  const previewGeometry = createCropDetectiveCssCropGeometry({
    x: currentPreview?.cropX ?? x,
    y: currentPreview?.cropY ?? y,
    size,
    rotation,
    aspectRatio: CROP_DETECTIVE_CARD_ASPECT_RATIO
  });
  return (
    <div
      role="img"
      aria-label="확대된 카드 이미지 조각"
      aria-busy={!revealed || !currentPreview}
      className="relative aspect-square w-[min(20rem,58vw)] overflow-hidden rounded-[1.75rem] border border-fuchsia-300/45 bg-zinc-950 shadow-[0_18px_45px_rgba(192,38,211,0.2)]"
      onContextMenu={(event) => event.preventDefault()}
    >
      {currentPreview ? (
        <div
          className={`absolute inset-0 ${revealed ? 'opacity-100' : 'opacity-0'}`}
          style={{
            transform: `rotate(${previewGeometry.rotationDegrees}deg)`,
            transformOrigin: '50% 50%'
          }}
        >
          <img
            src={currentPreview.imageUrl}
            alt=""
            className="absolute max-w-none object-cover"
            draggable={false}
            style={{
              width: `${previewGeometry.widthPercent}%`,
              height: `${previewGeometry.heightPercent}%`,
              left: `${previewGeometry.leftPercent}%`,
              top: `${previewGeometry.topPercent}%`,
              objectPosition: 'center'
            }}
            onError={(event) => {
              const element = event.currentTarget;
              if (element.dataset.localFallbackApplied === 'true') return;
              element.dataset.localFallbackApplied = 'true';
              element.src = localFallbackUrl;
            }}
          />
        </div>
      ) : null}
      {!revealed || !currentPreview ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[radial-gradient(circle_at_50%_32%,rgba(217,70,239,0.2),rgba(9,9,11,0.98)_70%)] text-white">
          <RefreshCw className="h-7 w-7 animate-spin text-fuchsia-300" aria-hidden="true" />
          <span className="text-[10px] font-black tracking-wide text-white/75">확대 영역 분석 중</span>
        </div>
      ) : null}
      <div className="pointer-events-none absolute inset-0 border-[10px] border-white/8" />
      {revealed && currentPreview ? (
        <div className="pointer-events-none absolute left-3 top-3 rounded-full border border-white/20 bg-black/45 px-2 py-1 text-[9px] font-black tracking-[0.14em] text-white/80">
          ZOOM CROP
        </div>
      ) : null}
    </div>
  );
};

const CropPreview: React.FC<CropPreviewProps> = (props) =>
  isProtectedMinigameImage(props.round.source_image_url)
    ? <ProtectedCropPreview {...props} />
    : <ClientCropPreview {...props} />;

const CropDetectiveChoiceTile: React.FC<{
  roundKey: string;
  card: ArcadeCardOption;
  selected: boolean;
  correct: boolean;
  wrong: boolean;
  disabled: boolean;
  imageBlindEnabled: boolean;
  hideImageUntilRevealed: boolean;
  forceLocalFallback: boolean;
  onSettled: (
    assetId: string,
    settledRoundKey: string,
    options: { deterministic: boolean; usedLocalFallback: boolean }
  ) => void;
  onClick: () => void;
}> = ({
  roundKey,
  card,
  selected,
  correct,
  wrong,
  disabled,
  imageBlindEnabled,
  hideImageUntilRevealed,
  forceLocalFallback,
  onSettled,
  onClick
}) => {
  const assetId = `choice:${card.channel_id}`;
  const generationKey = `${roundKey}:${assetId}`;
  const sources = useMemo(
    () => getCropDetectiveImageSources(card.image_url, card.fallback_image_url),
    [card.fallback_image_url, card.image_url]
  );
  const loadedSource = useCropDetectiveImageSource(generationKey, sources);
  const localFallbackSources = useMemo(
    () => sources.length > 0 ? [sources[sources.length - 1]] : [],
    [sources]
  );
  const localLoadedSource = useCropDetectiveImageSource(
    `${generationKey}:deterministic`,
    localFallbackSources,
    CROP_DETECTIVE_IMAGE_REQUEST_PROFILES.choice.timeoutMs,
    true
  );
  const effectiveLoadedSource = forceLocalFallback ? localLoadedSource : loadedSource;
  const effectiveGenerationKey = `${generationKey}:${forceLocalFallback ? 'deterministic' : 'normal'}`;
  const localFallbackUrl = localLoadedSource?.url || sources[sources.length - 1]?.url || '/icon.png';
  const lastSettledGenerationRef = useRef('');

  useEffect(() => {
    if (!effectiveLoadedSource || lastSettledGenerationRef.current === effectiveGenerationKey) return;
    lastSettledGenerationRef.current = effectiveGenerationKey;
    onSettled(assetId, roundKey, {
      deterministic: forceLocalFallback,
      usedLocalFallback: effectiveLoadedSource.usedLocalFallback
    });
  }, [
    assetId,
    effectiveGenerationKey,
    effectiveLoadedSource,
    forceLocalFallback,
    onSettled,
    roundKey
  ]);

  return (
    <CardImageTile
      card={card}
      imageUrlOverride={effectiveLoadedSource?.url || localFallbackUrl}
      selected={selected}
      correct={correct}
      wrong={wrong}
      disabled={disabled}
      imageBlindEnabled={imageBlindEnabled}
      darkImageBackground
      freezeImage
      hideImageUntilRevealed={hideImageUntilRevealed}
      onClick={onClick}
    />
  );
};

const CropDetectiveChoices: React.FC<{
  round: CropDetectiveRound;
  roundFeedback: RoundFeedback | null;
  roundChecking: boolean;
  gameBusy: boolean;
  isGameOver: boolean;
  countdownLeft: number | null;
  skipProtectedImage: boolean;
  onRoundReady: (roundKey: string, options?: { localDeadlineAt?: number }) => void;
  onRoundImageFailed: (roundKey: string) => Promise<boolean>;
  onChoice: (channelId: string) => void;
}> = ({
  round,
  roundFeedback,
  roundChecking,
  gameBusy,
  isGameOver,
  countdownLeft,
  skipProtectedImage,
  onRoundReady,
  onRoundImageFailed,
  onChoice
}) => {
  const roundKey = getCropDetectiveRoundKey(round);
  const requiredChoiceAssetIds = useMemo(
    () => round.choices.map((choice) => `choice:${choice.channel_id}`),
    [round.choices]
  );
  const [settledState, setSettledState] = useState<{
    roundKey: string;
    assetIds: string[];
    deterministicAssetIds: string[];
    localFallbackDetected: boolean;
  }>({ roundKey: '', assetIds: [], deterministicAssetIds: [], localFallbackDetected: false });
  const [cropFallbackState, setCropFallbackState] = useState<{
    roundKey: string;
    forceLocalFallback: boolean;
  }>({ roundKey: '', forceLocalFallback: false });
  const [cropDeadlineState, setCropDeadlineState] = useState<{
    roundKey: string;
    localDeadlineAt: number | null;
  }>({ roundKey: '', localDeadlineAt: null });
  const currentSettledState: {
    assetIds: string[];
    deterministicAssetIds: string[];
    localFallbackDetected: boolean;
  } = settledState.roundKey === roundKey
    ? settledState
    : { assetIds: [], deterministicAssetIds: [], localFallbackDetected: false };
  const cropUsesLocalFallback =
    cropFallbackState.roundKey === roundKey && cropFallbackState.forceLocalFallback;
  const forceDeterministicClue = currentSettledState.localFallbackDetected;
  const forceLocalFallback = forceDeterministicClue || cropUsesLocalFallback;
  const choiceSettlementIds = forceLocalFallback
    ? currentSettledState.deterministicAssetIds
    : currentSettledState.assetIds;
  const choicesReady = areCropDetectiveAssetsSettled(requiredChoiceAssetIds, choiceSettlementIds);
  const cropReady = currentSettledState.assetIds.includes('crop');
  const protectedRound = isProtectedMinigameImage(round.source_image_url);
  const completedResume = roundFeedback?.locked === true;
  const allImagesReady = choicesReady && (completedResume || skipProtectedImage || cropReady);
  const canRequestProtectedCrop =
    choicesReady &&
    !skipProtectedImage &&
    !roundChecking &&
    !roundFeedback &&
    (countdownLeft === null || countdownLeft <= 0);
  const selectedId = roundFeedback?.selected_channel_id || null;
  const correctIds = roundFeedback?.correct_channel_ids || [];

  const handleAssetSettled = useCallback((
    assetId: string,
    settledRoundKey: string,
    options: { deterministic?: boolean; usedLocalFallback?: boolean } = {}
  ) => {
    if (settledRoundKey !== roundKey) return;
    setSettledState((previous) => {
      const current = previous.roundKey === roundKey
        ? previous
        : { roundKey, assetIds: [], deterministicAssetIds: [], localFallbackDetected: false };
      const assetIds = current.assetIds.includes(assetId)
        ? current.assetIds
        : [...current.assetIds, assetId];
      const deterministicAssetIds = options.deterministic && !current.deterministicAssetIds.includes(assetId)
        ? [...current.deterministicAssetIds, assetId]
        : current.deterministicAssetIds;
      const localFallbackDetected = current.localFallbackDetected || (
        assetId.startsWith('choice:') && options.usedLocalFallback === true
      );
      if (
        assetIds === current.assetIds &&
        deterministicAssetIds === current.deterministicAssetIds &&
        localFallbackDetected === current.localFallbackDetected
      ) return previous;
      return { roundKey, assetIds, deterministicAssetIds, localFallbackDetected };
    });
  }, [roundKey]);
  const handleCropSettled = useCallback((
    settledRoundKey: string,
    options?: { forceLocalFallback?: boolean; localDeadlineAt?: number }
  ) => {
    if (settledRoundKey === roundKey) {
      setCropFallbackState({
        roundKey,
        forceLocalFallback: options?.forceLocalFallback === true
      });
      setCropDeadlineState({
        roundKey,
        localDeadlineAt: Number.isFinite(options?.localDeadlineAt)
          ? Number(options?.localDeadlineAt)
          : null
      });
    }
    handleAssetSettled('crop', settledRoundKey);
  }, [handleAssetSettled, roundKey]);

  useEffect(() => {
    if (allImagesReady && !completedResume && !skipProtectedImage) {
      onRoundReady(roundKey, {
        localDeadlineAt: cropDeadlineState.roundKey === roundKey
          ? cropDeadlineState.localDeadlineAt ?? undefined
          : undefined
      });
    }
  }, [allImagesReady, completedResume, cropDeadlineState, onRoundReady, roundKey, skipProtectedImage]);

  const hideImages = !roundFeedback && !allImagesReady;
  const choiceDisabled = hideImages || Boolean(roundFeedback) || roundChecking || gameBusy || isGameOver || (countdownLeft !== null && countdownLeft > 0);

  return (
    <div className="contents" data-crop-detective-ready={allImagesReady ? 'true' : 'false'}>
      {completedResume || skipProtectedImage ? (
        <div
          role="img"
          aria-label={completedResume ? '저장된 확대 탐정 라운드' : '시간 초과 처리 중인 확대 탐정 라운드'}
          className="relative flex aspect-square w-[min(20rem,58vw)] flex-col items-center justify-center gap-2 overflow-hidden rounded-[1.75rem] border border-emerald-300/45 bg-zinc-950 text-white shadow-[0_18px_45px_rgba(16,185,129,0.16)]"
        >
          <Gamepad2 className="h-8 w-8 text-emerald-300" aria-hidden="true" />
          <span className="text-xs font-black text-white/90">
            {completedResume ? '저장된 라운드 확인 완료' : '시간 초과 결과 저장 중'}
          </span>
        </div>
      ) : !protectedRound || canRequestProtectedCrop ? (
        <CropPreview
          key={roundKey}
          round={round}
          revealed={allImagesReady || Boolean(roundFeedback)}
          forceDeterministicFallback={forceDeterministicClue}
          onPrepared={handleCropSettled}
          onLoadFailed={onRoundImageFailed}
        />
      ) : (
        <div
          role="img"
          aria-label="확대 이미지 준비 중"
          aria-busy="true"
          className="relative flex aspect-square w-[min(20rem,58vw)] flex-col items-center justify-center gap-2 overflow-hidden rounded-[1.75rem] border border-fuchsia-300/45 bg-zinc-950 text-white shadow-[0_18px_45px_rgba(192,38,211,0.2)]"
        >
          <RefreshCw className="h-7 w-7 animate-spin text-fuchsia-300" aria-hidden="true" />
          <span className="text-[10px] font-black tracking-wide text-white/75">
            {choicesReady ? '게임 시작 준비 중' : '후보 이미지 준비 중'}
          </span>
        </div>
      )}

      {!allImagesReady && !roundFeedback ? (
        <p role="status" className="text-center text-[10px] font-black text-fuchsia-700 dark:text-fuchsia-300">
          확대 이미지와 후보 카드 4장을 안전하게 준비하고 있습니다.
        </p>
      ) : null}

      <div className="grid w-full max-w-4xl grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-4">
        {round.choices.map((choice) => {
          const selected = selectedId === choice.channel_id;
          const correct = correctIds.includes(choice.channel_id);
          const wrong = selected && roundFeedback?.correct === false;
          return (
            <CropDetectiveChoiceTile
              key={choice.channel_id}
              roundKey={roundKey}
              card={choice}
              selected={selected}
              correct={correct}
              wrong={wrong}
              disabled={choiceDisabled}
              imageBlindEnabled={Boolean(roundFeedback)}
              hideImageUntilRevealed={hideImages}
              forceLocalFallback={forceLocalFallback}
              onSettled={handleAssetSettled}
              onClick={() => onChoice(choice.channel_id)}
            />
          );
        })}
      </div>
    </div>
  );
};

export const ArcadeTab: React.FC = () => {
  const { user, refreshUserData, toast, blindImage, unblindImage, isImageBlinded } = useApp();
  const currentUserId = user?.id || null;
  const searchParams = useSearchParams();
  const router = useRouter();
  const autoStartRef = useRef(false); // URL 파라미터 기반 연습 자동 시작 1회 가드
  const activeResumeCheckedUserRef = useRef<string | null>(null);
  const activeSessionRestoreAllowedRef = useRef(true);
  const [loading, setLoading] = useState(true);
  const [tickets, setTickets] = useState(0);
  const [baseTickets, setBaseTickets] = useState(0);
  const [bonusTickets, setBonusTickets] = useState(0);
  const [secondsUntilNext, setSecondsUntilNext] = useState(0);
  const [todayGame, setTodayGame] = useState<GameType | null>(null);
  const [todayKstDate, setTodayKstDate] = useState('');
  const [nextGameAt, setNextGameAt] = useState('');
  const [secondsUntilGameChange, setSecondsUntilGameChange] = useState(0);
  const [activeGame, setActiveGame] = useState<GameType | null>(null);
  const [isPracticeMode, setIsPracticeMode] = useState(false);
  const [isPracticeExpanded, setIsPracticeExpanded] = useState(false);

  // 게임 세션 관련 상태
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [gameData, setGameData] = useState<MinigameData | null>(null);
  const [gameBusy, setGameBusy] = useState(false);
  const submitInFlightRef = useRef(false);
  const [submitRetry, setSubmitRetry] = useState<SubmitRetryState | null>(null);

  // 공통 결과 화면 상태
  const [gameResult, setGameResult] = useState<MinigameResult | null>(null);
  const [reportCard, setReportCard] = useState<ReportTargetCard | null>(null);

  useEffect(() => {
    if (!gameResult) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [gameResult]);

  // 공통 카운트다운 및 시간 제어 상태
  const [countdownLeft, setCountdownLeft] = useState<number | null>(null);

  // 1. 인물 퀴즈 전용 상태 (블러 퀴즈로 고도화)
  const [quizStartTime, setQuizStartTime] = useState<number>(0);
  const [quizBlurType, setQuizBlurType] = useState<QuizBlurType>('gaussian');
  const [quizBlurAngle, setQuizBlurAngle] = useState<number>(0);
  const [quizIntensity, setQuizIntensity] = useState<number>(100);

  // 2. 카드 퍼즐 전용 상태
  const [puzzlePieces, setPuzzlePieces] = useState<PuzzlePiece[]>([]);
  const [puzzleMoves, setPuzzleMoves] = useState<PuzzleMove[]>([]);
  const puzzleMovesRef = useRef<PuzzleMove[]>([]);
  const [puzzleUsesServerLayout, setPuzzleUsesServerLayout] = useState(false);
  const [draggingPuzzleIndex, setDraggingPuzzleIndex] = useState<number | null>(null);
  const [dragOverPuzzleIndex, setDragOverPuzzleIndex] = useState<number | null>(null);
  const [puzzleTimeLeft, setPuzzleTimeLeft] = useState(PUZZLE_TIME_LIMIT_SECONDS);
  const [puzzleHintUsed, setPuzzleHintUsed] = useState(false);
  const [showPuzzleHint, setShowPuzzleHint] = useState(false);
  const puzzleDeadlineRef = useRef<number | null>(null);
  const puzzleDragRef = React.useRef<{ index: number; startX: number; startY: number; dragging: boolean } | null>(null);
  const puzzleHintTimeoutRef = React.useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (puzzleHintTimeoutRef.current !== null) {
        window.clearTimeout(puzzleHintTimeoutRef.current);
      }
    };
  }, []);

  // 3. 카드 뒤집기 전용 상태
  const [matchCards, setMatchCards] = useState<MatchCard[]>([]);
  const [matchedPairs, setMatchedPairs] = useState<MatchedPair[]>([]);
  const [matchUsesServerDeck, setMatchUsesServerDeck] = useState(false);
  const [flippedIndices, setFlippedIndices] = useState<number[]>([]);
  const [revealActive, setRevealActive] = useState(false); // 시작 시 2초 공개 중인지 여부
  const [gameTimeLeft, setGameTimeLeft] = useState(MATCH_TIME_LIMIT_SECONDS);
  const [isGameOver, setIsGameOver] = useState(false);
  const matchDeadlineRef = useRef<number | null>(null);
  const matchActionTimeoutsRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    const timeouts = matchActionTimeoutsRef.current;
    return () => {
      timeouts.forEach((timeoutId) => window.clearTimeout(timeoutId));
      timeouts.clear();
    };
  }, []);

  // 4. 5라운드형 게임 공통 상태 (시세 듀얼 / 카드 확대 탐정)
  const [roundIndex, setRoundIndex] = useState(0);
  const [roundTotalRounds, setRoundTotalRounds] = useState(ROUND_GAME_TOTAL_ROUNDS);
  const [roundAnswers, setRoundAnswers] = useState<Array<{ round: number; selected_channel_id: string }>>([]);
  const [roundFeedback, setRoundFeedback] = useState<RoundFeedback | null>(null);
  const [roundCorrectCount, setRoundCorrectCount] = useState(0);
  const [roundTimeLeft, setRoundTimeLeft] = useState(ROUND_GAME_ROUND_SECONDS);
  const [roundChecking, setRoundChecking] = useState(false);
  const [roundStartBusy, setRoundStartBusy] = useState(false);
  const [roundTimeoutRetryAttempt, setRoundTimeoutRetryAttempt] = useState(0);
  const roundDeadlineRef = useRef<number | null>(null);
  const [roundDeadlineSyncAt, setRoundDeadlineSyncAt] = useState<number | null>(null);
  const [roundSubmissionKey, setRoundSubmissionKey] = useState<string | null>(null);
  const [serverClockOffsetMs, setServerClockOffsetMs] = useState(0);
  const [pendingPaidRound, setPendingPaidRound] = useState<PendingPaidRound | null>(null);
  const roundStartInFlightRef = useRef(false);
  const roundStartRequestRef = useRef(0);
  const [cropDetectiveReadyKey, setCropDetectiveReadyKey] = useState('');
  const [imageBlindMenu, setImageBlindMenu] = useState<{ x: number; y: number; imageUrl: string } | null>(null);
  const currentCropDetectiveRound = activeGame === 'crop_detective'
    ? gameData?.rounds?.[roundIndex]
    : undefined;
  const currentCropDetectiveRoundKey = isCropDetectiveRound(currentCropDetectiveRound)
    ? getCropDetectiveRoundKey(currentCropDetectiveRound)
    : '';
  const cropImageRecoveryRequestRef = useRef(0);
  const cropImageRecoveryAttemptsRef = useRef<Map<string, number>>(new Map());
  const autoSubmittedCompletedSessionsRef = useRef<Set<string>>(new Set());
  const cropImageRecoveryContextRef = useRef({
    activeGame,
    sessionId,
    roundIndex,
    roundKey: currentCropDetectiveRoundKey
  });
  useEffect(() => {
    cropImageRecoveryContextRef.current = {
      activeGame,
      sessionId,
      roundIndex,
      roundKey: currentCropDetectiveRoundKey
    };
  }, [activeGame, currentCropDetectiveRoundKey, roundIndex, sessionId]);
  const cropDetectiveRoundReady = Boolean(
    currentCropDetectiveRoundKey && cropDetectiveReadyKey === currentCropDetectiveRoundKey
  );

  useEffect(() => {
    if (roundDeadlineSyncAt !== null) roundDeadlineRef.current = roundDeadlineSyncAt;
  }, [roundDeadlineSyncAt]);

  useEffect(() => () => {
    cropImageRecoveryRequestRef.current += 1;
  }, []);

  const handleCropDetectiveRoundReady = useCallback((
    roundKey: string,
    options: { localDeadlineAt?: number } = {}
  ) => {
    if (roundKey !== currentCropDetectiveRoundKey) return;
    if (!isPracticeMode) {
      const localDeadlineAt = Number(options.localDeadlineAt);
      if (!Number.isFinite(localDeadlineAt)) return;
      roundDeadlineRef.current = localDeadlineAt;
      setRoundDeadlineSyncAt(localDeadlineAt);
      setRoundTimeLeft(getVisibleRoundTimeLeft(localDeadlineAt));
    }
    cropImageRecoveryAttemptsRef.current.delete(`${sessionId || ''}:${roundIndex}`);
    setCropDetectiveReadyKey((previousKey) => previousKey === roundKey ? previousKey : roundKey);
  }, [currentCropDetectiveRoundKey, isPracticeMode, roundIndex, sessionId]);

  useEffect(() => {
    const userId = user?.id;
    if (
      typeof window === 'undefined' ||
      !userId ||
      !sessionId ||
      activeGame !== 'crop_detective' ||
      isPracticeMode ||
      gameResult
    ) return;
    const snapshot: CropDetectiveProgressSnapshot = {
      version: 1,
      userId,
      sessionId,
      roundIndex,
      roundAnswers,
      roundCorrectCount,
      roundFeedback,
      roundTimeLeft,
      roundDeadlineAt: roundFeedback ? null : roundDeadlineRef.current,
      savedAt: Date.now()
    };
    try {
      window.sessionStorage.setItem(cropProgressStorageKey(userId, sessionId), JSON.stringify(snapshot));
    } catch {
      // Session recovery remains available from the server even when storage is unavailable.
    }
  }, [activeGame, gameResult, isPracticeMode, roundAnswers, roundCorrectCount, roundFeedback, roundIndex, roundTimeLeft, sessionId, user?.id]);

  useEffect(() => {
    if (!imageBlindMenu) return;
    const close = () => setImageBlindMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [imageBlindMenu]);

  const openImageBlindMenu = (event: React.MouseEvent, imageUrl: string, enabled: boolean) => {
    event.preventDefault();
    event.stopPropagation();
    if (!enabled || !imageUrl) return;
    setImageBlindMenu({
      x: Math.min(event.clientX, window.innerWidth - 220),
      y: Math.min(event.clientY, window.innerHeight - 96),
      imageUrl
    });
  };

  // 티켓 상태 조회 API 호출
  const fetchStatus = useCallback(async (): Promise<TicketStatusResponse | null> => {
    try {
      const res = await apiFetch('/minigames/status');
      if (res.ok) {
        const data = (await res.json()) as TicketStatusResponse;
        setTickets(data.current_tickets);
        setBaseTickets(data.base_tickets ?? Math.min(data.current_tickets, data.max_tickets ?? 5));
        setBonusTickets(data.bonus_tickets ?? Math.max(0, data.current_tickets - (data.max_tickets ?? 5)));
        setSecondsUntilNext(data.seconds_until_next_ticket);
        setTodayGame(data.today_game);
        setTodayKstDate(data.kst_date);
        setNextGameAt(data.next_game_at);
        setSecondsUntilGameChange(data.seconds_until_game_change);
        return data;
      }
      return null;
    } catch (err) {
      console.error('티켓 조회 실패:', err);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchActiveCropDetectiveSession = useCallback(async (): Promise<StartGameResponse | null> => {
    try {
      const res = await apiFetch('/minigames/active?game_type=crop_detective');
      if (!res.ok) return null;
      const data = (await res.json()) as ActiveMinigameSessionResponse;
      return data.active_session || null;
    } catch (err) {
      console.error('진행 중인 확대 탐정 조회 실패:', err);
      return null;
    }
  }, []);

  const restoreCropDetectiveSession = useCallback((
    data: StartGameResponse,
    options: { silent?: boolean } = {}
  ): boolean => {
    const contract = parsePaidRoundContract(data, 'crop_detective');
    if (!contract || !data.resumed_session || !contract.progress) {
      toast('진행 중인 카드 확대 탐정의 서버 검증 데이터를 확인할 수 없어 복구를 중단했습니다.', 'error');
      return false;
    }

    const serverProgress = contract.progress;
    const restoredRoundIndex = contract.currentRoundIndex;
    const restoredFeedback: RoundFeedback | null = contract.complete
      ? {
          round: restoredRoundIndex,
          correct: false,
          correct_channel_ids: [],
          locked: true
        }
      : null;
    const restoredTimeLeft = contract.localDeadlineAt === null
      ? ROUND_GAME_ROUND_SECONDS
      : getVisibleRoundTimeLeft(contract.localDeadlineAt);
    const restoredRound = contract.rounds[restoredRoundIndex];
    const expiredRoundKey = !contract.complete &&
      contract.localDeadlineAt !== null &&
      restoredTimeLeft <= 0 &&
      isCropDetectiveRound(restoredRound)
        ? getCropDetectiveRoundKey(restoredRound)
        : '';
    submitInFlightRef.current = false;
    setRoundSubmissionKey(null);
    setSubmitRetry(null);
    setSessionId(data.session_id);
    setGameData({
      ...data.game_data,
      rounds: contract.rounds,
      total_rounds: contract.totalRounds
    });
    setActiveGame('crop_detective');
    setIsPracticeMode(false);
    setGameResult(null);
    setIsGameOver(false);
    setRoundIndex(restoredRoundIndex);
    setRoundTotalRounds(contract.totalRounds);
    setPendingPaidRound(null);
    setServerClockOffsetMs(contract.serverClockOffsetMs);
    setRoundAnswers(serverProgress.answers);
    setRoundFeedback(restoredFeedback);
    setRoundCorrectCount(Math.max(0, Math.min(
      contract.totalRounds,
      serverProgress.correctCount
    )));
    setRoundChecking(false);
    setRoundTimeoutRetryAttempt(0);
    setRoundDeadlineSyncAt(contract.localDeadlineAt);
    setRoundTimeLeft(restoredTimeLeft);
    // An already-armed expired round must submit its authoritative timeout
    // without requesting (and repeatedly failing to re-arm) the clue image.
    setCropDetectiveReadyKey(expiredRoundKey);
    puzzleMovesRef.current = [];
    setPuzzleMoves([]);
    setPuzzleUsesServerLayout(false);
    setMatchedPairs([]);
    setMatchUsesServerDeck(false);
    matchActionTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
    matchActionTimeoutsRef.current.clear();
    roundDeadlineRef.current = contract.localDeadlineAt;
    setCountdownLeft(0);
    if (!options.silent) {
      toast(data.message || '진행 중이던 카드 확대 탐정을 복구했습니다.', 'info');
    }
    return true;
  }, [toast]);

  const handleCropDetectiveImageFailure = useCallback(async (failedRoundKey: string): Promise<boolean> => {
    if (
      isPracticeMode ||
      activeGame !== 'crop_detective' ||
      !sessionId ||
      failedRoundKey !== currentCropDetectiveRoundKey
    ) return false;

    const recoveryRequestId = ++cropImageRecoveryRequestRef.current;
    const recoveryKey = `${sessionId}:${roundIndex}`;
    const recoveryAttempt = cropImageRecoveryAttemptsRef.current.get(recoveryKey) || 0;
    cropImageRecoveryAttemptsRef.current.set(recoveryKey, recoveryAttempt + 1);
    const retryDelayMs = recoveryAttempt === 0
      ? 0
      : Math.min(10_000, 750 * (2 ** Math.min(recoveryAttempt - 1, 4)));
    if (retryDelayMs > 0) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, retryDelayMs));
    }

    const contextBeforeFetch = cropImageRecoveryContextRef.current;
    if (
      recoveryRequestId !== cropImageRecoveryRequestRef.current ||
      contextBeforeFetch.activeGame !== 'crop_detective' ||
      contextBeforeFetch.sessionId !== sessionId ||
      contextBeforeFetch.roundIndex !== roundIndex ||
      contextBeforeFetch.roundKey !== failedRoundKey
    ) return false;

    const activeSession = await fetchActiveCropDetectiveSession();
    const latestContext = cropImageRecoveryContextRef.current;
    if (
      recoveryRequestId !== cropImageRecoveryRequestRef.current ||
      latestContext.activeGame !== 'crop_detective' ||
      latestContext.sessionId !== sessionId ||
      latestContext.roundIndex !== roundIndex ||
      latestContext.roundKey !== failedRoundKey
    ) return false;
    if (!activeSession || activeSession.session_id !== sessionId) {
      return false;
    }
    return restoreCropDetectiveSession(activeSession, { silent: true });
  }, [
    activeGame,
    currentCropDetectiveRoundKey,
    fetchActiveCropDetectiveSession,
    isPracticeMode,
    restoreCropDetectiveSession,
    roundIndex,
    sessionId
  ]);

  const resetGameView = useCallback(() => {
    cropImageRecoveryRequestRef.current += 1;
    cropImageRecoveryAttemptsRef.current.clear();
    autoSubmittedCompletedSessionsRef.current.clear();
    roundStartRequestRef.current += 1;
    roundStartInFlightRef.current = false;
    submitInFlightRef.current = false;
    setRoundSubmissionKey(null);
    setSubmitRetry(null);
    setActiveGame(null);
    setGameData(null);
    setGameResult(null);
    setSessionId(null);
    setIsGameOver(false);
    setIsPracticeMode(false);
    setPuzzleHintUsed(false);
    setShowPuzzleHint(false);
    puzzleMovesRef.current = [];
    setPuzzleMoves([]);
    setPuzzleUsesServerLayout(false);
    setMatchedPairs([]);
    setMatchUsesServerDeck(false);
    matchActionTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
    matchActionTimeoutsRef.current.clear();
    setRoundIndex(0);
    setRoundTotalRounds(ROUND_GAME_TOTAL_ROUNDS);
    setPendingPaidRound(null);
    setServerClockOffsetMs(0);
    setRoundAnswers([]);
    setRoundFeedback(null);
    setRoundCorrectCount(0);
    setRoundChecking(false);
    setRoundStartBusy(false);
    setRoundTimeoutRetryAttempt(0);
    setRoundDeadlineSyncAt(null);
    setRoundTimeLeft(ROUND_GAME_ROUND_SECONDS);
    setCropDetectiveReadyKey('');
    puzzleDeadlineRef.current = null;
    matchDeadlineRef.current = null;
    roundDeadlineRef.current = null;
    if (puzzleHintTimeoutRef.current !== null) {
      window.clearTimeout(puzzleHintTimeoutRef.current);
      puzzleHintTimeoutRef.current = null;
    }
  }, []);

  // 완료·명시적 포기처럼 현재 진행도를 더 이상 복구하지 않을 때 사용합니다.
  const handleExitGame = useCallback(() => {
    clearCropDetectiveProgress(currentUserId, sessionId);
    resetGameView();
  }, [currentUserId, resetGameView, sessionId]);

  const handleAbandonGame = useCallback(async () => {
    if (!sessionId || isPracticeMode) {
      handleExitGame();
      return;
    }
    setGameBusy(true);
    try {
      const res = await apiFetch('/minigames/abandon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(data.message || '미니게임 포기 처리에 실패했습니다.', 'error');
        return;
      }
      handleExitGame();
      fetchStatus();
    } catch {
      toast('연결 문제로 미니게임을 포기하지 못했습니다. 다시 시도해 주세요.', 'warning');
    } finally {
      setGameBusy(false);
    }
  }, [fetchStatus, handleExitGame, isPracticeMode, sessionId, toast]);

  const restoreActiveTimer = useCallback((remainingMs: number) => {
    const safeRemainingMs = Math.max(0, Math.floor(remainingMs));
    const remainingSeconds = Math.max(0, Math.ceil(safeRemainingMs / 1000));
    const deadline = Date.now() + safeRemainingMs;

    if (activeGame === 'quiz') {
      setRoundTimeLeft(ROUND_GAME_ROUND_SECONDS);
      roundDeadlineRef.current = Date.now() + ROUND_GAME_ROUND_SECONDS * 1000;
    } else if (activeGame === 'puzzle') {
      setPuzzleTimeLeft(remainingSeconds);
      puzzleDeadlineRef.current = deadline;
    } else if (activeGame === 'match') {
      setGameTimeLeft(remainingSeconds);
      matchDeadlineRef.current = deadline;
    } else if (isRoundGame(activeGame)) {
      setRoundTimeLeft(ROUND_GAME_ROUND_SECONDS);
      roundDeadlineRef.current = Date.now() + ROUND_GAME_ROUND_SECONDS * 1000;
    }
  }, [activeGame]);

  // 게임 결과 제출 처리 (치팅 방지를 위해 백엔드에서 서버 시간 2중 검증함)
  const submitResult = useCallback(async (payload: SubmitPayload) => {
    if (!sessionId) return;
    if (submitInFlightRef.current) return;
    const isTerminalSuccess = payload.success === true && (activeGame === 'puzzle' || activeGame === 'match');
    const isRoundSettlement = isRoundGame(activeGame) && Array.isArray(payload.answers);
    const shouldRetrySettlement = isTerminalSuccess || isRoundSettlement;
    if (isTerminalSuccess) {
      setIsGameOver(true);
    }
    const clientRemainingMs =
      activeGame === 'puzzle' ? Math.max(0, puzzleTimeLeft * 1000)
          : activeGame === 'match' ? Math.max(0, gameTimeLeft * 1000)
            : 0;
    submitInFlightRef.current = true;
    setGameBusy(true);
    try {
      const res = await apiFetch('/minigames/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          payload: {
            ...payload,
            client_remaining_ms: clientRemainingMs,
            client_submitted_at: new Date().toISOString()
          }
        })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setSubmitRetry(null);
        setGameResult(data as MinigameResult);
        if (activeGame === 'crop_detective') clearCropDetectiveProgress(currentUserId, sessionId);
        if (!data.practice_mode) refreshUserData(); // 일반 게임에서만 보유 자산 갱신
      } else if (shouldRetrySettlement && res.status >= 500) {
        setSubmitRetry(prev => ({ payload, attempt: (prev?.attempt || 0) + 1 }));
      } else {
        toast(data.message || '결과 처리 중 에러가 발생했습니다.', 'error');
        handleExitGame();
      }
    } catch {
      if (shouldRetrySettlement) {
        setSubmitRetry(prev => ({ payload, attempt: (prev?.attempt || 0) + 1 }));
        return;
      }
      toast('결과 전송에 실패했습니다. 연결이 복구되면 다시 시도해 주세요.', 'warning');
      restoreActiveTimer(clientRemainingMs);
      if (isRoundGame(activeGame)) {
        setRoundFeedback(null);
      }
    } finally {
      submitInFlightRef.current = false;
      setGameBusy(false);
    }
  }, [activeGame, currentUserId, gameTimeLeft, handleExitGame, puzzleTimeLeft, refreshUserData, restoreActiveTimer, sessionId, toast]);

  // If all five authoritative outcomes were stored before a refresh or response
  // loss, finish the idempotent settlement automatically instead of requiring a
  // clue fetch or another button click that could strand the consumed ticket.
  useEffect(() => {
    if (
      activeGame !== 'crop_detective' ||
      isPracticeMode ||
      !sessionId ||
      !roundFeedback?.locked ||
      roundIndex < roundTotalRounds - 1 ||
      gameResult
    ) return;
    if (autoSubmittedCompletedSessionsRef.current.has(sessionId)) return;
    autoSubmittedCompletedSessionsRef.current.add(sessionId);
    void submitResult({ answers: roundAnswers });
  }, [
    activeGame,
    gameResult,
    isPracticeMode,
    roundAnswers,
    roundFeedback?.locked,
    roundIndex,
    roundTotalRounds,
    sessionId,
    submitResult
  ]);

  const submitRoundAnswer = useCallback(async (
    selectedChannelId: string | null,
    timedOut = false
  ) => {
    if (!sessionId || !isRoundGame(activeGame)) return;
    const selected = String(selectedChannelId || '').trim();
    if (!timedOut && !selected) return;
    if (
      gameBusy ||
      roundChecking ||
      roundFeedback ||
      gameResult ||
      isGameOver ||
      (!timedOut && roundTimeLeft <= 0) ||
      (countdownLeft !== null && countdownLeft > 0)
    ) return;

    const submissionKey = `${sessionId}:${roundIndex}`;
    if (roundSubmissionKey === submissionKey) return;
    setRoundSubmissionKey(submissionKey);
    setRoundChecking(true);

    const handleTimedOutSubmissionFailure = () => {
      setRoundSubmissionKey(null);
      if (isPracticeMode) {
        setRoundFeedback({
          round: roundIndex,
          correct: false,
          correct_channel_ids: [],
          timed_out: true
        });
        return;
      }

      const retrySeconds = Math.min(5, 2 ** Math.min(roundTimeoutRetryAttempt, 3));
      setRoundTimeoutRetryAttempt((attempt) => attempt + 1);
      setRoundTimeLeft(retrySeconds);
      setRoundDeadlineSyncAt(Date.now() + retrySeconds * 1000);
    };

    try {
      const res = await apiFetch('/minigames/round-answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          payload: {
            round: roundIndex,
            ...(timedOut ? { timed_out: true } : { selected_channel_id: selected })
          }
        })
      });
      const data = await res.json().catch(() => ({})) as RoundAnswerResponse;
      if (!res.ok) {
        if (timedOut) {
          if (isPracticeMode || roundTimeoutRetryAttempt === 0) {
            toast(data.message || '시간 초과 결과를 저장하지 못했습니다. 잠시 후 다시 시도합니다.', 'warning');
          }
          handleTimedOutSubmissionFailure();
        } else {
          setRoundSubmissionKey(null);
          toast(data.message || '라운드 결과 확인에 실패했습니다.', 'error');
        }
        return;
      }

      setRoundTimeoutRetryAttempt(0);
      setRoundDeadlineSyncAt(null);
      if (!timedOut) {
        setRoundAnswers(prev => {
          const withoutCurrent = prev.filter(answer => answer.round !== roundIndex);
          return [...withoutCurrent, { round: roundIndex, selected_channel_id: selected }];
        });
      }
      if (!timedOut && data.correct) setRoundCorrectCount(prev => prev + 1);
      setRoundFeedback({
        round: roundIndex,
        ...(selected ? { selected_channel_id: selected } : {}),
        correct: timedOut ? false : Boolean(data.correct),
        correct_channel_ids: Array.isArray(data.correct_channel_ids) ? data.correct_channel_ids : [],
        timed_out: timedOut || Boolean(data.timed_out)
      });

      if (!isPracticeMode) {
        const responseTotalRounds = Number(data.total_rounds);
        const expectedNextIndex = roundIndex + 1;
        const hasNextRound = expectedNextIndex < roundTotalRounds;
        const nextRound = data.next_round === null ? null : data.next_round;
        const responseServerNowMs = Date.parse(data.server_now || '');
        const nextServerClockOffsetMs = Number.isFinite(responseServerNowMs)
          ? responseServerNowMs - Date.now()
          : serverClockOffsetMs;
        const nextLocalDeadline = getLocalRoundDeadline(
          data.next_round_deadline_at,
          nextServerClockOffsetMs
        );
        const validNextRound = Boolean(
          nextRound &&
          isRoundForGame(activeGame, nextRound) &&
          Number(nextRound.round) === expectedNextIndex
        );
        const validDeferredValueDuelProtocol =
          activeGame === 'value_duel' &&
          data.has_next_round === hasNextRound &&
          data.next_round === null &&
          data.next_round_deadline_at === null;
        const validProtocol =
          Number.isInteger(responseTotalRounds) &&
          responseTotalRounds === roundTotalRounds &&
          (activeGame === 'value_duel'
            ? validDeferredValueDuelProtocol
            : hasNextRound
              ? validNextRound && (
                  activeGame === 'crop_detective'
                    ? data.next_round_deadline_at === null && nextLocalDeadline === null
                    : nextLocalDeadline !== null
                )
              : data.next_round === null);

        if (!validProtocol) {
          setPendingPaidRound(null);
          setIsGameOver(true);
          toast('다음 라운드의 서버 검증 데이터를 확인할 수 없어 진행을 중단했습니다.', 'error');
          return;
        }

        if (activeGame === 'value_duel') {
          setPendingPaidRound(hasNextRound
            ? { roundIndex: expectedNextIndex, localDeadlineAt: null }
            : null);
        } else if (nextRound) {
          setServerClockOffsetMs(nextServerClockOffsetMs);
          setGameData((previousData) => {
            if (!previousData) return previousData;
            const rounds = [...(previousData.rounds || []).filter((round) => round.round !== nextRound.round), nextRound]
              .sort((left, right) => left.round - right.round);
            return { ...previousData, rounds, total_rounds: responseTotalRounds };
          });
          setPendingPaidRound({ roundIndex: expectedNextIndex, localDeadlineAt: nextLocalDeadline });
        } else {
          setPendingPaidRound(null);
        }
      }
    } catch {
      if (timedOut) {
        if (isPracticeMode || roundTimeoutRetryAttempt === 0) {
          toast('시간 초과 결과를 저장하지 못했습니다. 연결이 복구되면 다시 시도합니다.', 'warning');
        }
        handleTimedOutSubmissionFailure();
      } else {
        setRoundSubmissionKey(null);
        toast('라운드 결과 확인에 실패했습니다.', 'warning');
      }
    } finally {
      setRoundChecking(false);
    }
  }, [activeGame, countdownLeft, gameBusy, gameResult, isGameOver, isPracticeMode, roundChecking, roundFeedback, roundIndex, roundSubmissionKey, roundTimeLeft, roundTimeoutRetryAttempt, roundTotalRounds, serverClockOffsetMs, sessionId, toast]);

  const advanceToPaidRound = useCallback((
    pendingRound: PendingPaidRound,
    disclosedRound?: QuizRound | ValueDuelRound | CropDetectiveRound
  ) => {
    if (!isRoundGame(activeGame)) return;
    const nextRound = disclosedRound || gameData?.rounds?.find((round) => round.round === pendingRound.roundIndex);
    if (!isRoundForGame(activeGame, nextRound) || nextRound.round !== pendingRound.roundIndex) {
      setIsGameOver(true);
      toast('서버가 공개한 다음 라운드를 확인할 수 없어 진행을 중단했습니다.', 'error');
      return;
    }

    setPendingPaidRound(null);
    setRoundIndex(pendingRound.roundIndex);
    setRoundSubmissionKey(null);
    setRoundTimeoutRetryAttempt(0);
    setRoundFeedback(null);
    setRoundDeadlineSyncAt(pendingRound.localDeadlineAt);
    roundDeadlineRef.current = pendingRound.localDeadlineAt;
    setRoundTimeLeft(pendingRound.localDeadlineAt === null
      ? ROUND_GAME_ROUND_SECONDS
      : getVisibleRoundTimeLeft(pendingRound.localDeadlineAt));
    if (activeGame === 'crop_detective') setCropDetectiveReadyKey('');
    if (activeGame === 'quiz') {
      setQuizStartTime(Date.now());
      setQuizIntensity(100);
      setQuizBlurType((previousType) => getRandomQuizBlurType(previousType));
      setQuizBlurAngle(Math.floor(Math.random() * 360));
    }
  }, [activeGame, gameData?.rounds, toast]);

  useEffect(() => {
    if (activeGame === 'value_duel' || isPracticeMode || !pendingPaidRound || !roundFeedback || isGameOver) return;
    const timer = window.setTimeout(() => advanceToPaidRound(pendingPaidRound), 450);
    return () => window.clearTimeout(timer);
  }, [activeGame, advanceToPaidRound, isGameOver, isPracticeMode, pendingPaidRound, roundFeedback]);

  useEffect(() => {
    if (!submitRetry || gameResult || !sessionId) return;
    const retryDelayMs = Math.min(5000, 1200 + submitRetry.attempt * 600);
    const retryTimer = window.setTimeout(() => {
      submitResult(submitRetry.payload);
    }, retryDelayMs);
    return () => window.clearTimeout(retryTimer);
  }, [gameResult, sessionId, submitResult, submitRetry]);

  useEffect(() => {
    const userId = user?.id || null;
    if (!userId) {
      activeResumeCheckedUserRef.current = null;
      activeSessionRestoreAllowedRef.current = true;
      return;
    }
    const shouldCheckActiveSession = activeResumeCheckedUserRef.current !== userId;
    if (shouldCheckActiveSession) activeSessionRestoreAllowedRef.current = true;
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      const activeSessionPromise = shouldCheckActiveSession
        ? fetchActiveCropDetectiveSession()
        : Promise.resolve(null);
      Promise.all([fetchStatus(), activeSessionPromise]).then(([, activeSession]) => {
        if (cancelled) return;
        if (shouldCheckActiveSession) activeResumeCheckedUserRef.current = userId;
        if (activeSession && activeSessionRestoreAllowedRef.current) {
          activeSessionRestoreAllowedRef.current = false;
          restoreCropDetectiveSession(activeSession);
        }
      });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [fetchActiveCropDetectiveSession, fetchStatus, restoreCropDetectiveSession, user?.id]);

  // 다음 티켓 충전용 타이머 구동
  useEffect(() => {
    if (secondsUntilNext <= 0) return;
    const timer = setInterval(() => {
      setSecondsUntilNext(prev => {
        if (prev <= 1) {
          fetchStatus(); // 티켓 수량 갱신
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [secondsUntilNext, fetchStatus]);

  // 백엔드가 지정한 다음 KST 자정에 오늘의 게임을 즉시 다시 조회합니다.
  useEffect(() => {
    if (!nextGameAt) return;

    const nextChangeMs = new Date(nextGameAt).getTime();
    if (!Number.isFinite(nextChangeMs)) return;

    const delay = Math.max(0, nextChangeMs - Date.now() + 150);
    const timer = window.setTimeout(() => {
      fetchStatus();
    }, Math.min(delay, 2_147_000_000));

    return () => window.clearTimeout(timer);
  }, [fetchStatus, nextGameAt]);

  useEffect(() => {
    if (!nextGameAt) return;

    const updateCountdown = () => {
      const remaining = Math.max(0, Math.ceil((new Date(nextGameAt).getTime() - Date.now()) / 1000));
      setSecondsUntilGameChange(remaining);
    };

    updateCountdown();
    const timer = window.setInterval(updateCountdown, 1000);
    return () => window.clearInterval(timer);
  }, [nextGameAt]);

  // 백그라운드 탭은 타이머가 지연될 수 있으므로 화면 복귀 시 서버 값으로 재동기화합니다.
  useEffect(() => {
    if (!user) return;

    const syncWhenVisible = () => {
      if (document.visibilityState === 'visible') fetchStatus();
    };

    window.addEventListener('focus', fetchStatus);
    document.addEventListener('visibilitychange', syncWhenVisible);
    return () => {
      window.removeEventListener('focus', fetchStatus);
      document.removeEventListener('visibilitychange', syncWhenVisible);
    };
  }, [fetchStatus, user]);

  // 3초 카운트다운 타이머 구동
  useEffect(() => {
    if (countdownLeft === null || countdownLeft <= 0) return;

    const timer = setInterval(() => {
      setCountdownLeft(prev => {
        if (prev === null) return null;
        if (prev <= 1) {
          clearInterval(timer);

          const now = Date.now();
          if (activeGame === 'quiz') {
            setQuizStartTime(now);
            setQuizIntensity(100);
            if (isPracticeMode || roundDeadlineRef.current === null) {
              roundDeadlineRef.current = now + QUIZ_TIME_LIMIT_SECONDS * 1000;
              setRoundTimeLeft(QUIZ_TIME_LIMIT_SECONDS);
            } else {
              setRoundTimeLeft(getVisibleRoundTimeLeft(roundDeadlineRef.current, now));
            }
          } else if (activeGame === 'puzzle') {
            puzzleDeadlineRef.current = now + PUZZLE_TIME_LIMIT_SECONDS * 1000;
            // 카운트다운 종료 후 바로 퍼즐 조작을 허용합니다.
          } else if (activeGame === 'match') {
            setRevealActive(true);
            setTimeout(() => {
              setMatchCards(prevDeck =>
                prevDeck.map(c => ({ ...c, isFlipped: false }))
              );
              matchDeadlineRef.current = Date.now() + MATCH_TIME_LIMIT_SECONDS * 1000;
              setRevealActive(false);
            }, 2000);
          } else if (activeGame === 'crop_detective') {
            if (isPracticeMode) {
              // Practice has no authoritative server deadline, so its clock can
              // wait until the enlarged clue and all candidate images are ready.
              roundDeadlineRef.current = null;
              setRoundTimeLeft(ROUND_GAME_ROUND_SECONDS);
            } else if (roundDeadlineRef.current !== null) {
              setRoundTimeLeft(getVisibleRoundTimeLeft(roundDeadlineRef.current, now));
            }
          } else if (isRoundGame(activeGame)) {
            if (isPracticeMode || roundDeadlineRef.current === null) {
              roundDeadlineRef.current = now + ROUND_GAME_ROUND_SECONDS * 1000;
              setRoundTimeLeft(ROUND_GAME_ROUND_SECONDS);
            } else {
              setRoundTimeLeft(getVisibleRoundTimeLeft(roundDeadlineRef.current, now));
            }
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [countdownLeft, activeGame, isPracticeMode]);

  // 짝맞추기 30초 인게임 타이머 구동
  useEffect(() => {
    if (activeGame !== 'match' || revealActive || gameBusy || gameResult || isGameOver || (countdownLeft !== null && countdownLeft > 0)) return;
    if (gameTimeLeft <= 0) {
      const timeout = window.setTimeout(() => {
        if (submitInFlightRef.current) return;
        setIsGameOver(true);
        // 시간 제한 만료 실패 제출
        submitResult({ success: false, matched_pairs: matchedPairs });
      }, 0);
      return () => window.clearTimeout(timeout);
    }
    const timer = setInterval(() => {
      setGameTimeLeft(prev => {
        const deadline = matchDeadlineRef.current;
        if (!deadline) return Math.max(0, prev - 1);
        return Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [activeGame, revealActive, gameBusy, gameTimeLeft, gameResult, isGameOver, countdownLeft, matchedPairs, submitResult]);

  useEffect(() => {
    if (
      activeGame !== 'match' ||
      matchCards.length === 0 ||
      revealActive ||
      gameBusy ||
      gameResult ||
      isGameOver ||
      (countdownLeft !== null && countdownLeft > 0)
    ) {
      return;
    }

    if (
      matchCards.every(card => card.isMatched) &&
      matchedPairs.length === matchCards.length / 2
    ) {
      const timeout = window.setTimeout(() => {
        submitResult({
          success: true,
          matched_pairs: matchedPairs,
          ...(isPracticeMode && !matchUsesServerDeck
            ? { matched_channel_ids: matchCards.map(card => card.channel_id) }
            : {})
        });
      }, 0);
      return () => window.clearTimeout(timeout);
    }
  }, [activeGame, countdownLeft, gameBusy, gameResult, isGameOver, isPracticeMode, matchCards, matchedPairs, matchUsesServerDeck, revealActive, submitResult]);

  // 회전 퍼즐 120초 인게임 타이머 구동
  useEffect(() => {
    if (activeGame !== 'puzzle' || gameBusy || gameResult || isGameOver || (countdownLeft !== null && countdownLeft > 0)) return;
    if (puzzleTimeLeft <= 0) {
      const timeout = window.setTimeout(() => {
        if (submitInFlightRef.current) return;
        setIsGameOver(true);
        submitResult({
          success: false,
          puzzle_moves: puzzleMoves,
          puzzle_pieces: puzzlePieces.map((piece) => ({ id: piece.id, rotation: piece.rotation }))
        });
      }, 0);
      return () => window.clearTimeout(timeout);
    }
    const timer = window.setInterval(() => {
      setPuzzleTimeLeft(prev => {
        const deadline = puzzleDeadlineRef.current;
        if (!deadline) return Math.max(0, prev - 1);
        return Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [activeGame, countdownLeft, gameBusy, gameResult, isGameOver, puzzleMoves, puzzlePieces, puzzleTimeLeft, submitResult]);

  // 인물 퀴즈 블러 강도 감쇄 타이머 구동 (10초 동안 100 -> 0, 50ms 갱신)
  useEffect(() => {
    if (activeGame !== 'quiz' || (countdownLeft !== null && countdownLeft > 0) || gameBusy || gameResult || roundFeedback) return;

    const interval = 50;
    const duration = 10000; // 10초

    const timer = setInterval(() => {
      const elapsed = Date.now() - quizStartTime;
      // 0~100 정규화값. 각 블러 타입별 실제 강도는 렌더링 시 별도 공식으로 확대 적용
      const currentIntensity = Math.max(0, 100 - (elapsed / duration) * 100);
      setQuizIntensity(currentIntensity);

      if (elapsed >= duration) {
        clearInterval(timer);
      }
    }, interval);

    return () => clearInterval(timer);
  }, [activeGame, countdownLeft, gameBusy, quizStartTime, gameResult, roundFeedback]);

  // 연습 카드 확대 탐정은 이미지가 모두 준비된 뒤에만 로컬 제한 시간을 시작합니다.
  useEffect(() => {
    if (
      activeGame !== 'crop_detective' ||
      !isPracticeMode ||
      gameBusy ||
      roundChecking ||
      gameResult ||
      isGameOver ||
      roundFeedback
    ) return;

    if (countdownLeft === null || countdownLeft > 0 || !cropDetectiveRoundReady) {
      roundDeadlineRef.current = null;
      return;
    }

    if (roundDeadlineRef.current === null) {
      const startingSeconds = Math.max(0, Math.min(ROUND_GAME_ROUND_SECONDS, roundTimeLeft));
      setRoundTimeLeft(startingSeconds);
      roundDeadlineRef.current = Date.now() + startingSeconds * 1000;
    }
  }, [
    activeGame,
    countdownLeft,
    cropDetectiveRoundReady,
    gameBusy,
    gameResult,
    isGameOver,
    isPracticeMode,
    roundChecking,
    roundFeedback,
    roundTimeLeft
  ]);

  // 시세 듀얼 / 카드 확대 탐정 라운드 타이머 구동
  useEffect(() => {
    if (!isRoundGame(activeGame) || gameBusy || roundChecking || gameResult || isGameOver || roundFeedback || (countdownLeft !== null && countdownLeft > 0)) return;
    // A refreshed paid crop round may already be expired. Its timeout is still
    // server-valid, while attempting to fetch the clue would correctly fail to
    // re-arm and could otherwise leave the UI in a recovery loop.
    if (
      activeGame === 'crop_detective' &&
      !isPracticeMode &&
      roundDeadlineRef.current !== null &&
      roundTimeLeft <= 0
    ) {
      const timeout = window.setTimeout(() => {
        void submitRoundAnswer(null, true);
      }, 0);
      return () => window.clearTimeout(timeout);
    }
    if (activeGame === 'crop_detective' && !cropDetectiveRoundReady) return;
    if (activeGame === 'crop_detective' && !isPracticeMode && roundDeadlineRef.current === null) return;

    if (roundTimeLeft <= 0) {
      const timeout = window.setTimeout(() => {
        void submitRoundAnswer(null, true);
      }, 0);
      return () => window.clearTimeout(timeout);
    }

    const timer = window.setInterval(() => {
      const currentRoundDeadline = roundDeadlineRef.current;
      if (currentRoundDeadline) {
        setRoundTimeLeft(getVisibleRoundTimeLeft(currentRoundDeadline));
      } else {
        setRoundTimeLeft(prev => Math.max(0, prev - 1));
      }
    }, 250);

    return () => window.clearInterval(timer);
  }, [activeGame, countdownLeft, cropDetectiveRoundReady, gameBusy, gameResult, isGameOver, isPracticeMode, roundChecking, roundFeedback, roundTimeLeft, submitRoundAnswer]);

  // 포맷팅 헬퍼 (초 -> HH:MM:SS)
  const formatTime = (secs: number) => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  // 게임 시작 처리
  const handleStartGame = async (
    type: GameType,
    practiceMode = false,
    override?: { channelId?: string; star?: number | null; blur?: string | null; imageUrl?: string | null }
  ) => {
    if (!practiceMode && (!todayGame || type !== todayGame)) {
      toast('오늘의 미니게임이 변경되었습니다. 최신 게임을 다시 불러옵니다.', 'warning');
      fetchStatus();
      return;
    }

    // A paid crop-detective session may already own the user's last ticket.
    // Let the idempotent start endpoint resume it before deciding there is no ticket.
    if (!practiceMode && tickets <= 0 && type !== 'crop_detective') {
      toast('사용 가능한 미니게임 티켓이 부족합니다.', 'warning');
      return;
    }

    activeSessionRestoreAllowedRef.current = false;
    setGameBusy(true);
    roundStartRequestRef.current += 1;
    roundStartInFlightRef.current = false;
    submitInFlightRef.current = false;
    setRoundSubmissionKey(null);
    setSubmitRetry(null);
    setGameResult(null);
    setFlippedIndices([]);
    setIsGameOver(false);
    setGameTimeLeft(MATCH_TIME_LIMIT_SECONDS);
    setPuzzleTimeLeft(PUZZLE_TIME_LIMIT_SECONDS);
    setPuzzleHintUsed(false);
    setShowPuzzleHint(false);
    puzzleMovesRef.current = [];
    setPuzzleMoves([]);
    setPuzzleUsesServerLayout(false);
    setMatchedPairs([]);
    setMatchUsesServerDeck(false);
    matchActionTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
    matchActionTimeoutsRef.current.clear();
    setRoundIndex(0);
    setRoundTotalRounds(ROUND_GAME_TOTAL_ROUNDS);
    setPendingPaidRound(null);
    setServerClockOffsetMs(0);
    setRoundAnswers([]);
    setRoundFeedback(null);
    setRoundCorrectCount(0);
    setRoundTimeLeft(ROUND_GAME_ROUND_SECONDS);
    setRoundChecking(false);
    setRoundStartBusy(false);
    setRoundTimeoutRetryAttempt(0);
    setRoundDeadlineSyncAt(null);
    setCropDetectiveReadyKey('');
    puzzleDeadlineRef.current = null;
    matchDeadlineRef.current = null;
    roundDeadlineRef.current = null;
    if (puzzleHintTimeoutRef.current !== null) {
      window.clearTimeout(puzzleHintTimeoutRef.current);
      puzzleHintTimeoutRef.current = null;
    }

    try {
      const res = await apiFetch('/minigames/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          game_type: type,
          practice_mode: practiceMode,
          // 연습 모드 한정: 특정 스트리머/별 이미지를 강제 지정(테스트용)
          ...(practiceMode && override?.channelId ? { force_channel_id: override.channelId } : {}),
          ...(practiceMode && override?.star != null ? { force_star: override.star } : {}),
          ...(practiceMode && type === 'puzzle' && override?.imageUrl ? { force_image_url: override.imageUrl } : {})
        })
      });

      const data = (await res.json()) as StartGameResponse;
      if (!res.ok) {
        toast(data.message || '게임을 시작할 수 없습니다.', res.status === 409 ? 'warning' : 'error');
        fetchStatus();
        return;
      }

      const responsePracticeMode = data.practice_mode === true;
      const responseGameData = isRecord(data.game_data)
        ? data.game_data as MinigameData
        : null;
      const serverPuzzlePieces = type === 'puzzle'
        ? parseServerPuzzlePieces(responseGameData?.puzzle_pieces)
        : null;
      const serverMatchDeck = type === 'match'
        ? parseServerMatchDeck(responseGameData?.cards)
        : null;
      const legacyPracticeMatchDeck = type === 'match' && responsePracticeMode && !serverMatchDeck
        ? createLegacyPracticeMatchDeck(responseGameData?.cards ?? [], data.session_id)
        : null;
      const paidRoundContract = !responsePracticeMode && responseGameData && isRoundGame(type)
        ? parsePaidRoundContract(data, type)
        : null;
      const practiceRoundTotal = responsePracticeMode && responseGameData && isRoundGame(type)
        ? parsePracticeRoundTotal(data, type)
        : null;
      const validResponseEnvelope = Boolean(
        responseGameData &&
        typeof data.session_id === 'string' &&
        data.session_id.trim() &&
        responsePracticeMode === practiceMode &&
        (data.game_type === undefined || data.game_type === type)
      );
      const missingAuthoritativeState = !responsePracticeMode && (
        !validResponseEnvelope ||
        (type === 'puzzle' && !serverPuzzlePieces) ||
        (type === 'match' && !serverMatchDeck) ||
        (isRoundGame(type) && !paidRoundContract)
      );
      const invalidPracticeState = responsePracticeMode && (
        !validResponseEnvelope ||
        (type === 'match' && !serverMatchDeck && !legacyPracticeMatchDeck) ||
        (isRoundGame(type) && practiceRoundTotal === null)
      );

      if (missingAuthoritativeState || invalidPracticeState) {
        try {
          if (typeof data.session_id === 'string' && data.session_id.trim()) {
            await apiFetch('/minigames/abandon', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ session_id: data.session_id })
            });
          }
        } catch {
          // The UI still fails closed; stale session cleanup remains server-owned.
        }
        toast(
          missingAuthoritativeState
            ? '서버 검증용 게임 데이터를 받지 못해 안전하게 시작을 중단했습니다.'
            : '연습 게임 데이터를 불러올 수 없습니다.',
          'error'
        );
        fetchStatus();
        return;
      }

      if (!responseGameData) return;

      setSessionId(data.session_id);
      setGameData(paidRoundContract
        ? {
            ...responseGameData,
            rounds: paidRoundContract.rounds,
            total_rounds: paidRoundContract.totalRounds
          }
        : responseGameData);
      setActiveGame(type);
      setIsPracticeMode(responsePracticeMode);
      if (data.resumed_session) {
        toast(data.message || '진행 중이던 카드 확대 탐정을 이어서 시작합니다.', 'info');
      } else if (data.interrupted_session_closed) {
        toast(data.message || '이전 미니게임은 실패 처리되었고 새 게임을 시작합니다.', 'warning');
      }

      const remainingSeconds = data.timing?.time_remaining_ms !== undefined
        ? Math.max(0, Math.ceil(data.timing.time_remaining_ms / 1000))
        : null;

      if (isRoundGame(type)) {
        const totalRounds = paidRoundContract?.totalRounds ?? practiceRoundTotal ?? ROUND_GAME_TOTAL_ROUNDS;
        const serverProgress = paidRoundContract?.progress ?? null;
        const restoredRoundIndex = paidRoundContract?.currentRoundIndex ?? 0;
        const restoredFeedback: RoundFeedback | null = paidRoundContract?.complete
          ? {
              round: restoredRoundIndex,
              correct: false,
              correct_channel_ids: [],
              locked: true
            }
          : null;
        const authoritativeDeadline = paidRoundContract?.localDeadlineAt ?? null;
        const restoredTimeLeft = authoritativeDeadline === null
          ? (paidRoundContract?.complete ? 0 : ROUND_GAME_ROUND_SECONDS)
          : getVisibleRoundTimeLeft(authoritativeDeadline);
        const restoredRound = paidRoundContract?.rounds[restoredRoundIndex];
        const expiredCropRoundKey =
          type === 'crop_detective' &&
          paidRoundContract !== null &&
          !paidRoundContract.complete &&
          authoritativeDeadline !== null &&
          restoredTimeLeft <= 0 &&
          isCropDetectiveRound(restoredRound)
            ? getCropDetectiveRoundKey(restoredRound)
            : '';

        setRoundIndex(restoredRoundIndex);
        setRoundTotalRounds(totalRounds);
        setPendingPaidRound(null);
        setServerClockOffsetMs(paidRoundContract?.serverClockOffsetMs ?? 0);
        setRoundAnswers(serverProgress?.answers ?? []);
        setRoundFeedback(restoredFeedback);
        setRoundCorrectCount(Math.max(0, Math.min(totalRounds, serverProgress?.correctCount ?? 0)));
        setRoundChecking(false);
        setRoundTimeoutRetryAttempt(0);
        setRoundDeadlineSyncAt(authoritativeDeadline);
        setRoundTimeLeft(restoredTimeLeft);
        setCropDetectiveReadyKey(expiredCropRoundKey);
        roundDeadlineRef.current = authoritativeDeadline;
      }

      // 게임별 초기 세팅값 설정
      if (type === 'quiz') {
        setQuizStartTime(Date.now());
        setQuizIntensity(100);
        // 첫 문제는 랜덤 블러로 시작하되, 연습 URL에 blur가 있으면 첫 문제만 강제할 수 있습니다.
        const forcedBlur = practiceMode && override?.blur && (QUIZ_BLUR_TYPES as string[]).includes(override.blur)
          ? (override.blur as QuizBlurType)
          : null;
        setQuizBlurType(forcedBlur ?? getRandomQuizBlurType());
        setQuizBlurAngle(Math.floor(Math.random() * 360));
      } else if (type === 'puzzle') {
        setPuzzlePieces(serverPuzzlePieces ?? createInitialPuzzlePieces());
        puzzleMovesRef.current = [];
        setPuzzleMoves([]);
        setPuzzleUsesServerLayout(Boolean(serverPuzzlePieces));
        const puzzleRemaining = remainingSeconds ?? PUZZLE_TIME_LIMIT_SECONDS;
        setPuzzleTimeLeft(puzzleRemaining);
        puzzleDeadlineRef.current = null;
      } else if (type === 'match') {
        setRevealActive(true);
        setMatchedPairs([]);
        setMatchUsesServerDeck(Boolean(serverMatchDeck));
        const matchRemaining = remainingSeconds ?? MATCH_TIME_LIMIT_SECONDS;
        setGameTimeLeft(matchRemaining);
        matchDeadlineRef.current = null;

        // Paid decks are shuffled and uniquely identified by the server. The
        // six-card client duplication path is retained only for legacy practice.
        setMatchCards(serverMatchDeck ?? legacyPracticeMatchDeck ?? []);
      }

      setCountdownLeft(data.resumed_session ? 0 : 3);

      if (!responsePracticeMode) fetchStatus(); // 일반 게임만 남은 티켓 수량 갱신

    } catch {
      toast('서버와의 통신에 실패했습니다.', 'error');
    } finally {
      setGameBusy(false);
    }
  };

  // URL 파라미터로 연습 게임을 자동 시작합니다 (특정 유저·별 이미지 테스트용).
  // 예) /arcade?practice=quiz&channel=<channel_id>&star=3&blur=motion
  //     practice=quiz|puzzle|match|value_duel|crop_detective (필수), channel=스트리머 channel_id, star=0~5, blur=(퀴즈) gaussian|mosaic|motion|radial, image=(퍼즐) 스냅샷 URL
  useEffect(() => {
    if (autoStartRef.current || !user) return;
    const practiceType = searchParams.get('practice');
    if (practiceType !== 'quiz' && practiceType !== 'puzzle' && practiceType !== 'match' && practiceType !== 'value_duel' && practiceType !== 'crop_detective') return;
    autoStartRef.current = true;

    const channelId = searchParams.get('channel') || undefined;
    const starRaw = searchParams.get('star');
    const star = starRaw !== null && starRaw !== ''
      ? Math.max(0, Math.min(5, parseInt(starRaw, 10) || 0))
      : null;
    const blur = searchParams.get('blur');
    const imageUrl = searchParams.get('image');

    handleStartGame(practiceType as GameType, true, { channelId, star, blur, imageUrl });
    router.replace('/arcade'); // 파라미터 정리 (새로고침 시 재실행 방지)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, searchParams]);

  // ==========================================
  // 2. 카드 퍼즐 회전 제어 (3x4 그리드)
  // ==========================================
  const toPuzzlePiecePayload = (pieces: PuzzlePiece[]) =>
    pieces.map((piece) => ({ id: piece.id, rotation: piece.rotation }));

  const handlePuzzleMoveLimitReached = () => {
    if (isGameOver || submitInFlightRef.current) return;
    setIsGameOver(true);
    toast(`퍼즐 조작은 최대 ${MAX_PUZZLE_MOVES}회까지 기록할 수 있습니다.`, 'warning');
    submitResult({
      success: false,
      puzzle_moves: puzzleMovesRef.current,
      puzzle_pieces: toPuzzlePiecePayload(puzzlePieces)
    });
  };

  const completePuzzleIfSolved = (pieces: PuzzlePiece[], moves: PuzzleMove[]) => {
    if (isPuzzleSolved(pieces)) {
      if (!isPracticeMode && !puzzleUsesServerLayout) {
        setIsGameOver(true);
        toast('서버에서 발급한 퍼즐 상태를 확인할 수 없어 결과를 제출하지 않았습니다.', 'error');
        return;
      }
      submitResult({
        success: true,
        puzzle_moves: moves,
        puzzle_pieces: toPuzzlePiecePayload(pieces)
      });
    }
  };

  const handleUsePuzzleHint = () => {
    if (
      puzzleHintUsed ||
      gameBusy ||
      gameResult ||
      isGameOver ||
      activeGame !== 'puzzle' ||
      (countdownLeft !== null && countdownLeft > 0)
    ) {
      return;
    }

    setPuzzleHintUsed(true);
    setShowPuzzleHint(true);
    if (puzzleDeadlineRef.current !== null) {
      puzzleDeadlineRef.current = Math.max(Date.now(), puzzleDeadlineRef.current - PUZZLE_HINT_PENALTY_SECONDS * 1000);
    }
    setPuzzleTimeLeft((prev) => Math.max(0, prev - PUZZLE_HINT_PENALTY_SECONDS));
    if (puzzleHintTimeoutRef.current !== null) {
      window.clearTimeout(puzzleHintTimeoutRef.current);
    }
    puzzleHintTimeoutRef.current = window.setTimeout(() => {
      setShowPuzzleHint(false);
      puzzleHintTimeoutRef.current = null;
    }, PUZZLE_HINT_DURATION_MS);
  };

  const handleRotatePiece = (index: number) => {
    if (gameBusy || gameResult || isGameOver || (countdownLeft !== null && countdownLeft > 0)) return;
    if (puzzleMovesRef.current.length >= MAX_PUZZLE_MOVES) {
      handlePuzzleMoveLimitReached();
      return;
    }
    const nextMoves: PuzzleMove[] = [...puzzleMovesRef.current, { type: 'rotate', index }];
    const newPieces = puzzlePieces.map((piece, pieceIndex) =>
      pieceIndex === index ? { ...piece, rotation: piece.rotation + 90 } : piece
    );
    puzzleMovesRef.current = nextMoves;
    setPuzzleMoves(nextMoves);
    setPuzzlePieces(newPieces);
    completePuzzleIfSolved(newPieces, nextMoves);
  };

  const handleSwapPuzzlePieces = (fromIndex: number, toIndex: number) => {
    if (
      gameBusy ||
      gameResult ||
      isGameOver ||
      (countdownLeft !== null && countdownLeft > 0) ||
      fromIndex === toIndex ||
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= puzzlePieces.length ||
      toIndex >= puzzlePieces.length
    ) {
      return;
    }
    if (puzzleMovesRef.current.length >= MAX_PUZZLE_MOVES) {
      handlePuzzleMoveLimitReached();
      return;
    }

    const nextMoves: PuzzleMove[] = [...puzzleMovesRef.current, { type: 'swap', from: fromIndex, to: toIndex }];
    const newPieces = [...puzzlePieces];
    [newPieces[fromIndex], newPieces[toIndex]] = [newPieces[toIndex], newPieces[fromIndex]];
    puzzleMovesRef.current = nextMoves;
    setPuzzleMoves(nextMoves);
    setPuzzlePieces(newPieces);
    completePuzzleIfSolved(newPieces, nextMoves);
  };

  const getPuzzleIndexFromPoint = (x: number, y: number) => {
    const target = document.elementFromPoint(x, y) as HTMLElement | null;
    const piece = target?.closest('[data-puzzle-index]') as HTMLElement | null;
    const rawIndex = piece?.dataset.puzzleIndex;
    if (!rawIndex) return null;

    const index = Number(rawIndex);
    return Number.isInteger(index) ? index : null;
  };

  const handlePuzzlePointerDown = (event: React.PointerEvent<HTMLButtonElement>, index: number) => {
    if (gameBusy || gameResult || isGameOver || (countdownLeft !== null && countdownLeft > 0)) return;
    if (event.button !== 0) return;
    puzzleDragRef.current = { index, startX: event.clientX, startY: event.clientY, dragging: false };
    setDragOverPuzzleIndex(null);
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture can fail if the pointer has already been released.
    }
  };

  const handlePuzzlePointerMove = (event: React.PointerEvent<HTMLButtonElement>, index: number) => {
    if (isGameOver) return;
    const drag = puzzleDragRef.current;
    if (!drag || drag.index !== index) return;

    const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
    if (!drag.dragging && distance > 10) {
      drag.dragging = true;
      setDraggingPuzzleIndex(index);
    }

    if (!drag.dragging) return;
    event.preventDefault();

    const targetIndex = getPuzzleIndexFromPoint(event.clientX, event.clientY);
    setDragOverPuzzleIndex(targetIndex !== null && targetIndex !== index ? targetIndex : null);
  };

  const handlePuzzlePointerUp = (event: React.PointerEvent<HTMLButtonElement>, index: number) => {
    if (isGameOver) {
      handlePuzzlePointerCancel();
      return;
    }
    const drag = puzzleDragRef.current;
    if (!drag || drag.index !== index) return;

    if (drag.dragging) {
      const targetIndex = getPuzzleIndexFromPoint(event.clientX, event.clientY);
      if (targetIndex !== null) {
        handleSwapPuzzlePieces(index, targetIndex);
      }
    } else {
      handleRotatePiece(index);
    }

    puzzleDragRef.current = null;
    setDraggingPuzzleIndex(null);
    setDragOverPuzzleIndex(null);
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // noop
    }
  };

  const handlePuzzlePointerCancel = () => {
    puzzleDragRef.current = null;
    setDraggingPuzzleIndex(null);
    setDragOverPuzzleIndex(null);
  };

  // ==========================================
  // 3. 카드 뒤집기 제어 (모바일 3x4 / PC 4x3)
  // ==========================================
  const handleFlipCard = (index: number) => {
    if (gameBusy || gameResult || revealActive || flippedIndices.length >= 2 || isGameOver || (countdownLeft !== null && countdownLeft > 0)) return;
    const clickedCard = matchCards[index];
    if (clickedCard.isFlipped || clickedCard.isMatched) return;

    const nextDeck = matchCards.map((card, idx) =>
      idx === index ? { ...card, isFlipped: true } : card
    );
    setMatchCards(nextDeck);

    const newFlipped = [...flippedIndices, index];
    setFlippedIndices(newFlipped);

    if (newFlipped.length === 2) {
      const [firstIdx, secondIdx] = newFlipped;
      const firstCard = nextDeck[firstIdx];
      const secondCard = nextDeck[secondIdx];

      if (firstCard.channel_id === secondCard.channel_id) {
        const matchedPair: MatchedPair = {
          first_card_id: firstCard.card_id,
          second_card_id: secondCard.card_id
        };
        // 짝 맞춤 성공 -> 0.5초 후 isMatched와 isFlipped를 확실히 true로 세팅
        const timeoutId = window.setTimeout(() => {
          matchActionTimeoutsRef.current.delete(timeoutId);
          setMatchedPairs(prevPairs => {
            const alreadyRecorded = prevPairs.some(pair =>
              pair.first_card_id === matchedPair.first_card_id ||
              pair.first_card_id === matchedPair.second_card_id ||
              pair.second_card_id === matchedPair.first_card_id ||
              pair.second_card_id === matchedPair.second_card_id
            );
            return alreadyRecorded ? prevPairs : [...prevPairs, matchedPair];
          });
          setMatchCards(prevDeck => {
            const matchedDeck = prevDeck.map((card, cardIndex) =>
              cardIndex === firstIdx || cardIndex === secondIdx
                ? { ...card, isFlipped: true, isMatched: true }
                : card
            );
            return matchedDeck;
          });
          setFlippedIndices([]);
        }, 500);
        matchActionTimeoutsRef.current.add(timeoutId);
      } else {
        // 매치 실패 -> 0.8초 뒤에 두 카드의 뒤집힘 원복
        const timeoutId = window.setTimeout(() => {
          matchActionTimeoutsRef.current.delete(timeoutId);
          setMatchCards(prevDeck =>
            prevDeck.map((card, cardIndex) =>
              cardIndex === firstIdx || cardIndex === secondIdx
                ? { ...card, isFlipped: false }
                : card
            )
          );
          setFlippedIndices([]);
        }, 800);
        matchActionTimeoutsRef.current.add(timeoutId);
      }
    }
  };

  const handleRoundChoice = useCallback((selectedChannelId: string) => {
    void submitRoundAnswer(selectedChannelId, false);
  }, [submitRoundAnswer]);

  const handleRoundContinue = async () => {
    if (!isRoundGame(activeGame) || !gameData?.rounds || !roundFeedback || isGameOver || roundStartBusy) return;
    const isLastRound = roundIndex >= roundTotalRounds - 1;
    if (isLastRound) {
      submitResult({ answers: roundAnswers });
      return;
    }

    const nextIndex = roundIndex + 1;
    if (!isPracticeMode) {
      if (!pendingPaidRound || pendingPaidRound.roundIndex !== nextIndex) {
        toast('서버가 공개한 다음 라운드를 확인할 수 없어 진행을 중단했습니다.', 'error');
        return;
      }

      if (activeGame === 'value_duel') {
        if (!sessionId || pendingPaidRound.localDeadlineAt !== null || roundStartInFlightRef.current) return;

        const requestId = ++roundStartRequestRef.current;
        roundStartInFlightRef.current = true;
        setRoundStartBusy(true);
        try {
          const res = await apiFetch('/minigames/round-start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_id: sessionId, round: nextIndex })
          });
          const data = await res.json().catch(() => ({})) as RoundStartResponse;
          if (requestId !== roundStartRequestRef.current) return;
          if (!res.ok) {
            toast(data.message || '다음 문제를 시작하지 못했습니다. 다시 시도해 주세요.', 'warning');
            return;
          }

          const responseRound = Number(data.round);
          const responseTotalRounds = Number(data.total_rounds);
          const responseServerNowMs = Date.parse(data.server_now || '');
          const responseDeadlineMs = Date.parse(data.round_deadline_at || '');
          const nextRound = data.round_data;
          const nextServerClockOffsetMs = responseServerNowMs - Date.now();
          const nextLocalDeadline = getLocalRoundDeadline(
            data.round_deadline_at,
            nextServerClockOffsetMs
          );
          const validProtocol =
            data.success === true &&
            Number.isInteger(responseRound) &&
            responseRound === nextIndex &&
            Number.isInteger(responseTotalRounds) &&
            responseTotalRounds === roundTotalRounds &&
            Number.isFinite(responseServerNowMs) &&
            Number.isFinite(responseDeadlineMs) &&
            responseDeadlineMs > responseServerNowMs &&
            isValueDuelRound(nextRound) &&
            nextRound.round === nextIndex &&
            nextLocalDeadline !== null;

          if (!validProtocol) {
            toast('다음 문제의 서버 검증 데이터를 확인할 수 없습니다. 다시 시도해 주세요.', 'error');
            return;
          }

          setServerClockOffsetMs(nextServerClockOffsetMs);
          setGameData((previousData) => {
            if (!previousData) return previousData;
            const rounds = [
              ...(previousData.rounds || []).filter((round) => round.round !== nextRound.round),
              nextRound
            ].sort((left, right) => left.round - right.round);
            return { ...previousData, rounds, total_rounds: responseTotalRounds };
          });
          advanceToPaidRound(
            { roundIndex: nextIndex, localDeadlineAt: nextLocalDeadline },
            nextRound
          );
        } catch {
          if (requestId === roundStartRequestRef.current) {
            toast('다음 문제를 시작하지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.', 'warning');
          }
        } finally {
          if (requestId === roundStartRequestRef.current) {
            roundStartInFlightRef.current = false;
            setRoundStartBusy(false);
          }
        }
        return;
      }

      advanceToPaidRound(pendingPaidRound);
      return;
    }

    setRoundIndex(nextIndex);
    setRoundSubmissionKey(null);
    setRoundTimeoutRetryAttempt(0);
    setRoundDeadlineSyncAt(null);
    setRoundFeedback(null);
    setRoundTimeLeft(ROUND_GAME_ROUND_SECONDS);
    if (activeGame === 'crop_detective') {
      setCropDetectiveReadyKey('');
      roundDeadlineRef.current = null;
    } else {
      roundDeadlineRef.current = Date.now() + ROUND_GAME_ROUND_SECONDS * 1000;
    }
    if (activeGame === 'quiz') {
      setQuizStartTime(Date.now());
      setQuizIntensity(100);
      setQuizBlurType((previousType) => getRandomQuizBlurType(previousType));
      setQuizBlurAngle(Math.floor(Math.random() * 360));
    }
  };

  // 로그인 체크
  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center animate-in fade-in duration-300">
        <div className="cute-surface max-w-md rounded-[2rem] p-8">
          <Gamepad2 className="mx-auto h-12 w-12 text-primary animate-pulse mb-4" />
          <h2 className="text-xl font-black text-foreground">로그인이 필요한 기능입니다</h2>
          <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
            미니게임에 도전하여 무료 가챠 포인트를 적립하시려면 치지직 간편 로그인을 완료해 주세요.
          </p>
        </div>
      </div>
    );
  }

  if (loading || !todayGame) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center animate-in fade-in duration-300">
        <div className="cute-surface rounded-[2rem] p-8">
          <RefreshCw className="mx-auto h-9 w-9 animate-spin text-primary mb-3" />
          <p className="text-xs font-bold text-muted-foreground">오늘의 미니게임을 불러오는 중입니다.</p>
        </div>
      </div>
    );
  }

  const dailyGameDetails = DAILY_GAME_DETAILS[todayGame];
  const DailyGameIcon = dailyGameDetails.Icon;
  const showAnswerReveal = Boolean(gameResult && gameData && activeGame === 'puzzle');
  const revealedImageUrl = gameResult?.answer?.image_url || gameData?.image_url || '';
  const revealedName = gameResult?.answer?.name || '정답 정보를 불러오지 못했습니다.';
  const answerReportCard: ReportTargetCard | null = gameResult?.answer
    ? {
        star: gameResult.answer.star || 0,
        streamer: {
          channel_id: gameResult.answer.channel_id,
          name: gameResult.answer.name,
          logo_url: gameResult.answer.image_url,
          custom_image_url: null,
          custom_images: null
        }
      }
    : null;
  const handleReportResult = (title: string, message: string, type: 'success' | 'error' | 'warning' | 'info' = 'info') => {
    toast(`${title}: ${message}`, type);
  };

  return (
    <div className="space-y-6">
      {gameResult && activeGame && gameData && typeof document !== 'undefined' && createPortal(
        <div className="modal-backdrop modal-backdrop-center z-[120] bg-slate-950/70 backdrop-blur-md animate-in fade-in duration-200">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="arcade-result-title"
            className={`modal-panel modal-panel-scroll rounded-[1.75rem] border border-border/80 bg-card shadow-[0_28px_90px_rgba(2,6,23,0.48)] sm:rounded-[2rem] ${showAnswerReveal ? 'modal-panel-xl' : 'modal-panel-md'}`}
          >
            <header className={`relative overflow-hidden border-b border-border/70 px-5 py-5 sm:px-7 sm:py-6 ${gameResult.correct
              ? 'bg-gradient-to-br from-emerald-50 via-card to-sky-50 dark:from-emerald-500/15 dark:via-card dark:to-sky-500/10'
              : 'bg-gradient-to-br from-rose-50 via-card to-amber-50 dark:from-rose-500/15 dark:via-card dark:to-amber-500/10'
              }`}>
              <div className="pointer-events-none absolute -right-12 -top-16 h-40 w-40 rounded-full bg-primary/10 blur-3xl" />
              <div className="relative flex items-start justify-between gap-4">
                <div className="flex min-w-0 items-center gap-3">
                  <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border shadow-sm sm:h-13 sm:w-13 ${gameResult.correct
                    ? 'border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-500/25 dark:bg-emerald-500/15 dark:text-emerald-300'
                    : 'border-rose-200 bg-rose-100 text-rose-700 dark:border-rose-500/25 dark:bg-rose-500/15 dark:text-rose-300'
                    }`}>
                    {gameResult.correct ? <Trophy className="h-5 w-5 sm:h-6 sm:w-6" /> : <X className="h-5 w-5 sm:h-6 sm:w-6" />}
                  </div>
                  <div className="min-w-0">
                    <p className={`text-[10px] font-black uppercase tracking-[0.2em] ${gameResult.correct
                      ? 'text-emerald-700 dark:text-emerald-300'
                      : 'text-rose-700 dark:text-rose-300'
                      }`}>
                      {gameResult.correct ? 'Mission Complete' : 'Game Over'}
                    </p>
                    <h3 id="arcade-result-title" className="mt-1 text-lg font-black text-foreground sm:text-xl">
                      {isPracticeMode
                        ? (gameResult.correct ? '연습 게임 성공!' : '연습 게임 종료')
                        : (gameResult.correct ? '미니게임 성공!' : '미션 실패!')}
                    </h3>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleExitGame}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border/80 bg-background/75 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
                  aria-label="결과 창 닫고 로비로 돌아가기"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </header>

            <div className={`grid min-h-0 ${showAnswerReveal ? 'md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]' : ''}`}>
              {showAnswerReveal && (
                <div className="border-b border-border/70 bg-secondary/20 p-4 sm:p-6 md:border-b-0 md:border-r">
                  <div className="mx-auto w-full max-w-[17rem] sm:max-w-[19rem]">
                    <div className="mb-3 flex items-center justify-between">
                      <span className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-muted-foreground">
                        <Eye className="h-3.5 w-3.5 text-primary" />
                        Original Image
                      </span>
                      <span className="rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[9px] font-black text-primary">
                        정답 공개
                      </span>
                    </div>
                    <div className="relative aspect-[3/4] max-h-[42dvh] w-full overflow-hidden rounded-2xl border border-border/80 bg-zinc-950 shadow-[0_16px_40px_rgba(2,6,23,0.28)] sm:max-h-[52dvh]">
                      {revealedImageUrl ? (
                        <BlindableCardImage
                          src={revealedImageUrl}
                          alt={`${revealedName} 원본 이미지`}
                          className="h-full w-full object-contain"
                          draggable={false}
                          imageBlindMenuEnabled
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center px-6 text-center text-xs font-bold text-zinc-400">
                          원본 이미지를 불러올 수 없습니다.
                        </div>
                      )}
                      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/60 to-transparent" />
                      {answerReportCard && (
                        <button
                          type="button"
                          onClick={() => setReportCard(answerReportCard)}
                          className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-full border border-white/25 bg-black/55 px-2 py-1 text-[10px] font-black text-white backdrop-blur-sm transition hover:bg-red-500/85"
                          aria-label="정답 이미지 신고"
                        >
                          <Flag className="h-3 w-3" />
                          신고
                        </button>
                      )}
                    </div>

                    <div className="relative -mt-5 mx-3 flex items-center gap-3 rounded-2xl border border-border/90 bg-card/95 px-4 py-3 shadow-xl backdrop-blur-md">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                        <UserRound className="h-4.5 w-4.5" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-[9px] font-black uppercase tracking-[0.16em] text-muted-foreground">Streamer</p>
                        <p className="break-words text-sm font-black text-foreground sm:text-base">{revealedName}</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex min-w-0 flex-col justify-center p-5 sm:p-7">
                <div className={`rounded-2xl border px-4 py-3.5 ${gameResult.correct
                  ? 'border-emerald-200 bg-emerald-50/80 dark:border-emerald-500/20 dark:bg-emerald-500/10'
                  : 'border-rose-200 bg-rose-50/80 dark:border-rose-500/20 dark:bg-rose-500/10'
                  }`}>
                  <p className="text-xs leading-relaxed text-foreground/85 sm:text-sm">
                    {gameResult.message}
                  </p>
                </div>

                {gameResult.earned_points > 0 ? (
                  <div className="mt-4 grid grid-cols-2 overflow-hidden rounded-2xl border border-border bg-secondary/25">
                    <div className="p-4">
                      <p className="text-[10px] font-bold text-muted-foreground">획득 재화</p>
                      <p className="mt-1 text-lg font-black text-emerald-600 dark:text-emerald-400">
                        +{gameResult.earned_points.toLocaleString()} P
                      </p>
                    </div>
                    <div className="border-l border-border p-4 text-right">
                      <p className="text-[10px] font-bold text-muted-foreground">현재 잔액</p>
                      <p className="mt-1 text-sm font-extrabold text-foreground">
                        {gameResult.new_balance.toLocaleString()} P
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 rounded-2xl border border-border/80 bg-secondary/20 px-4 py-3 text-center">
                    <p className="text-[10px] font-bold text-muted-foreground">
                      {isPracticeMode ? '연습 모드에서는 포인트가 지급되지 않습니다.' : '이번 게임에서 획득한 포인트가 없습니다.'}
                    </p>
                  </div>
                )}

                <div className="mt-5 flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    onClick={handleExitGame}
                    className="rounded-2xl border border-border bg-secondary px-5 py-2.5 text-xs font-bold text-muted-foreground transition hover:text-foreground"
                  >
                    로비로 돌아가기
                  </button>
                  <button
                    type="button"
                    onClick={() => handleStartGame(isPracticeMode ? activeGame : todayGame, isPracticeMode)}
                    disabled={!isPracticeMode && tickets <= 0}
                    className="cute-wiggle-hover flex items-center justify-center gap-1 rounded-2xl bg-primary px-5 py-2.5 text-xs font-bold text-primary-foreground shadow-sm transition hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-40"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    {isPracticeMode ? '다시 연습하기' : '다시 도전'}
                  </button>
                </div>
              </div>
            </div>
          </section>
        </div>,
        document.body
      )}

      {reportCard && (
        <ReportCardModal
          card={reportCard}
          onClose={() => setReportCard(null)}
          onResult={handleReportResult}
        />
      )}

      {/* 아케이드 대시보드 헤더 */}
      {!activeGame && (
        <div data-tour="arcade-header" className="cute-surface flex flex-col gap-4 rounded-[2rem] p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="cute-pill rounded-2xl p-2.5">
              <Gamepad2 className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h2 className="text-lg font-extrabold text-foreground flex items-center gap-1.5">
                미니게임 아케이드
                <span className="cute-pill rounded-full px-2 py-0.5 text-xs font-black"> Arcade </span>
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">포인트를 두고 벌이는 재미있는 카드 미니게임!</p>
            </div>
          </div>

          {/* 아케이드 코인 충전 현황 */}
          <div data-tour="arcade-tickets" className="flex min-w-[270px] flex-col gap-2 self-start rounded-[1.75rem] border border-primary/20 bg-gradient-to-br from-white via-secondary/75 to-accent/35 p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_10px_24px_rgba(22,136,240,0.12)] sm:self-center dark:from-card dark:via-secondary/65 dark:to-primary/10">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1 text-xs font-black text-primary">
                🪙 아케이드 동전
              </span>
              <span className="rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[9px] font-black text-primary">
                총 {tickets}개
              </span>
            </div>

            <div className="flex items-center justify-between mt-1 gap-4">
              {/* 5개 코인 슬롯 */}
              <div className="flex items-center gap-1.5 rounded-2xl border border-primary/15 bg-white/80 px-2.5 py-1.5 shadow-inner dark:bg-card/70">
                {Array.from({ length: 5 }).map((_, idx) => {
                  const hasCoin = idx < baseTickets;
                  return (
                    <div key={idx} className="relative">
                      {hasCoin ? (
                        <div className="relative flex h-5.5 w-5.5 animate-[pulse_1.5s_infinite_ease-in-out] items-center justify-center rounded-full border border-sky-100 bg-gradient-to-b from-sky-200 via-primary to-teal-400 shadow-[0_2px_8px_rgba(22,136,240,0.4),inset_0_1px_0_rgba(255,255,255,0.55)]">
                          <div className="flex h-3.5 w-3.5 items-center justify-center rounded-full border border-dashed border-white/65">
                            <span className="select-none text-[9px] font-black leading-none text-white">C</span>
                          </div>
                        </div>
                      ) : (
                        <div className="relative flex h-5.5 w-5.5 items-center justify-center rounded-full border border-primary/18 bg-secondary/70 shadow-inner dark:bg-secondary/50">
                          <div className="h-2 w-2 rounded-full border border-primary/15 bg-primary/20" />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* 충전 대기 타이머 */}
              {baseTickets < 5 ? (
                <div className="flex items-center gap-1 rounded-2xl border border-primary/20 bg-primary/10 px-2.5 py-1.5 text-primary">
                  <RefreshCw className="h-3 w-3 animate-spin" />
                  <span className="cute-number-font text-xs font-black">{formatTime(secondsUntilNext)}</span>
                </div>
              ) : (
                <div className="flex items-center gap-1 rounded-2xl border border-teal-200 bg-teal-50 px-2.5 py-1.5 text-[10px] font-black uppercase text-teal-700 dark:border-teal-500/20 dark:bg-teal-500/10 dark:text-teal-300">
                  FULL COIN
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-2xl border border-primary/15 bg-white/70 px-2.5 py-1.5 dark:bg-card/60">
                <p className="text-[9px] font-bold text-muted-foreground">기본 충전</p>
                <p className="text-xs font-black text-primary"><span className="cute-number-font">{baseTickets}/5</span></p>
              </div>
              <div className={`rounded-2xl border px-2.5 py-1.5 ${bonusTickets > 0 ? 'border-sky-200 bg-sky-50 dark:border-sky-500/30 dark:bg-sky-500/10' : 'border-primary/12 bg-white/65 dark:bg-card/55'}`}>
                <p className="text-[9px] font-bold text-muted-foreground">추가 티켓</p>
                <p className={`text-xs font-black ${bonusTickets > 0 ? 'text-sky-700 dark:text-sky-400' : 'text-muted-foreground'}`}>+<span className="cute-number-font">{bonusTickets}</span></p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 백엔드가 KST 날짜 기준으로 지정한 오늘의 미니게임 */}
      {!activeGame && (
        <section data-tour="arcade-daily-game" className="cute-surface relative overflow-hidden rounded-[2rem]">
          <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${dailyGameDetails.glow}`} />
          <div className="relative border-b border-border/60 px-5 py-4 sm:px-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-primary px-2.5 py-1 text-[10px] font-black tracking-wide text-primary-foreground shadow-sm">
                  오늘의 미니게임
                </span>
                <span className="text-[10px] font-bold text-muted-foreground">매일 00:00 KST 변경</span>
              </div>
              <span className="rounded-full border border-border/70 bg-background/70 px-2.5 py-1 text-[10px] font-black text-muted-foreground">
                {todayKstDate.replaceAll('-', '.')} KST
              </span>
            </div>
          </div>

          <div className="relative grid gap-5 p-5 sm:grid-cols-[1fr_190px] sm:p-6">
            <div className="flex min-w-0 gap-4">
              <div className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl ${dailyGameDetails.iconBackground} ${dailyGameDetails.accent} shadow-sm`}>
                <DailyGameIcon className="h-7 w-7" />
              </div>
              <div className="min-w-0">
                <p className={`text-[10px] font-black uppercase tracking-[0.18em] ${dailyGameDetails.accent}`}>
                  Today&apos;s Arcade
                </p>
                <h3 className="mt-1 text-lg font-black text-foreground">{dailyGameDetails.title}</h3>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  {dailyGameDetails.description}
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <span className={`rounded-lg border px-2.5 py-1 text-[10px] font-black ${dailyGameDetails.badge}`}>
                    기본 성공 보상 1,000 P
                  </span>
                  <span className="rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-1 text-[10px] font-black text-violet-700 dark:border-violet-500/20 dark:bg-violet-500/10 dark:text-violet-400">
                    {dailyGameDetails.bonus}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex flex-col justify-between gap-3 rounded-[1.75rem] border border-border/70 bg-background/65 p-4 shadow-inner">
              <div>
                <div className="flex items-center gap-1.5 text-[10px] font-black text-muted-foreground">
                  <CalendarClock className="h-3.5 w-3.5 text-primary" />
                  다음 게임까지
                </div>
                <p className="cute-number-font mt-1 text-xl font-black tracking-tight text-foreground">
                  {formatTime(secondsUntilGameChange)}
                </p>
                <p className="mt-1 text-[9px] font-bold text-muted-foreground">
                  매일 자정에 새 게임이 지정됩니다.
                </p>
              </div>
              <button
                onClick={() => handleStartGame(todayGame)}
                disabled={gameBusy || (tickets <= 0 && todayGame !== 'crop_detective')}
                className="cute-wiggle-hover flex w-full items-center justify-center gap-1.5 rounded-2xl bg-primary px-3 py-2.5 text-xs font-black text-primary-foreground transition active:scale-95 disabled:pointer-events-none disabled:opacity-40"
              >
                {tickets <= 0 && todayGame === 'crop_detective' ? '진행 중 게임 확인' : '🪙 1개 소모 · 도전'}
              </button>
            </div>
          </div>
        </section>
      )}

      {/* 동전과 포인트 지급 없이 모든 게임을 체험하는 연습 모드 */}
      {!activeGame && (
        <section data-tour="arcade-practice" className="overflow-hidden rounded-[2rem] border border-dashed border-primary/25 bg-primary/5 shadow-sm dark:bg-primary/10">
          <button
            type="button"
            aria-expanded={isPracticeExpanded}
            aria-controls="practice-game-list"
            onClick={() => setIsPracticeExpanded(expanded => !expanded)}
            className={`flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition hover:bg-primary/8 sm:px-6 ${isPracticeExpanded ? 'border-b border-primary/18' : ''}`}
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="cute-pill flex h-7 w-7 items-center justify-center rounded-2xl">
                  <Gamepad2 className="h-4 w-4" />
                </span>
                <h3 className="text-sm font-black text-foreground">연습 게임</h3>
                <span className="rounded-full border border-primary/20 bg-white/70 px-2 py-0.5 text-[9px] font-black text-primary dark:bg-primary/10">
                  FREE PLAY
                </span>
              </div>
              <p className="mt-1.5 text-[10px] font-bold text-muted-foreground">
                오늘의 게임과 관계없이 무료로 플레이할 수 있습니다. (보상 X)
              </p>
            </div>
            <span className="cute-pill flex h-8 w-8 shrink-0 items-center justify-center rounded-full shadow-sm">
              <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${isPracticeExpanded ? 'rotate-180' : ''}`} />
            </span>
          </button>

          {isPracticeExpanded && (
            <div id="practice-game-list" className="grid gap-3 p-4 animate-in fade-in slide-in-from-top-2 duration-200 sm:grid-cols-3 sm:p-5 xl:grid-cols-5">
              {GAME_TYPES.map((gameType) => {
                const details = DAILY_GAME_DETAILS[gameType];
                const PracticeIcon = details.Icon;

                return (
                  <article
                    key={gameType}
                    className="cute-card-pop flex flex-col justify-between rounded-[1.75rem] border border-border/80 bg-card/90 p-4 shadow-sm hover:border-primary/35 hover:shadow-md"
                  >
                    <div>
                      <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${details.iconBackground} ${details.accent}`}>
                        <PracticeIcon className="h-4.5 w-4.5" />
                      </div>
                      <h4 className="mt-3 text-xs font-black text-foreground">{details.title}</h4>
                      <p className="mt-1.5 line-clamp-3 text-[10px] leading-relaxed text-muted-foreground">
                        {details.description}
                      </p>
                    </div>
                    <button
                      onClick={() => handleStartGame(gameType, true)}
                      disabled={gameBusy}
                      className="cute-wiggle-hover mt-4 flex w-full items-center justify-center gap-1 rounded-2xl border border-primary/20 bg-primary/10 px-2.5 py-2 text-[10px] font-black text-primary transition hover:bg-primary/15 active:scale-95 disabled:pointer-events-none disabled:opacity-40"
                    >
                      연습 시작
                    </button>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* ======================================================== */}
      {/* 인게임 뷰 영역 */}
      {/* ======================================================== */}
      {activeGame && gameData && (
        <div
          className="cute-surface relative mx-auto flex min-h-[calc(100dvh-10rem)] w-full max-w-5xl flex-col overflow-hidden overscroll-x-contain rounded-[2rem] p-4 animate-in zoom-in-95 duration-200 sm:p-6 md:min-h-[calc(100dvh-4rem)]"
          style={{ overscrollBehaviorX: 'contain' }}
          onTouchStart={(event) => event.stopPropagation()}
          onTouchMove={(event) => event.stopPropagation()}
          onTouchEnd={(event) => event.stopPropagation()}
        >

          {/* 아케이드 3초 카운트다운 오버레이 */}
          {countdownLeft !== null && countdownLeft > 0 && (
            <div className="absolute inset-0 z-40 flex select-none flex-col items-center justify-center bg-sky-950/88 backdrop-blur-xs pointer-events-auto">
              <div className="text-center space-y-3 animate-in zoom-in-90 duration-200">
                <span className="text-[10px] font-black tracking-widest text-primary bg-primary/10 border border-primary/20 px-3.5 py-1 rounded-full animate-pulse">
                  READY?
                </span>
                <div className="cute-number-font text-7xl font-black text-primary drop-shadow-[0_0_24px_rgba(67,228,210,0.65)] animate-ping scale-110">
                  {countdownLeft}
                </div>
                <p className="text-[10px] text-muted-foreground font-extrabold uppercase tracking-wide">Get Ready for Action</p>
              </div>
            </div>
          )}

          {/* 게임 상단 제어 바 */}
          <div className="mb-5 flex shrink-0 items-center justify-between border-b border-border/60 pb-3">
            <button
              type="button"
              onClick={handleAbandonGame}
              disabled={gameBusy}
              className="flex items-center gap-1 text-xs font-bold text-muted-foreground transition hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
            >
              <ChevronLeft className="h-4 w-4" /> {gameBusy ? '처리 중' : '포기하고 나가기'}
            </button>

            {isPracticeMode ? (
              <div className="flex select-none items-center gap-1 rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-[10px] font-black text-primary shadow-xs">
                <Gamepad2 className="h-3 w-3" />
                연습 모드 · 동전 미소모
              </div>
            ) : (
              <div className="flex select-none items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-[10px] font-black text-blue-950 shadow-xs dark:border-border/40 dark:bg-secondary/70 dark:text-foreground">
                <span className="text-primary">🪙</span>
                <span>남은 코인: <strong className="cute-number-font text-primary">{tickets}</strong></span>
              </div>
            )}

            <span className="text-xs font-black text-primary capitalize flex items-center gap-1.5">
              <Gamepad2 className="h-4 w-4" />
              {activeGame === 'quiz' && '❓ 송출 오류난 스트리머 맞추기'}
              {activeGame === 'puzzle' && '🧩 3x4 회전 퍼즐'}
              {activeGame === 'match' && '🎴 짝맞추기 카드게임'}
              {activeGame === 'value_duel' && '📈 시세 듀얼'}
              {activeGame === 'crop_detective' && '🔎 카드 확대 탐정'}
            </span>
          </div>

          {/* 공통 로딩 오버레이 */}
          {gameBusy && !gameResult && (
            <div className="absolute inset-0 z-45 flex flex-col items-center justify-center bg-black/60 backdrop-blur-xs">
              <RefreshCw className="h-8 w-8 text-primary animate-spin mb-2" />
              <p className="text-xs text-white/90 font-bold">
                {isPracticeMode ? '연습 게임 결과 확인 중...' : '결과 채점 및 포인트 지급 처리 중...'}
              </p>
            </div>
          )}

          {submitRetry && !gameBusy && !gameResult && (
            <div className="absolute inset-0 z-45 flex flex-col items-center justify-center bg-black/55 backdrop-blur-xs px-6 text-center">
              <div className="rounded-3xl border border-primary/25 bg-card/95 px-5 py-4 shadow-xl">
                <RefreshCw className="mx-auto mb-2 h-7 w-7 animate-spin text-primary" />
                <p className="text-sm font-black text-foreground">결과 전송을 다시 시도 중입니다</p>
                <p className="mt-1 text-[11px] font-bold text-muted-foreground">
                  성공 기록은 유지한 채 연결이 복구되는 대로 자동 제출합니다.
                </p>
              </div>
            </div>
          )}

          {/* ======================================================== */}
          {/* 게임 1: 인물 퀴즈 */}
          {/* ======================================================== */}
          {activeGame === 'quiz' && gameData.rounds && (() => {
            const currentRound = gameData.rounds[roundIndex];
            if (!isQuizRound(currentRound)) return null;
            const protectedRoundImage = isProtectedMinigameImage(currentRound.image_url);
            const currentRoundImageUrl = resolveMinigameImage(currentRound.image_url);
            const selectedId = roundFeedback?.selected_channel_id || null;
            const correctIds = roundFeedback?.correct_channel_ids || [];
            const imageBlindEnabled = Boolean(roundFeedback);

            return (
              <div className="flex flex-1 flex-col items-center justify-center space-y-5 sm:space-y-6">
                <GameTimeLimit
                  timeLeft={roundTimeLeft}
                  totalSeconds={QUIZ_TIME_LIMIT_SECONDS}
                  dangerSeconds={3}
                  bonusLabel="5문제 만점 보너스"
                  pausedLabel={roundFeedback ? '결과 확인' : undefined}
                />

                <div className="flex w-full max-w-3xl flex-wrap items-center justify-between gap-2 rounded-2xl border border-emerald-500/20 bg-emerald-500/8 px-3 py-2 text-[10px] font-black text-emerald-800 dark:text-emerald-200 sm:text-xs">
                  <span>문제 <span className="cute-number-font">{roundIndex + 1}</span>/{roundTotalRounds}</span>
                  <span>현재 정답 <span className="cute-number-font">{roundCorrectCount}</span>개</span>
                  <span>2지선다 · 각 문제 <span className="cute-number-font">{QUIZ_TIME_LIMIT_SECONDS}</span>초</span>
                </div>

                <div
                  className="arcade-quiz-card relative flex aspect-[5/8] items-center justify-center overflow-hidden rounded-[1.75rem] border border-border/80 bg-sky-950 shadow-[0_18px_44px_rgba(7,89,133,0.26)]"
                  onContextMenu={(event) => {
                    openImageBlindMenu(event, currentRoundImageUrl, imageBlindEnabled);
                  }}
                  title="우클릭으로 같은 이미지를 블라인드/해제"
                >
                  {protectedRoundImage && (
                    <BlindableCardImage
                      src={currentRoundImageUrl}
                      alt="Quiz card"
                      className="h-full w-full object-cover select-none pointer-events-none"
                      imageBlindMenuEnabled={imageBlindEnabled}
                    />
                  )}

                  {!protectedRoundImage && quizBlurType === 'gaussian' && (
                    <BlindableCardImage
                      src={currentRoundImageUrl}
                      alt="Quiz card"
                      style={{
                        filter: `blur(${(quizIntensity / 100) * QUIZ_GAUSSIAN_MAX_BLUR_PX}px) contrast(1.1)`,
                      }}
                      className="h-full w-full object-cover select-none pointer-events-none transition-all duration-75"
                      imageBlindMenuEnabled={imageBlindEnabled}
                    />
                  )}

                  {!protectedRoundImage && quizBlurType === 'mosaic' && (
                    <MosaicQuizImage src={currentRoundImageUrl} intensity={quizIntensity} />
                  )}

                  {!protectedRoundImage && quizBlurType === 'motion' && (
                    <MotionBlurQuizImage
                      src={currentRoundImageUrl}
                      intensity={quizIntensity}
                      angle={quizBlurAngle}
                    />
                  )}

                  {!protectedRoundImage && quizBlurType === 'radial' && (
                    <RadialBlurQuizImage
                      src={currentRoundImageUrl}
                      intensity={quizIntensity}
                      angle={quizBlurAngle}
                    />
                  )}

                  {!protectedRoundImage && quizIntensity > 0 && (
                    <div className="pointer-events-none absolute left-2.5 top-2.5 flex select-none items-center gap-1 rounded-full border border-white/20 bg-sky-950/72 px-1.5 py-0.5 text-[8px] font-black tracking-wider text-rose-300 animate-pulse sm:left-3.5 sm:top-3.5 sm:px-2 sm:py-1 sm:text-[10px]">
                      <span className="inline-block h-1.5 w-1.5 rounded-full bg-rose-600 animate-ping sm:h-2 sm:w-2" />
                      <span>DECRYPTING {Math.round(100 - quizIntensity)}%</span>
                    </div>
                  )}
                </div>

                <div className="space-y-1.5 text-center">
                  <p className="flex items-center justify-center gap-1.5 text-xs font-black text-muted-foreground sm:text-sm">
                    <span>📡</span>
                    <span>
                      {protectedRoundImage && '서버 비식별 이미지 전송 방식'}
                      {!protectedRoundImage && quizBlurType === 'gaussian' && '가우시안 블러 전송 방식'}
                      {!protectedRoundImage && quizBlurType === 'mosaic' && '픽셀 모자이크 전송 방식'}
                      {!protectedRoundImage && quizBlurType === 'motion' && '강한 방향성 모션 잔상 방식'}
                      {!protectedRoundImage && quizBlurType === 'radial' && '방사형 소용돌이 복원 방식'}
                    </span>
                  </p>
                  <p className="max-w-lg text-[10px] leading-relaxed text-muted-foreground sm:text-xs">
                    {protectedRoundImage
                      ? '서버에서 안전하게 흐린 카드입니다. 10초 안에 둘 중 한 명을 골라주세요!'
                      : '10초 동안 점점 선명해집니다. 둘 중 누구의 카드인지 골라주세요!'}
                  </p>
                </div>

                <div className="grid w-full max-w-3xl grid-cols-2 gap-2.5 sm:gap-4">
                  {currentRound.choices.map((choice) => {
                    const selected = selectedId === choice.channel_id;
                    const correct = correctIds.includes(choice.channel_id);
                    const wrong = selected && roundFeedback?.correct === false;
                    return (
                      <button
                        key={choice.channel_id}
                        onClick={() => handleRoundChoice(choice.channel_id)}
                        disabled={Boolean(roundFeedback) || roundChecking || gameBusy || isGameOver || roundTimeLeft <= 0 || (countdownLeft !== null && countdownLeft > 0)}
                        className={`cute-card-pop rounded-2xl border p-3.5 text-center text-xs font-extrabold transition sm:p-5 sm:text-base ${
                          correct
                            ? 'border-emerald-400 bg-emerald-500/12 text-emerald-700 ring-2 ring-emerald-400/50 dark:text-emerald-300'
                            : wrong
                              ? 'border-rose-400 bg-rose-500/12 text-rose-700 ring-2 ring-rose-400/50 dark:text-rose-300'
                              : selected
                                ? 'border-primary bg-primary/10 text-primary shadow-sm'
                                : 'border-border bg-secondary/35 text-foreground hover:-translate-y-0.5 hover:bg-secondary/70'
                        }`}
                      >
                        {choice.name}
                      </button>
                    );
                  })}
                </div>

                <div className="min-h-16 w-full max-w-3xl">
                  {roundChecking && (
                    <div className="flex items-center justify-center gap-2 rounded-2xl border border-border bg-secondary/45 px-4 py-3 text-xs font-black text-muted-foreground">
                      <RefreshCw className="h-4 w-4 animate-spin text-primary" />
                      라운드 결과 확인 중
                    </div>
                  )}
                  {roundFeedback && (
                    <div className={`flex flex-col gap-3 rounded-2xl border px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${
                      roundFeedback.locked
                        ? 'border-primary/35 bg-primary/10 text-primary'
                        : roundFeedback.correct
                        ? 'border-emerald-400/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                        : 'border-rose-400/35 bg-rose-500/10 text-rose-700 dark:text-rose-300'
                    }`}>
                      <div>
                        <p className="text-sm font-black">{roundFeedback.locked ? '답안 저장 완료' : roundFeedback.correct ? '정답입니다' : roundFeedback.timed_out ? '시간 초과' : '오답입니다'}</p>
                        <p className="mt-0.5 text-[10px] font-bold text-muted-foreground">
                          {roundFeedback.locked ? '서버에 저장된 결과를 이어서 확인합니다.' : roundFeedback.correct ? '좋습니다. 다음 문제로 이어가세요.' : '다음 문제에서 만회할 수 있습니다.'}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={handleRoundContinue}
                        disabled={isGameOver}
                        className="cute-wiggle-hover rounded-2xl bg-primary px-4 py-2 text-xs font-black text-primary-foreground active:scale-95 disabled:pointer-events-none disabled:opacity-55"
                      >
                        {roundIndex >= roundTotalRounds - 1 ? '최종 결과 확인' : '다음 문제'}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* ======================================================== */}
          {/* 게임 2: 카드 퍼즐 (가로 3칸 세로 4칸 정사각형 조각 3:4 크롭) */}
          {/* ======================================================== */}
          {activeGame === 'puzzle' && (
            <div className="flex flex-1 flex-col items-center justify-center space-y-4 sm:space-y-5">
              <GameTimeLimit
                timeLeft={puzzleTimeLeft}
                totalSeconds={PUZZLE_TIME_LIMIT_SECONDS}
                dangerSeconds={15}
                bonusLabel="30초 보너스"
              />

              <p className="max-w-2xl text-center text-xs font-bold text-muted-foreground sm:text-sm">
                조각을 드래그해서 위치를 바꾸고, 탭하면 90도씩 회전합니다. 120초 안에 위치와 회전을 모두 맞춰주세요!
              </p>

              <div className="flex w-full max-w-[min(30rem,calc(100vw_-_4rem))] flex-col gap-2 rounded-2xl border border-teal-500/15 bg-teal-500/8 p-3 shadow-sm dark:border-teal-300/15 dark:bg-teal-400/10 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                <div className="min-w-0 text-center sm:text-left">
                  <p className="text-[10px] font-black text-teal-700 dark:text-teal-200 sm:text-xs">
                    이미지가 어렵다면 순서 힌트를 사용하세요.
                  </p>
                  <p className="mt-0.5 text-[9px] font-bold text-muted-foreground sm:text-[10px]">
                    1회만 사용 가능 · 제한시간 -{PUZZLE_HINT_PENALTY_SECONDS}초 · 퍼즐 조각 순서 {PUZZLE_HINT_DURATION_MS / 1000}초간 표시
                  </p>
                </div>

                <div className="group relative flex justify-center sm:justify-end">
                  <button
                    type="button"
                    onClick={handleUsePuzzleHint}
                    disabled={puzzleHintUsed || gameBusy || isGameOver || !!gameResult || (countdownLeft !== null && countdownLeft > 0)}
                    className={`cute-wiggle-hover inline-flex items-center justify-center gap-1.5 rounded-2xl border px-3.5 py-2 text-[11px] font-black shadow-sm transition active:scale-95 disabled:pointer-events-none disabled:opacity-55 sm:px-4 sm:text-xs ${
                      puzzleHintUsed
                        ? 'border-border bg-secondary/70 text-muted-foreground'
                        : 'border-teal-500/30 bg-gradient-to-r from-teal-500 to-primary text-white shadow-teal-500/15 hover:brightness-105 dark:from-teal-400 dark:to-primary dark:text-slate-950'
                    }`}
                    aria-describedby="puzzle-hint-tooltip"
                  >
                    <Eye className="h-3.5 w-3.5" />
                    {puzzleHintUsed ? '힌트 사용 완료' : '순서 힌트'}
                  </button>
                  <div
                    id="puzzle-hint-tooltip"
                    role="tooltip"
                    className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 w-64 -translate-x-1/2 rounded-2xl border border-border bg-popover px-3 py-2 text-center text-[10px] font-bold leading-relaxed text-popover-foreground opacity-0 shadow-xl transition group-hover:opacity-100 group-focus-within:opacity-100 dark:border-white/12 sm:left-auto sm:right-0 sm:translate-x-0 sm:text-left"
                  >
                    각 퍼즐 조각에 원래 순서 번호(1~12)를 {PUZZLE_HINT_DURATION_MS / 1000}초간 반투명하게 표시합니다. 사용 즉시 제한시간이 {PUZZLE_HINT_PENALTY_SECONDS}초 줄어듭니다.
                  </div>
                </div>
              </div>

              {/* 원본의 중앙 3:4 영역을 실제 좌표로 크롭한 뒤 정사각형 12개로 분할 */}
              <div className="rounded-[1.75rem] border border-border bg-secondary/30 p-1.5 shadow-inner">
                <div
                  className="arcade-puzzle-board grid aspect-[3/4] grid-cols-3 grid-rows-4 overflow-hidden rounded-2xl touch-none select-none"
                  onContextMenu={(event) => {
                    openImageBlindMenu(event, gameData.image_url || '', Boolean(isGameOver || gameResult));
                  }}
                  title="우클릭으로 같은 이미지를 블라인드/해제"
                >
                  {puzzlePieces.map((piece, idx) => {
                    const isDragging = draggingPuzzleIndex === idx;
                    const isDropTarget = dragOverPuzzleIndex === idx;

                    return (
                      <button
                        type="button"
                        key={`${piece.id}-${idx}`}
                        data-puzzle-index={idx}
                        onPointerDown={(event) => handlePuzzlePointerDown(event, idx)}
                        onPointerMove={(event) => handlePuzzlePointerMove(event, idx)}
                        onPointerUp={(event) => handlePuzzlePointerUp(event, idx)}
                        onPointerCancel={handlePuzzlePointerCancel}
                        className={`relative h-full w-full min-h-0 min-w-0 cursor-grab overflow-hidden ring-1 ring-inset ring-card/45 transition-[transform,opacity,box-shadow,filter] duration-200 active:cursor-grabbing active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${isDragging ? 'opacity-55 brightness-75 shadow-inner' : ''} ${isDropTarget ? 'z-10 ring-2 ring-primary ring-offset-1 ring-offset-background brightness-110' : ''}`}
                        aria-label={`퍼즐 조각 ${idx + 1}: 탭하면 회전, 드래그하면 위치 교체`}
                      >
                        <div
                          className="absolute inset-0 transition-transform duration-200"
                          style={{
                            transform: `rotate(${piece.rotation}deg)`,
                          }}
                        >
                          <PuzzlePieceImage src={gameData.image_url || ''} pieceId={piece.id} />
                        </div>
                        {showPuzzleHint && (
                          <span className="pointer-events-none absolute inset-0 z-20 flex select-none items-center justify-center bg-white/8 text-[clamp(1.6rem,9vw,3.4rem)] cute-number-font font-black text-white/68 opacity-95 [text-shadow:0_2px_10px_rgba(0,0,0,0.55)] dark:bg-black/8 dark:text-white/62">
                            {piece.id + 1}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center gap-1 rounded-full border border-border/70 bg-secondary/60 px-2.5 py-1 text-[10px] font-bold text-muted-foreground sm:px-3.5 sm:py-2 sm:text-xs">
                <Clock className="h-3 w-3 sm:h-4 sm:w-4" /> 모든 조각이 제자리이고 정답 각도이면 자동 완성됩니다.
              </div>
            </div>
          )}

          {/* ======================================================== */}
          {/* 게임 4: 시세 듀얼 */}
          {/* ======================================================== */}
          {activeGame === 'value_duel' && gameData.rounds && (() => {
            const currentRound = gameData.rounds[roundIndex];
            if (!isValueDuelRound(currentRound)) return null;
            const selectedId = roundFeedback?.selected_channel_id || null;
            const correctIds = roundFeedback?.correct_channel_ids || [];
            const leftState = {
              selected: selectedId === currentRound.left.channel_id,
              correct: correctIds.includes(currentRound.left.channel_id),
              wrong: selectedId === currentRound.left.channel_id && roundFeedback?.correct === false
            };
            const rightState = {
              selected: selectedId === currentRound.right.channel_id,
              correct: correctIds.includes(currentRound.right.channel_id),
              wrong: selectedId === currentRound.right.channel_id && roundFeedback?.correct === false
            };

            return (
              <div className="flex flex-1 flex-col items-center justify-center space-y-4 sm:space-y-5">
                <GameTimeLimit
                  timeLeft={roundTimeLeft}
                  totalSeconds={ROUND_GAME_ROUND_SECONDS}
                  dangerSeconds={3}
                  bonusLabel="5문제 만점 보너스"
                  pausedLabel={roundFeedback ? '결과 확인' : undefined}
                />

                <div className="flex w-full max-w-3xl flex-wrap items-center justify-between gap-2 rounded-2xl border border-amber-500/20 bg-amber-500/8 px-3 py-2 text-[10px] font-black text-amber-800 dark:text-amber-200 sm:text-xs">
                  <span>문제 <span className="cute-number-font">{roundIndex + 1}</span>/{roundTotalRounds}</span>
                  <span>현재 정답 <span className="cute-number-font">{roundCorrectCount}</span>개</span>
                  <span>각 문제 <span className="cute-number-font">{ROUND_GAME_ROUND_SECONDS}</span>초</span>
                </div>

                <div className="grid w-full max-w-3xl grid-cols-2 gap-3 sm:gap-5">
                  <CardImageTile
                    card={currentRound.left}
                    showStarLabel={false}
                    disabled={Boolean(roundFeedback) || roundChecking || gameBusy || isGameOver || (countdownLeft !== null && countdownLeft > 0)}
                    imageBlindEnabled={Boolean(roundFeedback)}
                    onClick={() => handleRoundChoice(currentRound.left.channel_id)}
                    {...leftState}
                  />
                  <CardImageTile
                    card={currentRound.right}
                    showStarLabel={false}
                    disabled={Boolean(roundFeedback) || roundChecking || gameBusy || isGameOver || (countdownLeft !== null && countdownLeft > 0)}
                    imageBlindEnabled={Boolean(roundFeedback)}
                    onClick={() => handleRoundChoice(currentRound.right.channel_id)}
                    {...rightState}
                  />
                </div>

                <div className="min-h-16 w-full max-w-3xl">
                  {roundChecking && (
                    <div className="flex items-center justify-center gap-2 rounded-2xl border border-border bg-secondary/45 px-4 py-3 text-xs font-black text-muted-foreground">
                      <RefreshCw className="h-4 w-4 animate-spin text-primary" />
                      라운드 결과 확인 중
                    </div>
                  )}
                  {roundFeedback && (
                    <div className={`flex flex-col gap-3 rounded-2xl border px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${
                      roundFeedback.locked
                        ? 'border-primary/35 bg-primary/10 text-primary'
                        : roundFeedback.correct
                        ? 'border-emerald-400/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                        : 'border-rose-400/35 bg-rose-500/10 text-rose-700 dark:text-rose-300'
                    }`}>
                      <div>
                        <p className="text-sm font-black">{roundFeedback.locked ? '답안 저장 완료' : roundFeedback.correct ? '정답입니다' : roundFeedback.timed_out ? '시간 초과' : '오답입니다'}</p>
                        <p className="mt-0.5 text-[10px] font-bold text-muted-foreground">
                          {roundFeedback.locked ? '서버에 저장된 결과를 이어서 확인합니다.' : roundFeedback.correct ? '좋습니다. 다음 문제로 이어가세요.' : '다음 문제에서 만회할 수 있습니다.'}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={handleRoundContinue}
                        disabled={isGameOver || roundStartBusy}
                        aria-busy={roundStartBusy}
                        className="cute-wiggle-hover inline-flex items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-2 text-xs font-black text-primary-foreground active:scale-95 disabled:pointer-events-none disabled:opacity-55"
                      >
                        {roundStartBusy ? (
                          <>
                            <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                            다음 문제 준비 중
                          </>
                        ) : roundIndex >= roundTotalRounds - 1 ? '최종 결과 확인' : '다음 문제'}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* ======================================================== */}
          {/* 게임 5: 카드 확대 탐정 */}
          {/* ======================================================== */}
          {activeGame === 'crop_detective' && gameData.rounds && (() => {
            const currentRound = gameData.rounds[roundIndex];
            if (!isCropDetectiveRound(currentRound)) return null;

            return (
              <div className="flex flex-1 flex-col items-center justify-center space-y-4 sm:space-y-5">
                <GameTimeLimit
                  timeLeft={roundTimeLeft}
                  totalSeconds={ROUND_GAME_ROUND_SECONDS}
                  dangerSeconds={3}
                  bonusLabel="5문제 만점 보너스"
                  pausedLabel={roundFeedback ? '결과 확인' : !cropDetectiveRoundReady ? '이미지 준비 중' : undefined}
                />

                <div className="flex w-full max-w-4xl flex-wrap items-center justify-between gap-2 rounded-2xl border border-fuchsia-500/20 bg-fuchsia-500/8 px-3 py-2 text-[10px] font-black text-fuchsia-800 dark:text-fuchsia-200 sm:text-xs">
                  <span>문제 <span className="cute-number-font">{roundIndex + 1}</span>/{roundTotalRounds}</span>
                  <span>현재 정답 <span className="cute-number-font">{roundCorrectCount}</span>개</span>
                  <span>각 문제 <span className="cute-number-font">{ROUND_GAME_ROUND_SECONDS}</span>초</span>
                </div>

                <CropDetectiveChoices
                  round={currentRound}
                  roundFeedback={roundFeedback}
                  roundChecking={roundChecking}
                  gameBusy={gameBusy}
                  isGameOver={isGameOver}
                  countdownLeft={countdownLeft}
                  skipProtectedImage={
                    !isPracticeMode && roundDeadlineSyncAt !== null && roundTimeLeft <= 0
                  }
                  onRoundReady={handleCropDetectiveRoundReady}
                  onRoundImageFailed={handleCropDetectiveImageFailure}
                  onChoice={handleRoundChoice}
                />

                <div className="min-h-16 w-full max-w-4xl">
                  {roundChecking && (
                    <div className="flex items-center justify-center gap-2 rounded-2xl border border-border bg-secondary/45 px-4 py-3 text-xs font-black text-muted-foreground">
                      <RefreshCw className="h-4 w-4 animate-spin text-primary" />
                      라운드 결과 확인 중
                    </div>
                  )}
                  {roundFeedback && (
                    <div className={`flex flex-col gap-3 rounded-2xl border px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${
                      roundFeedback.locked
                        ? 'border-primary/35 bg-primary/10 text-primary'
                        : roundFeedback.correct
                        ? 'border-emerald-400/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                        : 'border-rose-400/35 bg-rose-500/10 text-rose-700 dark:text-rose-300'
                    }`}>
                      <div>
                        <p className="text-sm font-black">{roundFeedback.locked ? '답안 저장 완료' : roundFeedback.correct ? '정답입니다' : roundFeedback.timed_out ? '시간 초과' : '오답입니다'}</p>
                        <p className="mt-0.5 text-[10px] font-bold text-muted-foreground">
                          {roundFeedback.locked ? '서버에 저장된 결과를 이어서 확인합니다.' : roundFeedback.correct ? '확대 조각을 정확히 찾았습니다.' : '후보 카드의 이미지 패턴을 다시 살펴보세요.'}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={handleRoundContinue}
                        disabled={isGameOver}
                        className="cute-wiggle-hover rounded-2xl bg-primary px-4 py-2 text-xs font-black text-primary-foreground active:scale-95 disabled:pointer-events-none disabled:opacity-55"
                      >
                        {roundIndex >= roundTotalRounds - 1 ? '최종 결과 확인' : '다음 문제'}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* ======================================================== */}
          {/* 게임 3: 짝맞추기 뒤집기 (2초 선공개, 30초 시간제한, 3D 플립 모션) */}
          {/* ======================================================== */}
          {activeGame === 'match' && (
            <div className="flex flex-1 flex-col items-center justify-center space-y-4">

              <GameTimeLimit
                timeLeft={gameTimeLeft}
                totalSeconds={MATCH_TIME_LIMIT_SECONDS}
                dangerSeconds={10}
                bonusLabel="10초 보너스"
                pausedLabel={revealActive ? '카드를 기억하세요!' : undefined}
              />

              {/* 카드 비율 4:5를 유지하는 3x4 / 4x3 반응형 매칭 보드 */}
              <div className="arcade-match-board grid aspect-[3/5] grid-cols-3 grid-rows-4 gap-2 rounded-[1.75rem] border border-border/60 bg-secondary/30 p-1.5 shadow-inner sm:aspect-[16/15] sm:grid-cols-4 sm:grid-rows-3 sm:gap-3 sm:p-2">
                {matchCards.map((card, idx) => {
                  // 선공개 중이거나 뒤집혔거나 이미 맞춘 경우 앞면 노출
                  const showFront = revealActive || card.isFlipped || card.isMatched;
                  return (
                    <div
                      key={card.card_id}
                      onClick={() => handleFlipCard(idx)}
                      className={`perspective group relative h-full min-h-0 w-full min-w-0 cursor-pointer transition-all duration-300 ${
                        card.isMatched ? 'scale-95' : ''
                      }`}
                    >
                      <div
                        className={`relative w-full h-full card-inner-transition transform-style preserve-3d ${showFront ? 'rotate-y-180' : ''
                          } ${card.isMatched ? '' : 'group-hover:scale-102'
                          }`}
                      >
                        {/* 카드 뒷면 (3D Backface) */}
                        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center overflow-hidden rounded-2xl border-2 border-white/55 bg-gradient-to-br from-sky-300 via-primary to-teal-400 shadow-lg backface-hidden group/back">
                          <div className="absolute inset-0 bg-[radial-gradient(circle,rgba(255,255,255,0.22)_1px,transparent_1.6px)] bg-[size:12px_12px] pointer-events-none" />

                          {/* 미래형 홀로그램 회전 서클 */}
                          <div className="arcade-match-orbit pointer-events-none absolute flex items-center justify-center rounded-full border border-white/30 animate-[spin_12s_linear_infinite]">
                            <div className="h-3/4 w-3/4 rounded-full border border-dashed border-white/55" />
                          </div>

                          {/* 모서리 데코 포인트 */}
                          <div className="absolute left-1 top-1 h-2 w-2 rounded-tl-lg border-l border-t border-white/70" />
                          <div className="absolute right-1 top-1 h-2 w-2 rounded-tr-lg border-r border-t border-white/70" />
                          <div className="absolute bottom-1 left-1 h-2 w-2 rounded-bl-lg border-b border-l border-white/70" />
                          <div className="absolute bottom-1 right-1 h-2 w-2 rounded-br-lg border-b border-r border-white/70" />

                          {/* 중앙 로고 */}
                          <div className="relative z-10 flex select-none flex-col items-center gap-1">
                            <div className="arcade-match-back-logo flex items-center justify-center rounded-2xl bg-white/28 p-0.5 shadow-[0_0_18px_rgba(255,255,255,0.34)] transition-transform duration-300 group-hover/back:rotate-12">
                              <div className="flex h-full w-full items-center justify-center rounded-[14px] bg-white/22">
                                <Gamepad2 className="h-1/2 w-1/2 text-white" />
                              </div>
                            </div>
                            <span className="arcade-match-back-label mt-1.5 font-black uppercase tracking-widest text-white drop-shadow">CHZZK CARD</span>
                          </div>

                          {/* 광택 반사 글레어 효과 */}
                          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:animate-[shimmer_1.5s_infinite] pointer-events-none" />
                        </div>

                        {/* 카드 앞면 (3D Frontface) */}
                        <div className="arcade-match-front absolute inset-0 flex flex-col items-center justify-between overflow-hidden rounded-2xl border-2 border-white bg-gradient-to-b from-white to-secondary backface-hidden rotate-y-180 shadow-xl dark:border-border dark:from-card dark:to-secondary">
                          <div className="absolute left-1 top-1 h-1.5 w-1.5 rounded-tl border-l border-t border-primary/30" />
                          <div className="absolute right-1 top-1 h-1.5 w-1.5 rounded-tr border-r border-t border-primary/30" />

                          <div className="w-full flex-1 flex flex-col items-center justify-center mt-1">
                            <div className="relative rounded-full bg-gradient-to-tr from-primary to-teal-400 p-0.5 shadow-md">
                              <img
                                src={card.logo_url || '/icon.png'}
                                alt={card.name}
                                className="arcade-match-avatar pointer-events-none select-none rounded-full border-2 border-white object-cover dark:border-card"
                              />
                            </div>
                          </div>

                          <div className="arcade-match-nameplate mt-2 w-full rounded-xl border border-border/70 bg-white/82 text-center shadow-sm dark:bg-card/82">
                            <p className="arcade-match-name truncate font-black text-foreground drop-shadow-sm select-none">
                              {card.name}
                            </p>
                          </div>

                          {/* 짝 맞춤 성공 시 카드를 어둡게 처리하는 반투명 오버레이 */}
                          {card.isMatched && (
                            <div className="absolute inset-0 z-20 rounded-2xl bg-primary/20 pointer-events-none transition-all duration-300 animate-in fade-in" />
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

        </div>
      )}

      {imageBlindMenu && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed z-[130] w-52 overflow-hidden rounded-2xl border border-border bg-card/95 p-1.5 text-xs shadow-2xl backdrop-blur-md animate-in fade-in duration-100"
          style={{ left: imageBlindMenu.x, top: imageBlindMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            onClick={async () => {
              if (isImageBlinded(imageBlindMenu.imageUrl)) await unblindImage(imageBlindMenu.imageUrl);
              else await blindImage(imageBlindMenu.imageUrl);
              setImageBlindMenu(null);
            }}
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left font-black text-foreground transition hover:bg-secondary/80"
          >
            {isImageBlinded(imageBlindMenu.imageUrl) ? '👁️ 이미지 블라인드 해제' : '🚫 같은 이미지 블라인드'}
          </button>
        </div>,
        document.body
      )}

      {/* 뒤집기 원복용/원형 원근 CSS 주입 */}
      <style jsx global>{`
        .arcade-quiz-card {
          width: min(clamp(12rem, 28dvh, 18rem), calc(100vw - 4rem));
        }
        .arcade-puzzle-board {
          width: min(30rem, 48dvh, calc(100vw - 4rem));
        }
        .arcade-match-board {
          container-type: inline-size;
          width: min(calc(100vw - 3rem), 38dvh);
        }
        .arcade-match-orbit {
          width: clamp(2.5rem, 14cqw, 7rem);
          height: clamp(2.5rem, 14cqw, 7rem);
        }
        .arcade-match-back-logo {
          width: clamp(2rem, 9cqw, 5rem);
          height: clamp(2rem, 9cqw, 5rem);
        }
        .arcade-match-back-label {
          font-size: clamp(0.45rem, 1.7cqw, 0.85rem);
        }
        .arcade-match-front {
          padding: clamp(0.35rem, 2cqw, 1rem);
        }
        .arcade-match-avatar {
          width: clamp(2.5rem, 12cqw, 7rem);
          height: clamp(2.5rem, 12cqw, 7rem);
        }
        .arcade-match-nameplate {
          padding: clamp(0.2rem, 0.8cqw, 0.5rem) clamp(0.3rem, 1.2cqw, 0.75rem);
        }
        .arcade-match-name {
          font-size: clamp(0.55rem, 2cqw, 1rem);
        }
        @media (min-width: 640px) {
          .arcade-match-board {
            width: min(48rem, 66dvh, calc(100vw - 8rem));
          }
        }
        .perspective {
          perspective: 1200px;
        }
        .preserve-3d {
          transform-style: preserve-3d;
        }
        .backface-hidden {
          backface-visibility: hidden;
          -webkit-backface-visibility: hidden;
        }
        .rotate-y-180 {
          transform: rotateY(180deg);
        }
        .card-inner-transition {
          transition: transform 0.65s cubic-bezier(0.175, 0.885, 0.32, 1.275);
          will-change: transform;
        }
        @keyframes shimmer {
          100% {
            transform: translateX(100%);
          }
        }
      `}</style>

    </div>
  );
};
