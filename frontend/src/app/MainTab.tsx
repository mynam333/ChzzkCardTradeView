'use client';

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useApp } from './AppContext';
import { Megaphone, RefreshCw, Flame, Award, ExternalLink, HelpCircle, ShieldAlert, Plus, Pin, ChevronRight } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import type { Announcement } from '@/lib/types';
import { formatAnnouncementDate, getAnnouncementPreview } from '@/lib/announcement';
import { streamerProfileImage } from '@/lib/cosmetics';
import { StreamerRegisterModal } from './StreamerRegisterModal';
import { AnnouncementBoardModal } from './AnnouncementBoardModal';
import { DraggableAnnouncementPopups } from './DraggableAnnouncementPopups';

const POPUP_DISMISSED_FOREVER = 'forever';

export const MainTab: React.FC = () => {
  const { user, updatePoints } = useApp();
  const [notices, setNotices] = useState<Announcement[]>([]);
  const [activePopups, setActivePopups] = useState<Announcement[]>([]);
  const [announcementBoardOpen, setAnnouncementBoardOpen] = useState(false);
  const [selectedNotice, setSelectedNotice] = useState<Announcement | null>(null);
  const [loading, setLoading] = useState(true);
  const [mounted, setMounted] = useState(false);

  // 치지직 실시간 스트리머 상위 가치 3명 (메인 노출용)
  const [hotStreamers, setHotStreamers] = useState<any[]>([]);

  useEffect(() => {
    setMounted(true);
    fetchNotices();
    fetchHotStreamers();
    let refreshTimer: number | null = null;
    const scheduleHotStreamerRefresh = () => {
      if (document.visibilityState !== 'visible') return;
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => fetchHotStreamers(), 500);
    };
    window.addEventListener('chikapo:ranking-updated', scheduleHotStreamerRefresh);
    // 스트림이 끊긴 환경을 위한 느린 fallback입니다.
    const fallbackMs = typeof EventSource === 'undefined' ? 60_000 : 300_000;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') fetchHotStreamers();
    }, fallbackMs);
    return () => {
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      window.removeEventListener('chikapo:ranking-updated', scheduleHotStreamerRefresh);
      clearInterval(timer);
    };
  }, []);

  const fetchNotices = async () => {
    try {
      // 게시판 목록 (전체 공지)
      const res = await apiFetch('/announcements');
      if (res.ok) {
        const allNotices: Announcement[] = await res.json();
        setNotices(allNotices);
      }

      // 팝업은 만료(popup_expires_at)가 반영된 전용 엔드포인트에서 활성 팝업만 가져옴
      const popupRes = await apiFetch('/announcements/popups');
      if (popupRes.ok) {
        const popups: Announcement[] = await popupRes.json();
        const visiblePopups = popups.filter(
          (popup) => localStorage.getItem(`popup_dismissed_${popup.id}`) !== POPUP_DISMISSED_FOREVER
        );
        setActivePopups(visiblePopups);
      }
    } catch (e) {
      console.error('백엔드 공지사항 로드 에러:', e);
      setNotices([]);
    } finally {
      setLoading(false);
    }
  };

  const fetchHotStreamers = async () => {
    try {
      const res = await apiFetch('/streamers/ranking?mode=value&limit=3');
      if (res.ok) {
        const data = await res.json();
        setHotStreamers(data);
      }
    } catch (e) {
      console.error('핫 스트리머 목록 로드 에러:', e);
      setHotStreamers([]);
    }
  };

  const dismissPopup = (popupId: number, permanently = false) => {
    if (permanently) {
      localStorage.setItem(`popup_dismissed_${popupId}`, POPUP_DISMISSED_FOREVER);
    }
    setActivePopups((current) => current.filter((popup) => popup.id !== popupId));
  };

  const openAnnouncementBoard = () => {
    setActivePopups([]);
    setSelectedNotice(null);
    setAnnouncementBoardOpen(true);
  };

  const openAnnouncementDetail = (notice: Announcement) => {
    setActivePopups([]);
    setSelectedNotice(notice);
    setAnnouncementBoardOpen(true);
  };

  const closeAnnouncementBoard = () => {
    setAnnouncementBoardOpen(false);
    setSelectedNotice(null);
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-300">

      {mounted && announcementBoardOpen && createPortal(
        <AnnouncementBoardModal
          notices={notices}
          selectedNotice={selectedNotice}
          onSelectNotice={setSelectedNotice}
          onShowList={() => setSelectedNotice(null)}
          onClose={closeAnnouncementBoard}
        />,
        document.body
      )}

      {/* 배경을 막지 않는 다중 드래그형 공지 레이어 */}
      {mounted && activePopups.length > 0 && createPortal(
        <DraggableAnnouncementPopups
          popups={activePopups}
          onDismiss={dismissPopup}
          onOpenDetail={openAnnouncementDetail}
        />,
        document.body
      )}

      {/* Hero Section */}
      <section data-tour="main-landing" className="cute-gradient relative overflow-hidden rounded-[2.25rem] border border-white/70 p-6 text-white shadow-[0_24px_70px_rgba(45,157,240,0.24)] dark:border-white/10 dark:shadow-[0_24px_70px_rgba(0,0,0,0.32)] md:p-10">
        <div className="absolute -right-10 -top-10 h-44 w-44 rounded-full bg-white/28 blur-2xl"></div>
        <div className="absolute -bottom-14 -left-10 h-48 w-48 rounded-full bg-teal-300/30 blur-2xl"></div>
        <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-sky-950/24 via-sky-900/8 to-transparent"></div>
        <div className="cute-floaty absolute left-8 top-8 h-3 w-3 rounded-full bg-white/85 shadow-[0_0_22px_rgba(255,255,255,0.85)]"></div>
        <div className="cute-floaty absolute right-24 bottom-12 h-4 w-4 rotate-45 rounded-sm bg-white/70 shadow-[0_0_22px_rgba(255,255,255,0.65)]"></div>
        <div className="absolute right-8 top-8 hidden rotate-3 rounded-[1.25rem] border border-white/55 bg-white/30 px-4 py-2 text-[11px] font-black text-white shadow-lg shadow-sky-900/10 backdrop-blur-md md:block">
          CHIKAPO CARD FORUM
        </div>

        {/* 
          메인 레이아웃: PC에서는 가로 분할(justify-between, items-center),
          모바일에서는 세로 분할(flex-col, gap-6) 구조로 텍스트와 버튼이 겹치지 않고 온전한 영역을 확보함.
        */}
        <div className="relative z-10 flex flex-col gap-6 md:flex-row md:items-center md:justify-between">

          {/* 왼쪽 텍스트 블록 */}
          <div className="max-w-2xl">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/60 bg-sky-950/28 px-4 py-1.5 text-[11px] font-black uppercase tracking-[0.16em] text-white shadow-sm backdrop-blur-md dark:border-white/25 dark:bg-white/14">
              <span className="h-2 w-2 rounded-full bg-teal-200 shadow-[0_0_12px_rgba(153,246,228,0.85)]"></span>
              치지직 스트리머 카드 수집 게임
            </span>
            <h2 className="cute-landing-title mt-4 text-[2.15rem] leading-[1.08] sm:text-5xl md:text-[3.35rem]">
              최애 스트리머 카드를 뽑고<br />
              <span className="relative inline-block">
                최고의 수집가가 되어보세요!
                <span className="pointer-events-none absolute -bottom-2 left-1 h-2 w-[96%] rounded-full bg-teal-200/70 shadow-[0_0_18px_rgba(153,246,228,0.45)]"></span>
              </span>
            </h2>
            <p className="mt-4 max-w-xl rounded-[1.35rem] border border-white/55 bg-white/86 px-4 py-3 text-sm font-extrabold leading-relaxed text-[#0b3b66] shadow-[0_10px_24px_rgba(7,89,133,0.14)] backdrop-blur-md dark:border-white/18 dark:bg-sky-950/38 dark:text-white/90">
              치지직 로그인 하나로 바로 시작! 매일 무료 가챠를 돌리고, 희귀 카드를 모아 랭킹에 도전하세요.<br />
              스트리머의 인기가 오를수록 내 카드의 가치도 함께 올라갑니다.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <div className="cute-wiggle-hover flex items-center gap-1.5 rounded-full border border-white/55 bg-white/82 px-4 py-1.5 text-xs font-black text-[#0b4b7a] shadow-sm backdrop-blur-sm dark:border-white/20 dark:bg-white/14 dark:text-white">
                <Flame className="h-3.5 w-3.5 fill-primary text-primary dark:fill-white dark:text-white" /> 매일 무료 가챠
              </div>
              <div className="cute-wiggle-hover flex items-center gap-1.5 rounded-full border border-white/55 bg-white/82 px-4 py-1.5 text-xs font-black text-[#0b4b7a] shadow-sm backdrop-blur-sm dark:border-white/20 dark:bg-white/14 dark:text-white">
                <Award className="h-3.5 w-3.5 text-primary dark:text-white" /> 컬렉터 랭킹 경쟁
              </div>
              <div className="cute-wiggle-hover flex items-center gap-1.5 rounded-full border border-white/55 bg-white/82 px-4 py-1.5 text-xs font-black text-[#0b4b7a] shadow-sm backdrop-blur-sm dark:border-white/20 dark:bg-white/14 dark:text-white">
                <RefreshCw className="h-3.5 w-3.5 animate-spin-slow text-primary dark:text-white" /> 인기 반영 시세
              </div>
            </div>
          </div>

          {/* 
            오른쪽 스트리머 추가 버튼 블록
            - 가로 크기를 약 1.2배 키우고 세로 영역의 볼륨감(총 높이)을 늘려 웅장하고 예쁘게 개선.
            - 모바일(md 이하)에서는 w-full로 채우고 그라디언트 박스의 가장 아랫부분에 화면 너비에 맞춰 납작하고 조화롭게 고정됨.
          */}
          {user && (
            <div className="flex w-full shrink-0 justify-center pt-2 md:w-auto md:pt-0">
              <StreamerRegisterModal
                onRegistered={fetchHotStreamers}
                className="cute-wiggle-hover group inline-flex w-full items-center justify-center gap-3 rounded-[1.75rem] border border-white/70 bg-sky-950/22 px-5 py-4 text-sm font-black text-white shadow-xl shadow-sky-900/10 ring-1 ring-inset ring-white/18 backdrop-blur-md transition-all hover:-translate-y-0.5 hover:border-white hover:bg-sky-950/30 active:scale-95 dark:border-white/45 dark:bg-white/18 dark:ring-white/20 dark:hover:border-white/65 dark:hover:bg-white/28 md:w-auto md:px-7 md:py-6 md:text-base"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-2xl bg-white/24 text-white transition group-hover:rotate-90 group-hover:bg-white/34 md:h-8 md:w-8">
                  <Plus className="h-4.5 w-4.5 md:h-5 md:w-5" />
                </span>
                <span>스트리머 추가</span>
              </StreamerRegisterModal>
            </div>
          )}

        </div>
      </section>

      {/* Grid Layout: 실시간 핫 스트리머 & 공지사항 게시판 */}
      <div className="grid gap-6 md:grid-cols-3">

        {/* 공지사항 롤링 보드 */}
        <div data-tour="main-news" className="cute-surface md:col-span-2 rounded-[2rem] p-6">
          <div className="flex items-center justify-between border-b border-border/60 pb-3">
            <button
              type="button"
              onClick={openAnnouncementBoard}
              className="cute-wiggle-hover group flex items-center gap-2 text-left"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Megaphone className="h-4.5 w-4.5" />
              </span>
              <span className="text-base font-black transition group-hover:text-primary">플랫폼 새소식</span>
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-primary" />
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={openAnnouncementBoard}
                className="rounded-lg px-2 py-1 text-[10px] font-bold text-primary transition hover:bg-primary/10"
              >
                전체보기
              </button>
              <button onClick={fetchNotices} className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-secondary hover:text-foreground" aria-label="공지 새로고침">
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <div className="mt-4 space-y-2.5">
            {loading ? (
              <p className="text-center py-8 text-xs text-muted-foreground">소식을 가져오는 중입니다...</p>
            ) : notices.length === 0 ? (
              <p className="text-center py-8 text-xs text-muted-foreground">현재 등록된 공지사항이 없습니다.</p>
            ) : (
              notices.slice(0, 3).map((notice) => (
                <button
                  key={notice.id}
                  type="button"
                  onClick={() => openAnnouncementDetail(notice)}
                  className={`cute-card-pop group block w-full rounded-2xl border p-3.5 text-left ${notice.is_pinned ? 'border-primary/25 bg-primary/10 shadow-sm shadow-primary/5' : 'border-transparent bg-secondary/35 hover:border-border hover:bg-secondary/60'}`}
                >
                  <div className="flex items-center justify-between">
                    <h4 className="flex min-w-0 items-center gap-1.5 text-sm font-bold transition group-hover:text-primary">
                      {notice.is_pinned && <Pin className="h-3.5 w-3.5 shrink-0 fill-current text-sky-500" />}
                      <span className="truncate">{notice.title}</span>
                    </h4>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {notice.is_pinned && (
                        <span className="rounded bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-bold text-sky-600 dark:text-sky-400">고정</span>
                      )}
                      {notice.is_popup && (
                        <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary">팝업</span>
                      )}
                    </div>
                  </div>
                  <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                    {getAnnouncementPreview(notice.content, 110)}
                  </p>
                  <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground/80">
                    <span>{formatAnnouncementDate(notice.created_at)}</span>
                    <span className="inline-flex items-center gap-0.5 font-bold text-primary opacity-0 transition group-hover:opacity-100">
                      자세히 보기 <ChevronRight className="h-3 w-3" />
                    </span>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* 핫 스트리머 카드 리스트 (시세 리딩) */}
        <div className="cute-surface flex flex-col rounded-[2rem] p-6">
          <h3 className="text-base font-bold flex items-center gap-2 border-b border-border/60 pb-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Flame className="h-4.5 w-4.5 fill-current" />
            </span>
            실시간 최고 가치 Top 3
          </h3>

          <div className="mt-4 space-y-3.5 flex-1">
            {hotStreamers.map((st, index) => (
              <div key={st.channel_id} className="cute-card-pop flex items-center justify-between rounded-2xl border border-border/50 bg-secondary/35 p-3 hover:border-primary/35 hover:bg-secondary/55">
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <img src={streamerProfileImage(st)} alt={st.name} className="h-10 w-10 rounded-full border border-border bg-card object-cover" />
                    <span className="absolute -left-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-black text-primary-foreground shadow-sm">
                      {index + 1}
                    </span>
                    {st.is_active && (
                      <span className="absolute -bottom-0.5 -right-0.5 flex items-center justify-center rounded-full bg-red-600 px-1 py-0.5 text-[7px] font-black text-white ring-2 ring-card leading-none">LIVE</span>
                    )}
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-foreground">{st.name}</h4>
                    <p className="text-[10px] text-muted-foreground">{(st.follower_count || 0).toLocaleString()} 팔로워</p>
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-xs font-black text-primary">{(st.base_value || 0).toLocaleString()} P</span>
                  <p className="text-[9px] text-muted-foreground">시세 기준</p>
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>

      {/* 이용 방법 안내 */}
      <section className="cute-surface rounded-[2rem] p-6">
        <h3 className="text-sm font-bold flex items-center gap-2 text-foreground mb-4">
          <HelpCircle className="h-4 w-4 text-muted-foreground" /> 이렇게 즐기세요!
        </h3>
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 text-xs text-muted-foreground leading-relaxed">
          <div className="cute-card-pop rounded-2xl border border-border/50 bg-card p-4 hover:border-primary/40">
            <div className="flex items-center gap-2 mb-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-primary font-black text-[11px]">1</span>
              <h4 className="font-bold text-foreground">치지직 계정으로 바로 로그인</h4>
            </div>
            <p>별도 회원가입 없이 치지직 계정 하나로 즉시 시작할 수 있어요. 로그인하면 매일 무료 뽑기가 지급됩니다.</p>
          </div>
          <div className="cute-card-pop rounded-2xl border border-border/50 bg-card p-4 hover:border-primary/40">
            <div className="flex items-center gap-2 mb-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-primary font-black text-[11px]">2</span>
              <h4 className="font-bold text-foreground">가챠로 스트리머 카드 수집</h4>
            </div>
            <p>상점에서 포인트를 사용해 가챠를 돌리고 다양한 스트리머 카드를 뽑아보세요. 어떤 카드가 나올지 두근두근한 순간을 매일 즐길 수 있어요!</p>
          </div>
          <div className="cute-card-pop rounded-2xl border border-border/50 bg-card p-4 hover:border-primary/40">
            <div className="flex items-center gap-2 mb-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-primary font-black text-[11px]">3</span>
              <h4 className="font-bold text-foreground">시세로 랭킹 정상 노려보기</h4>
            </div>
            <p>보유 카드 총 가치로 치지직의 컬렉터들과 실력을 겨뤄보세요. 최애 스트리머가 인기를 얻을수록 내 카드 가치도 함께 올라가 랭킹이 수직 상승!</p>
          </div>
        </div>
      </section>

    </div>
  );
};
