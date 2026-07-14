'use client';

import React from 'react';
import Image from 'next/image';
import { Sparkles } from 'lucide-react';
import { API_BASE_URL } from '@/lib/api';
import { parseArenaCosmeticStyle } from '@/lib/arenaCosmetics';
import { ArenaTooltip } from './ArenaTooltip';

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
        <ArenaTooltip key={index} data={{
          eyebrow: '이모트 휠 슬롯',
          title: item ? `${index + 1}번 · ${item.name}` : `${index + 1}번 · 빈 슬롯`,
          description: item
            ? '이 슬롯을 선택하면 장착 위치를 편집하거나 대전 중 해당 이모트를 바로 보냅니다.'
            : '보유 이모트를 이 위치에 장착하면 상점 편집 화면과 실제 대전 파이 메뉴에 같은 위치로 반영됩니다.',
          details: [{ label: '방향', value: `${index * 45}°` }, { label: '상태', value: selected ? '현재 선택됨' : item ? '장착됨' : '비어 있음' }],
          note: onPick ? '대전 중 선택하면 즉시 전송됩니다.' : '슬롯을 고른 뒤 카탈로그에서 보유 이모트를 선택하세요.',
          tone: item ? 'violet' : 'neutral'
        }} side="top">
          <button
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
        </ArenaTooltip>
      );
    })}
    <div className="arena-v2-pie-core" aria-hidden="true">
      <Sparkles />
      <strong>{selectedIndex === null ? centerLabel : `${selectedIndex + 1}번 슬롯`}</strong>
      <span>{selectedIndex === null ? '선택' : '편집 중'}</span>
    </div>
  </div>
);
