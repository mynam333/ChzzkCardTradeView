'use client';

import React from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Flag, LoaderCircle, X } from 'lucide-react';
import styles from './ArenaSurrenderDialog.module.css';

type ArenaSurrenderDialogProps = {
  open: boolean;
  mode: 'bot' | 'quick';
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

const focusableSelector = [
  'button:not(:disabled)',
  '[href]',
  'input:not(:disabled)',
  'select:not(:disabled)',
  'textarea:not(:disabled)',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

export const ArenaSurrenderDialog: React.FC<ArenaSurrenderDialogProps> = ({
  open,
  mode,
  busy = false,
  onCancel,
  onConfirm
}) => {
  const dialogRef = React.useRef<HTMLDivElement | null>(null);
  const cancelButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const busyRef = React.useRef(busy);
  const onCancelRef = React.useRef(onCancel);

  React.useLayoutEffect(() => {
    busyRef.current = busy;
    onCancelRef.current = onCancel;
  }, [busy, onCancel]);

  React.useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const focusTimer = window.setTimeout(() => cancelButtonRef.current?.focus(), 0);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busyRef.current) {
        event.preventDefault();
        onCancelRef.current();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;

      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(focusableSelector));
      if (!focusable.length) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [open]);

  if (!open || typeof document === 'undefined') return null;

  const isQuick = mode === 'quick';
  const description = isQuick
    ? '현재 경기는 패배로 기록되고 상대가 승리합니다. 빠른대전 점수도 정상적으로 반영됩니다.'
    : '진행 중인 연습전이 즉시 패배로 종료됩니다.';

  return createPortal((
    <div
      className={styles.backdrop}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="arena-surrender-title"
        aria-describedby="arena-surrender-description"
        aria-busy={busy}
        tabIndex={-1}
      >
        <button
          type="button"
          className={styles.closeButton}
          onClick={onCancel}
          disabled={busy}
          aria-label="항복 확인 닫기"
        >
          <X aria-hidden="true" />
        </button>

        <div className={styles.icon} aria-hidden="true">
          <Flag />
        </div>
        <span className={styles.eyebrow}>전투 종료</span>
        <h2 id="arena-surrender-title">정말 항복할까요?</h2>
        <p id="arena-surrender-description">{description}</p>

        <div className={styles.warning}>
          <AlertTriangle aria-hidden="true" />
          <span>항복이 확정되면 취소하거나 경기로 돌아갈 수 없습니다.</span>
        </div>

        <div className={styles.actions}>
          <button
            ref={cancelButtonRef}
            type="button"
            className={styles.cancelButton}
            onClick={onCancel}
            disabled={busy}
          >
            경기 계속하기
          </button>
          <button
            type="button"
            className={styles.confirmButton}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? <LoaderCircle className={styles.spinner} aria-hidden="true" /> : <Flag aria-hidden="true" />}
            {busy ? '항복 처리 중' : '항복 확정'}
          </button>
        </div>
      </div>
    </div>
  ), document.body);
};
