'use client';

import React, { useState, useEffect } from 'react';
import { useApp } from './AppContext';
import { Megaphone, RefreshCw, Flame, Award, ExternalLink, HelpCircle, ShieldAlert } from 'lucide-react';

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

  // 치지직 실시간 스트리머 상위 가치 3명 (메인 노출용)
  const [hotStreamers, setHotStreamers] = useState<any[]>([]);

  useEffect(() => {
    fetchNotices();
    fetchHotStreamers();
  }, []);

  const fetchNotices = async () => {
    try {
      const res = await fetch('http://localhost:5000/api/announcements');
      if (res.ok) {
        const data = await res.json();
        setNotices(data);
        
        // 팝업 공지 추출 (최신 활성 팝업 1개 노출)
        const popups = data.filter((n: Notice) => n.is_popup);
        if (popups.length > 0) {
          const latestPopupId = popups[0].id;
          const isDismissed = localStorage.getItem(`popup_dismissed_${latestPopupId}`);
          if (!isDismissed) {
            setActivePopup(popups[0]);
          }
        }
      }
    } catch (e) {
      console.warn('백엔드 공지사항 로드 불가 (오프라인 모드 fallback)');
      // offline mock notices
      const mockNotices = [
        { id: 1, title: 'CCTV 서비스 오픈 안내!', content: '치지직 카드 트레이드 뷰(CCTV) 플랫폼 서비스가 정상 가동을 시작했습니다. 100% 실시간 팔로워와 가치 환산 기능을 통해 컬렉션을 수집해 보세요.', is_popup: true, created_at: new Date().toISOString() },
        { id: 2, title: '쿠폰 시스템 가이드', content: '내 정보 탭 또는 어드민 패널에서 쿠폰 코드를 입력해 다양한 포인트를 지급받으실 수 있습니다.', is_popup: false, created_at: new Date().toISOString() }
      ];
      setNotices(mockNotices);
      setActivePopup(mockNotices[0]);
    } finally {
      setLoading(false);
    }
  };

  const fetchHotStreamers = async () => {
    try {
      const res = await fetch('http://localhost:5000/api/streamers');
      if (res.ok) {
        const data = await res.json();
        setHotStreamers(data.slice(0, 3));
      }
    } catch (e) {
      // offline fallback
      setHotStreamers([
        { channel_id: 'ch1', name: '스트리머A', logo_url: 'https://api.dicebear.com/7.x/pixel-art/svg?seed=A', base_value: 5400, follower_count: 145000 },
        { channel_id: 'ch2', name: '스트리머B', logo_url: 'https://api.dicebear.com/7.x/pixel-art/svg?seed=B', base_value: 3900, follower_count: 85200 },
        { channel_id: 'ch3', name: '스트리머C', logo_url: 'https://api.dicebear.com/7.x/pixel-art/svg?seed=C', base_value: 2100, follower_count: 42100 }
      ]);
    }
  };

  const dismissPopup = (forever = false) => {
    if (activePopup) {
      if (forever) {
        localStorage.setItem(`popup_dismissed_${activePopup.id}`, 'true');
      }
      setActivePopup(null);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      
      {/* 팝업 오버레이 모달 */}
      {activePopup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-center gap-2 text-primary">
              <Megaphone className="h-5 w-5" />
              <h3 className="font-bold text-foreground">긴급 공지사항</h3>
            </div>
            <h4 className="mt-3 text-lg font-bold text-foreground">{activePopup.title}</h4>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground whitespace-pre-wrap">
              {activePopup.content}
            </p>
            <div className="mt-6 flex items-center justify-between border-t border-border/60 pt-4">
              <button 
                onClick={() => dismissPopup(true)} 
                className="text-xs text-muted-foreground hover:underline"
              >
                다시 보지 않기
              </button>
              <button 
                onClick={() => dismissPopup(false)}
                className="rounded-lg bg-primary px-4 py-2 text-xs font-bold text-primary-foreground hover:bg-primary/90 shadow-md shadow-primary/10"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Hero Section */}
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-600 via-teal-700 to-blue-800 p-6 text-white shadow-xl md:p-10">
        <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10 blur-2xl"></div>
        <div className="absolute -bottom-10 -left-10 h-40 w-40 rounded-full bg-emerald-500/20 blur-2xl"></div>
        
        <div className="relative z-10 max-w-xl">
          <span className="inline-block rounded-full bg-white/20 px-3 py-1 text-xs font-bold uppercase tracking-wider backdrop-blur-md">
            Live Streamer Collection
          </span>
          <h2 className="mt-4 text-3xl font-black tracking-tight md:text-4xl leading-tight">
            치지직 최애 스트리머를<br />소장하고 가치로 경쟁하세요!
          </h2>
          <p className="mt-3 text-sm text-emerald-100/90 leading-relaxed">
            등급이 필요 없는 순수한 시세 중심의 신개념 트레이딩 뷰. 실시간 라이브 활동 데이터와 팔로워 수의 증가 추이에 맞춰 보유 카드의 시세가 동적으로 움직입니다.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <div className="flex items-center gap-1.5 rounded-full bg-black/30 px-4 py-1.5 text-xs font-semibold backdrop-blur-sm">
              <Flame className="h-3.5 w-3.5 text-orange-400 fill-orange-400" /> 가치 중심의 무등급 카드
            </div>
            <div className="flex items-center gap-1.5 rounded-full bg-black/30 px-4 py-1.5 text-xs font-semibold backdrop-blur-sm">
              <RefreshCw className="h-3.5 w-3.5 text-teal-300 animate-spin-slow" /> 치지직 API 실시간 연동
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
                  <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{notice.content}</p>
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
                    <img src={st.logo_url} alt={st.name} className="h-10 w-10 rounded-full border border-border bg-card" />
                    <span className="absolute -left-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-black text-primary-foreground shadow-sm">
                      {index + 1}
                    </span>
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

      {/* 가이드 & 정보 제공 */}
      <section className="rounded-2xl border border-border bg-secondary/40 p-6">
        <h3 className="text-sm font-bold flex items-center gap-2 text-foreground mb-3">
          <HelpCircle className="h-4 w-4 text-muted-foreground" /> 플랫폼 가이드라인
        </h3>
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 text-xs text-muted-foreground leading-relaxed">
          <div className="p-3 bg-card rounded-xl border border-border/50">
            <h4 className="font-bold text-foreground mb-1">1. 카드에는 등급이 존재하지 않습니다</h4>
            <p>모든 스트리머 카드는 등급 없이 오직 시세 가치(`base_value`)로만 가치가 매겨집니다. 가치가 높을수록 더욱 희소한 오라가 카드 테두리에 부여됩니다.</p>
          </div>
          <div className="p-3 bg-card rounded-xl border border-border/50">
            <h4 className="font-bold text-foreground mb-1">2. 실시간 데이터 갱신 및 가치 조정</h4>
            <p>스트리머의 치지직 API 데이터를 실시간으로 가져와 활동 점수와 시세를 재계산합니다. 팔로워 수의 증가량과 방송 활성화 지표가 핵심 시세 변동 요소입니다.</p>
          </div>
          <div className="p-3 bg-card rounded-xl border border-border/50">
            <h4 className="font-bold text-foreground mb-1">3. 스트리머 고유 업로드 지연 업로드</h4>
            <p>스트리머 권한을 획득하면 자기 카드의 고유 이미지를 리사이징된 고품질 WebP 파일로 업로드할 수 있습니다. 저장 전까지 blob 미리보기로 실시간 피드백을 제공합니다.</p>
          </div>
        </div>
      </section>

    </div>
  );
};
