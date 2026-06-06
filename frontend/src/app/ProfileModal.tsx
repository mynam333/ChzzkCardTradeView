'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useApp } from './AppContext';
import { apiFetch } from '@/lib/api';
import { borderStyle, borderClass, nameEffectStyle, proxiedImage, cardImage } from '@/lib/cosmetics';
import { CosmeticFrame } from './CosmeticFrame';
import { CosmeticName } from './CosmeticName';
import { toPng } from 'html-to-image';
import { X, Coins, Download, Share2, Star, Loader2 } from 'lucide-react';

interface CosmeticRef { id: number; style_json?: string | null; font_url?: string | null; font_family?: string | null; }
interface StreamerLite {
  channel_id?: string;
  name: string;
  logo_url?: string | null;
  custom_image_url?: string | null;
  custom_images?: (string | null)[] | null;
  base_value?: number;
  serial_number?: number | null;
  follower_count?: number;
  is_active?: boolean;
}
interface RepCard {
  channel_id: string;
  star: number;
  serial_number: number | null;
  streamer: StreamerLite;
  border: CosmeticRef | null;
  name_effect: CosmeticRef | null;
}
interface CollectionItem {
  channel_id: string;
  count: number;
  maxStar: number;
  streamer: StreamerLite;
}
interface ProfileData {
  id: string;
  username: string;
  avatar_url: string;
  point: number;
  card_count: number;
  unique_count: number;
  total_asset: number;
  representative_card: RepCard | null;
  collection: CollectionItem[];
}

export const ProfileModal: React.FC<{ userId: string; onClose: () => void }> = ({ userId, onClose }) => {
  const { toast } = useApp();
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const res = await apiFetch(`/users/${userId}/profile`);
        if (res.ok && alive) setProfile(await res.json());
        else if (alive) toast('프로필을 불러오지 못했습니다.', 'error');
      } catch {
        if (alive) toast('프로필 조회 중 오류가 발생했습니다.', 'error');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [userId]);

  const renderToPng = async (): Promise<string | null> => {
    if (!cardRef.current) return null;
    return toPng(cardRef.current, {
      cacheBust: true,
      pixelRatio: 2,
      backgroundColor: '#0a0a0a'
    });
  };

  const handleSave = async () => {
    setExporting(true);
    try {
      const dataUrl = await renderToPng();
      if (!dataUrl) return;
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `cctv-profile-${profile?.username || userId}.png`;
      a.click();
      toast('프로필 이미지를 저장했습니다.', 'success');
    } catch (e) {
      console.error(e);
      toast('이미지 저장에 실패했습니다.', 'error');
    } finally {
      setExporting(false);
    }
  };

  const handleShare = async () => {
    setExporting(true);
    try {
      const dataUrl = await renderToPng();
      if (!dataUrl) return;
      const blob = await (await fetch(dataUrl)).blob();
      const file = new File([blob], `cctv-profile-${profile?.username || userId}.png`, { type: 'image/png' });
      const nav = navigator as any;
      if (nav.share && nav.canShare && nav.canShare({ files: [file] })) {
        await nav.share({
          files: [file],
          title: `${profile?.username}님의 CCTV 프로필`,
          text: `${profile?.username}님의 치지직 카드 컬렉션`
        });
        toast('공유를 시작했습니다.', 'success');
      } else {
        // 공유 미지원 환경: 저장으로 폴백
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = file.name;
        a.click();
        toast('공유를 지원하지 않아 이미지로 저장했습니다.', 'info');
      }
    } catch (e: any) {
      if (e?.name !== 'AbortError') {
        console.error(e);
        toast('공유에 실패했습니다.', 'error');
      }
    } finally {
      setExporting(false);
    }
  };

  const rep = profile?.representative_card;
  const repStreamer = rep?.streamer;

  return (
    <div
      className="modal-backdrop z-[80] bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="modal-panel modal-panel-md modal-panel-scroll relative rounded-3xl border border-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute right-3 top-3 z-10 rounded-full bg-black/30 p-1.5 text-white/80 hover:bg-black/50 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>

        {loading ? (
          <div className="flex flex-col items-center justify-center gap-3 py-24">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-xs text-muted-foreground">프로필 불러오는 중...</p>
          </div>
        ) : !profile ? (
          <div className="py-24 text-center text-sm text-muted-foreground">프로필 정보를 찾을 수 없습니다.</div>
        ) : (
          <>
            {/* 캡처 대상 영역 */}
            <div ref={cardRef} className="bg-gradient-to-b from-zinc-900 to-black p-6 text-white">
              {/* 헤더: 닉네임 + ID */}
              <div className="flex items-center gap-3">
                <img
                  src={proxiedImage(profile.avatar_url)}
                  alt={profile.username}
                  crossOrigin="anonymous"
                  className="h-14 w-14 rounded-full border-2 border-primary/50 bg-zinc-800 object-cover"
                />
                <div className="min-w-0">
                  <h3 className="text-lg font-black tracking-tight truncate">{profile.username}</h3>
                  <p className="text-[10px] text-zinc-400 truncate">@{profile.id}</p>
                </div>
                <div className="ml-auto text-right">
                  <p className="text-[9px] text-zinc-400">총 자산</p>
                  <p className="text-sm font-black text-emerald-400">{profile.total_asset.toLocaleString()} P</p>
                </div>
              </div>

              {/* 대표 카드 (크게) */}
              {rep && repStreamer ? (
                <div className="mt-5 flex justify-center">
                  <div
                    style={{
                      containerType: 'inline-size',
                      ...(borderClass(rep.border) ? {} : (borderStyle(rep.border) || {}))
                    }}
                    className={`relative flex aspect-[5/8] w-44 flex-col justify-between overflow-hidden rounded-xl bg-zinc-800 shadow-xl border border-white/10 ${rep.star >= 1 ? `card-star card-star-${rep.star}` : ''}`}
                  >
                    {/* 프리미엄 테두리 코스메틱 오버레이 */}
                    <CosmeticFrame border={rep.border} />
                    
                    {/* 카드 이미지 배경 */}
                    <div className="absolute inset-0 z-0">
                      <img
                        src={proxiedImage(cardImage(repStreamer, rep.star))}
                        alt={repStreamer.name}
                        crossOrigin="anonymous"
                        className="h-full w-full object-cover opacity-85"
                      />
                    </div>
                    
                    {/* 하단 그라데이션 오버레이 (카드 테두리(z-10)보다 위에 배치하여 테두리 하단도 어둡게 덮음) */}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/15 to-transparent z-15 pointer-events-none" />

                    {/* 카드 콘텐츠 패딩 랩퍼 */}
                    <div className="relative z-20 flex h-full w-full flex-col justify-between p-3 pointer-events-none">
                      {/* 상단 정보 */}
                      <div className="flex items-center justify-between w-full pointer-events-auto">
                        {repStreamer.is_active ? (
                          <span className="rounded bg-red-600 px-1.5 py-0.5 text-[8px] font-bold">LIVE</span>
                        ) : <span />}
                        <span className="rounded bg-black/50 px-2 py-0.5 text-[9px] font-black text-white/90">
                          No.{String(rep.serial_number ?? 0).padStart(4, '0')}
                        </span>
                      </div>

                      {/* 하단 정보 */}
                      <div className="space-y-1 w-full pointer-events-auto">
                        {rep.star >= 1 && (
                          <div className="flex gap-0.5">
                            {Array.from({ length: rep.star }).map((_, i) => (
                              <Star key={i} className="h-3 w-3 fill-yellow-400 text-yellow-400 drop-shadow" />
                            ))}
                          </div>
                        )}
                        <CosmeticName effect={rep.name_effect} className="block text-sm font-black tracking-tight truncate drop-shadow">
                          {repStreamer.name}
                        </CosmeticName>
                        <div className="flex items-center justify-between border-t border-white/20 pt-1.5">
                          <span className="text-[8px] text-zinc-300">대표 카드</span>
                          <span className="text-xs font-black text-emerald-400">{(repStreamer.base_value || 0).toLocaleString()} P</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="mt-5 rounded-2xl border border-dashed border-white/20 py-10 text-center text-xs text-zinc-400">
                  보유한 카드가 없습니다.
                </div>
              )}

              {/* 요약 통계 */}
              <div className="mt-5 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-xl bg-white/5 py-2">
                  <p className="text-[9px] text-zinc-400">보유 포인트</p>
                  <p className="text-xs font-black text-yellow-400">{profile.point.toLocaleString()}</p>
                </div>
                <div className="rounded-xl bg-white/5 py-2">
                  <p className="text-[9px] text-zinc-400">총 카드</p>
                  <p className="text-xs font-black">{profile.card_count.toLocaleString()}</p>
                </div>
                <div className="rounded-xl bg-white/5 py-2">
                  <p className="text-[9px] text-zinc-400">보유 종류</p>
                  <p className="text-xs font-black">{profile.unique_count.toLocaleString()}</p>
                </div>
              </div>

              {/* 보유 카드 요약 (썸네일 그리드) */}
              {profile.collection.length > 0 && (
                <div className="mt-4">
                  <p className="mb-2 text-[10px] font-bold text-zinc-400">보유 카드</p>
                  <div className="flex flex-wrap gap-1.5">
                    {profile.collection.slice(0, 25).map((c) => (
                      <div key={c.channel_id} className="relative">
                        <img
                          src={proxiedImage(cardImage(c.streamer, c.maxStar))}
                          alt={c.streamer.name}
                          crossOrigin="anonymous"
                          className="h-9 w-9 rounded-lg border border-white/10 object-cover"
                        />
                        {c.count > 1 && (
                          <span className="absolute -bottom-1 -right-1 rounded-full bg-primary px-1 text-[8px] font-black text-primary-foreground">
                            {c.count}
                          </span>
                        )}
                        {c.maxStar >= 1 && (
                          <span className="absolute -top-1 -left-1 rounded-full bg-yellow-400 px-1 text-[7px] font-black text-black">
                            ★{c.maxStar}
                          </span>
                        )}
                      </div>
                    ))}
                    {profile.collection.length > 25 && (
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/5 text-[9px] font-bold text-zinc-400">
                        +{profile.collection.length - 25}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* 워터마크 */}
              <p className="mt-5 text-center text-[8px] font-bold tracking-widest text-zinc-500">
                CCTV · 치지직 카드 트레이드 뷰
              </p>
            </div>

            {/* 액션 버튼 */}
            <div className="flex gap-2 border-t border-border p-4">
              <button
                onClick={handleSave}
                disabled={exporting}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-secondary py-2.5 text-xs font-bold text-foreground hover:bg-secondary/80 disabled:opacity-50"
              >
                {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                이미지 저장
              </button>
              <button
                onClick={handleShare}
                disabled={exporting}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary py-2.5 text-xs font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Share2 className="h-3.5 w-3.5" />}
                공유하기
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
