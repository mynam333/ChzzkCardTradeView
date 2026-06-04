'use client';

import React, { useState, useEffect } from 'react';
import { Users, RefreshCw } from 'lucide-react';
import { useApp } from './AppContext';
import { apiFetch } from '@/lib/api';
import type { AdminUser } from '@/lib/types';

const USERS_PER_PAGE = 20;

/**
 * 관리자 > 유저 목록 탭.
 * 닉네임/채널ID 서버 검색 + 페이지네이션, 클릭 시 닉네임/ID 복사.
 * (AdminTab에서 분리된 자기완결형 컴포넌트 — 자체적으로 데이터를 조회합니다)
 */
export const AdminUsersTab: React.FC = () => {
  const { toast } = useApp();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [userSearch, setUserSearch] = useState('');
  const [userPage, setUserPage] = useState(1);
  const [userTotal, setUserTotal] = useState(0);
  const [userTotalPages, setUserTotalPages] = useState(1);
  const [usersLoading, setUsersLoading] = useState(false);

  const fetchUsers = async (page = userPage, keyword = userSearch) => {
    setUsersLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(USERS_PER_PAGE) });
      if (keyword.trim()) params.set('q', keyword.trim());
      const res = await apiFetch(`/admin/users?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users || []);
        setUserTotal(data.total || 0);
        setUserTotalPages(data.total_pages || 1);
      }
    } catch { /* noop */ } finally {
      setUsersLoading(false);
    }
  };

  // 검색어 디바운스(닉네임/ID) → 1페이지부터 재조회
  useEffect(() => {
    const t = setTimeout(() => {
      setUserPage(1);
      fetchUsers(1, userSearch);
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userSearch]);

  // 페이지 변경 시 재조회
  useEffect(() => {
    fetchUsers(userPage, userSearch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userPage]);

  // 닉네임/ID 클립보드 복사 (HTTPS 미지원 환경 폴백 포함)
  const copyText = async (text: string, label: string) => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      toast(`${label} 복사됨: ${text}`);
    } catch {
      toast('복사에 실패했습니다.');
    }
  };

  return (
    <section className="space-y-4">
      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-sm font-bold"><Users className="h-4 w-4" /> 유저 목록 ({userTotal.toLocaleString()})</h3>
          <button onClick={() => fetchUsers(userPage, userSearch)} className="text-xs text-muted-foreground hover:text-foreground"><RefreshCw className="h-3.5 w-3.5" /></button>
        </div>

        {/* 검색 */}
        <input
          type="text"
          placeholder="닉네임 또는 채널 ID로 검색"
          value={userSearch}
          onChange={(e) => setUserSearch(e.target.value)}
          className="mb-1 w-full rounded-lg border border-border bg-secondary/40 px-3 py-2 text-xs"
        />
        <p className="mb-3 text-[10px] text-muted-foreground">프로필 이미지·닉네임·채널 ID를 클릭하면 복사됩니다.</p>

        <div className="space-y-2">
          {usersLoading ? (
            <p className="py-8 text-center text-xs text-muted-foreground">불러오는 중…</p>
          ) : users.length === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">{userSearch.trim() ? '검색 결과가 없습니다.' : '유저가 없습니다.'}</p>
          ) : users.map((u) => (
            <div key={u.id} className="flex items-center gap-3 rounded-lg bg-secondary/30 p-2.5">
              {/* 프로필 이미지 (클릭 시 닉네임 복사) */}
              <button
                type="button"
                onClick={() => copyText(u.username, '닉네임')}
                title="닉네임 복사"
                className="relative h-10 w-10 shrink-0 overflow-hidden rounded-full border border-border bg-secondary"
              >
                {u.avatar_url
                  ? <img src={u.avatar_url} alt={u.username} className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                  : <span className="flex h-full w-full items-center justify-center text-[10px] font-bold text-muted-foreground">{(u.username || '?').slice(0, 2)}</span>}
              </button>
              <div className="min-w-0 flex-1">
                {/* 닉네임 (클릭 복사) */}
                <button
                  type="button"
                  onClick={() => copyText(u.username, '닉네임')}
                  title="닉네임 복사"
                  className="flex max-w-full items-center gap-1.5 text-left"
                >
                  <span className="truncate text-xs font-bold text-foreground hover:underline">{u.username}</span>
                  {u.role === 'ADMIN' && <span className="shrink-0 rounded bg-sky-500/15 px-1.5 py-0.5 text-[9px] font-bold text-sky-500">ADMIN</span>}
                  {u.banned_until && new Date(u.banned_until).getTime() > Date.now() && (
                    <span className="shrink-0 rounded bg-red-500/15 px-1.5 py-0.5 text-[9px] font-bold text-red-500">정지</span>
                  )}
                </button>
                {/* 채널 ID (클릭 복사) */}
                <button
                  type="button"
                  onClick={() => copyText(u.id, '채널 ID')}
                  title="채널 ID 복사"
                  className="block max-w-full truncate text-left text-[10px] text-muted-foreground hover:text-foreground hover:underline"
                >{u.id}</button>
              </div>
            </div>
          ))}
        </div>

        {/* 페이지네이션 */}
        {userTotalPages > 1 && (
          <div className="mt-4 flex items-center justify-center gap-2">
            <button
              onClick={() => setUserPage((p) => Math.max(1, p - 1))}
              disabled={userPage <= 1 || usersLoading}
              className="rounded-lg bg-secondary px-3 py-1.5 text-xs font-bold text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
            >이전</button>
            <span className="text-xs font-bold text-muted-foreground">{userPage} / {userTotalPages}</span>
            <button
              onClick={() => setUserPage((p) => Math.min(userTotalPages, p + 1))}
              disabled={userPage >= userTotalPages || usersLoading}
              className="rounded-lg bg-secondary px-3 py-1.5 text-xs font-bold text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
            >다음</button>
          </div>
        )}
      </div>
    </section>
  );
};
