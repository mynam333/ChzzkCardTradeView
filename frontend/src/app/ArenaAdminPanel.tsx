'use client';

import React from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Download,
  Gamepad2,
  Gauge,
  RefreshCw,
  ShieldCheck,
  Trophy
} from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { formatLocalDateTime } from '@/lib/time';
import { useApp } from './AppContext';

type ArenaAdminAction = 'stats' | 'rankings' | 'prune' | 'recoverCup' | 'recoverQuick';
type ArenaAdminSubTab = 'ops' | 'controls' | 'abuse';
type ArenaRestrictionType = 'skill' | 'tag' | 'battlefield' | 'card';
type ArenaStatFilterReview = 'all' | 'watch' | 'over' | 'under' | 'low_sample' | 'normal';

const statTypeLabels: Record<string, string> = {
  all: '전체',
  user_record: '유저 승패',
  class_combo: '클래스 조합',
  class_single: '클래스 단일',
  skill_single: '스킬',
  stat_focus: '스탯 성향',
  deck_size: '덱 크기',
  strategy_chip: '전술 칩',
  tactic_style: '라운드 전술',
  focus_rule: '타겟 우선순위'
};
const statTypeOrder = ['user_record', 'class_combo', 'class_single', 'skill_single', 'stat_focus', 'deck_size', 'strategy_chip', 'tactic_style', 'focus_rule'] as const;

const getQueueValue = (source: any, key: string) => Number(source?.queue?.[key] || 0).toLocaleString();
const toPercent = (value: number) => `${Math.round(Number(value || 0) * 100)}%`;
const formatDurationMs = (value: number) => {
  const totalSeconds = Math.max(0, Math.round(Number(value || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}분 ${seconds}초` : `${seconds}초`;
};
const getAuditRiskTone = (risk: string) => {
  if (risk === 'high') return 'border-red-200 bg-red-50 text-red-700 dark:border-red-300/20 dark:bg-red-300/10 dark:text-red-100';
  if (risk === 'medium') return 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-300/20 dark:bg-rose-300/10 dark:text-rose-100';
  if (risk === 'low') return 'border-pink-200 bg-pink-50 text-pink-700 dark:border-pink-300/20 dark:bg-pink-300/10 dark:text-pink-100';
  return 'border-border bg-secondary text-muted-foreground';
};
const getWinRateTone = (winRate: number, sampleCount: number) => {
  if (sampleCount < 10) return 'bg-secondary text-muted-foreground';
  if (winRate >= 0.62) return 'bg-rose-100 text-rose-700 dark:bg-rose-300/15 dark:text-rose-100';
  if (winRate <= 0.38) return 'bg-sky-100 text-sky-700 dark:bg-sky-300/15 dark:text-sky-100';
  return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-300/15 dark:text-emerald-100';
};
const formatExportTimestamp = () => {
  const date = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
};
const csvCell = (value: unknown) => {
  const text = value == null ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
const downloadTextFile = (filename: string, content: string, mimeType: string) => {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};
const getStatReview = (item: any) => {
  const sampleCount = Number(item.sample_count || 0);
  const winRate = Number(item.win_rate || 0);
  if (sampleCount < 10) return { flag: 'LOW_SAMPLE', reason: '표본 10 미만', hint: '판단 보류. 더 많은 경기 후 재확인' };
  if (winRate >= 0.62) return { flag: 'OVERPERFORMING', reason: '승률 62% 이상', hint: '상향된 클래스/스킬/전술 조합인지 확인' };
  if (winRate <= 0.38) return { flag: 'UNDERPERFORMING', reason: '승률 38% 이하', hint: '사용률과 패배 패턴 확인 후 보정 후보 검토' };
  return { flag: 'NORMAL', reason: '정상 범위', hint: '즉시 조정 불필요' };
};
const getStatConfidence = (item: any) => {
  const sampleCount = Number(item.sample_count || 0);
  if (sampleCount >= 80) return { label: '신뢰도 높음', tone: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-300/15 dark:text-emerald-100' };
  if (sampleCount >= 30) return { label: '신뢰도 보통', tone: 'bg-sky-100 text-sky-700 dark:bg-sky-300/15 dark:text-sky-100' };
  if (sampleCount >= 10) return { label: '신뢰도 낮음', tone: 'bg-amber-100 text-amber-700 dark:bg-amber-300/15 dark:text-amber-100' };
  return { label: '표본 부족', tone: 'bg-secondary text-muted-foreground' };
};
const matchesReviewFilter = (item: any, filter: ArenaStatFilterReview) => {
  if (filter === 'all') return true;
  const review = getStatReview(item);
  if (filter === 'watch') return review.flag === 'OVERPERFORMING' || review.flag === 'UNDERPERFORMING';
  if (filter === 'over') return review.flag === 'OVERPERFORMING';
  if (filter === 'under') return review.flag === 'UNDERPERFORMING';
  if (filter === 'low_sample') return review.flag === 'LOW_SAMPLE';
  return review.flag === 'NORMAL';
};
const buildActionCandidates = (items: any[]) => {
  const enoughSamples = items.filter((item) => Number(item.sample_count || 0) >= 10);
  const bySeverity = (a: any, b: any) =>
    Math.abs(Number(b.win_rate || 0) - 0.5) - Math.abs(Number(a.win_rate || 0) - 0.5)
    || Number(b.sample_count || 0) - Number(a.sample_count || 0);
  const withReview = (item: any) => ({
    ...item,
    confidence: getStatConfidence(item).label,
    review: getStatReview(item)
  });
  return {
    nerf_candidates: enoughSamples
      .filter((item) => Number(item.win_rate || 0) >= 0.62)
      .sort(bySeverity)
      .slice(0, 12)
      .map(withReview),
    buff_candidates: enoughSamples
      .filter((item) => Number(item.win_rate || 0) <= 0.38)
      .sort(bySeverity)
      .slice(0, 12)
      .map(withReview),
    watchlist: items
      .filter((item) => Number(item.sample_count || 0) >= 5)
      .filter((item) => Number(item.sample_count || 0) < 10 || Number(item.win_rate || 0) >= 0.58 || Number(item.win_rate || 0) <= 0.42)
      .sort(bySeverity)
      .slice(0, 20)
      .map(withReview)
  };
};
const buildArenaStatsCsv = (params: {
  arenaStats: any;
  statItems: any[];
  filters?: Record<string, unknown>;
}) => {
  const generatedAt = new Date().toISOString();
  const headers = [
    'generated_at',
    'season_id',
    'snapshot_at',
    'source',
    'snapshot_type',
    'metric_key',
    'label',
    'sample_count',
    'wins',
    'losses',
    'draws',
    'win_rate',
    'win_rate_percent',
    'review_flag',
    'review_reason',
    'review_hint',
    'confidence',
    'filters_json'
  ];
  const filtersJson = params.filters ? JSON.stringify(params.filters) : '';
  const rows = params.statItems.map((item) => {
    const review = getStatReview(item);
    const confidence = getStatConfidence(item);
    const winRate = Number(item.win_rate || 0);
    return [
      generatedAt,
      params.arenaStats?.season_id || '',
      params.arenaStats?.snapshot_at || '',
      params.arenaStats?.source || '',
      item.snapshot_type,
      item.metric_key,
      item.label,
      Number(item.sample_count || 0),
      Number(item.wins || 0),
      Number(item.losses || 0),
      Number(item.draws || 0),
      winRate,
      Math.round(winRate * 100),
      review.flag,
      review.reason,
      review.hint,
      confidence.label,
      filtersJson
    ];
  });
  return `\uFEFF${[headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')}`;
};
const buildArenaAbuseAuditCsv = (audit: any) => {
  const generatedAt = new Date().toISOString();
  const headers = [
    'generated_at',
    'season_id',
    'audit_generated_at',
    'scanned_matches',
    'user_id',
    'risk_level',
    'suspicion_score',
    'matches',
    'wins',
    'losses',
    'draws',
    'top_opponent_id',
    'top_opponent_matches',
    'top_opponent_rate',
    'short_match_rate',
    'sweep_rate',
    'one_sided_rate',
    'average_duration_ms',
    'flags',
    'evidence_match_ids'
  ];
  const rows = (audit?.suspects || []).map((item: any) => [
    generatedAt,
    audit?.season_id || '',
    audit?.generated_at || '',
    audit?.scanned_matches || 0,
    item.user_id,
    item.risk_level,
    item.suspicion_score,
    item.matches,
    item.wins,
    item.losses,
    item.draws,
    item.top_opponent_id || '',
    item.top_opponent_matches || 0,
    item.top_opponent_rate || 0,
    item.short_match_rate || 0,
    item.sweep_rate || 0,
    item.one_sided_rate || 0,
    item.average_duration_ms || 0,
    (item.flags || []).join('|'),
    (item.evidence || []).map((match: any) => match.match_id).join('|')
  ]);
  return `\uFEFF${[headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')}`;
};

export const ArenaAdminPanel: React.FC = () => {
  const { user, toast } = useApp();
  const [arenaOps, setArenaOps] = React.useState<any | null>(null);
  const [arenaStats, setArenaStats] = React.useState<any | null>(null);
  const [arenaQuick, setArenaQuick] = React.useState<any | null>(null);
  const [arenaCups, setArenaCups] = React.useState<any | null>(null);
  const [arenaAudit, setArenaAudit] = React.useState<any | null>(null);
  const [arenaJobs, setArenaJobs] = React.useState<any[]>([]);
  const [adminSubTab, setAdminSubTab] = React.useState<ArenaAdminSubTab>('ops');
  const [auditLimit, setAuditLimit] = React.useState(800);
  const [loading, setLoading] = React.useState(false);
  const [actionLoading, setActionLoading] = React.useState<ArenaAdminAction | ''>('');
  const [auditActionLoading, setAuditActionLoading] = React.useState('');
  const [flagLoading, setFlagLoading] = React.useState('');
  const [restrictionLoading, setRestrictionLoading] = React.useState('');
  const [restrictionType, setRestrictionType] = React.useState<ArenaRestrictionType>('skill');
  const [restrictionId, setRestrictionId] = React.useState('');
  const [statTypeFilter, setStatTypeFilter] = React.useState('all');
  const [reviewFilter, setReviewFilter] = React.useState<ArenaStatFilterReview>('all');
  const [minSampleFilter, setMinSampleFilter] = React.useState(0);
  const [statSearch, setStatSearch] = React.useState('');
  const [seasonKind, setSeasonKind] = React.useState<'preseason' | 'season'>('preseason');
  const [seasonNo, setSeasonNo] = React.useState(0);
  const [seasonName, setSeasonName] = React.useState('');
  const [seasonSaving, setSeasonSaving] = React.useState(false);

  React.useEffect(() => {
    const season = arenaOps?.season;
    if (!season) return;
    setSeasonKind(season.kind === 'season' ? 'season' : 'preseason');
    setSeasonNo(Number(season.season_no || 0));
    setSeasonName(String(season.name || ''));
  }, [arenaOps?.season?.id, arenaOps?.season?.name, arenaOps?.season?.phase]);
  const isAdmin = user?.role === 'ADMIN';
  const statItems = React.useMemo(() => (Array.isArray(arenaStats?.items) ? arenaStats.items : []), [arenaStats]);
  const activeStatFilters = React.useMemo(() => ({
    snapshot_type: statTypeFilter,
    review: reviewFilter,
    min_sample: minSampleFilter,
    search: statSearch.trim()
  }), [minSampleFilter, reviewFilter, statSearch, statTypeFilter]);
  const filteredStatItems = React.useMemo(() => {
    const search = statSearch.trim().toLowerCase();
    return statItems.filter((item: any) => {
      const sampleCount = Number(item.sample_count || 0);
      if (statTypeFilter !== 'all' && item.snapshot_type !== statTypeFilter) return false;
      if (sampleCount < minSampleFilter) return false;
      if (!matchesReviewFilter(item, reviewFilter)) return false;
      if (search) {
        const haystack = `${item.snapshot_type || ''} ${item.metric_key || ''} ${item.label || ''}`.toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      return true;
    });
  }, [minSampleFilter, reviewFilter, statItems, statSearch, statTypeFilter]);
  const statGroups = React.useMemo(() => {
    const grouped = new Map<string, any[]>();
    for (const item of filteredStatItems) {
      const key = String(item.snapshot_type || 'unknown');
      grouped.set(key, [...(grouped.get(key) || []), item]);
    }
    return grouped;
  }, [filteredStatItems]);
  const balanceOutliers = React.useMemo(() => filteredStatItems
    .filter((item: any) => Number(item.sample_count || 0) >= 10)
    .filter((item: any) => Number(item.win_rate || 0) >= 0.62 || Number(item.win_rate || 0) <= 0.38)
    .sort((a: any, b: any) => Math.abs(Number(b.win_rate || 0) - 0.5) - Math.abs(Number(a.win_rate || 0) - 0.5))
    .slice(0, 8), [filteredStatItems]);
  const topSamples = React.useMemo(() => [...filteredStatItems]
    .sort((a: any, b: any) => Number(b.sample_count || 0) - Number(a.sample_count || 0))
    .slice(0, 8), [filteredStatItems]);
  const actionCandidates = React.useMemo(() => buildActionCandidates(statItems), [statItems]);

  const fetchArenaAdminData = React.useCallback(async (scope: ArenaAdminSubTab = adminSubTab) => {
    if (!isAdmin) return;
    setLoading(true);
    try {
      if (scope === 'abuse') {
        const auditRes = await apiFetch(`/admin/arena/abuse-audit?limit=${auditLimit}`);
        if (auditRes.ok) {
          const auditData = await auditRes.json();
          setArenaAudit(auditData.data || auditData);
        }
        return;
      }

      if (scope === 'controls') {
        const opsRes = await apiFetch('/admin/arena/system');
        if (opsRes.ok) {
          const opsData = await opsRes.json();
          setArenaOps(opsData.data || opsData);
        }
        return;
      }

      const [opsRes, statsRes, quickRes, cupsRes, jobsRes] = await Promise.all([
        apiFetch('/admin/arena/system'),
        apiFetch('/admin/arena/stats?limit=300'),
        apiFetch('/admin/arena/quick-match'),
        apiFetch('/admin/arena/cups'),
        apiFetch('/admin/arena/jobs?limit=8')
      ]);

      if (opsRes.ok) {
        const opsData = await opsRes.json();
        setArenaOps(opsData.data || opsData);
      }
      if (statsRes.ok) {
        const statsData = await statsRes.json();
        setArenaStats(statsData.data || statsData);
      }
      if (quickRes.ok) {
        const quickData = await quickRes.json();
        setArenaQuick(quickData.data || quickData);
      }
      if (cupsRes.ok) {
        const cupsData = await cupsRes.json();
        setArenaCups(cupsData.data || cupsData);
      }
      if (jobsRes.ok) {
        const jobsData = await jobsRes.json();
        setArenaJobs(jobsData.data?.items || jobsData.items || []);
      }
    } catch {
      toast('아레나 관리자 정보를 불러오지 못했습니다.', 'error');
    } finally {
      setLoading(false);
    }
  }, [adminSubTab, auditLimit, isAdmin, toast]);

  React.useEffect(() => {
    fetchArenaAdminData();
  }, [fetchArenaAdminData]);

  const runArenaAdminAction = async (kind: ArenaAdminAction) => {
    if (!isAdmin || actionLoading) return;
    setActionLoading(kind);
    try {
      const endpoint = kind === 'stats'
        ? '/admin/arena/stats/rebuild'
        : kind === 'rankings'
          ? '/admin/arena/rankings/rebuild'
          : kind === 'recoverCup'
            ? '/admin/arena/cups/recover-queue'
            : kind === 'recoverQuick'
              ? '/admin/arena/quick-match/recover-queue'
              : '/admin/arena/matches/prune-logs';
      const body = kind === 'prune'
        ? { retention_days: 7, limit: 200 }
        : kind === 'recoverCup' || kind === 'recoverQuick'
          ? {}
          : { limit: 1000 };
      const res = await apiFetch(endpoint, { method: 'POST', body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || 'Arena admin action failed');
      toast(
        kind === 'stats'
          ? '아레나 통계 스냅샷 재생성 작업을 등록했습니다.'
          : kind === 'rankings'
            ? '아레나 랭킹 스냅샷 재생성 작업을 등록했습니다.'
            : kind === 'recoverCup'
              ? '아레나 컵 큐를 복구했습니다.'
              : kind === 'recoverQuick'
                ? '아레나 빠른대전 큐를 복구했습니다.'
                : '아레나 리플레이 정리 작업을 등록했습니다.',
        'success'
      );
      await fetchArenaAdminData();
    } catch (err: any) {
      toast(err?.message || '아레나 관리자 작업에 실패했습니다.', 'error');
    } finally {
      setActionLoading('');
    }
  };

  const updateArenaSeason = async (phase: 'setup' | 'active' | 'closed') => {
    setSeasonSaving(true);
    try {
      const res = await apiFetch('/admin/arena/season', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: seasonKind,
          season_no: seasonNo,
          name: seasonName,
          phase,
          reason: 'arena admin season control'
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || 'Arena season update failed');
      toast(phase === 'active' ? '아레나 시즌을 열었습니다.' : phase === 'closed' ? '아레나 시즌을 닫았습니다.' : '아레나 시즌을 준비 상태로 저장했습니다.', 'success');
      await fetchArenaAdminData('ops');
    } catch (err: any) {
      toast(err?.message || '아레나 시즌 설정 변경에 실패했습니다.', 'error');
    } finally {
      setSeasonSaving(false);
    }
  };

  const toggleArenaFlag = async (flag: string, enabled: boolean) => {
    if (!isAdmin || flagLoading) return;
    setFlagLoading(flag);
    try {
      const res = await apiFetch(`/admin/arena/system/flags/${flag}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || 'Arena ops flag update failed');
      toast('아레나 운영 설정을 변경했습니다.', 'success');
      await fetchArenaAdminData();
    } catch (err: any) {
      toast(err?.message || '아레나 운영 설정 변경에 실패했습니다.', 'error');
    } finally {
      setFlagLoading('');
    }
  };

  const updateArenaRestriction = async (type: ArenaRestrictionType, id: string, disabled: boolean) => {
    const cleanId = id.trim();
    if (!isAdmin || restrictionLoading || !cleanId) return;
    const loadingKey = `${type}:${cleanId}`;
    setRestrictionLoading(loadingKey);
    try {
      const res = await apiFetch(`/admin/arena/restrictions/${encodeURIComponent(type)}/${encodeURIComponent(cleanId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ disabled, reason: 'arena admin panel' })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || 'Arena restriction update failed');
      toast(disabled ? '아레나 제한을 적용했습니다.' : '아레나 제한을 해제했습니다.', 'success');
      setRestrictionId('');
      await fetchArenaAdminData();
    } catch (err: any) {
      toast(err?.message || '아레나 제한 설정에 실패했습니다.', 'error');
    } finally {
      setRestrictionLoading('');
    }
  };

  const exportArenaStatsCsv = () => {
    if (filteredStatItems.length === 0) {
      toast('현재 필터 조건에 맞는 아레나 통계가 없습니다.', 'warning');
      return;
    }
    const filename = `chikapo-arena-stats-${formatExportTimestamp()}.csv`;
    downloadTextFile(filename, buildArenaStatsCsv({ arenaStats, statItems: filteredStatItems, filters: activeStatFilters }), 'text/csv;charset=utf-8');
    toast('아레나 통계 CSV를 생성했습니다.', 'success');
  };

  const exportArenaDiagnosticsJson = () => {
    const generatedAt = new Date().toISOString();
    const typeCounts = Array.from(statGroups.entries()).reduce<Record<string, number>>((acc, [type, items]) => {
      acc[type] = items.length;
      return acc;
    }, {});
    const payload = {
      schema_version: 1,
      generated_at: generatedAt,
      purpose: 'chikapo_arena_balance_diagnostics',
      review_thresholds: {
        low_sample_below: 10,
        overperforming_win_rate_gte: 0.62,
        underperforming_win_rate_lte: 0.38,
        high_confidence_sample_gte: 80,
        medium_confidence_sample_gte: 30
      },
      notes: [
        '이 파일은 관리자 화면에 이미 로드된 스냅샷과 운영 상태를 브라우저에서 내보낸 것입니다.',
        '새 DB 조회나 서버 집계 없이 생성됩니다.',
        '문제 분석 시 arena_stats.items, diagnostics.balance_outliers, queue 상태를 함께 확인합니다.'
      ],
      arena_stats: arenaStats,
      diagnostics: {
        type_counts: typeCounts,
        active_filters: activeStatFilters,
        filtered_item_count: filteredStatItems.length,
        balance_outliers: balanceOutliers.map((item: any) => ({ ...item, review: getStatReview(item) })),
        top_samples: topSamples.map((item: any) => ({ ...item, review: getStatReview(item), confidence: getStatConfidence(item).label })),
        action_candidates: actionCandidates
      },
      ops: arenaOps,
      quick_match: arenaQuick,
      cups: arenaCups,
      abuse_audit: arenaAudit,
      recent_jobs: arenaJobs
    };
    const filename = `chikapo-arena-diagnostics-${formatExportTimestamp()}.json`;
    downloadTextFile(filename, JSON.stringify(payload, null, 2), 'application/json;charset=utf-8');
    toast('아레나 진단 JSON을 생성했습니다.', 'success');
  };

  const exportArenaAbuseAuditCsv = () => {
    if (!arenaAudit || !Array.isArray(arenaAudit.suspects) || arenaAudit.suspects.length === 0) {
      toast('내보낼 어뷰징 의심 계정이 없습니다.', 'warning');
      return;
    }
    const filename = `chikapo-arena-abuse-audit-${formatExportTimestamp()}.csv`;
    downloadTextFile(filename, buildArenaAbuseAuditCsv(arenaAudit), 'text/csv;charset=utf-8');
    toast('아레나 어뷰징 감사 CSV를 생성했습니다.', 'success');
  };

  const exportArenaAbuseAuditJson = () => {
    if (!arenaAudit) {
      toast('어뷰징 감사 데이터가 없습니다.', 'warning');
      return;
    }
    const payload = {
      schema_version: 1,
      generated_at: new Date().toISOString(),
      purpose: 'chikapo_arena_abuse_audit',
      audit: arenaAudit,
      review_notes: [
        '동일 상대 반복, 일방 승패, 짧은 전투 재생 시간, 스윕 비율을 함께 봅니다.',
        '단일 지표만으로 제재하지 말고 evidence의 최근 경기 ID와 리플레이를 함께 확인합니다.',
        '이 파일은 최신 랭크 경기 제한 스캔 결과라 서버 전체 테이블 풀스캔 결과가 아닙니다.'
      ]
    };
    const filename = `chikapo-arena-abuse-audit-${formatExportTimestamp()}.json`;
    downloadTextFile(filename, JSON.stringify(payload, null, 2), 'application/json;charset=utf-8');
    toast('아레나 어뷰징 감사 JSON을 생성했습니다.', 'success');
  };

  const sanctionArenaSuspect = async (userId: string, duration: '1d' | '7d' | '30d' | 'permanent') => {
    if (!userId || auditActionLoading) return;
    const suspect = (arenaAudit?.suspects || []).find((item: any) => item.user_id === userId);
    setAuditActionLoading(`${userId}:${duration}`);
    try {
      const reason = [
        '치카포 아레나 어뷰징 의심 자동 감사',
        suspect ? `위험도 ${suspect.risk_level} / 점수 ${suspect.suspicion_score}` : '',
        suspect?.flags?.length ? `근거: ${suspect.flags.join(', ')}` : ''
      ].filter(Boolean).join(' | ');
      const res = await apiFetch(`/admin/users/${encodeURIComponent(userId)}/ban`, {
        method: 'POST',
        body: JSON.stringify({ duration, reason })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || '제재 처리에 실패했습니다.');
      toast(`${userId} 계정을 제재 처리했습니다.`, 'success');
    } catch (err: any) {
      toast(err?.message || '제재 처리에 실패했습니다.', 'error');
    } finally {
      setAuditActionLoading('');
    }
  };

  const unbanArenaSuspect = async (userId: string) => {
    if (!userId || auditActionLoading) return;
    setAuditActionLoading(`${userId}:unban`);
    try {
      const res = await apiFetch(`/admin/users/${encodeURIComponent(userId)}/unban`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || '제재 해제에 실패했습니다.');
      toast(`${userId} 계정 제재를 해제했습니다.`, 'success');
    } catch (err: any) {
      toast(err?.message || '제재 해제에 실패했습니다.', 'error');
    } finally {
      setAuditActionLoading('');
    }
  };

  if (!isAdmin) return null;

  return (
    <section className="space-y-5">
      <div className="cute-surface rounded-[2rem] p-3">
        <div className="grid gap-2 sm:grid-cols-3">
          {[
            ['ops', '운영/통계', '큐, 스냅샷, 밸런스 통계 관리'],
            ['controls', '인게임 제어', '문제 카드와 규칙 즉시 제한'],
            ['abuse', '어뷰징 감사', '반복 상대와 비정상 승패 흐름 확인']
          ].map(([id, label, description]) => (
            <button
              key={id}
              type="button"
              onClick={() => setAdminSubTab(id as ArenaAdminSubTab)}
              className={`rounded-3xl px-4 py-3 text-left transition ${
                adminSubTab === id
                  ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/20'
                  : 'bg-secondary/55 text-muted-foreground hover:bg-secondary/80 hover:text-foreground'
              }`}
            >
              <span className="block text-sm font-black">{label}</span>
              <span className="mt-0.5 block text-[10px] font-bold opacity-80">{description}</span>
            </button>
          ))}
        </div>
      </div>

      {adminSubTab === 'controls' ? (
        <div className="cute-surface rounded-[2rem] p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h2 className="flex items-center gap-2 text-lg font-black text-foreground">
                <ShieldCheck className="h-5 w-5 text-primary" />
                인게임 제어
              </h2>
              <p className="mt-1 max-w-3xl text-xs font-bold leading-relaxed text-muted-foreground">
                문제가 되는 스킬, 태그, 전장 규칙, 카드를 즉시 제한합니다. 제한은 새 카드 생성과 새 매치 전장 선택에 반영되고, 모든 조작은 감사 로그에 남습니다.
              </p>
            </div>
            <button
              type="button"
              onClick={() => fetchArenaAdminData()}
              disabled={loading}
              className="cute-wiggle-hover inline-flex items-center gap-1.5 rounded-2xl border border-border bg-secondary/70 px-3 py-2 text-[10px] font-black text-foreground disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              새로고침
            </button>
          </div>

          <div className="mt-5 rounded-[1.75rem] border border-border bg-card/70 p-4">
            <h3 className="text-sm font-black text-foreground">제한 추가</h3>
            <div className="mt-3 grid gap-2 md:grid-cols-[10rem_minmax(0,1fr)_9rem]">
              <select
                value={restrictionType}
                onChange={(event) => setRestrictionType(event.target.value as ArenaRestrictionType)}
                className="rounded-2xl border border-border bg-secondary/60 px-3 py-2 text-xs font-black text-foreground outline-none"
              >
                <option value="skill">스킬</option>
                <option value="tag">태그</option>
                <option value="battlefield">전장 규칙</option>
                <option value="card">카드/채널</option>
              </select>
              <input
                value={restrictionId}
                onChange={(event) => setRestrictionId(event.target.value)}
                placeholder="제한할 ID"
                className="rounded-2xl border border-border bg-background px-3 py-2 text-xs font-bold text-foreground outline-none focus:border-primary"
              />
              <button
                type="button"
                onClick={() => updateArenaRestriction(restrictionType, restrictionId, true)}
                disabled={!restrictionId.trim() || Boolean(restrictionLoading)}
                className="cute-wiggle-hover rounded-2xl bg-primary px-3 py-2 text-xs font-black text-primary-foreground disabled:opacity-50"
              >
                제한 적용
              </button>
            </div>
          </div>

          <div className="mt-5 grid gap-4 xl:grid-cols-2">
            {([
              ['skill', 'disabled_skill_ids', '제한된 스킬'],
              ['tag', 'disabled_tag_ids', '제한된 태그'],
              ['battlefield', 'disabled_battlefield_rule_ids', '제한된 전장 규칙'],
              ['card', 'disabled_card_ids', '제한된 카드/채널']
            ] as const).map(([type, key, label]) => {
              const items = Array.isArray(arenaOps?.admin_control?.[key]) ? arenaOps.admin_control[key] : [];
              return (
                <div key={key} className="rounded-3xl border border-white/70 bg-white/64 p-4 dark:border-white/10 dark:bg-white/10">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-black text-foreground">{label}</h3>
                    <span className="rounded-full bg-secondary px-2.5 py-1 text-[10px] font-black text-muted-foreground">{items.length}개</span>
                  </div>
                  <div className="mt-3 space-y-2">
                    {items.length === 0 ? (
                      <p className="rounded-2xl bg-secondary/45 px-3 py-4 text-center text-[11px] font-bold text-muted-foreground">현재 제한된 항목이 없습니다.</p>
                    ) : items.map((item: string) => (
                      <div key={`${key}-${item}`} className="flex items-center justify-between gap-2 rounded-2xl bg-card/80 px-3 py-2">
                        <span className="min-w-0 truncate text-[11px] font-black text-foreground">{item}</span>
                        <button
                          type="button"
                          onClick={() => updateArenaRestriction(type, item, false)}
                          disabled={restrictionLoading === `${type}:${item}`}
                          className="shrink-0 rounded-xl border border-border bg-secondary/70 px-2.5 py-1.5 text-[10px] font-black text-muted-foreground disabled:opacity-50"
                        >
                          해제
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : adminSubTab === 'abuse' ? (
        <div className="cute-surface rounded-[2rem] p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h2 className="flex items-center gap-2 text-lg font-black text-foreground">
                <ShieldCheck className="h-5 w-5 text-primary" />
                어뷰징 감사
              </h2>
              <p className="mt-1 max-w-3xl text-xs font-bold leading-relaxed text-muted-foreground">
                최신 랭크 경기만 제한 스캔해 동일 상대 반복, 일방 승패, 짧은 전투 재생 시간, 스윕 비율을 함께 점수화합니다.
                단일 지표만으로 확정하지 말고 근거 경기와 리플레이를 확인한 뒤 제재하세요.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={String(auditLimit)}
                onChange={(event) => setAuditLimit(Number(event.target.value))}
                className="rounded-2xl border border-border bg-secondary/60 px-3 py-2 text-xs font-black text-foreground outline-none"
              >
                <option value="300">최근 300경기</option>
                <option value="800">최근 800경기</option>
                <option value="1500">최근 1500경기</option>
              </select>
              <button
                type="button"
                onClick={() => fetchArenaAdminData()}
                disabled={loading}
                className="cute-wiggle-hover inline-flex items-center gap-1.5 rounded-2xl border border-border bg-secondary/70 px-3 py-2 text-[10px] font-black text-foreground disabled:opacity-50"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                재검사
              </button>
              <button
                type="button"
                onClick={exportArenaAbuseAuditCsv}
                className="cute-wiggle-hover inline-flex items-center gap-1.5 rounded-2xl border border-border bg-secondary/70 px-3 py-2 text-[10px] font-black text-foreground"
              >
                <Download className="h-3.5 w-3.5" />
                CSV
              </button>
              <button
                type="button"
                onClick={exportArenaAbuseAuditJson}
                className="cute-wiggle-hover inline-flex items-center gap-1.5 rounded-2xl bg-primary px-3 py-2 text-[10px] font-black text-primary-foreground shadow-sm"
              >
                <Download className="h-3.5 w-3.5" />
                JSON
              </button>
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-4">
            {[
              ['스캔 경기', arenaAudit?.scanned_matches ?? 0],
              ['의심 계정', arenaAudit?.summary?.suspect_accounts ?? 0],
              ['위험 계정', arenaAudit?.summary?.high_risk_accounts ?? 0],
              ['의심 페어', arenaAudit?.summary?.suspicious_pairs ?? 0]
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-3xl border border-white/70 bg-white/72 p-4 text-center shadow-sm dark:border-white/10 dark:bg-white/10">
                <p className="text-[10px] font-black text-muted-foreground">{String(label)}</p>
                <p className="mt-1 text-xl font-black text-foreground">{Number(value || 0).toLocaleString()}</p>
              </div>
            ))}
          </div>

          <div className="mt-4 rounded-3xl border border-border bg-card/62 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-black text-foreground">의심 계정</h3>
                <p className="mt-1 text-[11px] font-bold text-muted-foreground">
                  제재 버튼은 기존 관리자 유저 제재 API를 사용합니다. 증거 경기 확인 후 단계적으로 적용하세요.
                </p>
              </div>
              <span className="rounded-full bg-secondary px-2.5 py-1 text-[10px] font-black text-muted-foreground">
                짧은 전투 기준 {formatDurationMs(arenaAudit?.thresholds?.short_match_ms || 0)}
              </span>
            </div>
            <div className="mt-4 grid gap-3 xl:grid-cols-2">
              {(!arenaAudit?.suspects || arenaAudit.suspects.length === 0) ? (
                <p className="rounded-3xl bg-secondary/45 px-4 py-8 text-center text-xs font-bold text-muted-foreground xl:col-span-2">
                  현재 감사 범위에서 의심 계정이 없습니다.
                </p>
              ) : arenaAudit.suspects.map((suspect: any) => (
                <article key={suspect.user_id} className="arena-status-row rounded-3xl border border-border bg-white/70 p-4 dark:bg-white/10">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="truncate text-sm font-black text-foreground">{suspect.user_id}</h4>
                        <span className={`rounded-full border px-2.5 py-1 text-[10px] font-black ${getAuditRiskTone(suspect.risk_level)}`}>
                          {suspect.risk_level} · {suspect.suspicion_score}
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] font-bold text-muted-foreground">
                        {suspect.matches}전 · {suspect.wins}승 {suspect.losses}패 {suspect.draws}무 · 주 상대 {suspect.top_opponent_id || '-'} ({suspect.top_opponent_matches || 0}회)
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {(['1d', '7d', '30d', 'permanent'] as const).map((duration) => (
                        <button
                          key={`${suspect.user_id}-${duration}`}
                          type="button"
                          onClick={() => sanctionArenaSuspect(suspect.user_id, duration)}
                          disabled={Boolean(auditActionLoading)}
                          className="rounded-xl border border-red-200 bg-red-50 px-2.5 py-1.5 text-[10px] font-black text-red-700 disabled:opacity-50 dark:border-red-300/20 dark:bg-red-300/10 dark:text-red-100"
                        >
                          {auditActionLoading === `${suspect.user_id}:${duration}` ? '처리중' : duration === 'permanent' ? '영구' : duration}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => unbanArenaSuspect(suspect.user_id)}
                        disabled={Boolean(auditActionLoading)}
                        className="rounded-xl border border-border bg-secondary/70 px-2.5 py-1.5 text-[10px] font-black text-muted-foreground disabled:opacity-50"
                      >
                        해제
                      </button>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {(suspect.flags || []).length === 0 ? (
                      <span className="rounded-full bg-secondary px-2 py-0.5 text-[9px] font-black text-muted-foreground">관찰 필요</span>
                    ) : suspect.flags.map((flag: string) => (
                      <span key={`${suspect.user_id}-${flag}`} className="rounded-full bg-primary/10 px-2 py-0.5 text-[9px] font-black text-primary">{flag}</span>
                    ))}
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {[
                      ['상대 집중', toPercent(suspect.top_opponent_rate)],
                      ['일방 승패', toPercent(suspect.one_sided_rate)],
                      ['짧은 전투', toPercent(suspect.short_match_rate)],
                      ['평균 시간', formatDurationMs(suspect.average_duration_ms)]
                    ].map(([label, value]) => (
                      <div key={`${suspect.user_id}-${label}`} className="rounded-2xl bg-card/80 px-3 py-2 text-center">
                        <p className="text-[9px] font-black text-muted-foreground">{label}</p>
                        <p className="mt-0.5 text-[11px] font-black text-foreground">{value}</p>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 space-y-1.5">
                    {(suspect.evidence || []).slice(0, 4).map((match: any) => (
                      <div key={`${suspect.user_id}-${match.match_id}`} className="flex items-center justify-between gap-2 rounded-2xl bg-secondary/45 px-3 py-2">
                        <p className="min-w-0 truncate text-[10px] font-bold text-muted-foreground">
                          #{match.match_id} · {match.player_a_id} vs {match.player_b_id}
                        </p>
                        <span className="shrink-0 text-[10px] font-black text-foreground">{match.score} · {formatDurationMs(match.duration_ms)}</span>
                      </div>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
            <div className="rounded-3xl border border-white/70 bg-white/64 p-4 dark:border-white/10 dark:bg-white/10">
              <h3 className="text-sm font-black text-foreground">의심 페어</h3>
              <div className="mt-3 space-y-2">
                {(!arenaAudit?.suspicious_pairs || arenaAudit.suspicious_pairs.length === 0) ? (
                  <p className="rounded-2xl bg-secondary/45 px-3 py-4 text-center text-[11px] font-bold text-muted-foreground">의심 페어가 없습니다.</p>
                ) : arenaAudit.suspicious_pairs.slice(0, 10).map((pair: any) => (
                  <div key={pair.pair_key} className="rounded-2xl bg-card/80 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="min-w-0 truncate text-[11px] font-black text-foreground">{pair.user_a_id} ↔ {pair.user_b_id}</p>
                      <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-black ${getAuditRiskTone(pair.risk_level)}`}>{pair.suspicion_score}</span>
                    </div>
                    <p className="mt-1 text-[10px] font-bold text-muted-foreground">
                      {pair.matches}전 · 우세 {pair.dominant_user_id || '없음'} · 일방 {toPercent(pair.one_sided_rate)} · 짧은 전투 {toPercent(pair.short_match_rate)}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-3xl border border-white/70 bg-white/64 p-4 dark:border-white/10 dark:bg-white/10">
              <h3 className="text-sm font-black text-foreground">감사 고도화 기준</h3>
              <div className="mt-3 space-y-2">
                {(arenaAudit?.recommendations || []).map((item: string) => (
                  <p key={item} className="rounded-2xl bg-secondary/45 px-3 py-2 text-[11px] font-bold leading-relaxed text-muted-foreground">{item}</p>
                ))}
                <p className="rounded-2xl bg-primary/10 px-3 py-2 text-[11px] font-bold leading-relaxed text-primary">
                  다음 단계로는 계정 생성일, IP/디바이스 해시, 큐 진입 간격, 제재 이력, 리플레이 이벤트 다양성 지표를 별도 스냅샷으로 붙이면 정확도를 더 높일 수 있습니다.
                </p>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <>
      <div className="cute-surface rounded-[2rem] p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-black text-foreground">
              <Gamepad2 className="h-5 w-5 text-primary" />
              아레나 운영 콘솔
            </h2>
            <p className="mt-1 text-xs font-bold text-muted-foreground">
              요청 시 실시간 집계하지 않고 저장된 스냅샷과 큐 상태만 조회합니다.
            </p>
          </div>
          <button
            type="button"
            onClick={() => fetchArenaAdminData()}
            disabled={loading}
            className="cute-wiggle-hover inline-flex items-center justify-center gap-2 rounded-2xl border border-border bg-secondary/70 px-4 py-2.5 text-xs font-black text-foreground disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            새로고침
          </button>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-4">
          {[
            { label: '빠른대전', value: arenaOps?.quick_match_enabled ? '활성' : '비활성' },
            { label: '8인 컵', value: arenaCups?.enabled ? '활성' : '비활성' },
            { label: '전투 전송', value: arenaOps?.transport_policy?.battle_transport || 'http_result_with_client_replay' },
            { label: '리플레이 보관', value: `${arenaOps?.replay_policy?.prune_retention_days || 7}일` }
          ].map((item) => (
            <div key={item.label} className="rounded-3xl border border-white/70 bg-white/72 p-4 shadow-sm dark:border-white/10 dark:bg-white/10">
              <p className="text-[10px] font-black text-muted-foreground">{item.label}</p>
              <p className="mt-1 break-all text-sm font-black text-foreground">{item.value}</p>
            </div>
          ))}
        </div>

        <div className="mt-4 rounded-[1.75rem] border border-border bg-card/70 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-black text-foreground">시즌 관리</h3>
              <p className="mt-1 text-[11px] font-bold text-muted-foreground">
                현재 시즌 ID는 덱, 큐, 매치, 랭킹의 season_id로 사용됩니다. 시즌을 닫으면 플레이 진입이 비활성화됩니다.
              </p>
            </div>
            <span className={`rounded-full px-2.5 py-1 text-[10px] font-black ${arenaOps?.season?.phase === 'active' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-300/10 dark:text-emerald-100' : arenaOps?.season?.phase === 'closed' ? 'bg-rose-50 text-rose-700 dark:bg-rose-300/10 dark:text-rose-100' : 'bg-secondary text-muted-foreground'}`}>
              {arenaOps?.season?.phase === 'active' ? 'OPEN' : arenaOps?.season?.phase === 'closed' ? 'CLOSED' : 'SETUP'}
            </span>
          </div>
          <div className="mt-3 grid gap-2 lg:grid-cols-[0.85fr_0.7fr_1.45fr_auto]">
            <label className="text-[10px] font-black text-muted-foreground">
              시즌 유형
              <select value={seasonKind} onChange={(event) => setSeasonKind(event.target.value === 'season' ? 'season' : 'preseason')} className="mt-1 w-full rounded-2xl border border-border bg-background px-3 py-2 text-xs font-black text-foreground outline-none focus:border-primary">
                <option value="preseason">프리시즌</option>
                <option value="season">정규 시즌</option>
              </select>
            </label>
            <label className="text-[10px] font-black text-muted-foreground">
              번호
              <input type="number" min={0} max={9999} value={seasonNo} onChange={(event) => setSeasonNo(Math.max(0, Number.parseInt(event.target.value || '0', 10) || 0))} className="mt-1 w-full rounded-2xl border border-border bg-background px-3 py-2 text-xs font-black text-foreground outline-none focus:border-primary" />
            </label>
            <label className="text-[10px] font-black text-muted-foreground">
              표시 이름
              <input value={seasonName} onChange={(event) => setSeasonName(event.target.value.slice(0, 80))} placeholder={seasonKind === 'season' ? `시즌 ${seasonNo}` : `프리시즌 ${seasonNo}`} className="mt-1 w-full rounded-2xl border border-border bg-background px-3 py-2 text-xs font-black text-foreground outline-none focus:border-primary" />
            </label>
            <div className="grid grid-cols-3 gap-1.5 self-end">
              <button type="button" onClick={() => updateArenaSeason('setup')} disabled={seasonSaving} className="rounded-2xl border border-border bg-secondary/70 px-3 py-2 text-[10px] font-black text-foreground disabled:opacity-50">준비</button>
              <button type="button" onClick={() => updateArenaSeason('active')} disabled={seasonSaving} className="rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[10px] font-black text-emerald-700 disabled:opacity-50 dark:border-emerald-300/20 dark:bg-emerald-300/10 dark:text-emerald-100">열기</button>
              <button type="button" onClick={() => updateArenaSeason('closed')} disabled={seasonSaving} className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-[10px] font-black text-rose-700 disabled:opacity-50 dark:border-rose-300/20 dark:bg-rose-300/10 dark:text-rose-100">닫기</button>
            </div>
          </div>
          <p className="mt-2 text-[10px] font-bold text-muted-foreground">
            현재 ID: {arenaOps?.season?.id || '-'} · 저장 출처: {arenaOps?.season?.source || 'env_default'}
          </p>
        </div>
        <div className="mt-4 rounded-[1.75rem] border border-border bg-card/70 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-black text-foreground">Worker 상태</h3>
              <p className="mt-1 text-[11px] font-bold text-muted-foreground">
                PM2 업타임이 아니라 DB에 마지막으로 기록된 heartbeat입니다. 값이 주기적으로 0초대로 돌아가는 것은 정상 갱신입니다.
              </p>
            </div>
            <span className={`rounded-full px-2.5 py-1 text-[10px] font-black ${arenaOps?.worker_health?.ok ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-300/10 dark:text-emerald-100' : 'bg-rose-50 text-rose-700 dark:bg-rose-300/10 dark:text-rose-100'}`}>
              {arenaOps?.worker_health?.ok ? 'ONLINE' : 'STALE'}
            </span>
          </div>
          {Array.isArray(arenaOps?.worker_health?.items) && arenaOps.worker_health.items.length > 0 ? (
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {arenaOps.worker_health.items.map((worker: any) => (
                <div key={worker.worker_id} className="rounded-2xl bg-secondary/55 px-3 py-2">
                  <p className="truncate text-xs font-black text-foreground">{worker.worker_id}</p>
                  <p className="mt-1 text-[10px] font-bold text-muted-foreground">
                    {worker.process_role} · heartbeat {worker.seconds_since_heartbeat == null ? '없음' : `${worker.seconds_since_heartbeat}초 전`}
                  </p>
                  <p className="mt-1 text-[10px] font-bold text-muted-foreground">
                    pid {worker.payload?.pid || '-'} · uptime {worker.payload?.uptime_sec == null ? '-' : `${worker.payload.uptime_sec}초`}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-3 rounded-2xl bg-secondary/45 px-3 py-3 text-center text-[11px] font-bold text-muted-foreground">
              아직 기록된 아레나 worker heartbeat가 없습니다.
            </p>
          )}
        </div>
        <div className="mt-4 grid gap-2 md:grid-cols-5">
          {[
            ['stats', '통계 스냅샷 재생성', '재생성 중...'],
            ['rankings', '랭킹 스냅샷 재생성', '재생성 중...'],
            ['prune', '오래된 리플레이 정리', '정리 중...'],
            ['recoverCup', '컵 큐 복구', '복구 중...'],
            ['recoverQuick', '빠른대전 큐 복구', '복구 중...']
          ].map(([kind, label, pending]) => (
            <button
              key={kind}
              type="button"
              onClick={() => runArenaAdminAction(kind as ArenaAdminAction)}
              disabled={Boolean(actionLoading)}
              className="cute-wiggle-hover rounded-2xl border border-border bg-secondary/70 px-3 py-2.5 text-xs font-black text-foreground disabled:opacity-50"
            >
              {actionLoading === kind ? pending : label}
            </button>
          ))}
        </div>

        <div className="mt-5 rounded-[1.75rem] border border-border bg-card/70 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-black text-foreground">운영 토글</h3>
              <p className="mt-1 text-[11px] font-bold text-muted-foreground">
                변경값은 저장 설정으로 반영되며, 매치 계산 경로에서는 캐시된 값만 읽습니다.
              </p>
            </div>
            <span className="rounded-full bg-secondary px-2.5 py-1 text-[10px] font-black text-muted-foreground">
              {arenaOps?.kill_switches?.source || 'env_default'}
            </span>
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-5">
            {[
              ['quick_match_enabled', '빠른대전', arenaOps?.kill_switches?.quick_match_enabled],
              ['cup_enabled', '8인 컵', arenaOps?.kill_switches?.cup_enabled],
              ['ranked_rating_writes', 'MMR 쓰기', arenaOps?.kill_switches?.ranked_rating_writes],
              ['replay_writes', '리플레이 저장', arenaOps?.kill_switches?.replay_writes],
              ['spectator_public_enabled', '링크 관전', arenaOps?.kill_switches?.spectator_public_enabled]
            ].map(([flag, label, enabled]) => (
              <button
                key={String(flag)}
                type="button"
                onClick={() => toggleArenaFlag(String(flag), !enabled)}
                disabled={Boolean(flagLoading)}
                className={`cute-wiggle-hover rounded-2xl border px-3 py-3 text-left text-xs font-black disabled:opacity-50 ${
                  enabled
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-300/20 dark:bg-emerald-300/10 dark:text-emerald-100'
                    : 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-300/20 dark:bg-rose-300/10 dark:text-rose-100'
                }`}
              >
                <span className="block">{label}</span>
                <span className="mt-1 block text-[10px] opacity-80">{flagLoading === flag ? '변경 중...' : enabled ? '활성' : '비활성'}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="cute-surface rounded-[2rem] p-5">
          <div className="flex items-center justify-between gap-3">
            <h3 className="flex items-center gap-2 text-sm font-black text-foreground">
              <Activity className="h-4 w-4 text-primary" />
              빠른대전 큐 현황
            </h3>
            <span className="rounded-full bg-secondary px-2.5 py-1 text-[10px] font-black text-muted-foreground">
              {arenaQuick?.enabled ? '활성' : '비활성'}
            </span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
            {['waiting', 'matching', 'matched', 'cancelled', 'expired'].map((key) => (
              <div key={key} className="rounded-2xl bg-white/70 px-3 py-2 text-center dark:bg-white/10">
                <p className="text-[10px] font-bold text-muted-foreground">{{
                  waiting: '대기',
                  matching: '매칭중',
                  matched: '완료',
                  cancelled: '취소',
                  expired: '만료'
                }[key]}</p>
                <p className="mt-1 text-sm font-black text-foreground">{getQueueValue(arenaQuick, key)}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="cute-surface rounded-[2rem] p-5">
          <div className="flex items-center justify-between gap-3">
            <h3 className="flex items-center gap-2 text-sm font-black text-foreground">
              <Trophy className="h-4 w-4 text-primary" />
              8인 컵 운영 현황
            </h3>
            <span className="rounded-full bg-secondary px-2.5 py-1 text-[10px] font-black text-muted-foreground">
              총 {(arenaCups?.cups_total || 0).toLocaleString()}회
            </span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
            {['waiting', 'matching', 'matched', 'cancelled', 'expired'].map((key) => (
              <div key={key} className="rounded-2xl bg-white/70 px-3 py-2 text-center dark:bg-white/10">
                <p className="text-[10px] font-bold text-muted-foreground">{{
                  waiting: '대기',
                  matching: '매칭중',
                  matched: '완료',
                  cancelled: '취소',
                  expired: '만료'
                }[key]}</p>
                <p className="mt-1 text-sm font-black text-foreground">{getQueueValue(arenaCups, key)}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="cute-surface rounded-[2rem] p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-black text-foreground">
              <BarChart3 className="h-4 w-4 text-primary" />
              아레나 밸런스 통계
            </h3>
            <p className="mt-1 text-xs font-bold text-muted-foreground">유저 승패, 클래스, 스킬, 스탯 조합별 저장 스냅샷입니다.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-secondary px-2.5 py-1 text-[10px] font-black text-muted-foreground">
              {arenaStats?.source || 'snapshot'}
            </span>
            <button
              type="button"
              onClick={exportArenaStatsCsv}
              disabled={statItems.length === 0}
              className="cute-wiggle-hover inline-flex items-center gap-1.5 rounded-2xl border border-border bg-secondary/70 px-3 py-2 text-[10px] font-black text-foreground disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5" />
              CSV
            </button>
            <button
              type="button"
              onClick={exportArenaDiagnosticsJson}
              className="cute-wiggle-hover inline-flex items-center gap-1.5 rounded-2xl bg-primary px-3 py-2 text-[10px] font-black text-primary-foreground shadow-sm"
            >
              <Download className="h-3.5 w-3.5" />
              진단 JSON
            </button>
          </div>
        </div>

        <div className="mt-4 rounded-3xl border border-border bg-card/60 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h4 className="text-xs font-black text-foreground">통계 필터</h4>
              <p className="mt-1 text-[11px] font-bold text-muted-foreground">
                화면과 CSV 내보내기에만 적용됩니다. 서버 조회는 추가로 발생하지 않습니다.
              </p>
            </div>
            <span className="rounded-full bg-secondary px-2.5 py-1 text-[10px] font-black text-muted-foreground">
              {filteredStatItems.length.toLocaleString()} / {statItems.length.toLocaleString()}개
            </span>
          </div>
          <div className="mt-3 grid gap-2 lg:grid-cols-[1fr_1fr_0.7fr_1fr]">
            <select
              value={statTypeFilter}
              onChange={(event) => setStatTypeFilter(event.target.value)}
              className="rounded-2xl border border-border bg-secondary/50 px-3 py-2 text-xs font-black text-foreground outline-none focus:ring-2 focus:ring-primary/30"
            >
              {['all', ...statTypeOrder].map((type) => (
                <option key={type} value={type}>{statTypeLabels[type]}</option>
              ))}
            </select>
            <select
              value={reviewFilter}
              onChange={(event) => setReviewFilter(event.target.value as ArenaStatFilterReview)}
              className="rounded-2xl border border-border bg-secondary/50 px-3 py-2 text-xs font-black text-foreground outline-none focus:ring-2 focus:ring-primary/30"
            >
              <option value="all">전체 판정</option>
              <option value="watch">관찰 필요</option>
              <option value="over">상향 과다 후보</option>
              <option value="under">상향 필요 후보</option>
              <option value="low_sample">표본 부족</option>
              <option value="normal">정상 범위</option>
            </select>
            <select
              value={String(minSampleFilter)}
              onChange={(event) => setMinSampleFilter(Number(event.target.value))}
              className="rounded-2xl border border-border bg-secondary/50 px-3 py-2 text-xs font-black text-foreground outline-none focus:ring-2 focus:ring-primary/30"
            >
              <option value="0">표본 전체</option>
              <option value="10">표본 10+</option>
              <option value="30">표본 30+</option>
              <option value="80">표본 80+</option>
            </select>
            <input
              value={statSearch}
              onChange={(event) => setStatSearch(event.target.value)}
              className="rounded-2xl border border-border bg-secondary/50 px-3 py-2 text-xs font-black text-foreground outline-none focus:ring-2 focus:ring-primary/30"
              placeholder="지표 검색"
            />
          </div>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="rounded-3xl border border-white/70 bg-white/64 p-4 dark:border-white/10 dark:bg-white/10">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-black text-muted-foreground">운영 위험 신호</p>
                <h4 className="mt-1 text-sm font-black text-foreground">승률 이상치</h4>
              </div>
              <AlertTriangle className="h-5 w-5 text-amber-500" />
            </div>
            <div className="mt-3 space-y-2">
              {balanceOutliers.length === 0 ? (
                <p className="rounded-2xl bg-secondary/45 px-3 py-3 text-center text-[11px] font-bold text-muted-foreground">
                  표본 10 이상 기준으로 뚜렷한 이상치가 없습니다.
                </p>
              ) : balanceOutliers.map((item: any) => (
                <div key={`outlier-${item.snapshot_type}-${item.metric_key}`} className="rounded-2xl bg-card/80 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="min-w-0 truncate text-[11px] font-black text-foreground">{item.label || item.metric_key}</p>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black ${getWinRateTone(Number(item.win_rate || 0), Number(item.sample_count || 0))}`}>
                      {toPercent(item.win_rate)}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-secondary">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(4, Math.min(100, Math.round(Number(item.win_rate || 0) * 100)))}%` }} />
                  </div>
                  <p className="mt-1 text-[10px] font-bold text-muted-foreground">표본 {Number(item.sample_count || 0).toLocaleString()} · {item.snapshot_type}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-white/70 bg-white/64 p-4 dark:border-white/10 dark:bg-white/10">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-black text-muted-foreground">표본 집중도</p>
                <h4 className="mt-1 text-sm font-black text-foreground">많이 쓰이는 조합</h4>
              </div>
              <Gauge className="h-5 w-5 text-primary" />
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {topSamples.length === 0 ? (
                <p className="rounded-2xl bg-secondary/45 px-3 py-3 text-center text-[11px] font-bold text-muted-foreground sm:col-span-2">
                  스냅샷 데이터가 없습니다.
                </p>
              ) : topSamples.map((item: any) => {
                const maxSample = Math.max(...topSamples.map((sample: any) => Number(sample.sample_count || 0)), 1);
                return (
                  <div key={`sample-${item.snapshot_type}-${item.metric_key}`} className="rounded-2xl bg-card/80 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="min-w-0 truncate text-[11px] font-black text-foreground">{item.label || item.metric_key}</p>
                      <span className="shrink-0 text-[10px] font-black text-primary">{Number(item.sample_count || 0).toLocaleString()}</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-secondary">
                      <div className="h-full rounded-full bg-gradient-to-r from-sky-300 via-primary to-emerald-300" style={{ width: `${Math.max(6, Math.round((Number(item.sample_count || 0) / maxSample) * 100))}%` }} />
                    </div>
                    <p className="mt-1 text-[10px] font-bold text-muted-foreground">{item.snapshot_type} · 승률 {toPercent(item.win_rate)}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-3">
          {[
            ['nerf_candidates', '하향 검토 후보', actionCandidates.nerf_candidates, '승률이 높은 지표입니다. 같은 클래스/스킬/전술이 반복되는지 확인하세요.'],
            ['buff_candidates', '상향 검토 후보', actionCandidates.buff_candidates, '승률이 낮은 지표입니다. 사용률과 패배 원인을 함께 확인하세요.'],
            ['watchlist', '관찰 목록', actionCandidates.watchlist, '표본이 부족하거나 경계선에 가까운 지표입니다. 즉시 조정보다 추적이 적합합니다.']
          ].map(([key, title, items, description]) => (
            <div key={String(key)} className="rounded-3xl border border-white/70 bg-white/64 p-4 dark:border-white/10 dark:bg-white/10">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h4 className="text-xs font-black text-foreground">{String(title)}</h4>
                  <p className="mt-1 text-[10px] font-bold leading-relaxed text-muted-foreground">{String(description)}</p>
                </div>
                <span className="rounded-full bg-secondary px-2.5 py-1 text-[10px] font-black text-muted-foreground">{(items as any[]).length}</span>
              </div>
              <div className="mt-3 space-y-2">
                {(items as any[]).length === 0 ? (
                  <p className="rounded-2xl bg-secondary/45 px-3 py-3 text-center text-[11px] font-bold text-muted-foreground">해당 후보가 없습니다.</p>
                ) : (items as any[]).slice(0, 5).map((item: any) => {
                  const confidence = getStatConfidence(item);
                  return (
                    <div key={`${key}-${item.snapshot_type}-${item.metric_key}`} className="rounded-2xl bg-card/80 px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="min-w-0 truncate text-[11px] font-black text-foreground">{item.label || item.metric_key}</p>
                        <span className="shrink-0 text-[10px] font-black text-primary">{toPercent(item.win_rate)}</span>
                      </div>
                      <div className="mt-1 flex items-center justify-between gap-2 text-[10px] font-bold text-muted-foreground">
                        <span>표본 {Number(item.sample_count || 0).toLocaleString()}</span>
                        <span className={`rounded-full px-2 py-0.5 font-black ${confidence.tone}`}>{confidence.label}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          {statTypeOrder.map((type) => {
            const items = (statGroups.get(type) || []).slice(0, 8);
            return (
              <div key={type} className="rounded-3xl border border-white/70 bg-white/64 p-4 dark:border-white/10 dark:bg-white/10">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-black text-foreground">{statTypeLabels[type]}</h4>
                  <span className="text-[10px] font-bold text-muted-foreground">{items.length}개</span>
                </div>
                <div className="mt-3 space-y-2">
                  {items.length === 0 ? (
                    <p className="py-4 text-center text-[11px] font-bold text-muted-foreground">스냅샷 데이터가 없습니다.</p>
                  ) : items.map((item: any) => {
                    const confidence = getStatConfidence(item);
                    const review = getStatReview(item);
                    return (
                      <div key={`${item.snapshot_type}-${item.metric_key}`} className="rounded-2xl bg-white/75 px-3 py-2 dark:bg-white/10">
                        <div className="flex items-center justify-between gap-2">
                          <p className="min-w-0 truncate text-[11px] font-black text-foreground">{item.label || item.metric_key}</p>
                          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black ${getWinRateTone(Number(item.win_rate || 0), Number(item.sample_count || 0))}`}>
                            {toPercent(item.win_rate)}
                          </span>
                        </div>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-secondary/70">
                          <div className="h-full rounded-full bg-gradient-to-r from-sky-300 via-primary to-rose-300" style={{ width: `${Math.max(4, Math.min(100, Math.round(Number(item.win_rate || 0) * 100)))}%` }} />
                        </div>
                        <div className="mt-1 flex items-center justify-between gap-2 text-[10px] font-bold text-muted-foreground">
                          <span>표본 {item.sample_count || 0}</span>
                          <span>{item.wins || 0}승 {item.losses || 0}패 {item.draws || 0}무</span>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          <span className={`rounded-full px-2 py-0.5 text-[9px] font-black ${confidence.tone}`}>{confidence.label}</span>
                          <span className="rounded-full bg-secondary px-2 py-0.5 text-[9px] font-black text-muted-foreground">{review.flag}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="cute-surface rounded-[2rem] p-5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="flex items-center gap-2 text-sm font-black text-foreground">
            <ShieldCheck className="h-4 w-4 text-primary" />
            최근 관리자 작업
          </h3>
          <span className="text-[10px] font-bold text-muted-foreground">{arenaJobs.length}개</span>
        </div>
        <div className="mt-3 space-y-2">
          {arenaJobs.length === 0 ? (
            <p className="py-4 text-center text-[11px] font-bold text-muted-foreground">등록된 작업이 없습니다.</p>
          ) : arenaJobs.map((job: any) => (
            <div key={job.id} className="flex items-center justify-between gap-2 rounded-2xl bg-white/70 px-3 py-2 dark:bg-white/10">
              <div className="min-w-0">
                <p className="truncate text-[11px] font-black text-foreground">#{job.id} · {job.job_type}</p>
                <p className="text-[10px] font-bold text-muted-foreground">
                  {job.error_message || (job.finished_at ? formatLocalDateTime(job.finished_at) : '대기/실행 중')}
                </p>
              </div>
              <span className="shrink-0 rounded-full bg-secondary px-2 py-1 text-[10px] font-black text-muted-foreground">{job.status}</span>
            </div>
          ))}
        </div>
      </div>
        </>
      )}
    </section>
  );
};



