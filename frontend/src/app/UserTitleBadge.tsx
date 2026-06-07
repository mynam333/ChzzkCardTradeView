'use client';

import React, { useEffect } from 'react';
import { Award, icons } from 'lucide-react';
import type { UserTitle } from '@/lib/types';

const generatedClass = (id: number) => `user-title-${id}`;

const cssClassFromEffect = (title: UserTitle): string | null => {
  if (!title.css.includes('{')) return null;
  const match = title.css.match(/\.([A-Za-z_][\w-]*)[^{]*\{/);
  return match?.[1] || null;
};

const compileCss = (title: UserTitle): string => {
  const selector = `.${generatedClass(title.id)}`;
  if (!title.css.trim()) return '';
  if (title.css.includes('{{selector}}')) return title.css.replaceAll('{{selector}}', selector);
  if (title.css.includes('{')) return title.css;
  return `${selector} { ${title.css} }`;
};

const ensureTitleCss = (title: UserTitle) => {
  const styleId = `user-title-style-${title.id}`;
  const css = compileCss(title);
  const existing = document.getElementById(styleId) as HTMLStyleElement | null;
  if (!css) {
    existing?.remove();
    return;
  }
  const style = existing || document.createElement('style');
  style.id = styleId;
  style.textContent = css;
  if (!existing) document.head.appendChild(style);
};

export const UserTitleBadge: React.FC<{ title: UserTitle; compact?: boolean }> = ({ title, compact = false }) => {
  useEffect(() => {
    ensureTitleCss(title);
  }, [title]);

  const Icon = (title.icon_name && icons[title.icon_name as keyof typeof icons]) || Award;
  const customClass = cssClassFromEffect(title);

  return (
    <span
      className={[
        'inline-flex shrink-0 items-center rounded-full border border-border/40 bg-secondary px-2 py-0.5 font-bold leading-none text-secondary-foreground shadow-sm dark:border-white/10 dark:bg-zinc-800 dark:text-white',
        compact ? 'gap-1 text-[9px]' : 'gap-1.5 text-[10px]',
        generatedClass(title.id),
        customClass
      ].filter(Boolean).join(' ')}
      title={title.name}
    >
      <Icon aria-hidden="true" className={compact ? 'h-2.5 w-2.5' : 'h-3 w-3'} style={{ color: title.icon_color }} />
      <span>{title.name}</span>
    </span>
  );
};

export const UserTitleList: React.FC<{ titles?: UserTitle[]; compact?: boolean }> = ({ titles = [], compact = false }) => {
  if (titles.length === 0) return null;
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-1">
      {titles.map((title) => <UserTitleBadge key={title.id} title={title} compact={compact} />)}
    </span>
  );
};
