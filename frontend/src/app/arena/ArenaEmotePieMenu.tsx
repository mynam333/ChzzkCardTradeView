'use client';

import React from 'react';
import Image from 'next/image';
import { Sparkles } from 'lucide-react';
import { API_BASE_URL } from '@/lib/api';
import { parseArenaCosmeticStyle } from '@/lib/arenaCosmetics';

export type ArenaEmotePieItem = {
  id: number;
  name: string;
  style_json: string | null;
};

type ArenaEmotePieMenuProps = {
  slots: Array<ArenaEmotePieItem | null>;
  selectedIndex?: number | null;
  onSelect?: (index: number) => void;
  onPick?: (item: ArenaEmotePieItem, index: number) => void;
  disabled?: boolean;
  compact?: boolean;
  centerLabel?: string;
  ariaLabel?: string;
};

const resolveImageUrl = (value: unknown) => {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw) || raw.startsWith('data:') || raw.startsWith('blob:')) return raw;
  if (!raw.startsWith('/')) return '';
  return API_BASE_URL ? `${API_BASE_URL.replace(/\/$/, '')}${raw}` : raw;
};

const sectorStyle = (index: number): React.CSSProperties => {
  const centerAngle = -90 + index * 45;
  const iconRadius = 32;
  const radians = (centerAngle * Math.PI) / 180;
  return {
    top: `${50 + Math.sin(radians) * iconRadius}%`,
    left: `${50 + Math.cos(radians) * iconRadius}%`
  } as React.CSSProperties;
};

export const ArenaEmotePieMenu: React.FC<ArenaEmotePieMenuProps> = ({
  slots,
  selectedIndex = null,
  onSelect,
  onPick,
  disabled = false,
  compact = false,
  centerLabel = '이모트',
  ariaLabel = '이모트 파이 메뉴'
}) => (
  <div
    className={`arena-v2-pie-menu ${compact ? 'is-compact' : ''}`}
    role="group"
    aria-label={ariaLabel}
    style={{
      '--arena-pie-selection-angle': `${-22.5 + (selectedIndex ?? 0) * 45}deg`,
      '--arena-pie-selection-opacity': selectedIndex === null ? 0 : 1
    } as React.CSSProperties}
  >
    <div className="arena-v2-pie-ring" aria-hidden="true" />
    {Array.from({ length: 8 }, (_, index) => {
      const item = slots[index] || null;
      const style = parseArenaCosmeticStyle(item?.style_json);
      const imageUrl = resolveImageUrl(style.image_url);
      const emoji = typeof style.emoji === 'string' && style.emoji.trim() ? style.emoji.trim() : '＋';
      const selected = selectedIndex === index;
      return (
        <button
          key={index}
          type="button"
          className={`${item ? 'has-emote' : 'is-empty'} ${selected ? 'is-selected' : ''}`}
          style={sectorStyle(index)}
          disabled={disabled || (!item && Boolean(onPick) && !onSelect)}
          aria-pressed={selected}
          aria-label={item ? `${index + 1}번 슬롯 ${item.name}` : `${index + 1}번 빈 슬롯`}
          onClick={() => {
            onSelect?.(index);
            if (item) onPick?.(item, index);
          }}
        >
          <span className="arena-v2-pie-slot-number">{index + 1}</span>
          <span className="arena-v2-pie-visual">
            {imageUrl ? <Image src={imageUrl} alt="" width={52} height={52} unoptimized /> : <b>{emoji}</b>}
          </span>
        </button>
      );
    })}
    <div className="arena-v2-pie-core" aria-hidden="true">
      <Sparkles />
      <strong>{selectedIndex === null ? centerLabel : `${selectedIndex + 1}번 슬롯`}</strong>
      <span>{selectedIndex === null ? '선택' : '편집 중'}</span>
    </div>
  </div>
);
