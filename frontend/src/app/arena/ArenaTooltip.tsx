'use client';

import React from 'react';
import { CircleHelp, Sparkles } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { ArenaTooltipData } from '@/lib/arenaTooltips';
import styles from './ArenaTooltip.module.css';

type ArenaTooltipProps = {
  data: ArenaTooltipData;
  children: React.ReactElement;
  side?: 'top' | 'right' | 'bottom' | 'left' | 'inline-start' | 'inline-end';
  align?: 'start' | 'center' | 'end';
  disabled?: boolean;
  focusable?: boolean;
};

export const ArenaTooltip: React.FC<ArenaTooltipProps> = ({
  data,
  children,
  side = 'top',
  align = 'center',
  disabled = false,
  focusable = false
}) => {
  const [open, setOpen] = React.useState(false);
  const tooltipId = React.useId();
  const childProps = children.props as React.HTMLAttributes<HTMLElement>;
  const describedBy = [childProps['aria-describedby'], open ? tooltipId : ''].filter(Boolean).join(' ') || undefined;
  const trigger = React.cloneElement(children as React.ReactElement<React.HTMLAttributes<HTMLElement>>, {
    ...(focusable && typeof children.type === 'string' ? { tabIndex: childProps.tabIndex ?? 0 } : {})
  });

  return (
    <Tooltip disabled={disabled} open={open} onOpenChange={setOpen}>
      <TooltipTrigger render={trigger} delay={180} closeDelay={80} aria-describedby={describedBy} />
      <TooltipContent
        id={tooltipId}
        role="tooltip"
        side={side}
        align={align}
        sideOffset={10}
        className={`${styles.content} ${styles[data.tone || 'neutral']}`}
      >
        <div className={styles.accent} />
        <header className={styles.header}>
          <span className={styles.icon}><CircleHelp aria-hidden="true" /></span>
          <div>
            <span className={styles.eyebrow}>{data.eyebrow}</span>
            <strong>{data.title}</strong>
          </div>
        </header>
        <p className={styles.description}>{data.description}</p>
        {data.details?.length ? (
          <dl className={styles.details}>
            {data.details.map((detail) => (
              <div key={`${detail.label}-${detail.value}`}>
                <dt>{detail.label}</dt>
                <dd>{detail.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        {data.note ? (
          <div className={styles.note}>
            <Sparkles aria-hidden="true" />
            <span>{data.note}</span>
          </div>
        ) : null}
      </TooltipContent>
    </Tooltip>
  );
};
