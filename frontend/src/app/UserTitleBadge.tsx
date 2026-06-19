'use client';

import React, { useEffect } from 'react';
import { AppIcon } from '@/lib/iconLibrary';
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

  const customClass = cssClassFromEffect(title);
  const description = title.description?.trim();

  return (
    <span
      className="group/title relative inline-flex shrink-0 align-middle"
      tabIndex={description ? 0 : undefined}
      aria-label={description ? `${title.name}: ${description}` : title.name}
    >
      <span
        className={[
          'inline-flex shrink-0 items-center rounded-full border border-border/40 bg-secondary px-2 py-0.5 font-bold leading-none text-secondary-foreground shadow-sm transition-transform group-hover/title:-translate-y-0.5 dark:border-white/10 dark:bg-zinc-800 dark:text-white',
          compact ? 'gap-1 text-[9px]' : 'gap-1.5 text-[10px]',
          generatedClass(title.id),
          customClass
        ].filter(Boolean).join(' ')}
        title={description ? undefined : title.name}
      >
        <AppIcon name={title.icon_name || 'Award'} aria-hidden="true" className={compact ? 'h-2.5 w-2.5' : 'h-3 w-3'} style={{ color: title.icon_color }} />
        <span>{title.name}</span>
      </span>
      {description && (
        <span
          role="tooltip"
          className="pointer-events-none absolute left-1/2 top-full z-[120] mt-2 w-64 max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-2xl border border-sky-200/80 bg-white/95 px-3 py-2 text-center text-[11px] font-semibold leading-relaxed text-slate-700 opacity-0 shadow-[0_18px_45px_rgba(59,130,246,0.22)] ring-1 ring-white/70 backdrop-blur transition duration-150 group-hover/title:translate-y-0.5 group-hover/title:opacity-100 group-focus-visible/title:translate-y-0.5 group-focus-visible/title:opacity-100 dark:border-sky-300/20 dark:bg-slate-950/95 dark:text-sky-50 dark:shadow-[0_18px_45px_rgba(14,165,233,0.18)] dark:ring-white/10"
        >
          {description}
        </span>
      )}
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
