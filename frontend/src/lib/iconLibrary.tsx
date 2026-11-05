'use client';

import React from 'react';
import {
  Award,
  BadgeCheck,
  Crown,
  Diamond,
  Flame,
  Gem,
  Heart,
  Medal,
  ShieldCheck,
  Sparkles,
  Star,
  Trophy,
  Zap,
  type LucideIcon
} from 'lucide-react';
import { generatedIconAssetVersion } from './generatedIconAssetVersion';

type IconProps = {
  name?: string | null;
  className?: string;
  style?: React.CSSProperties;
  'aria-hidden'?: boolean | 'true' | 'false';
};

type ResolvedIcon =
  | { key: string; kind: 'mdi'; path: string }
  | { key: string; kind: 'lucide'; nodes: LucideNode[] };

type LucideNode = [string, Record<string, string | number>];
type IconBucket = Record<string, string | LucideNode[] | undefined>;

const commonLucideIcons: Partial<Record<string, LucideIcon>> = {
  Award,
  BadgeCheck,
  Crown,
  Diamond,
  Flame,
  Gem,
  Heart,
  Medal,
  ShieldCheck,
  Sparkles,
  Star,
  Trophy,
  Zap
};

const bucketPromises = new Map<string, Promise<IconBucket>>();

const toPascalCase = (value: string) =>
  value
    .split(/[-_:\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join('');

const toKebabCase = (value: string) =>
  value
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Za-z])([0-9])/g, '$1-$2')
    .replace(/[_:\s]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();

const mdiExportName = (name: string) => {
  const raw = name.trim();
  if (/^mdi[A-Z]/.test(raw)) return raw;
  const normalized = raw.replace(/^mdi[:_-]?/i, '');
  return `mdi${toPascalCase(normalized)}`;
};

const isMdiName = (name: string) => /^mdi[:_-]?/i.test(name) || /^mdi[A-Z]/.test(name);

const hashBucket = (value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 32;
};

const getIconBucket = (kind: 'mdi' | 'lucide', lookupName: string) => {
  const bucket = hashBucket(lookupName);
  const cacheKey = `${kind}-${bucket}`;
  let promise = bucketPromises.get(cacheKey);
  if (!promise) {
    promise = fetch(`/generated-icons/${cacheKey}.json?v=${generatedIconAssetVersion}`, { cache: 'force-cache' })
      .then((response) => {
        if (!response.ok) throw new Error(`아이콘 리소스를 불러오지 못했습니다. (${response.status})`);
        return response.json() as Promise<IconBucket>;
      })
      .catch((error) => {
        if (bucketPromises.get(cacheKey) === promise) bucketPromises.delete(cacheKey);
        throw error;
      });
    bucketPromises.set(cacheKey, promise);
  }
  return promise;
};

const loadIcon = async (raw: string): Promise<ResolvedIcon | null> => {
  if (isMdiName(raw)) {
    const lookupName = mdiExportName(raw);
    const bucket = await getIconBucket('mdi', lookupName);
    const path = bucket[lookupName];
    return typeof path === 'string' ? { key: raw, kind: 'mdi', path } : null;
  }

  const lucideName = /^lucide:/i.test(raw) ? raw.slice(7) : raw;
  const lookupName = toKebabCase(lucideName);
  const bucket = await getIconBucket('lucide', lookupName);
  const nodes = bucket[lookupName];
  return Array.isArray(nodes) ? { key: raw, kind: 'lucide', nodes } : null;
};

export const AppIcon: React.FC<IconProps> = ({ name, className, style, 'aria-hidden': ariaHidden }) => {
  const raw = String(name || '').trim();
  const normalizedLucideName = /^lucide:/i.test(raw) ? raw.slice(7) : raw;
  const CommonIcon = commonLucideIcons[normalizedLucideName] || (!raw ? Award : null);
  const [resolved, setResolved] = React.useState<ResolvedIcon | null>(null);

  React.useEffect(() => {
    if (CommonIcon) return;
    let active = true;
    loadIcon(raw)
      .then((icon) => {
        if (active) setResolved(icon);
      })
      .catch(() => {
        if (active) setResolved(null);
      });
    return () => {
      active = false;
    };
  }, [CommonIcon, raw]);

  if (CommonIcon) {
    return <CommonIcon aria-hidden={ariaHidden} className={className} style={style} />;
  }

  const current = resolved?.key === raw ? resolved : null;
  if (current?.kind === 'mdi') {
    return (
      <svg aria-hidden={ariaHidden} viewBox="0 0 24 24" className={className} style={style} fill="currentColor">
        <path d={current.path} />
      </svg>
    );
  }
  if (current?.kind === 'lucide') {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden={ariaHidden}
        viewBox="0 0 24 24"
        width="24"
        height="24"
        className={['lucide', `lucide-${toKebabCase(normalizedLucideName)}`, className].filter(Boolean).join(' ')}
        style={style}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {current.nodes.map(([tag, attributes], index) => React.createElement(tag, {
          ...attributes,
          key: attributes.key || `${tag}-${index}`
        }))}
      </svg>
    );
  }

  return <Award aria-hidden={ariaHidden} className={className} style={style} />;
};
