'use client';

import React from 'react';
import { CometCard } from '@/components/ui/comet-card';
import { borderClass, borderStyle } from '@/lib/cosmetics';
import { CosmeticFrame } from './CosmeticFrame';
import { CosmeticName } from './CosmeticName';

type CosmeticLike = {
  id?: number;
  style_json?: string | null;
  font_url?: string | null;
  font_family?: string | null;
} | null;

type CardPreviewProps = {
  border?: CosmeticLike;
  nameEffect?: CosmeticLike;
  name?: string;
  serialNumber?: number;
  followerCount?: number;
  value?: number;
  star?: number;
  statusLabel?: string;
  className?: string;
  withComet?: boolean;
};

const CardShell: React.FC<CardPreviewProps> = ({
  border,
  nameEffect,
  name = '미리보기',
  serialNumber = 0,
  followerCount = 12345,
  value = 67890,
  star = 0,
  statusLabel = 'PREVIEW',
  className
}) => (
  <div
    style={{
      width: '224px',
      height: '358.4px',
      containerType: 'inline-size',
      ...(borderClass(border) ? {} : (borderStyle(border) || {}))
    }}
    className={`card-3d-surface relative flex flex-col justify-between overflow-hidden rounded-xl border border-border/80 bg-card shadow-2xl ${star >= 1 ? `card-star card-star-${star}` : ''} ${className || ''}`}
  >
    <CosmeticFrame border={border} />

    <div className="absolute inset-0 z-0 flex items-center justify-center bg-gradient-to-br from-zinc-300 via-zinc-400 to-zinc-600 dark:from-zinc-700 dark:via-zinc-800 dark:to-zinc-950">
      <span className="select-none text-[8rem] font-black leading-none text-white/50 drop-shadow-md">?</span>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_35%_20%,rgba(255,255,255,0.34),transparent_32%),linear-gradient(135deg,rgba(255,255,255,0.16),transparent_40%)]" />
    </div>
    <div className="absolute inset-0 z-15 bg-gradient-to-t from-black/90 via-black/12 to-black/25 pointer-events-none" />

    <div className="card-3d-text relative z-20 flex h-full w-full flex-col justify-between p-3 text-white pointer-events-none">
      <div className="flex items-center justify-between w-full">
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[8px] font-bold text-zinc-200">
          {statusLabel}
        </span>
        <span className="rounded bg-black/40 px-1.5 py-0.5 text-[8px] font-black text-white/90">
          No.{String(serialNumber).padStart(4, '0')}
        </span>
      </div>

      <div className="mt-auto block space-y-1">
        {star > 0 && (
          <div className="flex items-center gap-0.5 drop-shadow">
            {Array.from({ length: star }, (_, i) => (
              <span key={i} className="text-amber-300 text-[10px] leading-none">★</span>
            ))}
          </div>
        )}
        <CosmeticName effect={nameEffect} className="block truncate text-sm font-bold tracking-tight drop-shadow">
          {name}
        </CosmeticName>
        <p className="text-[8.5px] text-zinc-300 drop-shadow">{followerCount.toLocaleString()} 팔로워</p>
        <div className="flex items-center justify-between border-t border-white/10 pt-1">
          <span className="text-[8.5px] text-zinc-400">{star > 0 ? `${star}성 가치` : '시세 가치'}</span>
          <span className="text-xs font-black text-emerald-400">{value.toLocaleString()} P</span>
        </div>
      </div>
    </div>
  </div>
);

export const CardPreview: React.FC<CardPreviewProps> = ({ withComet = false, ...props }) => {
  if (!withComet) return <CardShell {...props} />;
  return (
    <CometCard
      rotateDepth={8}
      translateDepth={10}
      className="h-full w-full"
    >
      <CardShell {...props} />
    </CometCard>
  );
};
