'use client';

import React, { useEffect } from 'react';
import { ArrowLeft, CalendarDays, ChevronRight, List, Megaphone, Pin, X } from 'lucide-react';
import type { Announcement } from '@/lib/types';
import { formatAnnouncementDate, getAnnouncementPreview } from '@/lib/announcement';
import { MarkdownRenderer } from './MarkdownRenderer';

interface AnnouncementBoardModalProps {
  notices: Announcement[];
  selectedNotice: Announcement | null;
  onSelectNotice: (notice: Announcement) => void;
  onShowList: () => void;
  onClose: () => void;
}

export const AnnouncementBoardModal: React.FC<AnnouncementBoardModalProps> = ({
  notices,
  selectedNotice,
  onSelectNotice,
  onShowList,
  onClose,
}) => {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="modal-backdrop modal-backdrop-center z-[90] bg-black/55 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={onClose}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="announcement-board-title"
        className="modal-panel modal-panel-xl flex min-h-0 flex-col overflow-hidden rounded-3xl border border-border bg-card shadow-2xl animate-in zoom-in-95 duration-200"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex shrink-0 items-center justify-between border-b border-border/70 bg-gradient-to-r from-primary/12 via-sky-500/8 to-transparent px-5 py-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            {selectedNotice ? (
              <button
                type="button"
                onClick={onShowList}
                className="rounded-xl border border-border bg-card/80 p-2 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
                aria-label="공지 목록으로 돌아가기"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
            ) : (
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/15 text-primary">
                <Megaphone className="h-4.5 w-4.5" />
              </span>
            )}
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">
                {selectedNotice ? 'Announcement' : 'Notice Board'}
              </p>
              <h2 id="announcement-board-title" className="truncate text-base font-black text-foreground sm:text-lg">
                {selectedNotice ? selectedNotice.title : '플랫폼 새소식'}
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-2 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
            aria-label="공지 게시판 닫기"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        {selectedNotice ? (
          <article className="announcement-detail min-h-0 flex-1 overflow-y-auto px-5 py-5 overscroll-contain sm:px-8 sm:py-7">
            <div className="mb-6 border-b border-border/70 pb-5">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                {selectedNotice.is_pinned && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/10 px-2.5 py-1 text-[10px] font-bold text-sky-600 dark:text-sky-400">
                    <Pin className="h-3 w-3 fill-current" /> 고정 공지
                  </span>
                )}
                {selectedNotice.is_popup && (
                  <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-bold text-primary">팝업 공지</span>
                )}
              </div>
              <h3 className="text-2xl font-black leading-tight tracking-tight text-foreground sm:text-3xl">
                {selectedNotice.title}
              </h3>
              <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
                <CalendarDays className="h-3.5 w-3.5" />
                {formatAnnouncementDate(selectedNotice.created_at)}
              </p>
            </div>
            <MarkdownRenderer content={selectedNotice.content} />
          </article>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto p-4 overscroll-contain sm:p-6">
            <div className="mb-4 flex items-center justify-between px-1">
              <p className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground">
                <List className="h-3.5 w-3.5" /> 전체 공지 {notices.length}건
              </p>
              <span className="text-[10px] text-muted-foreground">고정 공지가 먼저 표시됩니다.</span>
            </div>

            {notices.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border py-16 text-center">
                <Megaphone className="mx-auto h-8 w-8 text-muted-foreground/50" />
                <p className="mt-3 text-sm text-muted-foreground">등록된 공지가 없습니다.</p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {notices.map((notice) => (
                  <button
                    key={notice.id}
                    type="button"
                    onClick={() => onSelectNotice(notice)}
                    className={`group flex w-full items-center gap-3 rounded-2xl border p-4 text-left transition hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md ${notice.is_pinned ? 'border-sky-500/25 bg-sky-500/8' : 'border-border/70 bg-secondary/20'}`}
                  >
                    <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${notice.is_pinned ? 'bg-sky-500/15 text-sky-600 dark:text-sky-400' : 'bg-primary/10 text-primary'}`}>
                      {notice.is_pinned ? <Pin className="h-4 w-4 fill-current" /> : <Megaphone className="h-4 w-4" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-sm font-bold text-foreground transition group-hover:text-primary">{notice.title}</span>
                        {notice.is_pinned && <span className="shrink-0 text-[9px] font-bold text-sky-600 dark:text-sky-400">고정</span>}
                      </span>
                      <span className="mt-1 block truncate text-xs text-muted-foreground">
                        {getAnnouncementPreview(notice.content, 100)}
                      </span>
                      <span className="mt-1.5 block text-[10px] text-muted-foreground/80">
                        {formatAnnouncementDate(notice.created_at)}
                      </span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-primary" />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
};
