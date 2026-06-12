'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { createPortal } from 'react-dom';
import { useApp } from './AppContext';
import { apiFetch } from '@/lib/api';
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

// 미니게임 타입 정의 (하이로우 제거)
type GameType = 'quiz' | 'puzzle' | 'match';
type QuizChoice = {
  channel_id: string;
  name: string;
};

type MatchCardSource = {
  channel_id: string;
  name: string;
  logo_url?: string | null;
};

type MatchCard = MatchCardSource & {
  id: number;
  isFlipped: boolean;
  isMatched: boolean;
};

type PuzzlePiece = {
  id: number;
  rotation: number;
};

type MinigameData = {
  image_url?: string;
  choices?: QuizChoice[];
  cards?: MatchCardSource[];
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
  matched_channel_ids?: string[];
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
  game_data: MinigameData;
  message?: string;
  practice_mode?: boolean;
  resumed?: boolean;
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

const GAME_TYPES: GameType[] = ['quiz', 'puzzle', 'match'];

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
  }
};

const PUZZLE_COLUMNS = 3;
const PUZZLE_ROWS = 4;
const PUZZLE_PIECE_COUNT = PUZZLE_COLUMNS * PUZZLE_ROWS;
const PUZZLE_TIME_LIMIT_SECONDS = 120;
const PUZZLE_HINT_PENALTY_SECONDS = 10;
const PUZZLE_HINT_DURATION_MS = 2000;
const MATCH_TIME_LIMIT_SECONDS = 30;
const QUIZ_TIME_LIMIT_SECONDS = 15;
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
  }, [scheduleDraw, src]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(scheduleDraw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [scheduleDraw]);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
    };
  }, []);

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
  }, [drawCanvas, src]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(drawCanvas);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [drawCanvas]);

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label="모자이크 처리된 퀴즈 카드"
      className="h-full w-full bg-zinc-950 select-none pointer-events-none"
    />
  );
};

const PuzzlePieceImage: React.FC<{ src: string; pieceId: number }> = ({ src, pieceId }) => {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !src) return;

    let cancelled = false;
    const image = new Image();
    image.decoding = 'async';
    image.fetchPriority = 'high';

    const drawPiece = () => {
      if (cancelled || !image.naturalWidth || !image.naturalHeight) return;

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

      // 원본의 중앙 3:4 영역을 먼저 계산하면 3x4로 나눈 각 영역은 정확한 정사각형이 됩니다.
      const targetRatio = PUZZLE_COLUMNS / PUZZLE_ROWS;
      const sourceRatio = image.naturalWidth / image.naturalHeight;
      let cropWidth = image.naturalWidth;
      let cropHeight = image.naturalHeight;
      let cropX = 0;
      let cropY = 0;

      if (sourceRatio > targetRatio) {
        cropWidth = image.naturalHeight * targetRatio;
        cropX = (image.naturalWidth - cropWidth) / 2;
      } else {
        cropHeight = image.naturalWidth / targetRatio;
        cropY = (image.naturalHeight - cropHeight) / 2;
      }

      const column = pieceId % PUZZLE_COLUMNS;
      const row = Math.floor(pieceId / PUZZLE_COLUMNS);
      const sourcePieceWidth = cropWidth / PUZZLE_COLUMNS;
      const sourcePieceHeight = cropHeight / PUZZLE_ROWS;

      context.drawImage(
        image,
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

    image.onload = drawPiece;
    image.src = src;
    if (image.complete) drawPiece();

    return () => {
      cancelled = true;
      image.onload = null;
    };
  }, [pieceId, src]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full select-none"
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

export const ArcadeTab: React.FC = () => {
  const { user, refreshUserData, toast } = useApp();
  const searchParams = useSearchParams();
  const router = useRouter();
  const autoStartRef = useRef(false); // URL 파라미터 기반 연습 자동 시작 1회 가드
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
  const [selectedQuizChoice, setSelectedQuizChoice] = useState<string | null>(null);
  const [quizBlurType, setQuizBlurType] = useState<'gaussian' | 'mosaic' | 'motion' | 'radial'>('gaussian');
  const [quizBlurAngle, setQuizBlurAngle] = useState<number>(0);
  const [quizIntensity, setQuizIntensity] = useState<number>(100);
  const [quizTimeLeft, setQuizTimeLeft] = useState<number>(15);
  const quizDeadlineRef = useRef<number | null>(null);

  // 2. 카드 퍼즐 전용 상태
  const [puzzlePieces, setPuzzlePieces] = useState<PuzzlePiece[]>([]);
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
  const [flippedIndices, setFlippedIndices] = useState<number[]>([]);
  const [revealActive, setRevealActive] = useState(false); // 시작 시 2초 공개 중인지 여부
  const [gameTimeLeft, setGameTimeLeft] = useState(MATCH_TIME_LIMIT_SECONDS);
  const [isGameOver, setIsGameOver] = useState(false);
  const matchDeadlineRef = useRef<number | null>(null);

  // 티켓 상태 조회 API 호출
  const fetchStatus = useCallback(async () => {
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
      }
    } catch (err) {
      console.error('티켓 조회 실패:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // 로비로 퇴장
  const handleExitGame = useCallback(() => {
    setActiveGame(null);
    setGameData(null);
    setGameResult(null);
    setSessionId(null);
    setIsGameOver(false);
    setIsPracticeMode(false);
    setPuzzleHintUsed(false);
    setShowPuzzleHint(false);
    quizDeadlineRef.current = null;
    puzzleDeadlineRef.current = null;
    matchDeadlineRef.current = null;
    if (puzzleHintTimeoutRef.current !== null) {
      window.clearTimeout(puzzleHintTimeoutRef.current);
      puzzleHintTimeoutRef.current = null;
    }
  }, []);

  // 게임 결과 제출 처리 (치팅 방지를 위해 백엔드에서 서버 시간 2중 검증함)
  const submitResult = useCallback(async (payload: SubmitPayload) => {
    if (!sessionId) return;
    const clientRemainingMs =
      activeGame === 'quiz' ? Math.max(0, quizTimeLeft * 1000)
        : activeGame === 'puzzle' ? Math.max(0, puzzleTimeLeft * 1000)
          : activeGame === 'match' ? Math.max(0, gameTimeLeft * 1000)
            : 0;
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
      const data = await res.json();
      if (res.ok) {
        setGameResult(data as MinigameResult);
        if (!data.practice_mode) refreshUserData(); // 일반 게임에서만 보유 자산 갱신
      } else {
        toast(data.message || '결과 처리 중 에러가 발생했습니다.', 'error');
        handleExitGame();
      }
    } catch {
      toast('결과 전송에 실패했습니다. 연결이 복구되면 다시 시도해 주세요.', 'warning');
      if (activeGame === 'quiz') {
        setSelectedQuizChoice(null);
      }
    } finally {
      setGameBusy(false);
    }
  }, [activeGame, gameTimeLeft, handleExitGame, puzzleTimeLeft, quizTimeLeft, refreshUserData, sessionId, toast]);

  useEffect(() => {
    if (user) {
      const timeout = window.setTimeout(() => {
        fetchStatus();
      }, 0);
      return () => window.clearTimeout(timeout);
    }
  }, [user, fetchStatus]);

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
            quizDeadlineRef.current = now + QUIZ_TIME_LIMIT_SECONDS * 1000;
            setQuizTimeLeft(QUIZ_TIME_LIMIT_SECONDS);
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
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [countdownLeft, activeGame]);

  // 짝맞추기 30초 인게임 타이머 구동
  useEffect(() => {
    if (activeGame !== 'match' || revealActive || gameResult || isGameOver || (countdownLeft !== null && countdownLeft > 0)) return;
    if (gameTimeLeft <= 0) {
      const timeout = window.setTimeout(() => {
        setIsGameOver(true);
        // 시간 제한 만료 실패 제출
        submitResult({ success: false });
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
  }, [activeGame, revealActive, gameTimeLeft, gameResult, isGameOver, countdownLeft, submitResult]);

  // 회전 퍼즐 120초 인게임 타이머 구동
  useEffect(() => {
    if (activeGame !== 'puzzle' || gameResult || isGameOver || (countdownLeft !== null && countdownLeft > 0)) return;
    if (puzzleTimeLeft <= 0) {
      const timeout = window.setTimeout(() => {
        setIsGameOver(true);
        submitResult({ success: false });
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
  }, [activeGame, countdownLeft, gameResult, isGameOver, puzzleTimeLeft, submitResult]);

  // 인물 퀴즈 15초 제한시간 타이머 구동
  useEffect(() => {
    if (activeGame !== 'quiz' || (countdownLeft !== null && countdownLeft > 0) || gameResult || selectedQuizChoice) return;
    if (quizTimeLeft <= 0) {
      const timeout = window.setTimeout(() => {
        submitResult({ success: false });
      }, 0);
      return () => window.clearTimeout(timeout);
    }
    const timer = setInterval(() => {
      setQuizTimeLeft(prev => {
        const deadline = quizDeadlineRef.current;
        if (!deadline) return Math.max(0, prev - 1);
        return Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [activeGame, countdownLeft, quizTimeLeft, gameResult, selectedQuizChoice, submitResult]);

  // 인물 퀴즈 블러 강도 감쇄 타이머 구동 (10초 동안 100 -> 0, 50ms 갱신)
  useEffect(() => {
    if (activeGame !== 'quiz' || (countdownLeft !== null && countdownLeft > 0) || gameResult || selectedQuizChoice) return;

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
  }, [activeGame, countdownLeft, quizStartTime, gameResult, selectedQuizChoice]);

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
    override?: { channelId?: string; star?: number | null; blur?: string | null }
  ) => {
    if (!practiceMode && (!todayGame || type !== todayGame)) {
      toast('오늘의 미니게임이 변경되었습니다. 최신 게임을 다시 불러옵니다.', 'warning');
      fetchStatus();
      return;
    }

    if (!practiceMode && tickets <= 0) {
      toast('사용 가능한 미니게임 티켓이 부족합니다.', 'warning');
      return;
    }

    setGameBusy(true);
    setGameResult(null);
    setSelectedQuizChoice(null);
    setFlippedIndices([]);
    setIsGameOver(false);
    setGameTimeLeft(MATCH_TIME_LIMIT_SECONDS);
    setPuzzleTimeLeft(PUZZLE_TIME_LIMIT_SECONDS);
    setPuzzleHintUsed(false);
    setShowPuzzleHint(false);
    quizDeadlineRef.current = null;
    puzzleDeadlineRef.current = null;
    matchDeadlineRef.current = null;
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
          ...(practiceMode && override?.star != null ? { force_star: override.star } : {})
        })
      });

      const data = (await res.json()) as StartGameResponse;
      if (!res.ok) {
        toast(data.message || '게임을 시작할 수 없습니다.', res.status === 409 ? 'warning' : 'error');
        fetchStatus();
        return;
      }

      setSessionId(data.session_id);
      setGameData(data.game_data);
      setActiveGame(type);
      setIsPracticeMode(data.practice_mode === true);
      if (data.resumed) {
        toast(data.message || '끊긴 미니게임 세션을 이어서 시작합니다.', 'info');
      }

      const isResumed = data.resumed === true;
      const remainingSeconds = data.timing?.time_remaining_ms !== undefined
        ? Math.max(0, Math.ceil(data.timing.time_remaining_ms / 1000))
        : null;

      // 게임별 초기 세팅값 설정
      if (type === 'quiz') {
        const quizRemaining = remainingSeconds ?? QUIZ_TIME_LIMIT_SECONDS;
        const elapsedPlayMs = Math.max(0, (data.timing?.time_limit_ms ?? QUIZ_TIME_LIMIT_SECONDS * 1000) - quizRemaining * 1000);
        setQuizStartTime(Date.now() - elapsedPlayMs);
        setQuizIntensity(Math.max(0, 100 - (elapsedPlayMs / 10_000) * 100));
        setSelectedQuizChoice(null);
        setQuizTimeLeft(quizRemaining);
        quizDeadlineRef.current = isResumed ? Date.now() + quizRemaining * 1000 : null;

        // 4가지 블러 종류 중 랜덤 선택 (연습 모드에서 override.blur로 강제 지정 가능)
        const blurTypes: ('gaussian' | 'mosaic' | 'motion' | 'radial')[] = ['gaussian', 'mosaic', 'motion', 'radial'];
        const forcedBlur = practiceMode && override?.blur && (blurTypes as string[]).includes(override.blur)
          ? (override.blur as 'gaussian' | 'mosaic' | 'motion' | 'radial')
          : null;
        const chosenBlur = forcedBlur ?? blurTypes[Math.floor(Math.random() * blurTypes.length)];
        setQuizBlurType(chosenBlur);
        setQuizBlurAngle(Math.floor(Math.random() * 360));
      } else if (type === 'puzzle') {
        setPuzzlePieces(createInitialPuzzlePieces());
        const puzzleRemaining = remainingSeconds ?? PUZZLE_TIME_LIMIT_SECONDS;
        setPuzzleTimeLeft(puzzleRemaining);
        puzzleDeadlineRef.current = isResumed ? Date.now() + puzzleRemaining * 1000 : null;
      } else if (type === 'match') {
        setRevealActive(!isResumed); // 재개 세션은 이미 선공개 시간이 지났다고 보고 바로 플레이로 복귀합니다.
        const matchRemaining = remainingSeconds ?? MATCH_TIME_LIMIT_SECONDS;
        setGameTimeLeft(matchRemaining);
        matchDeadlineRef.current = isResumed ? Date.now() + matchRemaining * 1000 : null;

        const rawCards = data.game_data.cards ?? [];
        const deck: MatchCard[] = [...rawCards, ...rawCards]
          .map((card, idx): MatchCard => ({
            id: idx,
            channel_id: card.channel_id,
            name: card.name,
            logo_url: card.logo_url,
            isFlipped: !isResumed, // 2초 공개를 위해 처음에 flipped로 시작
            isMatched: false
          }))
          .sort(() => 0.5 - Math.random()); // 셔플
        setMatchCards(deck);
      }

      // 3초 카운트다운 가동
      setCountdownLeft(isResumed ? 0 : 3);

      if (!practiceMode) fetchStatus(); // 일반 게임만 남은 티켓 수량 갱신

    } catch {
      toast('서버와의 통신에 실패했습니다.', 'error');
    } finally {
      setGameBusy(false);
    }
  };

  // URL 파라미터로 연습 게임을 자동 시작합니다 (특정 유저·별 이미지 테스트용).
  // 예) /arcade?practice=quiz&channel=<channel_id>&star=3&blur=motion
  //     practice=quiz|puzzle|match (필수), channel=스트리머 channel_id, star=0~5, blur=(퀴즈) gaussian|mosaic|motion|radial
  useEffect(() => {
    if (autoStartRef.current || !user) return;
    const practiceType = searchParams.get('practice');
    if (practiceType !== 'quiz' && practiceType !== 'puzzle' && practiceType !== 'match') return;
    autoStartRef.current = true;

    const channelId = searchParams.get('channel') || undefined;
    const starRaw = searchParams.get('star');
    const star = starRaw !== null && starRaw !== ''
      ? Math.max(0, Math.min(5, parseInt(starRaw, 10) || 0))
      : null;
    const blur = searchParams.get('blur');

    handleStartGame(practiceType as GameType, true, { channelId, star, blur });
    router.replace('/arcade'); // 파라미터 정리 (새로고침 시 재실행 방지)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, searchParams]);

  // ==========================================
  // 1. 인물 퀴즈 버튼 핸들러
  // ==========================================
  const handleQuizAnswer = (choiceId: string) => {
    if (gameBusy || selectedQuizChoice || (countdownLeft !== null && countdownLeft > 0)) return;
    setSelectedQuizChoice(choiceId);
    submitResult({
      answer_channel_id: choiceId
    });
  };

  // ==========================================
  // 2. 카드 퍼즐 회전 제어 (3x4 그리드)
  // ==========================================
  const completePuzzleIfSolved = (pieces: PuzzlePiece[]) => {
    if (isPuzzleSolved(pieces)) {
      submitResult({
        success: true,
        puzzle_pieces: pieces.map((piece) => ({
          id: piece.id,
          rotation: normalizeRotation(piece.rotation)
        }))
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
    const newPieces = puzzlePieces.map((piece, pieceIndex) =>
      pieceIndex === index ? { ...piece, rotation: piece.rotation + 90 } : piece
    );
    setPuzzlePieces(newPieces);
    completePuzzleIfSolved(newPieces);
  };

  const handleSwapPuzzlePieces = (fromIndex: number, toIndex: number) => {
    if (
      isGameOver ||
      fromIndex === toIndex ||
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= puzzlePieces.length ||
      toIndex >= puzzlePieces.length
    ) {
      return;
    }

    const newPieces = [...puzzlePieces];
    [newPieces[fromIndex], newPieces[toIndex]] = [newPieces[toIndex], newPieces[fromIndex]];
    setPuzzlePieces(newPieces);
    completePuzzleIfSolved(newPieces);
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
        // 짝 맞춤 성공 -> 0.5초 후 isMatched와 isFlipped를 확실히 true로 세팅
        setTimeout(() => {
          setMatchCards(prevDeck => {
            const matchedDeck = prevDeck.map((card, cardIndex) =>
              cardIndex === firstIdx || cardIndex === secondIdx
                ? { ...card, isFlipped: true, isMatched: true }
                : card
            );
            
            // 12장 모두 매치되었는지 확인
            if (matchedDeck.every(c => c.isMatched)) {
              submitResult({
                success: true,
                matched_channel_ids: matchedDeck.map((card) => card.channel_id)
              });
            }
            return matchedDeck;
          });
          setFlippedIndices([]);
        }, 500);
      } else {
        // 매치 실패 -> 0.8초 뒤에 두 카드의 뒤집힘 원복
        setTimeout(() => {
          setMatchCards(prevDeck =>
            prevDeck.map((card, cardIndex) =>
              cardIndex === firstIdx || cardIndex === secondIdx
                ? { ...card, isFlipped: false }
                : card
            )
          );
          setFlippedIndices([]);
        }, 800);
      }
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
  const showAnswerReveal = Boolean(
    gameResult && gameData && (activeGame === 'quiz' || activeGame === 'puzzle')
  );
  const revealedImageUrl = gameResult?.answer?.image_url || gameData?.image_url || '';
  const revealedName = gameResult?.answer?.name
    || (
      activeGame === 'quiz' && gameResult?.correct
        ? gameData?.choices?.find(choice => choice.channel_id === selectedQuizChoice)?.name
        : undefined
    )
    || '정답 정보를 불러오지 못했습니다.';
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
                        <img
                          src={revealedImageUrl}
                          alt={`${revealedName} 원본 이미지`}
                          className="h-full w-full object-contain"
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
                disabled={gameBusy || tickets <= 0}
                className="cute-wiggle-hover flex w-full items-center justify-center gap-1.5 rounded-2xl bg-primary px-3 py-2.5 text-xs font-black text-primary-foreground transition active:scale-95 disabled:pointer-events-none disabled:opacity-40"
              >
                🪙 1개 소모 · 도전
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
            <div id="practice-game-list" className="grid gap-3 p-4 animate-in fade-in slide-in-from-top-2 duration-200 sm:grid-cols-3 sm:p-5">
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
              onClick={handleExitGame}
              className="text-xs font-bold text-muted-foreground hover:text-foreground flex items-center gap-1 transition"
            >
              <ChevronLeft className="h-4 w-4" /> 포기하고 나가기
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

          {/* ======================================================== */}
          {/* 게임 1: 인물 퀴즈 */}
          {/* ======================================================== */}
          {activeGame === 'quiz' && (
              <div className="flex flex-1 flex-col items-center justify-center space-y-5 sm:space-y-6">

                {/* 퀴즈 15초 타이머 & 프로그레스 바 */}
                <div className="flex w-full max-w-2xl flex-col gap-2 px-1">
                  <div className="flex items-center justify-between">
                    <div className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-black shadow-sm transition-all duration-300 sm:px-4 sm:py-2 sm:text-sm ${quizTimeLeft <= 5
                      ? 'bg-rose-500/20 text-rose-400 border-rose-500/40 animate-bounce'
                      : 'bg-secondary/80 text-foreground border-border/70'
                      }`}>
                      {quizTimeLeft <= 5 ? (
                        <span className="animate-pulse">🔥</span>
                      ) : (
                        <Timer className={`h-3 w-3 ${quizTimeLeft <= 8 ? 'animate-spin' : ''} text-primary`} />
                      )}
                      <span>남은 시간: <strong className="cute-number-font text-xs sm:text-base">{quizTimeLeft}</strong>초</span>
                    </div>

                    <span className="rounded-full border border-border/70 bg-secondary/80 px-2 py-0.5 text-[9px] font-black text-muted-foreground sm:px-3 sm:py-1.5 sm:text-xs">
                      3초 스피드 보너스 (+200 P)
                    </span>
                  </div>

                  {/* 프로그레스 바 게이지 */}
                  <div className="relative h-1.5 w-full overflow-hidden rounded-full border border-border/20 bg-secondary/60 shadow-inner sm:h-2.5">
                    <div
                      className={`h-full rounded-full transition-all duration-1000 ease-linear ${quizTimeLeft <= 5
                        ? 'bg-gradient-to-r from-rose-500 to-red-600 shadow-[0_0_8px_rgba(239,68,68,0.5)]'
                        : 'bg-gradient-to-r from-emerald-400 to-primary shadow-[0_0_8px_rgba(16,185,129,0.4)]'
                        }`}
                      style={{ width: `${(quizTimeLeft / 15) * 100}%` }}
                    />
                  </div>
                </div>

                {/* 카드 이미지 컨테이너 */}
                <div className="arcade-quiz-card relative flex aspect-[5/8] items-center justify-center overflow-hidden rounded-[1.75rem] border border-border/80 bg-sky-950 shadow-[0_18px_44px_rgba(7,89,133,0.26)]">

                  {/* 가우시안 블러 모드 */}
                  {quizBlurType === 'gaussian' && (
                    <img
                      src={gameData.image_url}
                      alt="Quiz card"
                      style={{
                        filter: `blur(${(quizIntensity / 100) * QUIZ_GAUSSIAN_MAX_BLUR_PX}px) contrast(1.1)`,
                      }}
                      className="h-full w-full object-cover select-none pointer-events-none transition-all duration-75"
                    />
                  )}

                  {/* 모자이크 블러 모드 */}
                  {quizBlurType === 'mosaic' && (
                    <MosaicQuizImage src={gameData.image_url || ''} intensity={quizIntensity} />
                  )}

                  {/* 모션 블러 모드 */}
                  {quizBlurType === 'motion' && (
                    <MotionBlurQuizImage
                      src={gameData.image_url || ''}
                      intensity={quizIntensity}
                      angle={quizBlurAngle}
                    />
                  )}

                  {/* 방사형 회전 잔상 블러 모드 */}
                  {quizBlurType === 'radial' && (
                    <RadialBlurQuizImage
                      src={gameData.image_url || ''}
                      intensity={quizIntensity}
                      angle={quizBlurAngle}
                    />
                  )}

                  {/* 디테일 데코: 치지직 송출 에러 인터페이스 오버레이 */}
                  {quizIntensity > 0 && (
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
                      {quizBlurType === 'gaussian' && '가우시안 블러 전송 방식'}
                      {quizBlurType === 'mosaic' && '픽셀 모자이크 전송 방식'}
                      {quizBlurType === 'motion' && '강한 방향성 모션 잔상 방식'}
                      {quizBlurType === 'radial' && '방사형 소용돌이 복원 방식'}
                    </span>
                  </p>
                  <p className="max-w-lg text-[10px] leading-relaxed text-muted-foreground sm:text-xs">
                    10초 동안 점점 선명해집니다. 누구의 카드인지 보기를 골라주세요!
                  </p>
                </div>

                <div className="grid w-full max-w-3xl grid-cols-2 gap-2.5 sm:gap-4">
                  {(gameData.choices ?? []).map((choice) => {
                    const isSelected = selectedQuizChoice === choice.channel_id;
                    return (
                      <button
                        key={choice.channel_id}
                        onClick={() => handleQuizAnswer(choice.channel_id)}
                        disabled={selectedQuizChoice !== null}
                        className={`cute-card-pop rounded-2xl border p-3.5 text-center text-xs font-extrabold sm:p-5 sm:text-base ${isSelected
                          ? 'border-primary bg-primary/10 text-primary shadow-sm'
                          : 'border-border bg-secondary/35 text-foreground hover:-translate-y-0.5 hover:bg-secondary/70'
                          }`}
                      >
                        {choice.name}
                      </button>
                    );
                  })}
                </div>
              </div>
          )}

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
                <div className="arcade-puzzle-board grid aspect-[3/4] grid-cols-3 grid-rows-4 overflow-hidden rounded-2xl touch-none select-none">
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
                      key={card.id}
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
