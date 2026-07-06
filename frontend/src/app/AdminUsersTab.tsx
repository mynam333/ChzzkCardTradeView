'use client';

import React, { useState, useEffect } from 'react';
import { Activity, ArrowRightLeft, ChevronRight, Eraser, MessageCircleHeart, RefreshCw, Users, WalletCards } from 'lucide-react';
import { useApp } from './AppContext';
import { apiFetch } from '@/lib/api';
import { formatLocalDateTime } from '@/lib/time';
import type { AdminUser, PointAuditResponse, PointLedgerEntry, PointLedgerSourceType } from '@/lib/types';

const USERS_PER_PAGE = 20;
const AUDIT_PAGE_SIZE = 80;

const pointSourceLabels: Record<PointLedgerSourceType, string> = {
  gacha_draw: '소환',
  card_sell: '카드 판매',
  coupon: '쿠폰',
  minigame: '미니게임',
  shop_purchase: '상점',
  market_purchase: '마켓 구매',
  market_sale: '마켓 판매',
  market_bid: '경매 입찰',
  market_bid_refund: '입찰 환불',
  card_delete_refund: '카드 삭제 환불',
  trade: '교환',
  admin_reset: '관리자 조정',
  manual_adjustment: '직접 조정',
  unknown: '기타'
};

const reasonLabels: Record<string, string> = {
  gacha_draw_paid: '유료 소환',
  card_sell: '카드 판매',
  coupon_redeem: '쿠폰 사용',
  minigame_reward: '미니게임 보상',
  shop_purchase: '상점 구매',
  market_buy: '즉시 구매',
  auction_win: '경매 낙찰',
  market_sale: '마켓 판매',
  market_sale_settlement: '판매 정산',
  auction_sale: '경매 판매',
  auction_sale_settlement: '경매 정산',
  market_bid: '입찰 예약',
  auction_bid_reserved: '입찰 예약',
  auction_bid_adjust_refund: '입찰 조정 환불',
  auction_vickrey_refund: '낙찰 차액 환불',
  auction_lost_refund: '미낙찰 환불',
  outbid_refund: '입찰 환불',
  auction_outbid_refund: '입찰 환불',
  auction_cancel_refund: '경매 취소 환불',
  seller_account_deleted_refund: '판매자 탈퇴 환불',
  card_delete_refund: '카드 삭제 환불',
  trade_settlement: '교환 정산',
  point_set: '포인트 설정',
  point_increment: '포인트 증가',
  point_deduct: '포인트 차감'
};

const metadataSummary = (metadata: Record<string, unknown> | null) => {
  if (!metadata) return '';
  const priorityKeys = [
    'listing_id', 'transaction_id', 'card_id', 'user_card_id', 'coupon_id', 'coupon_code',
    'session_id', 'game_type', 'item_id', 'item_name', 'channel_id', 'serial_number', 'star'
  ];
  return priorityKeys
    .filter((key) => metadata[key] !== undefined && metadata[key] !== null && metadata[key] !== '')
    .map((key) => `${key}: ${String(metadata[key])}`)
    .join(' · ');
};

const pointClass = (amount: number) => (
  amount > 0 ? 'text-emerald-500' : amount < 0 ? 'text-rose-500' : 'text-muted-foreground'
);

const identityLabel = (source?: PointAuditResponse['user']['identity_source']) => {
  if (source === 'rejoined') return '재가입 계정';
  if (source === 'deleted_snapshot') return '탈퇴 스냅샷';
  if (source === 'unknown') return '알 수 없음';
  return '현재 계정';
};

const userIdentityLabel = (user: Pick<AdminUser, 'is_deleted' | 'identity_source'>) => {
  if (user.is_deleted || user.identity_source === 'deleted_snapshot') return '탈퇴';
  if (user.identity_source === 'rejoined') return '재가입';
  return null;
};

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
  const [resettingStatusUserId, setResettingStatusUserId] = useState<string | null>(null);
  const [audit, setAudit] = useState<PointAuditResponse | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditTrail, setAuditTrail] = useState<{ id: string; username: string | null }[]>([]);

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

  const resetStatusMessage = async (target: AdminUser) => {
    if (!target.status_message) return;
    if (!confirm(`${target.username}님의 상태 메시지를 초기화할까요?`)) return;

    setResettingStatusUserId(target.id);
    try {
      const res = await apiFetch(`/admin/users/${target.id}/status-message/reset`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(data.message || '상태 메시지 초기화에 실패했습니다.', 'error');
        return;
      }
      setUsers((prev) => prev.map((user) => user.id === target.id ? { ...user, status_message: null } : user));
      toast(data.message || '상태 메시지를 초기화했습니다.', 'success');
    } catch {
      toast('서버 통신 중 오류가 발생했습니다.', 'error');
    } finally {
      setResettingStatusUserId(null);
    }
  };

  const fetchPointAudit = async (userId: string, append = false, beforeId?: number | null) => {
    if (!userId) return;
    setAuditLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(AUDIT_PAGE_SIZE) });
      if (append && beforeId) params.set('before_id', String(beforeId));
      const res = await apiFetch(`/admin/users/${encodeURIComponent(userId)}/audit/points?${params.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(data.message || '포인트 감사 내역을 불러오지 못했습니다.', 'error');
        return;
      }

      const nextAudit = data as PointAuditResponse;
      if (append) {
        setAudit((prev) => prev ? {
          ...nextAudit,
          entries: [...prev.entries, ...(nextAudit.entries || [])],
          page_summary: {
            income: prev.page_summary.income + nextAudit.page_summary.income,
            expense: prev.page_summary.expense + nextAudit.page_summary.expense,
            net: prev.page_summary.net + nextAudit.page_summary.net
          }
        } : nextAudit);
      } else {
        setAudit(nextAudit);
        setAuditTrail((prev) => {
          const current = { id: nextAudit.user.id, username: nextAudit.user.username || null };
          if (prev[prev.length - 1]?.id === current.id) return prev;
          return [...prev.filter((item) => item.id !== current.id), current].slice(-8);
        });
      }
    } catch {
      toast('포인트 감사 내역 조회 중 오류가 발생했습니다.', 'error');
    } finally {
      setAuditLoading(false);
    }
  };

  const flowLabel = (entry: PointLedgerEntry, targetUserId: string) => {
    const counterpartyName = entry.counterparty_username
      ? `${entry.counterparty_username}${entry.counterparty_deleted_at ? ' (탈퇴)' : ''}`
      : entry.counterparty_user_id;
    const source = counterpartyName || pointSourceLabels[entry.source_type] || entry.source_type;
    const target = audit?.user.username || targetUserId;
    if (entry.amount > 0) return { from: source, to: target };
    if (entry.amount < 0) return { from: target, to: source };
    return { from: source, to: target };
  };

  return (
    <section className="space-y-4">
      {audit && (
        <div className="rounded-2xl border border-primary/20 bg-card p-5 shadow-sm">
          <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
              <h3 className="flex items-center gap-1.5 text-sm font-bold">
                <Activity className="h-4 w-4 text-primary" /> 포인트 감사
              </h3>
              <div className="mt-2 flex min-w-0 items-center gap-2">
                {audit.user.avatar_url
                  ? <img src={audit.user.avatar_url} alt={audit.user.username || audit.user.id} className="h-9 w-9 rounded-full border border-border object-cover" referrerPolicy="no-referrer" />
                  : <span className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-secondary text-[10px] font-bold text-muted-foreground">{(audit.user.username || '?').slice(0, 2)}</span>}
                <div className="min-w-0">
                  <p className="truncate text-sm font-black text-foreground">{audit.user.username || '탈퇴/삭제 유저'}</p>
                  <button
                    type="button"
                    onClick={() => copyText(audit.user.id, '감사 대상 ID')}
                    className="block max-w-full truncate text-left text-[10px] text-muted-foreground hover:text-foreground hover:underline"
                  >
                    {audit.user.id}
                  </button>
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
                      {identityLabel(audit.user.identity_source)}
                    </span>
                    {audit.user.deleted_at && (
                      <span className="rounded-full bg-rose-500/10 px-2 py-0.5 text-[10px] font-bold text-rose-500">
                        탈퇴 기록 {formatLocalDateTime(audit.user.deleted_at, { hour12: false })}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              {auditTrail.length > 1 && (
                <div className="mt-3 flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
                  {auditTrail.map((item, index) => (
                    <React.Fragment key={`${item.id}-${index}`}>
                      {index > 0 && <ChevronRight className="h-3 w-3" />}
                      <button
                        type="button"
                        onClick={() => fetchPointAudit(item.id)}
                        className="max-w-[140px] truncate rounded-full border border-border bg-secondary/40 px-2 py-0.5 font-bold hover:text-foreground"
                        title={item.id}
                      >
                        {item.username || item.id}
                      </button>
                    </React.Fragment>
                  ))}
                </div>
              )}
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg bg-emerald-500/10 px-3 py-2">
                <p className="text-[10px] font-bold text-emerald-500">수입</p>
                <p className="text-xs font-black text-emerald-500">+{audit.page_summary.income.toLocaleString()} P</p>
              </div>
              <div className="rounded-lg bg-rose-500/10 px-3 py-2">
                <p className="text-[10px] font-bold text-rose-500">지출</p>
                <p className="text-xs font-black text-rose-500">-{audit.page_summary.expense.toLocaleString()} P</p>
              </div>
              <div className="rounded-lg bg-secondary/60 px-3 py-2">
                <p className="text-[10px] font-bold text-muted-foreground">현재</p>
                <p className="text-xs font-black text-foreground">{audit.user.point == null ? '-' : `${audit.user.point.toLocaleString()} P`}</p>
              </div>
            </div>
          </div>

          <div className="max-h-[520px] space-y-2 overflow-y-auto pr-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {audit.entries.length === 0 ? (
              <p className="py-8 text-center text-xs text-muted-foreground">기록된 포인트 원장이 없습니다.</p>
            ) : audit.entries.map((entry) => {
              const flow = flowLabel(entry, audit.user.id);
              const metadata = metadataSummary(entry.metadata);
              return (
                <div key={entry.id} className="rounded-xl border border-border bg-secondary/25 p-3">
                  <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0">
                      <div className="mb-1 flex flex-wrap items-center gap-1.5">
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-black text-primary">{pointSourceLabels[entry.source_type] || entry.source_type}</span>
                        <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-bold text-muted-foreground">{reasonLabels[entry.reason] || entry.reason}</span>
                        {entry.source_id && <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-bold text-muted-foreground">#{entry.source_id}</span>}
                      </div>
                      <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs">
                        <span className="max-w-[180px] truncate font-bold text-foreground">{flow.from}</span>
                        <ArrowRightLeft className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="max-w-[180px] truncate font-bold text-foreground">{flow.to}</span>
                        {entry.counterparty_user_id && (
                          <button
                            type="button"
                            onClick={() => fetchPointAudit(entry.counterparty_user_id as string)}
                            className="rounded-full border border-border px-2 py-0.5 text-[10px] font-black text-muted-foreground hover:text-foreground"
                            title={entry.counterparty_user_id}
                          >
                            상대 추적
                          </button>
                        )}
                      </div>
                      {entry.description && <p className="mt-1 text-[10px] text-muted-foreground">{entry.description}</p>}
                      {metadata && <p className="mt-1 truncate text-[10px] text-muted-foreground" title={metadata}>{metadata}</p>}
                      <p className="mt-1 text-[10px] text-muted-foreground">{formatLocalDateTime(entry.created_at, { hour12: false })}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className={`text-sm font-black ${pointClass(entry.amount)}`}>
                        {entry.amount > 0 ? '+' : ''}{entry.amount.toLocaleString()} P
                      </p>
                      <p className="text-[10px] text-muted-foreground">잔액 {entry.balance_after == null ? '-' : `${entry.balance_after.toLocaleString()} P`}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-3 flex items-center justify-between gap-2">
            <p className="text-[10px] text-muted-foreground">새 원장은 배포 이후 발생한 포인트 변동부터 누적됩니다.</p>
            {audit.next_before_id && (
              <button
                type="button"
                onClick={() => fetchPointAudit(audit.user.id, true, audit.next_before_id)}
                disabled={auditLoading}
                className="rounded-lg bg-secondary px-3 py-1.5 text-xs font-bold text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
              >
                {auditLoading ? '불러오는 중...' : '더 보기'}
              </button>
            )}
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-sm font-bold"><Users className="h-4 w-4" /> 유저 목록 ({userTotal.toLocaleString()} · 탈퇴 제외)</h3>
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
        <p className="mb-3 text-[10px] text-muted-foreground">프로필 이미지·닉네임·채널 ID를 클릭하면 복사됩니다. 상태 메시지가 있는 유저는 바로 확인하고 초기화할 수 있습니다.</p>

        <div className="space-y-2">
          {usersLoading ? (
            <p className="py-8 text-center text-xs text-muted-foreground">불러오는 중…</p>
          ) : users.length === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">{userSearch.trim() ? '검색 결과가 없습니다.' : '유저가 없습니다.'}</p>
          ) : users.map((u) => (
            <div key={u.id} className="flex items-start gap-3 rounded-lg bg-secondary/30 p-2.5">
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
                  {userIdentityLabel(u) && (
                    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold ${u.is_deleted ? 'bg-rose-500/15 text-rose-500' : 'bg-amber-500/15 text-amber-500'}`}>
                      {userIdentityLabel(u)}
                    </span>
                  )}
                  {u.banned_until && new Date(u.banned_until).getTime() > Date.now() && (
                    <span className="shrink-0 rounded bg-red-500/15 px-1.5 py-0.5 text-[9px] font-bold text-red-500">정지</span>
                  )}
                </button>
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  {/* 채널 ID (클릭 복사) */}
                  <button
                    type="button"
                    onClick={() => copyText(u.id, '채널 ID')}
                    title="채널 ID 복사"
                    className="block max-w-full truncate text-left text-[10px] text-muted-foreground hover:text-foreground hover:underline"
                  >{u.id}</button>
                  {u.status_message && (
                    <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-primary/15 bg-primary/10 px-2 py-0.5 text-[10px] font-black text-primary dark:bg-primary/15">
                      <MessageCircleHeart className="h-3 w-3 shrink-0" />
                      <span className="truncate">{u.status_message}</span>
                    </span>
                  )}
                  {u.deleted_at && (
                    <span className="text-[10px] font-bold text-rose-500">
                      탈퇴 기록 {formatLocalDateTime(u.deleted_at, { hour12: false })}
                    </span>
                  )}
                </div>
              </div>
              <div className="ml-auto flex shrink-0 flex-col gap-1.5 sm:flex-row">
                <button
                  type="button"
                  onClick={() => fetchPointAudit(u.id)}
                  disabled={auditLoading && audit?.user.id === u.id}
                  className="inline-flex items-center justify-center gap-1 rounded-lg border border-primary/20 bg-primary/10 px-2.5 py-1.5 text-[10px] font-black text-primary transition hover:bg-primary/15 disabled:pointer-events-none disabled:opacity-50"
                  title="포인트 감사"
                >
                  <WalletCards className="h-3.5 w-3.5" />
                  감사
                </button>
                {u.status_message && !u.is_deleted && (
                <button
                  type="button"
                  onClick={() => resetStatusMessage(u)}
                  disabled={resettingStatusUserId === u.id}
                  className="inline-flex items-center justify-center gap-1 rounded-lg border border-rose-500/20 bg-rose-500/10 px-2.5 py-1.5 text-[10px] font-black text-rose-500 transition hover:bg-rose-500/15 disabled:pointer-events-none disabled:opacity-50"
                  title="상태 메시지 초기화"
                >
                  <Eraser className="h-3.5 w-3.5" />
                  {resettingStatusUserId === u.id ? '초기화 중' : '상태 초기화'}
                </button>
                )}
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
