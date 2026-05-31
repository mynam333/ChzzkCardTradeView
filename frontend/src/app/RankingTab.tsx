'use client';

import React, { useState, useEffect } from 'react';
import { useApp } from './AppContext';
import { 
  TrendingUp, 
  Coins, 
  Search, 
  Award, 
  Users, 
  ChevronRight, 
  ArrowUpRight,
  RefreshCw,
  Flame
} from 'lucide-react';
import { API_BASE_URL } from '@/lib/api';

interface Streamer {
  channel_id: string;
  name: string;
  logo_url: string;
  custom_image_url: string | null;
  base_value: number;
  follower_count: number;
  prev_value?: number;
}

interface UserRank {
  id: string;
  username: string;
  avatar_url: string;
  point: number;
  card_count: number;
}

export const RankingTab: React.FC = () => {
  const { user } = useApp();
  const [subTab, setSubTab] = useState<'streamer' | 'user'>('streamer');
  
  const [streamers, setStreamers] = useState<Streamer[]>([]);
  const [userRankings, setUserRankings] = useState<UserRank[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    fetchRankings();
  }, [subTab]);

  const fetchRankings = async () => {
    setLoading(true);
    try {
      if (subTab === 'streamer') {
        const res = await fetch(`${API_BASE_URL}/streamers`);
        if (res.ok) {
          const data = await res.json();
          setStreamers(data);
        }
      } else {
        const res = await fetch(`${API_BASE_URL}/users/ranking`);
        if (res.ok) {
          const data = await res.json();
          setUserRankings(data);
        }
      }
    } catch (e) {
      console.error('랭킹 데이터 획득 실패:', e);
      if (subTab === 'streamer') {
        setStreamers([]);
      } else {
        setUserRankings([]);
      }
    } finally {
      setLoading(false);
    }
  };

  const getCardBadge = (val: number) => {
    if (val >= 8000) return <span className="rounded bg-gradient-to-r from-amber-500 to-orange-500 px-1.5 py-0.5 text-[8.5px] font-black text-white">LEGEND</span>;
    if (val >= 5000) return <span className="rounded bg-gradient-to-r from-fuchsia-500 to-purple-500 px-1.5 py-0.5 text-[8.5px] font-black text-white">EPIC</span>;
    return <span className="rounded bg-blue-500 px-1.5 py-0.5 text-[8.5px] font-black text-white">RARE</span>;
  };

  // 스트리머 검색 필터
  const filteredStreamers = streamers.filter(s => 
    s.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      
      {/* 랭킹 탭 대제목 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-black flex items-center gap-2">
            <TrendingUp className="h-5.5 w-5.5 text-primary" /> 실시간 랭킹 시스템
          </h2>
          <p className="text-xs text-muted-foreground">치지직 시세 순위 및 유저 자산 랭킹을 실시간으로 확인하세요.</p>
        </div>

        <div className="flex items-center gap-2">
          {/* 슬라이드 서브 탭 */}
          <div className="flex rounded-lg bg-secondary p-1">
            <button
              onClick={() => setSubTab('streamer')}
              className={`rounded-md px-3.5 py-1.5 text-xs font-bold transition ${
                subTab === 'streamer' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              스트리머 시세
            </button>
            <button
              onClick={() => setSubTab('user')}
              className={`rounded-md px-3.5 py-1.5 text-xs font-bold transition ${
                subTab === 'user' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              컬렉터 자산
            </button>
          </div>
          
          <button 
            onClick={fetchRankings}
            className="rounded-lg p-2 bg-secondary text-muted-foreground hover:text-foreground transition"
            title="새로고침"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* 랭킹 메인 */}
      <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        
        {/* 스트리머 랭킹 검색바 */}
        {subTab === 'streamer' && (
          <div className="relative mb-5">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="스트리머 검색"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-xl border border-border bg-secondary/30 pl-10 pr-4 py-2.5 text-xs focus:border-primary focus:outline-none"
            />
          </div>
        )}

        {/* 랭킹 테이블 리스트 */}
        <div className="space-y-3.5">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent"></div>
            </div>
          ) : subTab === 'streamer' ? (
            filteredStreamers.map((st, index) => (
              <div 
                key={st.channel_id} 
                className="flex items-center justify-between rounded-xl bg-secondary/15 p-4 border border-border/50 hover:border-border transition"
              >
                <div className="flex items-center gap-4">
                  {/* 순위 표기 */}
                  <span className={`w-6 text-center text-xs font-black ${
                    index === 0 ? 'text-amber-500' : index === 1 ? 'text-zinc-400' : index === 2 ? 'text-amber-700' : 'text-muted-foreground'
                  }`}>
                    {index + 1}
                  </span>

                  <img src={st.logo_url} alt={st.name} className="h-10 w-10 rounded-full border border-border/80 bg-card object-cover" />
                  
                  <div>
                    <h4 className="text-xs font-bold text-foreground flex items-center gap-1.5">
                      {st.name} {st.base_value >= 5000 && getCardBadge(st.base_value)}
                    </h4>
                    <p className="text-[10px] text-muted-foreground">{(st.follower_count || 0).toLocaleString()} 팔로워</p>
                  </div>
                </div>

                <div className="text-right flex flex-col items-end justify-center">
                  <div className="flex items-center gap-1.5 justify-end">
                    <span className="text-xs font-black text-primary">{(st.base_value || 0).toLocaleString()} P</span>
                    {(() => {
                      const prevVal = st.prev_value ?? st.base_value ?? 1000;
                      const diff = st.base_value - prevVal;
                      const rate = prevVal > 0 ? (diff / prevVal) * 100 : 0;

                      if (diff > 0) {
                        return (
                          <span className="text-[10px] font-black text-rose-500 flex items-center gap-0.5" title={`이전 시세: ${prevVal.toLocaleString()} P`}>
                            ▲ +{rate.toFixed(1)}%
                          </span>
                        );
                      } else if (diff < 0) {
                        return (
                          <span className="text-[10px] font-black text-blue-500 flex items-center gap-0.5" title={`이전 시세: ${prevVal.toLocaleString()} P`}>
                            ▼ {rate.toFixed(1)}%
                          </span>
                        );
                      } else {
                        return (
                          <span className="text-[9px] font-bold text-muted-foreground" title={`이전 시세: ${prevVal.toLocaleString()} P`}>
                            - 0.0%
                          </span>
                        );
                      }
                    })()}
                  </div>
                  <p className="text-[9px] text-muted-foreground">실시간 환산 시세</p>
                </div>
              </div>
            ))
          ) : (
            // 컬렉터(유저) 자산 랭킹
            userRankings.map((ur, index) => (
              <div 
                key={ur.id}
                className="flex items-center justify-between rounded-xl bg-secondary/15 p-4 border border-border/50 hover:border-border transition"
              >
                <div className="flex items-center gap-4">
                  <span className={`w-6 text-center text-xs font-black ${
                    index === 0 ? 'text-amber-500' : index === 1 ? 'text-zinc-400' : index === 2 ? 'text-amber-700' : 'text-muted-foreground'
                  }`}>
                    {index + 1}
                  </span>

                  <img src={ur.avatar_url} alt={ur.username} className="h-10 w-10 rounded-full border border-border/80 bg-card object-cover" />
                  
                  <div>
                    <h4 className="text-xs font-bold text-foreground">{ur.username}</h4>
                    <p className="text-[10px] text-muted-foreground">총 {ur.card_count}장 소장 중</p>
                  </div>
                </div>

                <div className="text-right">
                  <span className="text-xs font-black text-primary">{(ur.point || 0).toLocaleString()} P</span>
                  <p className="text-[9px] text-muted-foreground">보유 자산</p>
                </div>
              </div>
            ))
          )}
        </div>

      </div>

    </div>
  );
};
