'use client';

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bell, CheckCheck, Trash2 } from 'lucide-react';
import { useApp, useNotifications } from './AppContext';
import { parseAppDate } from '@/lib/time';

export const NotificationBell: React.FC<{ className?: string; align?: 'left' | 'right' }> = ({ className, align = 'right' }) => {
  const { user } = useApp();
  const { notifications, unreadCount, fetchNotifications, openNotification, markAllNotificationsRead, hideReadNotification } = useNotifications();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [panelPosition, setPanelPosition] = useState({ top: 0, left: 0, width: 320 });

  if (!user) return null;

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) fetchNotifications();
  };

  useEffect(() => {
    if (!open) return;

    const updatePosition = () => {
      const button = buttonRef.current;
      if (!button) return;
      const rect = button.getBoundingClientRect();
      const padding = 12;
      const width = Math.min(320, window.innerWidth - padding * 2);
      const preferredLeft = align === 'left' ? rect.left : rect.right - width;
      const left = Math.min(Math.max(preferredLeft, padding), window.innerWidth - width - padding);
      setPanelPosition({
        top: rect.bottom + 8,
        left,
        width
      });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [align, open]);

  const formatTime = (iso?: string) => {
    if (!iso) return '';
    const d = parseAppDate(iso);
    if (!d) return '';
    const diff = Date.now() - d.getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return '방금';
    if (m < 60) return `${m}분 전`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}시간 전`;
    return `${Math.floor(h / 24)}일 전`;
  };

  const dropdown = open ? (
    <>
      {/* 바깥 클릭 닫기 */}
      <div className="fixed inset-0 z-[220]" onClick={() => setOpen(false)} />
      <div
        className="cute-surface fixed z-[230] overflow-hidden rounded-[1.75rem] animate-in fade-in slide-in-from-top-2 duration-150"
        style={{ top: panelPosition.top, left: panelPosition.left, width: panelPosition.width }}
      >
        <div className="flex items-center justify-between border-b border-border/60 bg-secondary/25 px-4 py-3">
          <h4 className="flex items-center gap-1.5 text-sm font-black">
            <span className="flex h-8 w-8 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Bell className="h-4 w-4" />
            </span>
            알림
          </h4>
          <button
            onClick={markAllNotificationsRead}
            className="cute-wiggle-hover flex items-center gap-1 rounded-full border border-border/70 bg-card/70 px-2.5 py-1 text-[11px] font-bold text-muted-foreground transition hover:bg-secondary hover:text-foreground"
          >
            <CheckCheck className="h-3.5 w-3.5" /> 전체 읽음
          </button>
        </div>
        <div className="max-h-80 overflow-y-auto">
          {notifications.length === 0 ? (
            <p className="px-4 py-10 text-center text-xs text-muted-foreground">받은 알림이 없습니다.</p>
          ) : (
            notifications.map((n) => (
              <div
                key={n.id}
                className={`group flex w-full items-start gap-2 border-b border-border/40 px-4 py-3 text-left transition hover:bg-secondary/45 ${n.is_read ? 'opacity-65' : 'bg-primary/6'}`}
              >
                <button
                  onClick={() => { openNotification(n); setOpen(false); }}
                  className="min-w-0 flex-1 text-left"
                >
                  <div className="flex w-full items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1.5 text-xs font-black text-foreground">
                      {!n.is_read && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary shadow-[0_0_10px_rgba(22,136,240,0.45)]" />}
                      <span className="truncate">{n.title}</span>
                    </span>
                    <span className="cute-number-font shrink-0 text-[10px] text-muted-foreground">{formatTime(n.created_at)}</span>
                  </div>
                  {n.body && <span className="mt-1 block break-keep text-[11px] font-semibold leading-snug text-muted-foreground">{n.body}</span>}
                </button>
                {n.is_read && (
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      hideReadNotification(n.id);
                    }}
                    className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border/60 bg-card/70 text-muted-foreground opacity-80 transition hover:border-rose-300 hover:bg-rose-50 hover:text-rose-500 dark:hover:bg-rose-500/10 sm:opacity-0 sm:group-hover:opacity-100"
                    title="읽은 알림 삭제"
                    aria-label="읽은 알림 삭제"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </>
  ) : null;

  return (
    <div className={`relative ${className || ''}`}>
      <button
        ref={buttonRef}
        onClick={toggle}
        className="cute-wiggle-hover relative rounded-full border border-border/70 bg-secondary/60 p-1.5 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
        title="알림"
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full border border-white bg-primary px-1 text-[9px] font-black text-primary-foreground shadow-sm dark:border-card">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {dropdown && typeof document !== 'undefined' ? createPortal(dropdown, document.body) : null}
    </div>
  );
};
