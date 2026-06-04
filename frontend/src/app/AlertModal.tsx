'use client';

import React from 'react';
import { CheckCircle2, XCircle, AlertTriangle, Info } from 'lucide-react';

export type AlertType = 'success' | 'error' | 'warning' | 'info';

interface Props {
  open: boolean;
  title?: string;
  message: string;
  type?: AlertType;
  onClose: () => void;
}

const TYPE_META: Record<AlertType, { Icon: React.ComponentType<{ className?: string }>; color: string; bg: string }> = {
  success: { Icon: CheckCircle2, color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
  error: { Icon: XCircle, color: 'text-red-500', bg: 'bg-red-500/10' },
  warning: { Icon: AlertTriangle, color: 'text-amber-500', bg: 'bg-amber-500/10' },
  info: { Icon: Info, color: 'text-primary', bg: 'bg-primary/10' },
};

/**
 * 공용 모달형 알림 다이얼로그 (성공/실패/경고/안내).
 * 토스트와 달리 화면 중앙에 떠서 확인 버튼으로 닫습니다.
 */
export const AlertModal: React.FC<Props> = ({ open, title, message, type = 'info', onClose }) => {
  if (!open) return null;
  const { Icon, color, bg } = TYPE_META[type];

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-xs rounded-2xl border border-border bg-card p-6 text-center shadow-2xl animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full ${bg}`}>
          <Icon className={`h-6 w-6 ${color}`} />
        </div>
        {title && <h4 className="text-sm font-bold text-foreground">{title}</h4>}
        <p className="mt-1.5 whitespace-pre-line text-xs leading-relaxed text-muted-foreground">{message}</p>
        <button
          onClick={onClose}
          className="mt-5 w-full rounded-lg bg-primary px-4 py-2.5 text-xs font-bold text-primary-foreground transition hover:bg-primary/90"
        >
          확인
        </button>
      </div>
    </div>
  );
};
