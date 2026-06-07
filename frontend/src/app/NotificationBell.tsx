'use client';

import React, { useState } from 'react';
import { Bell, CheckCheck } from 'lucide-react';
import { useApp, useNotifications } from './AppContext';

export const NotificationBell: React.FC<{ className?: string; align?: 'left' | 'right' }> = ({ className, align = 'right' }) => {
  const { user } = useApp();
  const { notifications, unreadCount, fetchNotifications, openNotification, markAllNotificationsRead } = useNotifications();
  const [open, setOpen] = useState(false);

  if (!user) return null;

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) fetchNotifications();
  };

  const formatTime = (iso?: string) => {
    if (!iso) return '';
    const d = new Date(iso.includes('T') || iso.includes('Z') ? iso : iso.replace(' ', 'T') + 'Z');
    const diff = Date.now() - d.getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return '방금';
    if (m < 60) return `${m}분 전`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}시간 전`;
    return `${Math.floor(h / 24)}일 전`;
  };

  return (
    <div className={`relative ${className || ''}`}>
      <button
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

      {open && (
        <>
          {/* 바깥 클릭 닫기 */}
          <div className="fixed inset-0 z-[90]" onClick={() => setOpen(false)} />
          <div className={`cute-surface absolute ${align === 'left' ? 'left-0' : 'right-0'} z-[95] mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-[1.75rem] animate-in fade-in slide-in-from-top-2 duration-150`}>
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
                  <button
                    key={n.id}
                    onClick={() => { openNotification(n); setOpen(false); }}
                    className={`flex w-full flex-col items-start gap-1 border-b border-border/40 px-4 py-3 text-left transition hover:bg-secondary/45 ${n.is_read ? 'opacity-65' : 'bg-primary/6'}`}
                  >
                    <div className="flex w-full items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 text-xs font-black text-foreground">
                        {!n.is_read && <span className="h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_10px_rgba(22,136,240,0.45)]" />}
                        {n.title}
                      </span>
                      <span className="cute-number-font shrink-0 text-[10px] text-muted-foreground">{formatTime(n.created_at)}</span>
                    </div>
                    {n.body && <span className="break-keep text-[11px] font-semibold leading-snug text-muted-foreground">{n.body}</span>}
                  </button>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
