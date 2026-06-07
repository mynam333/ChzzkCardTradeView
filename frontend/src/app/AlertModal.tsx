'use client';

import React from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, XCircle, AlertTriangle, Info } from 'lucide-react';

export type AlertType = 'success' | 'error' | 'warning' | 'info';

interface Props {
  open: boolean;
  title?: string;
  message: string;
  type?: AlertType;
  onClose: () => void;
}

const TYPE_META: Record<AlertType, {
  Icon: React.ComponentType<{ className?: string }>;
  color: string;
  bg: string;
  ring: string;
}> = {
  success: {
    Icon: CheckCircle2,
    color: 'text-teal-600 dark:text-teal-200',
    bg: 'bg-teal-50 dark:bg-teal-400/10',
    ring: 'border-teal-200 dark:border-teal-400/20',
  },
  error: {
    Icon: XCircle,
    color: 'text-rose-600 dark:text-rose-200',
    bg: 'bg-rose-50 dark:bg-rose-400/10',
    ring: 'border-rose-200 dark:border-rose-400/20',
  },
  warning: {
    Icon: AlertTriangle,
    color: 'text-sky-700 dark:text-sky-200',
    bg: 'bg-sky-50 dark:bg-sky-400/10',
    ring: 'border-sky-200 dark:border-sky-400/20',
  },
  info: {
    Icon: Info,
    color: 'text-primary',
    bg: 'bg-primary/10',
    ring: 'border-primary/20',
  },
};

/**
 * 공용 모달형 알림 다이얼로그 (성공/실패/경고/안내).
 * 토스트와 달리 화면 중앙에 떠서 확인 버튼으로 닫습니다.
 */
export const AlertModal: React.FC<Props> = ({ open, title, message, type = 'info', onClose }) => {
  if (!open) return null;
  const { Icon, color, bg, ring } = TYPE_META[type];

  const modal = (
    <div className="modal-backdrop modal-backdrop-center z-[90] bg-sky-950/35 backdrop-blur-sm dark:bg-black/60" onClick={onClose}>
      <div
        className="modal-panel modal-panel-xs modal-panel-scroll cute-surface overflow-hidden rounded-[2rem] p-6 text-center animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full bg-primary/12 blur-2xl" />
        <div className={`relative mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border shadow-sm ${bg} ${ring}`}>
          <Icon className={`h-6 w-6 ${color}`} />
        </div>
        {title && <h4 className="relative text-base font-black text-foreground">{title}</h4>}
        <p className="relative mt-2 whitespace-pre-line break-keep text-sm font-bold leading-relaxed text-muted-foreground">{message}</p>
        <button
          onClick={onClose}
          className="cute-wiggle-hover relative mt-5 w-full rounded-2xl bg-primary px-4 py-3 text-xs font-black text-primary-foreground transition active:scale-95"
        >
          확인
        </button>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(modal, document.body);
};
