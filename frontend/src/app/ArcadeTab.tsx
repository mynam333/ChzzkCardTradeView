'use client';

import React, { useState, useEffect, useCallback } from 'react';
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
  ChevronLeft
} from 'lucide-react';

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
};

type SubmitPayload = {
  success?: boolean;
  answer_channel_id?: string;
};

type TicketStatusResponse = {
  current_tickets: number;
  max_tickets?: number;
  base_tickets?: number;
  bonus_tickets?: number;
  seconds_until_next_ticket: number;
};

type StartGameResponse = {
  session_id: string;
  game_data: MinigameData;
  message?: string;
};

const PUZZLE_PIECE_COUNT = 12;
const PUZZLE_TIME_LIMIT_SECONDS = 120;
const MATCH_TIME_LIMIT_SECONDS = 60;
const QUIZ_DISTORTION_SCALE = 0.25;
const QUIZ_GAUSSIAN_MAX_BLUR_PX = 100 * QUIZ_DISTORTION_SCALE;
const QUIZ_MOTION_MAX_RADIUS = 8;
const QUIZ_MOTION_MAX_KERNEL_UNIT = 3;
// 모자이크·회전 잔상은 원래 강도가 약한 효과이므로 DISTORTION_SCALE을 따르지 않고 독립 상수 사용
const QUIZ_MOSAIC_MAX_BLOCK_PX = 34;
const QUIZ_RADIAL_MAX_ROTATE_DEG = 120;   // 최대 120도 회전 잔상
const QUIZ_RADIAL_MAX_SCALE = 0.20;      // 외곽 잔상 20% 확대
const QUIZ_RADIAL_MAX_GHOST_OPACITY = 0.52;  // 잔상 최대 불투명도 52%
const QUIZ_RADIAL_MIN_GHOST_OPACITY = 0.16;  // 잔상 최소 불투명도 16%

const createMotionBlurKernel = (angle: number, intensity: number) => {
  const normalizedIntensity = Math.max(0, Math.min(100, intensity)) / 100;
  const radius = Math.round(normalizedIntensity * QUIZ_MOTION_MAX_RADIUS);
  if (radius < 1) return null;

  const order = radius * 2 + 1;
  const center = radius;
  const radians = (angle * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const samples = new Set<string>();

  // 선을 촘촘히 샘플링해 얕은 각도에서도 커널이 끊기지 않도록 합니다.
  for (let step = -radius * 4; step <= radius * 4; step += 1) {
    const distance = step / 4;
    const x = Math.max(0, Math.min(order - 1, Math.round(center + cos * distance)));
    const y = Math.max(0, Math.min(order - 1, Math.round(center + sin * distance)));
    samples.add(`${x},${y}`);
  }

  const matrix = Array(order * order).fill(0);
  for (const sample of samples) {
    const [x, y] = sample.split(',').map(Number);
    matrix[y * order + x] = 1;
  }

  return {
    order,
    radius,
    divisor: samples.size,
    matrix: matrix.join(' '),
    kernelUnitLength: 1 + normalizedIntensity * (QUIZ_MOTION_MAX_KERNEL_UNIT - 1)
  };
};

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

const GameTimeLimit: React.FC<{
  timeLeft: number;
  totalSeconds: number;
  dangerSeconds: number;
  bonusLabel: string;
  pausedLabel?: string;
}> = ({ timeLeft, totalSeconds, dangerSeconds, bonusLabel, pausedLabel }) => (
  <div className="w-full max-w-md flex flex-col gap-2 px-1">
    <div className="flex items-center justify-between">
      {pausedLabel ? (
        <div className="flex items-center gap-1.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-3 py-1.5 rounded-full text-xs font-black shadow-sm animate-pulse">
          <span>👀</span>
          <span>{pausedLabel}</span>
        </div>
      ) : (
        <div className={`flex items-center gap-1.5 border px-3 py-1.5 rounded-full text-xs font-black shadow-sm transition-all duration-300 ${timeLeft <= dangerSeconds
          ? 'bg-rose-500/20 text-rose-400 border-rose-500/40 animate-bounce'
          : 'bg-zinc-800/80 text-foreground border-zinc-700/60'
          }`}>
          {timeLeft <= dangerSeconds ? (
            <span className="animate-pulse">🔥</span>
          ) : (
            <Timer className={`h-3.5 w-3.5 ${timeLeft <= dangerSeconds * 2 ? 'animate-spin' : ''} text-primary`} />
          )}
          <span>남은 시간: <strong className="font-mono text-sm">{timeLeft}</strong>초</span>
        </div>
      )}

      <div className="flex items-center gap-1 bg-secondary/50 border border-border/40 px-2.5 py-1.5 rounded-full text-[10px] text-muted-foreground font-extrabold">
        <span>⏱️ {bonusLabel}</span>
      </div>
    </div>

    {!pausedLabel && (
      <div className="w-full h-2 rounded-full bg-secondary/60 border border-border/20 overflow-hidden shadow-inner relative">
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
  const [loading, setLoading] = useState(true);
  const [tickets, setTickets] = useState(0);
  const [baseTickets, setBaseTickets] = useState(0);
  const [bonusTickets, setBonusTickets] = useState(0);
  const [secondsUntilNext, setSecondsUntilNext] = useState(0);
  const [activeGame, setActiveGame] = useState<GameType | null>(null);

  // 게임 세션 관련 상태
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [gameData, setGameData] = useState<MinigameData | null>(null);
  const [gameBusy, setGameBusy] = useState(false);

  // 공통 결과 화면 상태
  const [gameResult, setGameResult] = useState<MinigameResult | null>(null);

  // 공통 카운트다운 및 시간 제어 상태
  const [countdownLeft, setCountdownLeft] = useState<number | null>(null);

  // 1. 인물 퀴즈 전용 상태 (블러 퀴즈로 고도화)
  const [quizStartTime, setQuizStartTime] = useState<number>(0);
  const [selectedQuizChoice, setSelectedQuizChoice] = useState<string | null>(null);
  const [quizBlurType, setQuizBlurType] = useState<'gaussian' | 'mosaic' | 'motion' | 'radial'>('gaussian');
  const [quizBlurAngle, setQuizBlurAngle] = useState<number>(0);
  const [quizIntensity, setQuizIntensity] = useState<number>(100);
  const [quizTimeLeft, setQuizTimeLeft] = useState<number>(15);

  // 2. 카드 퍼즐 전용 상태
  const [puzzlePieces, setPuzzlePieces] = useState<PuzzlePiece[]>([]);
  const [draggingPuzzleIndex, setDraggingPuzzleIndex] = useState<number | null>(null);
  const [dragOverPuzzleIndex, setDragOverPuzzleIndex] = useState<number | null>(null);
  const [puzzleTimeLeft, setPuzzleTimeLeft] = useState(PUZZLE_TIME_LIMIT_SECONDS);
  const puzzleDragRef = React.useRef<{ index: number; startX: number; startY: number; dragging: boolean } | null>(null);

  // 3. 카드 뒤집기 전용 상태
  const [matchCards, setMatchCards] = useState<MatchCard[]>([]);
  const [flippedIndices, setFlippedIndices] = useState<number[]>([]);
  const [revealActive, setRevealActive] = useState(false); // 시작 시 2초 공개 중인지 여부
  const [gameTimeLeft, setGameTimeLeft] = useState(MATCH_TIME_LIMIT_SECONDS);
  const [isGameOver, setIsGameOver] = useState(false);

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
  }, []);

  // 게임 결과 제출 처리 (치팅 방지를 위해 백엔드에서 서버 시간 2중 검증함)
  const submitResult = useCallback(async (payload: SubmitPayload) => {
    if (!sessionId) return;
    setGameBusy(true);
    try {
      const res = await apiFetch('/minigames/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          payload
        })
      });
      const data = await res.json();
      if (res.ok) {
        setGameResult(data as MinigameResult);
        refreshUserData(); // 보유 자산 갱신
      } else {
        toast(data.message || '결과 처리 중 에러가 발생했습니다.', 'error');
        handleExitGame();
      }
    } catch {
      toast('결과 전송에 실패했습니다.', 'error');
    } finally {
      setGameBusy(false);
    }
  }, [handleExitGame, refreshUserData, sessionId, toast]);

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
            setQuizTimeLeft(15);
          } else if (activeGame === 'puzzle') {
            // 카운트다운 종료 후 바로 퍼즐 조작을 허용합니다.
          } else if (activeGame === 'match') {
            setRevealActive(true);
            setTimeout(() => {
              setMatchCards(prevDeck =>
                prevDeck.map(c => ({ ...c, isFlipped: false }))
              );
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

  // 짝맞추기 60초 인게임 타이머 구동
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
      setGameTimeLeft(prev => prev - 1);
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
      setPuzzleTimeLeft(prev => prev - 1);
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
      setQuizTimeLeft(prev => prev - 1);
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
  const handleStartGame = async (type: GameType) => {
    if (tickets <= 0) {
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

    try {
      const res = await apiFetch('/minigames/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ game_type: type })
      });

      const data = (await res.json()) as StartGameResponse;
      if (!res.ok) {
        toast(data.message || '게임을 시작할 수 없습니다.', 'error');
        fetchStatus();
        return;
      }

      setSessionId(data.session_id);
      setGameData(data.game_data);
      setActiveGame(type);

      // 게임별 초기 세팅값 설정
      if (type === 'quiz') {
        setQuizStartTime(Date.now());
        setQuizIntensity(100);
        setSelectedQuizChoice(null);
        setQuizTimeLeft(15);

        // 4가지 블러 종류 중 랜덤 선택
        const blurTypes: ('gaussian' | 'mosaic' | 'motion' | 'radial')[] = ['gaussian', 'mosaic', 'motion', 'radial'];
        const chosenBlur = blurTypes[Math.floor(Math.random() * blurTypes.length)];
        setQuizBlurType(chosenBlur);
        setQuizBlurAngle(Math.floor(Math.random() * 360));
      } else if (type === 'puzzle') {
        setPuzzlePieces(createInitialPuzzlePieces());
        setPuzzleTimeLeft(PUZZLE_TIME_LIMIT_SECONDS);
      } else if (type === 'match') {
        setRevealActive(true); // 2초 선공개 활성화

        const rawCards = data.game_data.cards ?? [];
        const deck: MatchCard[] = [...rawCards, ...rawCards]
          .map((card, idx): MatchCard => ({
            id: idx,
            channel_id: card.channel_id,
            name: card.name,
            logo_url: card.logo_url,
            isFlipped: true, // 2초 공개를 위해 처음에 flipped로 시작
            isMatched: false
          }))
          .sort(() => 0.5 - Math.random()); // 셔플
        setMatchCards(deck);
      }

      // 3초 카운트다운 가동
      setCountdownLeft(3);

      fetchStatus(); // 남은 티켓 수량 갱신

    } catch {
      toast('서버와의 통신에 실패했습니다.', 'error');
    } finally {
      setGameBusy(false);
    }
  };

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
        success: true
      });
    }
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
                success: true
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
        <div className="max-w-md rounded-3xl border border-border bg-card p-8 shadow-lg">
          <Gamepad2 className="mx-auto h-12 w-12 text-primary animate-pulse mb-4" />
          <h2 className="text-xl font-black text-foreground">로그인이 필요한 기능입니다</h2>
          <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
            미니게임에 도전하여 무료 가챠 포인트를 적립하시려면 치지직 간편 로그인을 완료해 주세요.
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center animate-in fade-in duration-300">
        <div className="rounded-3xl border border-border bg-card p-8 shadow-lg">
          <RefreshCw className="mx-auto h-9 w-9 animate-spin text-primary mb-3" />
          <p className="text-xs font-bold text-muted-foreground">아케이드 티켓 상태를 불러오는 중입니다.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">

      {/* 아케이드 대시보드 헤더 */}
      {!activeGame && (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between rounded-2xl bg-card border border-border p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-primary/10 p-2.5">
              <Gamepad2 className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h2 className="text-lg font-extrabold text-foreground flex items-center gap-1.5">
                미니게임 아케이드
                <span className="text-xs font-bold text-muted-foreground bg-secondary/80 px-2 py-0.5 rounded-full"> Arcade </span>
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">포인트를 두고 벌이는 재미있는 카드 미니게임!</p>
            </div>
          </div>

          {/* 아케이드 코인 충전 현황 */}
          <div className="flex flex-col gap-2 self-start sm:self-center bg-zinc-900/45 border border-zinc-800 p-3.5 rounded-2xl shadow-inner min-w-[270px]">
            <div className="flex items-center justify-between">
              <span className="text-xs font-black text-amber-400 flex items-center gap-1">
                🪙 아케이드 동전
              </span>
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[9px] font-black text-primary">총 {tickets}개</span>
            </div>

            <div className="flex items-center justify-between mt-1 gap-4">
              {/* 5개 코인 슬롯 */}
              <div className="flex items-center gap-1.5 bg-black/40 px-2.5 py-1.5 rounded-xl border border-zinc-800/80">
                {Array.from({ length: 5 }).map((_, idx) => {
                  const hasCoin = idx < baseTickets;
                  return (
                    <div key={idx} className="relative">
                      {hasCoin ? (
                        <div className="relative w-5.5 h-5.5 rounded-full bg-gradient-to-b from-yellow-300 via-amber-400 to-amber-500 border border-amber-200 shadow-[0_2px_4px_rgba(245,158,11,0.6),inset_0_1px_0_rgba(255,255,255,0.4)] flex items-center justify-center animate-[pulse_1.5s_infinite_ease-in-out]">
                          <div className="w-3.5 h-3.5 rounded-full border border-dashed border-yellow-100/50 flex items-center justify-center">
                            <span className="text-[9px] font-black text-amber-950/80 leading-none select-none">C</span>
                          </div>
                        </div>
                      ) : (
                        <div className="relative w-5.5 h-5.5 rounded-full bg-zinc-900 border border-zinc-800 shadow-inner flex items-center justify-center">
                          <div className="w-2 h-2 rounded-full bg-zinc-950 border border-zinc-900" />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* 충전 대기 타이머 */}
              {baseTickets < 5 ? (
                <div className="flex items-center gap-1 bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2.5 py-1.5 rounded-xl">
                  <RefreshCw className="h-3 w-3 animate-spin text-amber-400" />
                  <span className="text-xs font-mono font-black">{formatTime(secondsUntilNext)}</span>
                </div>
              ) : (
                <div className="flex items-center gap-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2.5 py-1.5 rounded-xl text-[10px] font-black uppercase">
                  FULL COIN
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl border border-zinc-800/80 bg-black/30 px-2.5 py-1.5">
                <p className="text-[9px] font-bold text-muted-foreground">기본 충전</p>
                <p className="text-xs font-black text-amber-400"><span className="font-mono">{baseTickets}</span>/5</p>
              </div>
              <div className={`rounded-xl border px-2.5 py-1.5 ${bonusTickets > 0 ? 'border-sky-500/30 bg-sky-500/10' : 'border-zinc-800/80 bg-black/30'}`}>
                <p className="text-[9px] font-bold text-muted-foreground">추가 티켓</p>
                <p className={`text-xs font-black ${bonusTickets > 0 ? 'text-sky-400' : 'text-muted-foreground'}`}>+<span className="font-mono">{bonusTickets}</span></p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 게임 로비 리스트 (하이로우 제거) */}
      {!activeGame && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">

          {/* 게임 1. 지직... 송출 오류 해독 (블러 퀴즈) */}
          <div className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-border bg-card p-5 shadow transition duration-300 hover:-translate-y-1 hover:shadow-md">
            <div>
              <div className="inline-block rounded-lg bg-emerald-500/10 p-2.5 text-emerald-500">
                <HelpCircle className="h-5 w-5" />
              </div>
              <h3 className="mt-4 text-sm font-black text-foreground">송출 오류난 스트리머 맞추기</h3>
              <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed">
                무작위 스트리머 카드가 전송 오류가 났습니다. 15초 내로 복원되는 카드를 보고 누구인지 맞춰보세요!
              </p>
            </div>
            <div className="mt-5 pt-3 border-t border-border/40 flex items-center justify-between">
              <span className="text-[10px] font-bold text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded">기본 1,000 P + 보너스 200 P</span>
              <button
                onClick={() => handleStartGame('quiz')}
                disabled={gameBusy || tickets <= 0}
                className="rounded-lg bg-primary px-3 py-1.5 text-xs font-black text-primary-foreground hover:bg-primary/90 transition flex items-center gap-1.5 disabled:opacity-40 active:scale-95 shadow-sm"
              >
                🪙 1개 소모 • 도전
              </button>
            </div>
          </div>

          {/* 게임 2. 카드 퍼즐 맞추기 */}
          <div className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-border bg-card p-5 shadow transition duration-300 hover:-translate-y-1 hover:shadow-md">
            <div>
              <div className="inline-block rounded-lg bg-amber-500/10 p-2.5 text-amber-500">
                <Sparkles className="h-5 w-5" />
              </div>
              <h3 className="mt-4 text-sm font-black text-foreground">3x4 회전 퍼즐</h3>
              <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed">
                120초 안에 섞인 조각을 드래그로 교체하고, 탭해서 90도씩 회전시켜 올바른 카드 이미지를 복구하는 직소 퍼즐입니다.
              </p>
            </div>
            <div className="mt-5 pt-3 border-t border-border/40 flex items-center justify-between">
              <span className="text-[10px] font-bold text-amber-500 bg-amber-500/10 px-2 py-0.5 rounded">기본 1,000 P + 보너스 200 P</span>
              <button
                onClick={() => handleStartGame('puzzle')}
                disabled={gameBusy || tickets <= 0}
                className="rounded-lg bg-primary px-3 py-1.5 text-xs font-black text-primary-foreground hover:bg-primary/90 transition flex items-center gap-1.5 disabled:opacity-40 active:scale-95 shadow-sm"
              >
                🪙 1개 소모 • 도전
              </button>
            </div>
          </div>

          {/* 게임 3. 짝맞추기 뒤집기 */}
          <div className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-border bg-card p-5 shadow transition duration-300 hover:-translate-y-1 hover:shadow-md">
            <div>
              <div className="inline-block rounded-lg bg-sky-500/10 p-2.5 text-sky-500">
                <Trophy className="h-5 w-5" />
              </div>
              <h3 className="mt-4 text-sm font-black text-foreground">스트리머 짝맞추기</h3>
              <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed">
                처음 2초간 카드를 전체 공개한 뒤 뒤집힙니다. 60초 시간 제한 내에 뒤집힌 카드의 짝을 모두 맞춰 보세요!
              </p>
            </div>
            <div className="mt-5 pt-3 border-t border-border/40 flex items-center justify-between">
              <span className="text-[10px] font-bold text-sky-500 bg-sky-500/10 px-2 py-0.5 rounded">기본 1,000 P + 보너스 200 P</span>
              <button
                onClick={() => handleStartGame('match')}
                disabled={gameBusy || tickets <= 0}
                className="rounded-lg bg-primary px-3 py-1.5 text-xs font-black text-primary-foreground hover:bg-primary/90 transition flex items-center gap-1.5 disabled:opacity-40 active:scale-95 shadow-sm"
              >
                🪙 1개 소모 • 도전
              </button>
            </div>
          </div>

        </div>
      )}

      {/* ======================================================== */}
      {/* 인게임 뷰 영역 */}
      {/* ======================================================== */}
      {activeGame && gameData && (
        <div className="max-w-xl mx-auto rounded-3xl border border-border bg-card p-6 shadow-xl relative overflow-hidden animate-in zoom-in-95 duration-200">

          {/* 아케이드 3초 카운트다운 오버레이 */}
          {countdownLeft !== null && countdownLeft > 0 && (
            <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-black/90 backdrop-blur-xs select-none pointer-events-auto">
              <div className="text-center space-y-3 animate-in zoom-in-90 duration-200">
                <span className="text-[10px] font-black tracking-widest text-primary bg-primary/10 border border-primary/20 px-3.5 py-1 rounded-full animate-pulse">
                  READY?
                </span>
                <div className="text-7xl font-black text-amber-400 drop-shadow-[0_0_20px_rgba(245,158,11,0.75)] font-mono animate-ping scale-110">
                  {countdownLeft}
                </div>
                <p className="text-[10px] text-muted-foreground font-extrabold uppercase tracking-wide">Get Ready for Action</p>
              </div>
            </div>
          )}

          {/* 게임 상단 제어 바 */}
          <div className="flex items-center justify-between border-b border-border/60 pb-3 mb-5">
            <button
              onClick={handleExitGame}
              className="text-xs font-bold text-muted-foreground hover:text-foreground flex items-center gap-1 transition"
            >
              <ChevronLeft className="h-4 w-4" /> 포기하고 나가기
            </button>

            {/* 인게임 미니 코인 카운터 */}
            <div className="flex items-center gap-1 bg-secondary/70 border border-border/40 px-2.5 py-1 rounded-full text-[10px] font-black text-foreground shadow-xs select-none">
              <span className="text-amber-400">🪙</span>
              <span>남은 코인: <strong className="text-amber-400 font-mono">{tickets}</strong></span>
            </div>

            <span className="text-xs font-black text-primary capitalize flex items-center gap-1.5">
              <Gamepad2 className="h-4 w-4" />
              {activeGame === 'quiz' && '❓ 인물 퀴즈'}
              {activeGame === 'puzzle' && '🧩 3x4 회전 퍼즐'}
              {activeGame === 'match' && '🎴 짝맞추기 카드게임'}
            </span>
          </div>

          {/* 공통 로딩 오버레이 */}
          {gameBusy && !gameResult && (
            <div className="absolute inset-0 z-45 flex flex-col items-center justify-center bg-black/60 backdrop-blur-xs">
              <RefreshCw className="h-8 w-8 text-primary animate-spin mb-2" />
              <p className="text-xs text-white/90 font-bold">결과 채점 및 포인트 지급 처리 중...</p>
            </div>
          )}

          {/* 공통 결과 출력 오버레이 */}
          {gameResult && (
            <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-background/95 p-6 text-center animate-in fade-in duration-300">
              <div className="rounded-full bg-primary/10 p-4 mb-4">
                {gameResult.correct ? (
                  <Trophy className="h-10 w-10 text-primary animate-bounce" />
                ) : (
                  <X className="h-10 w-10 text-rose-500" />
                )}
              </div>
              <h3 className="text-lg font-black text-foreground">
                {gameResult.correct ? '🎉 미니게임 성공!' : '😅 미션 실패!'}
              </h3>
              <p className="text-xs text-muted-foreground mt-2 max-w-sm leading-relaxed">
                {gameResult.message}
              </p>

              {gameResult.earned_points > 0 && (
                <div className="mt-5 rounded-2xl bg-secondary/40 border border-border px-5 py-3.5 flex items-center justify-between gap-6">
                  <div>
                    <p className="text-[10px] text-muted-foreground font-semibold">획득 재화</p>
                    <p className="text-lg font-black text-emerald-400">+{gameResult.earned_points.toLocaleString()} P</p>
                  </div>
                  <div className="border-l border-border/80 pl-6 text-right">
                    <p className="text-[10px] text-muted-foreground font-semibold">현재 잔액</p>
                    <p className="text-sm font-extrabold text-foreground">{gameResult.new_balance.toLocaleString()} P</p>
                  </div>
                </div>
              )}

              <div className="mt-6 flex items-center gap-2.5">
                <button
                  onClick={handleExitGame}
                  className="rounded-xl bg-secondary px-5 py-2.5 text-xs font-bold text-muted-foreground hover:text-foreground transition"
                >
                  로비로 돌아가기
                </button>
                <button
                  onClick={() => handleStartGame(activeGame)}
                  disabled={tickets <= 0}
                  className="rounded-xl bg-primary px-5 py-2.5 text-xs font-bold text-primary-foreground hover:bg-primary/95 disabled:opacity-40 transition flex items-center gap-1 shadow"
                >
                  <RefreshCw className="h-3.5 w-3.5" /> 다시 도전 (동전 소모)
                </button>
              </div>
            </div>
          )}

          {/* ======================================================== */}
          {/* 게임 1: 인물 퀴즈 */}
          {/* ======================================================== */}
          {activeGame === 'quiz' && (() => {
            const motionKernel = createMotionBlurKernel(quizBlurAngle, quizIntensity);

            return (
              <div className="space-y-5 flex flex-col items-center">

                {/* 퀴즈 15초 타이머 & 프로그레스 바 */}
                <div className="w-full max-w-xs flex flex-col gap-2 px-1">
                  <div className="flex items-center justify-between">
                    <div className={`flex items-center gap-1.5 border px-2.5 py-1 rounded-full text-[10px] font-black shadow-sm transition-all duration-300 ${quizTimeLeft <= 5
                      ? 'bg-rose-500/20 text-rose-400 border-rose-500/40 animate-bounce'
                      : 'bg-zinc-800/80 text-foreground border-zinc-700/60'
                      }`}>
                      {quizTimeLeft <= 5 ? (
                        <span className="animate-pulse">🔥</span>
                      ) : (
                        <Timer className={`h-3 w-3 ${quizTimeLeft <= 8 ? 'animate-spin' : ''} text-primary`} />
                      )}
                      <span>남은 시간: <strong className="font-mono text-xs">{quizTimeLeft}</strong>초</span>
                    </div>

                    <span className="bg-secondary/80 px-2 py-0.5 rounded text-[9px] text-muted-foreground font-black">
                      3초 스피드 보너스 (+200 P)
                    </span>
                  </div>

                  {/* 프로그레스 바 게이지 */}
                  <div className="w-full h-1.5 rounded-full bg-secondary/60 border border-border/20 overflow-hidden shadow-inner relative">
                    <div
                      className={`h-full rounded-full transition-all duration-1000 ease-linear ${quizTimeLeft <= 5
                        ? 'bg-gradient-to-r from-rose-500 to-red-600 shadow-[0_0_8px_rgba(239,68,68,0.5)]'
                        : 'bg-gradient-to-r from-emerald-400 to-primary shadow-[0_0_8px_rgba(16,185,129,0.4)]'
                        }`}
                      style={{ width: `${(quizTimeLeft / 15) * 100}%` }}
                    />
                  </div>
                </div>

                {/* 모션 블러용 인라인 SVG 필터 (조건부 렌더링) */}
                {quizBlurType === 'motion' && (
                  <svg className="absolute w-0 h-0 pointer-events-none" style={{ visibility: 'hidden' }}>
                    <filter
                      id="quiz-motion-blur"
                      x="-30%"
                      y="-30%"
                      width="160%"
                      height="160%"
                      colorInterpolationFilters="sRGB"
                    >
                      {motionKernel && (
                        <feConvolveMatrix
                          order={`${motionKernel.order} ${motionKernel.order}`}
                          kernelMatrix={motionKernel.matrix}
                          divisor={motionKernel.divisor}
                          targetX={motionKernel.radius}
                          targetY={motionKernel.radius}
                          edgeMode="duplicate"
                          preserveAlpha="true"
                          kernelUnitLength={`${motionKernel.kernelUnitLength} ${motionKernel.kernelUnitLength}`}
                        />
                      )}
                    </filter>
                  </svg>
                )}

                {/* 카드 이미지 컨테이너 */}
                <div className="relative aspect-[5/8] w-48 overflow-hidden rounded-2xl border border-border/80 bg-zinc-950 shadow-md flex items-center justify-center">

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
                    <img
                      src={gameData.image_url}
                      alt="Quiz card"
                      style={{
                        filter: motionKernel ? 'url(#quiz-motion-blur) contrast(1.08)' : 'contrast(1.05)',
                      }}
                      className="h-full w-full object-cover select-none pointer-events-none transition-[filter] duration-75"
                    />
                  )}

                  {/* 방사형 회전 잔상 블러 모드 */}
                  {quizBlurType === 'radial' && (
                    <div className="w-full h-full relative">
                      {Array.from({ length: 33 }).map((_, i) => {
                        const offsetFactor = i - 16; // -16, -15, ..., 0, ..., 15, 16
                        const rotateAngle = (quizIntensity / 100) * QUIZ_RADIAL_MAX_ROTATE_DEG * (offsetFactor / 16);
                        const scale = 1 + (quizIntensity / 100) * QUIZ_RADIAL_MAX_SCALE * Math.abs(offsetFactor / 16);
                        // 중앙(i=16)은 원본, 외곽 잔상은 거리에 따라 점감하는 불투명도
                        const opacity = i === 16 ? 1 : Math.max(QUIZ_RADIAL_MIN_GHOST_OPACITY, QUIZ_RADIAL_MAX_GHOST_OPACITY - Math.abs(offsetFactor) * 0.02);
                        return (
                          <img
                            key={i}
                            src={gameData.image_url}
                            alt="Quiz card"
                            style={{
                              transform: `rotate(${rotateAngle}deg) scale(${scale})`,
                              opacity: opacity,
                            }}
                            className="absolute inset-0 h-full w-full object-cover select-none pointer-events-none transition-transform duration-75"
                          />
                        );
                      })}
                    </div>
                  )}

                  {/* 디테일 데코: 치지직 송출 에러 인터페이스 오버레이 */}
                  {quizIntensity > 0 && (
                    <div className="absolute top-2.5 left-2.5 px-1.5 py-0.5 rounded bg-black/60 border border-zinc-800/80 text-[8px] font-black text-rose-500 tracking-wider flex items-center gap-1 select-none pointer-events-none animate-pulse">
                      <span className="w-1.5 h-1.5 rounded-full bg-rose-600 inline-block animate-ping" />
                      <span>DECRYPTING {Math.round(100 - quizIntensity)}%</span>
                    </div>
                  )}
                </div>

                <div className="text-center space-y-1.5">
                  <p className="text-xs text-muted-foreground font-black flex items-center justify-center gap-1.5">
                    <span>📡</span>
                    <span>
                      {quizBlurType === 'gaussian' && '가우시안 블러 전송 방식'}
                      {quizBlurType === 'mosaic' && '픽셀 모자이크 전송 방식'}
                      {quizBlurType === 'motion' && '모션 블러 왜곡 방식'}
                      {quizBlurType === 'radial' && '방사형 소용돌이 복원 방식'}
                    </span>
                  </p>
                  <p className="text-[10px] text-muted-foreground max-w-xs leading-relaxed">
                    10초 동안 점점 선명해집니다. 누구의 카드인지 보기를 골라주세요!
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-2.5 w-full">
                  {(gameData.choices ?? []).map((choice) => {
                    const isSelected = selectedQuizChoice === choice.channel_id;
                    return (
                      <button
                        key={choice.channel_id}
                        onClick={() => handleQuizAnswer(choice.channel_id)}
                        disabled={selectedQuizChoice !== null}
                        className={`rounded-xl border p-3.5 text-xs font-extrabold transition text-center ${isSelected
                          ? 'border-primary bg-primary/10 text-primary shadow-sm'
                          : 'border-border bg-secondary/30 text-foreground hover:bg-secondary/70'
                          }`}
                      >
                        {choice.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* ======================================================== */}
          {/* 게임 2: 카드 퍼즐 (가로 3칸 세로 4칸 정사각형 조각 3:4 크롭) */}
          {/* ======================================================== */}
          {activeGame === 'puzzle' && (
            <div className="space-y-5 flex flex-col items-center">
              <GameTimeLimit
                timeLeft={puzzleTimeLeft}
                totalSeconds={PUZZLE_TIME_LIMIT_SECONDS}
                dangerSeconds={15}
                bonusLabel="20초 보너스"
              />

              <p className="text-xs text-muted-foreground text-center font-bold">
                조각을 드래그해서 위치를 바꾸고, 탭하면 90도씩 회전합니다. 120초 안에 위치와 회전을 모두 맞춰주세요!
              </p>

              {/* 원본을 중앙 기준 3:4로 크롭한 뒤 80x80 정사각형 12개로 분할 */}
              <div className="rounded-2xl border border-border bg-secondary/20 p-1 shadow-inner">
                <div className="grid h-[320px] w-[240px] grid-cols-3 grid-rows-4 overflow-hidden rounded-xl touch-none select-none">
                  {puzzlePieces.map((piece, idx) => {
                    const col = piece.id % 3;
                    const row = Math.floor(piece.id / 3);
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
                        style={{
                          transform: `rotate(${piece.rotation}deg)`,
                        }}
                        className={`relative h-full w-full min-h-0 min-w-0 cursor-grab overflow-hidden ring-1 ring-inset ring-card/45 transition-[transform,opacity,box-shadow,filter] duration-200 active:cursor-grabbing active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${isDragging ? 'opacity-55 brightness-75 shadow-inner' : ''} ${isDropTarget ? 'z-10 ring-2 ring-primary ring-offset-1 ring-offset-background brightness-110' : ''}`}
                        aria-label={`퍼즐 조각 ${idx + 1}: 탭하면 회전, 드래그하면 위치 교체`}
                      >
                        <img
                          src={gameData.image_url}
                          alt=""
                          draggable={false}
                          style={{
                            width: '300%',
                            height: '400%',
                            left: `${-col * 100}%`,
                            top: `${-row * 100}%`,
                            objectFit: 'cover',
                            objectPosition: 'center'
                          }}
                          className="pointer-events-none absolute max-w-none select-none"
                        />
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center gap-1 rounded bg-secondary/60 px-2.5 py-1 text-[10px] text-muted-foreground font-bold font-mono">
                <Clock className="h-3 w-3" /> 모든 조각이 제자리이고 정답 각도이면 자동 완성됩니다.
              </div>
            </div>
          )}

          {/* ======================================================== */}
          {/* 게임 3: 짝맞추기 뒤집기 (2초 선공개, 60초 시간제한, 3D 플립 모션) */}
          {/* ======================================================== */}
          {activeGame === 'match' && (
            <div className="space-y-4 flex flex-col items-center">

              <GameTimeLimit
                timeLeft={gameTimeLeft}
                totalSeconds={MATCH_TIME_LIMIT_SECONDS}
                dangerSeconds={10}
                bonusLabel="30초 보너스"
                pausedLabel={revealActive ? '카드를 기억하세요!' : undefined}
              />

              {/* 3x4 / 4x3 반응형 카드 매칭 보드 */}
              <div className="grid grid-cols-3 gap-3 w-full max-w-md sm:grid-cols-4 aspect-[4/3] p-1.5 rounded-2xl bg-secondary/20 border border-border/40">
                {matchCards.map((card, idx) => {
                  // 선공개 중이거나 뒤집혔거나 이미 맞춘 경우 앞면 노출
                  const showFront = revealActive || card.isFlipped || card.isMatched;
                  return (
                    <div
                      key={card.id}
                      onClick={() => handleFlipCard(idx)}
                      className={`relative w-full aspect-[4/5] cursor-pointer perspective group transition-all duration-300 ${
                        card.isMatched ? 'scale-95' : ''
                      }`}
                    >
                      <div
                        className={`relative w-full h-full card-inner-transition transform-style preserve-3d ${showFront ? 'rotate-y-180' : ''
                          } ${card.isMatched ? '' : 'group-hover:scale-102'
                          }`}
                      >
                        {/* 카드 뒷면 (3D Backface) - 사이버 펑크 메탈 & 형광 연두 광원 테마 */}
                        <div className="absolute inset-0 bg-gradient-to-br from-zinc-900 via-black to-zinc-900 border-2 border-emerald-500/20 rounded-xl flex flex-col items-center justify-center backface-hidden shadow-lg overflow-hidden group/back z-10">
                          {/* 사이버 테크 가이드라인 격자 무늬 배경 */}
                          <div className="absolute inset-0 bg-[linear-gradient(rgba(0,255,163,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(0,255,163,0.03)_1px,transparent_1px)] bg-[size:10px_10px] pointer-events-none" />

                          {/* 미래형 홀로그램 회전 서클 */}
                          <div className="absolute w-16 h-16 rounded-full border border-emerald-500/15 flex items-center justify-center animate-[spin_12s_linear_infinite] pointer-events-none">
                            <div className="w-12 h-12 rounded-full border border-dashed border-emerald-500/35" />
                          </div>

                          {/* 모서리 데코 포인트 */}
                          <div className="absolute top-1 left-1 w-2 h-2 border-t border-l border-emerald-500/60" />
                          <div className="absolute top-1 right-1 w-2 h-2 border-t border-r border-emerald-500/60" />
                          <div className="absolute bottom-1 left-1 w-2 h-2 border-b border-l border-emerald-500/60" />
                          <div className="absolute bottom-1 right-1 w-2 h-2 border-b border-r border-emerald-500/60" />

                          {/* 중앙 로고 */}
                          <div className="relative z-10 flex flex-col items-center gap-1 scale-90 sm:scale-100 select-none">
                            <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-500 p-0.5 shadow-[0_0_12px_rgba(16,185,129,0.35)] flex items-center justify-center transform group-hover/back:rotate-12 transition-transform duration-300">
                              <div className="w-full h-full rounded-[10px] bg-zinc-950 flex items-center justify-center">
                                <Gamepad2 className="h-4.5 w-4.5 text-emerald-400" />
                              </div>
                            </div>
                            <span className="text-[8px] font-black tracking-widest text-emerald-400/80 uppercase mt-1.5">CHZZK CARD</span>
                          </div>

                          {/* 광택 반사 글레어 효과 */}
                          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:animate-[shimmer_1.5s_infinite] pointer-events-none" />
                        </div>

                        {/* 카드 앞면 (3D Frontface) - 세련된 사이버 프레임 */}
                        <div className="absolute inset-0 bg-gradient-to-b from-zinc-900 to-zinc-950 border-2 border-zinc-700/50 rounded-xl flex flex-col items-center justify-between p-2.5 backface-hidden rotate-y-180 shadow-xl overflow-hidden">
                          <div className="absolute top-1 left-1 w-1.5 h-1.5 border-t border-l border-zinc-500/40" />
                          <div className="absolute top-1 right-1 w-1.5 h-1.5 border-t border-r border-zinc-500/40" />

                          <div className="w-full flex-1 flex flex-col items-center justify-center mt-1">
                            <div className="relative p-0.5 rounded-full bg-gradient-to-tr from-emerald-500 to-cyan-500 shadow-md">
                              <img
                                src={card.logo_url || '/icon.png'}
                                alt={card.name}
                                className="h-12 w-12 sm:h-14 sm:w-14 rounded-full object-cover border-2 border-zinc-900 select-none pointer-events-none"
                              />
                            </div>
                          </div>

                          <div className="w-full bg-zinc-800/85 border border-zinc-700/50 rounded-lg py-1 px-1.5 text-center mt-2">
                            <p className="text-[10px] sm:text-xs font-black text-foreground truncate drop-shadow-sm select-none">
                              {card.name}
                            </p>
                          </div>

                          {/* 짝 맞춤 성공 시 카드를 어둡게 처리하는 반투명 오버레이 */}
                          {card.isMatched && (
                            <div className="absolute inset-0 bg-black/55 rounded-xl z-20 pointer-events-none transition-all duration-300 animate-in fade-in" />
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
