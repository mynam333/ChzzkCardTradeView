'use client';

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { apiFetch } from '@/lib/api';
import { useApp } from './AppContext';
import { BarChart3, X } from 'lucide-react';

interface HistoryPoint { value: number; recorded_at: string; }
interface HistoryRange { start: string; end: string; }
interface StreamerDetail {
  channel_id: string;
  name: string;
  logo_url?: string | null;
  custom_image_url?: string | null;
  follower_count?: number | null;
  is_active?: boolean | null;
  base_value?: number | null;
  prev_value?: number | null;
  recent_market_price?: number | null;
  activity_score?: number | null;
  broadcast_minutes?: number | null;
}

/**
 * 스트리머 시세 상세 + 그래프 모달 (보관함/실시간 랭킹 공용).
 * channelId가 주어지면 해당 스트리머 상세를 로드하여 표시하고, 카드 외 영역 클릭 시 닫힙니다.
 */
export const StreamerDetailModal: React.FC<{ channelId: string; onClose: () => void }> = ({ channelId, onClose }) => {
  const { toast } = useApp();
  const [streamer, setStreamer] = useState<StreamerDetail | null>(null);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [historyRange, setHistoryRange] = useState<HistoryRange | null>(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<'24h' | '7d'>('7d');
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setHistory([]);
      setHistoryRange(null);
      try {
        const res = await apiFetch(`/streamers/${channelId}?range=${range}`);
        if (res.ok && alive) {
          const data = await res.json();
          setStreamer(data.streamer as StreamerDetail);
          setHistory(data.history || []);
          setHistoryRange(
            data.range_start_at && data.range_end_at
              ? { start: data.range_start_at, end: data.range_end_at }
              : null
          );
        } else if (alive) {
          toast('스트리머 상세 정보를 불러오지 못했습니다.', 'error');
        }
      } catch {
        if (alive) toast('서버와의 통신 중 오류가 발생했습니다.', 'error');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [channelId, range, toast]);

  const modal = (
    <div className="modal-backdrop z-[80] bg-black/65 backdrop-blur-md" onClick={onClose}>
      <div className="modal-panel modal-panel-lg flex min-h-0 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl animate-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/60 bg-card/95 px-4 py-3 sm:px-5">
          <h3 className="flex min-w-0 items-center gap-2 text-base font-black text-foreground">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary/10">
              <BarChart3 className="h-4.5 w-4.5 text-primary" />
            </span>
            <span className="truncate">스트리머 시세 상세</span>
          </h3>
          <button
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-secondary/60 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
            aria-label="닫기"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {loading || !streamer ? (
          <div className="flex flex-1 items-center justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent"></div>
          </div>
        ) : (
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-5">
            <div className="rounded-2xl border border-border/70 bg-secondary/20 p-3.5">
              <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center">
                <div className="flex min-w-0 items-center gap-3">
                  <img
                    src={streamer.custom_image_url || streamer.logo_url || '/icon.png'}
                    alt={streamer.name}
                    className="h-14 w-14 shrink-0 rounded-full border border-border object-cover"
                  />
                  <div className="min-w-0">
                    <h4 className="truncate text-base font-black text-foreground">{streamer.name}</h4>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-muted-foreground">
                      <span>{(streamer.follower_count || 0).toLocaleString()} 팔로워</span>
                      <span className="text-border">·</span>
                      <span className={`inline-flex items-center gap-1 font-bold ${streamer.is_active ? 'text-emerald-500' : 'text-muted-foreground'}`}>
                        <span className={`h-2 w-2 rounded-full ${streamer.is_active ? 'bg-emerald-500' : 'bg-zinc-700'}`} />
                        {streamer.is_active ? '방송 중' : '오프라인'}
                      </span>
                    </p>
                  </div>
                </div>

                <div className="rounded-xl border border-primary/20 bg-primary/10 px-3 py-2 sm:min-w-36 sm:text-right">
                  <p className="text-[10px] font-bold text-muted-foreground">현재 시세</p>
                  <p className="mt-0.5 text-lg font-black text-primary">{(streamer.base_value || 0).toLocaleString()} P</p>
                {(() => {
                  const prev = streamer.prev_value ?? streamer.base_value ?? 1000;
                  const diff = (streamer.base_value || 0) - prev;
                  const rate = prev > 0 ? (diff / prev) * 100 : 0;
                  const cls = diff > 0 ? 'text-rose-500' : diff < 0 ? 'text-blue-500' : 'text-muted-foreground';
                  const arrow = diff > 0 ? '▲' : diff < 0 ? '▼' : '-';
                  return <p className={`text-[11px] font-bold ${cls}`}>{arrow} {rate.toFixed(1)}% (24h)</p>;
                })()}
                {streamer.recent_market_price !== undefined && streamer.recent_market_price !== null ? (
                  <p className="mt-1 text-[10px] font-bold text-emerald-500">최근 체결 {streamer.recent_market_price.toLocaleString()} P</p>
                ) : (
                  <p className="mt-1 text-[10px] text-muted-foreground">마켓 거래 이력 없음</p>
                )}
                </div>
              </div>
            </div>

            {/* 그래프 기간 토글 */}
            <div className="flex items-center justify-between gap-3">
              <p className="text-[11px] font-bold text-muted-foreground">시세 기록</p>
              <div className="flex shrink-0 items-center gap-1 rounded-xl bg-secondary/50 p-1">
                {(['24h', '7d'] as const).map((r) => (
                  <button
                    key={r}
                    onClick={() => setRange(r)}
                    className={`rounded-lg px-3 py-1.5 text-[11px] font-black transition ${range === r ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                  >
                    {r === '24h' ? '24시간' : '7일'}
                  </button>
                ))}
              </div>
            </div>

            {/* SVG 라인 차트 (hover 시 해당 시점 강조 + 툴팁) */}
            {history.length >= 2 ? (() => {
              const W = 460, H = 170, P = 14;
              const parseTime = (iso: string) => {
                const normalized = iso.includes('T') || iso.endsWith('Z') ? iso : iso.replace(' ', 'T') + 'Z';
                const ts = new Date(normalized).getTime();
                return Number.isFinite(ts) ? ts : Date.now();
              };
              const sortedHistory = history.slice().sort((a, b) => parseTime(a.recorded_at) - parseTime(b.recorded_at));
              const n = sortedHistory.length;
              const values = sortedHistory.map(h => h.value);
              const min = Math.min(...values), max = Math.max(...values);
              const rng = max - min || 1;

              // 축 라벨은 데이터 포인트가 아니라 '요청한 조회 구간'(현재 ~ 현재-range)을 기준으로 표시합니다.
              // 24시간이면 현재부터 24시간 전까지, 7일이면 현재부터 7일 전까지가 명확히 보이도록.
              const rangeMs = range === '24h' ? 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
              const fallbackEndTs = Date.now();
              const rangeEndTs = historyRange ? parseTime(historyRange.end) : fallbackEndTs;
              const rangeStartTs = historyRange ? parseTime(historyRange.start) : rangeEndTs - rangeMs;
              const safeRangeMs = Math.max(1, rangeEndTs - rangeStartTs);
              const coords = sortedHistory.map((h) => {
                const pointTs = Math.min(rangeEndTs, Math.max(rangeStartTs, parseTime(h.recorded_at)));
                return {
                  ts: pointTs,
                  x: P + ((pointTs - rangeStartTs) / safeRangeMs) * (W - 2 * P),
                  y: H - P - ((h.value - min) / rng) * (H - 2 * P)
                };
              });
              const gapThresholdMs = range === '24h' ? 20 * 60 * 1000 : 2 * 60 * 60 * 1000;
              const segments = coords.reduce<Array<typeof coords>>((acc, coord, index) => {
                const prev = coords[index - 1];
                if (!prev || coord.ts - prev.ts > gapThresholdMs) {
                  acc.push([coord]);
                } else {
                  acc[acc.length - 1].push(coord);
                }
                return acc;
              }, []);
              const up = values[n - 1] >= values[0];
              const stroke = up ? '#f43f5e' : '#3b82f6';

              const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                const pointerX = P + ratio * (W - 2 * P);
                let nearest = 0;
                let nearestDistance = Infinity;
                coords.forEach((coord, index) => {
                  const distance = Math.abs(coord.x - pointerX);
                  if (distance < nearestDistance) {
                    nearest = index;
                    nearestDistance = distance;
                  }
                });
                setHover(nearest);
              };
              const hovered = hover !== null && hover < n ? hover : null;
              const fmtTime = (iso: string) => {
                const d = new Date(parseTime(iso));
                return d.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
              };
              const fmtAxis = (ts: number) => new Date(ts).toLocaleString(
                'ko-KR',
                range === '24h'
                  ? { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }
                  : { month: 'numeric', day: 'numeric' }
              );

              return (
                <div className="rounded-2xl border border-border bg-secondary/20 p-3">
                  <div className="relative overflow-visible">
                    <svg
                      viewBox={`0 0 ${W} ${H}`}
                      className="h-44 w-full min-w-0 overflow-visible"
                      preserveAspectRatio="none"
                      onMouseMove={onMove}
                      onMouseLeave={() => setHover(null)}
                    >
                      {segments
                        .filter((segment) => segment.length >= 2)
                        .map((segment, index) => (
                          <polyline
                            key={index}
                            points={segment.map(c => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ')}
                            fill="none"
                            stroke={stroke}
                            strokeWidth="2"
                            strokeLinejoin="round"
                            strokeLinecap="round"
                          />
                        ))}
                      {hovered !== null && (
                        <>
                          <line x1={coords[hovered].x} y1={P} x2={coords[hovered].x} y2={H - P} stroke="currentColor" strokeWidth="1" className="text-muted-foreground/40" strokeDasharray="3 3" />
                          <circle cx={coords[hovered].x} cy={coords[hovered].y} r="4" fill={stroke} stroke="#fff" strokeWidth="1.5" />
                        </>
                      )}
                    </svg>
                    {hovered !== null && (
                      <div
                        className="pointer-events-none absolute -top-1 z-10 -translate-x-1/2 -translate-y-full rounded-lg bg-foreground px-2 py-1 text-[10px] font-bold text-background shadow-lg whitespace-nowrap"
                        style={{ left: `${(coords[hovered].x / W) * 100}%` }}
                      >
                        {fmtTime(sortedHistory[hovered].recorded_at)} · {values[hovered].toLocaleString()}P
                      </div>
                    )}
                  </div>
                  <div className="mt-2 grid gap-1 text-[10px] text-muted-foreground sm:grid-cols-3 sm:items-center">
                    <span className="truncate">{fmtAxis(rangeStartTs)}</span>
                    <span className="text-left font-bold sm:text-center">최저 {min.toLocaleString()}P · 최고 {max.toLocaleString()}P</span>
                    <span className="truncate text-left sm:text-right">{fmtAxis(rangeEndTs)}</span>
                  </div>
                </div>
              );
            })() : (
              <div className="rounded-xl border border-border bg-secondary/20 p-6 text-center text-[11px] text-muted-foreground">
                아직 시세 그래프를 그릴 만큼의 데이터가 쌓이지 않았습니다.<br />(시세는 2분마다 기록됩니다)
              </div>
            )}

            {/* 치지직 방송국 바로가기 */}
            <a
              href={streamer.is_active ? `https://chzzk.naver.com/live/${streamer.channel_id}` : `https://chzzk.naver.com/${streamer.channel_id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#00ffa3] py-3 text-sm font-black text-black transition hover:brightness-95"
            >
              치지직 바로가기
            </a>

            <div className="grid gap-2 text-[11px] sm:grid-cols-2">
              <div className="rounded-xl border border-border/50 bg-secondary/30 p-3">
                <p className="text-muted-foreground">활동 점수</p>
                <p className="mt-1 text-sm font-black text-foreground">{(streamer.activity_score || 0).toLocaleString()}</p>
              </div>
              <div className="rounded-xl border border-border/50 bg-secondary/30 p-3">
                <p className="text-muted-foreground">누적 방송 시간</p>
                <p className="mt-1 text-sm font-black text-foreground">{Math.floor((streamer.broadcast_minutes || 0) / 60)}시간 {(streamer.broadcast_minutes || 0) % 60}분</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(modal, document.body);
};
