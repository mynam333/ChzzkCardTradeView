'use client';

import React from 'react';
import * as mdiIcons from '@mdi/js';
import { Award, icons } from 'lucide-react';

type IconProps = {
  name?: string | null;
  className?: string;
  style?: React.CSSProperties;
  'aria-hidden'?: boolean | 'true' | 'false';
};

const toPascalCase = (value: string) =>
  value
    .split(/[-_:\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join('');

const mdiExportName = (name: string) => {
  const raw = name.trim();
  if (/^mdi[A-Z]/.test(raw)) return raw;
  const normalized = raw.replace(/^mdi[:_-]?/i, '');
  return `mdi${toPascalCase(normalized)}`;
};

const mdiPath = (name: string) => (mdiIcons as Record<string, string | undefined>)[mdiExportName(name)];

const isMdiName = (name: string) => /^mdi[:_-]?/i.test(name) || /^mdi[A-Z]/.test(name);

export const suggestedIconOptions = [
  'Award', 'BadgeCheck', 'Crown', 'Diamond', 'Flame', 'Gem', 'Heart', 'Medal', 'ShieldCheck', 'Sparkles', 'Star', 'Trophy', 'Zap',
  'mdi:crown', 'mdi:account-star', 'mdi:badge-account', 'mdi:calendar-check', 'mdi:cards-playing', 'mdi:diamond-stone', 'mdi:fire',
  'mdi:gamepad-variant', 'mdi:gift', 'mdi:medal', 'mdi:shield-check', 'mdi:star', 'mdi:ticket', 'mdi:trophy'
];

export const appIconExists = (name?: string | null) => {
  const raw = String(name || '').trim();
  if (!raw) return true;
  if (isMdiName(raw)) return Boolean(mdiPath(raw));
  if (/^lucide:/i.test(raw)) return Boolean(icons[raw.slice(7) as keyof typeof icons]);
  return Boolean(icons[raw as keyof typeof icons]);
};

export const AppIcon: React.FC<IconProps> = ({ name, className, style, 'aria-hidden': ariaHidden }) => {
  const raw = String(name || '').trim();
  if (isMdiName(raw)) {
    const path = mdiPath(raw);
    if (path) {
      return (
        <svg aria-hidden={ariaHidden} viewBox="0 0 24 24" className={className} style={style} fill="currentColor">
          <path d={path} />
        </svg>
      );
    }
  }
  const lucideName = /^lucide:/i.test(raw) ? raw.slice(7) : raw;
  const Icon = (lucideName && icons[lucideName as keyof typeof icons] || Award) as typeof Award;
  return <Icon aria-hidden={ariaHidden} className={className} style={style} />;
};
