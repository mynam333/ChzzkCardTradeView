'use client';

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useApp } from './AppContext';
import { Megaphone, RefreshCw, Flame, Award, ExternalLink, HelpCircle, ShieldAlert } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { MarkdownRenderer } from './MarkdownRenderer';

interface Notice {
  id: number;
  title: string;
  content: string;
  is_popup: boolean;
  created_at?: string;
}

export const MainTab: React.FC = () => {
  const { user, updatePoints } = useApp();
  const [notices, setNotices] = useState<Notice[]>([]);
  const [activePopup, setActivePopup] = useState<Notice | null>(null);
  const [loading, setLoading] = useState(true);
  const [mounted, setMounted] = useState(false);

  // 치지직 실시간 스트리머 상위 가치 3명 (메인 노출용)
  const [hotStreamers, setHotStreamers] = useState<any[]>([]);

  useEffect(() => {
    setMounted(true);
    fetchNotices();
    fetchHotStreamers();
    // 급상승/시세 요약을 준실시간으로 반영 (25초 주기)
    const timer = setInterval(() => fetchHotStreamers(), 25_000);
    return () => clearInterval(timer);
  }, []);

  const fetchNotices = async () => {
    try {
      // 게시판 목록 (전체 공지)
      const res = await apiFetch('/announcements');
      if (res.ok) setNotices(await res.json());

      // 팝업은 만료(popup_expires_at)가 반영된 전용 엔드포인트에서 활성 팝업만 가져옴
      const popupRes = await apiFetch('/announcements/popups');
      if (popupRes.ok) {
        const popups = await popupRes.json();
        if (popups.length > 0) {
          const latestPopupId = popups[0].id;
          const dismissedDate = localStorage.getItem(`popup_dismissed_${latestPopupId}`);
          // '오늘 하루 보지 않기'는 당일에만 유효 (저장된 날짜가 오늘과 다르면 다시 노출)
          if (dismissedDate !== getTodayKey()) {
            setActivePopup(popups[0]);
          }
        }
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
      const res = await apiFetch('/streamers');
      if (res.ok) {
        const data = await res.json();
        setHotStreamers(data.slice(0, 3));
      }
    } catch (e) {
      console.error('핫 스트리머 목록 로드 에러:', e);
      setHotStreamers([]);
    }
  };

  // 오늘 날짜 키 (KST 기준 YYYY-MM-DD)
  const getTodayKey = () =>
    new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().split('T')[0];

  const dismissPopup = (today = false) => {
    if (activePopup) {
      if (today) {
        // 오늘 하루 보지 않기: 오늘 날짜를 저장 (다음 날에는 다시 노출)
        localStorage.setItem(`popup_dismissed_${activePopup.id}`, getTodayKey());
      }
      setActivePopup(null);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-300">

      {/* 팝업 오버레이 모달 (Portal 적용으로 transform 영역 제약 및 배경 흐림 잘림 방지) */}
      {mounted && activePopup && createPortal(
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-center gap-2 text-primary">
              <Megaphone className="h-5 w-5" />
              <h3 className="font-bold text-foreground">공지사항</h3>
            </div>
            <h4 className="mt-3 text-lg font-bold text-foreground">{activePopup.title}</h4>
            <div className="mt-2 text-sm leading-relaxed text-muted-foreground">
              <MarkdownRenderer content={activePopup.content} />
            </div>
            <div className="mt-6 flex items-center justify-between border-t border-border/60 pt-4">
              <button
                onClick={() => dismissPopup(true)}
                className="text-xs text-muted-foreground hover:underline"
              >
                오늘 하루 보지 않기
              </button>
              <button
                onClick={() => dismissPopup(false)}
                className="rounded-lg bg-primary px-4 py-2 text-xs font-bold text-primary-foreground hover:bg-primary/90 shadow-md shadow-primary/10"
              >
                닫기
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Hero Section */}
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-sky-500 via-blue-500 to-indigo-500 dark:from-blue-600 dark:via-sky-700 dark:to-indigo-900 p-6 text-white shadow-lg dark:shadow-xl md:p-10">
        <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10 blur-2xl"></div>
        <div className="absolute -bottom-10 -left-10 h-40 w-40 rounded-full bg-sky-400/20 blur-2xl"></div>

        <div className="relative z-10 max-w-xl">
          <span className="inline-block rounded-full bg-white/20 px-3 py-1 text-xs font-bold uppercase tracking-wider backdrop-blur-md">
            치지직 스트리머 카드 수집 게임
          </span>
          <h2 className="mt-4 text-3xl font-black tracking-tight md:text-4xl leading-tight">
            최애 스트리머 카드를 뽑고<br />최고의 수집가가 되어보세요!
          </h2>
          <p className="mt-3 text-sm text-sky-100/90 leading-relaxed">
            치지직 로그인 하나로 바로 시작!<br />매일 무료 가챠를 돌리고, 희귀 카드를 모아 랭킹에 도전하세요.<br />스트리머의 인기가 오를수록 내 카드의 가치도 함께 올라갑니다.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <div className="flex items-center gap-1.5 rounded-full bg-black/30 px-4 py-1.5 text-xs font-semibold backdrop-blur-sm">
              <Flame className="h-3.5 w-3.5 text-orange-400 fill-orange-400" /> 매일 무료 가챠 제공
            </div>
            <div className="flex items-center gap-1.5 rounded-full bg-black/30 px-4 py-1.5 text-xs font-semibold backdrop-blur-sm">
              <Award className="h-3.5 w-3.5 text-yellow-300" /> 컬렉터 랭킹 경쟁
            </div>
            <div className="flex items-center gap-1.5 rounded-full bg-black/30 px-4 py-1.5 text-xs font-semibold backdrop-blur-sm">
              <RefreshCw className="h-3.5 w-3.5 text-teal-300 animate-spin-slow" /> 스트리머 인기 반영 시세
            </div>
          </div>
        </div>
      </section>

      {/* Grid Layout: 실시간 핫 스트리머 & 공지사항 게시판 */}
      <div className="grid gap-6 md:grid-cols-3">

        {/* 공지사항 롤링 보드 */}
        <div className="md:col-span-2 rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="flex items-center justify-between border-b border-border/60 pb-3">
            <h3 className="text-base font-bold flex items-center gap-2">
              <Megaphone className="h-4.5 w-4.5 text-primary" /> 플랫폼 새소식
            </h3>
            <button onClick={fetchNotices} className="text-muted-foreground hover:text-foreground">
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="mt-4 space-y-4 max-h-[280px] overflow-y-auto pr-1">
            {loading ? (
              <p className="text-center py-8 text-xs text-muted-foreground">소식을 가져오는 중입니다...</p>
            ) : notices.length === 0 ? (
              <p className="text-center py-8 text-xs text-muted-foreground">현재 등록된 공지사항이 없습니다.</p>
            ) : (
              notices.map((notice) => (
                <div key={notice.id} className="group rounded-xl bg-secondary/30 p-4 border border-transparent hover:border-border hover:bg-secondary/50 transition">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-bold group-hover:text-primary transition">{notice.title}</h4>
                    {notice.is_popup && (
                      <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary">팝업</span>
                    )}
                  </div>
                  <div className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                    <MarkdownRenderer content={notice.content} />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* 핫 스트리머 카드 리스트 (시세 리딩) */}
        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm flex flex-col">
          <h3 className="text-base font-bold flex items-center gap-2 border-b border-border/60 pb-3">
            <Flame className="h-4.5 w-4.5 text-orange-500 fill-orange-500" /> 실시간 최고 가치 Top 3
          </h3>

          <div className="mt-4 space-y-3.5 flex-1">
            {hotStreamers.map((st, index) => (
              <div key={st.channel_id} className="flex items-center justify-between rounded-xl bg-secondary/20 p-3 border border-border/40 hover:border-border/80 transition">
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <img src={st.custom_image_url || st.logo_url} alt={st.name} className="h-10 w-10 rounded-full border border-border bg-card object-cover" />
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
      <section className="rounded-2xl border border-border bg-secondary/40 p-6">
        <h3 className="text-sm font-bold flex items-center gap-2 text-foreground mb-4">
          <HelpCircle className="h-4 w-4 text-muted-foreground" /> 이렇게 즐기세요!
        </h3>
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 text-xs text-muted-foreground leading-relaxed">
          <div className="p-4 bg-card rounded-xl border border-border/50 hover:border-primary/40 transition">
            <div className="flex items-center gap-2 mb-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-primary font-black text-[11px]">1</span>
              <h4 className="font-bold text-foreground">치지직 계정으로 바로 로그인</h4>
            </div>
            <p>별도 회원가입 없이 치지직 계정 하나로 즉시 시작할 수 있어요. 로그인하면 매일 무료 뽑기가 지급됩니다.</p>
          </div>
          <div className="p-4 bg-card rounded-xl border border-border/50 hover:border-primary/40 transition">
            <div className="flex items-center gap-2 mb-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-primary font-black text-[11px]">2</span>
              <h4 className="font-bold text-foreground">가챠로 스트리머 카드 수집</h4>
            </div>
            <p>상점에서 포인트를 사용해 가챠를 돌리고 다양한 스트리머 카드를 뽑아보세요. 어떤 카드가 나올지 두근두근한 순간을 매일 즐길 수 있어요!</p>
          </div>
          <div className="p-4 bg-card rounded-xl border border-border/50 hover:border-primary/40 transition">
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
