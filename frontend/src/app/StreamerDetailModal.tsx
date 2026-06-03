'use client';

import React, { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { useApp } from './AppContext';
import { BarChart3, X } from 'lucide-react';

interface HistoryPoint { value: number; recorded_at: string; }

/**
 * 스트리머 시세 상세 + 그래프 모달 (보관함/실시간 랭킹 공용).
 * channelId가 주어지면 해당 스트리머 상세를 로드하여 표시하고, 카드 외 영역 클릭 시 닫힙니다.
 */
export const StreamerDetailModal: React.FC<{ channelId: string; onClose: () => void }> = ({ channelId, onClose }) => {
  const { toast } = useApp();
  const [streamer, setStreamer] = useState<any | null>(null);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<'24h' | '7d'>('7d');
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setHistory([]);
      try {
        const res = await apiFetch(`/streamers/${channelId}?range=${range}`);
        if (res.ok && alive) {
          const data = await res.json();
          setStreamer(data.streamer);
          setHistory(data.history || []);
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
  }, [channelId, range]);

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-2xl animate-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border/60 pb-3">
          <h3 className="text-base font-bold flex items-center gap-2"><BarChart3 className="h-4.5 w-4.5 text-primary" /> 스트리머 시세 상세</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
        </div>

        {loading || !streamer ? (
          <div className="flex items-center justify-center py-16">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent"></div>
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <div className="flex items-center gap-3">
              <img src={streamer.custom_image_url || streamer.logo_url} alt={streamer.name} className="h-14 w-14 rounded-full object-cover border border-border" />
              <div className="flex-1 min-w-0">
                <h4 className="text-sm font-black truncate">{streamer.name}</h4>
                <p className="text-[11px] text-muted-foreground">{(streamer.follower_count || 0).toLocaleString()} 팔로워 · {streamer.is_active ? '🟢 방송 중' : '⚫ 오프라인'}</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-black text-primary">{(streamer.base_value || 0).toLocaleString()} P</p>
                {(() => {
                  const prev = streamer.prev_value ?? streamer.base_value ?? 1000;
                  const diff = (streamer.base_value || 0) - prev;
                  const rate = prev > 0 ? (diff / prev) * 100 : 0;
                  const cls = diff > 0 ? 'text-rose-500' : diff < 0 ? 'text-blue-500' : 'text-muted-foreground';
                  const arrow = diff > 0 ? '▲' : diff < 0 ? '▼' : '-';
                  return <p className={`text-[11px] font-bold ${cls}`}>{arrow} {rate.toFixed(1)}% (24h)</p>;
                })()}
              </div>
            </div>

            {/* 그래프 기간 토글 */}
            <div className="flex items-center justify-end gap-1">
              {(['24h', '7d'] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => setRange(r)}
                  className={`rounded-md px-2.5 py-1 text-[11px] font-bold transition ${range === r ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:text-foreground'}`}
                >
                  {r === '24h' ? '24시간' : '7일'}
                </button>
              ))}
            </div>

            {/* SVG 라인 차트 (hover 시 해당 시점 강조 + 툴팁) */}
            {history.length >= 2 ? (() => {
              const W = 460, H = 140, P = 8;
              const n = history.length;
              const values = history.map(h => h.value);
              const min = Math.min(...values), max = Math.max(...values);
              const rng = max - min || 1;
              const coords = history.map((h, i) => ({
                x: P + (i / (n - 1)) * (W - 2 * P),
                y: H - P - ((h.value - min) / rng) * (H - 2 * P)
              }));
              const pts = coords.map(c => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
              const up = values[n - 1] >= values[0];
              const stroke = up ? '#f43f5e' : '#3b82f6';

              const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const ratio = (e.clientX - rect.left) / rect.width;
                const idx = Math.max(0, Math.min(n - 1, Math.round(ratio * (n - 1))));
                setHover(idx);
              };
              const hovered = hover !== null && hover < n ? hover : null;
              const fmtTime = (iso: string) => {
                const d = new Date(iso.includes('T') || iso.includes('Z') ? iso : iso.replace(' ', 'T') + 'Z');
                return d.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
              };

              return (
                <div className="rounded-xl border border-border bg-secondary/20 p-3">
                  <div className="relative">
                    <svg
                      viewBox={`0 0 ${W} ${H}`}
                      className="w-full h-auto"
                      preserveAspectRatio="none"
                      onMouseMove={onMove}
                      onMouseLeave={() => setHover(null)}
                    >
                      <polyline points={pts} fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
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
                        {fmtTime(history[hovered].recorded_at)} · {values[hovered].toLocaleString()}P
                      </div>
                    )}
                  </div>
                  <div className="flex justify-between text-[9px] text-muted-foreground mt-1">
                    <span>{new Date(history[0].recorded_at).toLocaleDateString('ko-KR')}</span>
                    <span>최저 {min.toLocaleString()}P · 최고 {max.toLocaleString()}P</span>
                    <span>{new Date(history[n - 1].recorded_at).toLocaleDateString('ko-KR')}</span>
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
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#00ffa3] py-2.5 text-xs font-black text-black hover:brightness-95 transition"
            >
              치지직 바로가기
            </a>

            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div className="rounded-lg bg-secondary/30 p-2.5"><p className="text-muted-foreground">활동 점수</p><p className="font-bold">{(streamer.activity_score || 0).toLocaleString()}</p></div>
              <div className="rounded-lg bg-secondary/30 p-2.5"><p className="text-muted-foreground">누적 방송 시간</p><p className="font-bold">{Math.floor((streamer.broadcast_minutes || 0) / 60)}시간 {(streamer.broadcast_minutes || 0) % 60}분</p></div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
