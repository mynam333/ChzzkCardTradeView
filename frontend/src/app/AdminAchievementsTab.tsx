'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Award, Edit3, Eye, EyeOff, Gift, Plus, RefreshCw, Save } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { useApp } from './AppContext';
import type { AchievementCategory, AchievementReward, AchievementRewardType, AchievementTier, AdminAchievement, UserTitle } from '@/lib/types';

type ConditionForm = { metric: string; target: number };

const metricOptions = [
  'login.count',
  'login.daily.count',
  'card.acquired.count',
  'card.sold.count',
  'card.fused.count',
  'card.star.5.count',
  'trade.completed.count',
  'market.listed.count',
  'market.purchase.count',
  'market.sale.count',
  'market.bid.count',
  'minigame.success.count',
  'minigame.success.quiz.count',
  'minigame.success.puzzle.count',
  'minigame.success.match.count',
  'minigame.success.value_duel.count',
  'minigame.success.crop_detective.count',
  'minigame.perfect.count',
  'minigame.speed_bonus.count',
  'shop.purchase.count',
  'cosmetic.equip.count',
  'coupon.claim.count',
  'profile.representative.set',
  'profile.status_message.set',
  'inventory.card_count',
  'inventory.unique_streamer_count',
  'inventory.star.5.count',
  'inventory.locked_count',
  'inventory.hidden_count',
  'inventory.favorite_count',
  'user.title_count',
  'user.cosmetic_count',
  'user.point_balance'
];

const categories: AchievementCategory[] = ['start', 'collection', 'growth', 'economy', 'trade', 'market', 'minigame', 'community', 'streamer', 'event', 'hidden'];
const tiers: AchievementTier[] = ['bronze', 'silver', 'gold', 'platinum', 'legendary', 'event'];
const rewardTypes: AchievementRewardType[] = ['point', 'card', 'cosmetic', 'minigame_ticket', 'free_draw_ticket', 'title'];

const categoryLabels: Record<AchievementCategory, string> = {
  start: '시작',
  collection: '수집',
  growth: '성장',
  economy: '경제',
  trade: '교환',
  market: '마켓',
  minigame: '미니게임',
  community: '커뮤니티',
  streamer: '스트리머',
  event: '이벤트',
  hidden: '숨김'
};

const emptyReward = (): AchievementReward => ({ type: 'point', points: 1000 });

const emptyForm = {
  id: 0,
  code: '',
  name: '',
  description: '',
  category: 'start' as AchievementCategory,
  tier: 'bronze' as AchievementTier,
  icon: 'Award',
  icon_color: '#2563eb',
  is_active: true,
  is_hidden: false,
  hidden_hint: '',
  sort_order: 100,
  progress_mode: 'incremental',
  repeat_policy: 'once',
  claim_policy: 'manual',
  criteria_type: 'stat' as 'stat' | 'all',
  conditions: [{ metric: 'card.acquired.count', target: 1 }] as ConditionForm[],
  rewards: [emptyReward()] as AchievementReward[],
  confirm_hidden_economic_reward: false,
  confirm_repeat_reward: false
};

const parseJsonValue = <T,>(value: unknown, fallback: T): T => {
  if (!value) return fallback;
  if (typeof value === 'object') return value as T;
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    return fallback;
  }
};

const normalizeReward = (reward: AchievementReward): AchievementReward => {
  if (reward.type === 'point') return { type: 'point', points: Math.max(1, Math.floor(Number(reward.points || 0))) };
  if (reward.type === 'card') return { type: 'card', channel_id: String(reward.channel_id || '').trim(), quantity: Math.max(1, Math.floor(Number(reward.quantity || 1))) };
  if (reward.type === 'cosmetic') return { type: 'cosmetic', item_id: Math.max(1, Math.floor(Number(reward.item_id || 0))), quantity: Math.max(1, Math.floor(Number(reward.quantity || 1))) };
  if (reward.type === 'title') return { type: 'title', title_id: Math.floor(Number(reward.title_id || 0)) };
  return { type: reward.type, quantity: Math.max(1, Math.floor(Number(reward.quantity || 1))) };
};

export const AdminAchievementsTab: React.FC = () => {
  const { toast } = useApp();
  const [items, setItems] = useState<AdminAchievement[]>([]);
  const [titles, setTitles] = useState<UserTitle[]>([]);
  const [form, setForm] = useState({ ...emptyForm });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const criteriaJson = useMemo(() => {
    const conditions = form.conditions
      .filter((condition) => condition.metric && condition.target > 0)
      .map((condition) => ({ type: 'stat', metric: condition.metric, target: Math.floor(Number(condition.target || 1)) }));
    if (form.criteria_type === 'all') return { type: 'all', conditions: conditions.slice(0, 8) };
    return conditions[0] || { type: 'stat', metric: 'card.acquired.count', target: 1 };
  }, [form.conditions, form.criteria_type]);

  const fetchAchievements = async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/admin/achievements');
      const data = await res.json().catch(() => ({ items: [] }));
      if (!res.ok) {
        toast(data.message || '업적 목록을 불러오지 못했습니다.', 'error');
        return;
      }
      setItems(data.items || []);
    } finally {
      setLoading(false);
    }
  };

  const fetchTitles = async () => {
    try {
      const res = await apiFetch('/admin/titles');
      if (res.ok) setTitles(await res.json());
    } catch {
      // 칭호 목록 조회 실패는 업적 목록 관리를 막지 않습니다.
    }
  };

  useEffect(() => {
    void fetchAchievements();
    void fetchTitles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resetForm = () => setForm({ ...emptyForm, rewards: [emptyReward()], conditions: [{ metric: 'card.acquired.count', target: 1 }] });

  const editAchievement = (achievement: AdminAchievement) => {
    const criteria = parseJsonValue<any>(achievement.criteria_json, { type: 'stat', metric: 'card.acquired.count', target: 1 });
    const rewards = parseJsonValue<AchievementReward[]>(achievement.rewards_json, []);
    const conditions = criteria.type === 'all'
      ? (Array.isArray(criteria.conditions) ? criteria.conditions : []).map((condition: any) => ({
        metric: String(condition.metric || 'card.acquired.count'),
        target: Math.max(1, Math.floor(Number(condition.target || 1)))
      }))
      : [{ metric: String(criteria.metric || 'card.acquired.count'), target: Math.max(1, Math.floor(Number(criteria.target || 1))) }];
    setForm({
      ...emptyForm,
      id: achievement.id,
      code: achievement.code,
      name: achievement.name,
      description: achievement.description || '',
      category: achievement.category,
      tier: achievement.tier,
      icon: achievement.icon || 'Award',
      icon_color: achievement.icon_color || '#2563eb',
      is_active: achievement.is_active,
      is_hidden: achievement.is_hidden,
      hidden_hint: achievement.hidden_hint || '',
      sort_order: Number(achievement.sort_order || 0),
      progress_mode: achievement.progress_mode || (criteria.type === 'all' ? 'composite' : 'incremental'),
      repeat_policy: achievement.repeat_policy || 'once',
      claim_policy: achievement.claim_policy || 'manual',
      criteria_type: criteria.type === 'all' ? 'all' : 'stat',
      conditions: conditions.length > 0 ? conditions.slice(0, 8) : [{ metric: 'card.acquired.count', target: 1 }],
      rewards: rewards.length > 0 ? rewards : []
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const updateCondition = (index: number, patch: Partial<ConditionForm>) => {
    setForm((current) => ({
      ...current,
      conditions: current.conditions.map((condition, i) => i === index ? { ...condition, ...patch } : condition)
    }));
  };

  const updateReward = (index: number, patch: Partial<AchievementReward>) => {
    setForm((current) => ({
      ...current,
      rewards: current.rewards.map((reward, i) => {
        if (i !== index) return reward;
        const nextType = patch.type || reward.type;
        const next = { ...reward, ...patch, type: nextType } as AchievementReward;
        if (patch.type) {
          if (nextType === 'point') return { type: 'point', points: 1000 };
          if (nextType === 'card') return { type: 'card', channel_id: '', quantity: 1 };
          if (nextType === 'cosmetic') return { type: 'cosmetic', item_id: 0, quantity: 1 };
          if (nextType === 'title') return { type: 'title', title_id: 0 };
          return { type: nextType, quantity: 1 };
        }
        return next;
      })
    }));
  };

  const saveAchievement = async () => {
    if (!form.code.trim()) return toast('업적 코드를 입력해 주세요.', 'warning');
    if (!form.name.trim()) return toast('업적 이름을 입력해 주세요.', 'warning');
    const payload = {
      code: form.code,
      name: form.name,
      description: form.description,
      category: form.category,
      tier: form.tier,
      icon: form.icon,
      icon_color: form.icon_color,
      is_active: form.is_active,
      is_hidden: form.is_hidden,
      hidden_hint: form.hidden_hint,
      sort_order: form.sort_order,
      repeat_policy: form.repeat_policy,
      claim_policy: form.claim_policy,
      progress_mode: form.criteria_type === 'all' ? 'composite' : form.progress_mode,
      criteria_json: criteriaJson,
      rewards_json: form.rewards.map(normalizeReward),
      confirm_hidden_economic_reward: form.confirm_hidden_economic_reward,
      confirm_repeat_reward: form.confirm_repeat_reward
    };
    setSaving(true);
    try {
      const res = await apiFetch(form.id ? `/admin/achievements/${form.id}` : '/admin/achievements', {
        method: form.id ? 'PUT' : 'POST',
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(data.message || '업적 저장에 실패했습니다.', 'error');
        return;
      }
      toast(data.message || '업적을 저장했습니다.', 'success');
      resetForm();
      await fetchAchievements();
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="space-y-5">
      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="flex items-center gap-1.5 text-sm font-bold">
              <Award className="h-4 w-4 text-primary" /> {form.id ? '업적 수정' : '새 업적 생성'}
            </h3>
            <p className="mt-1 text-[11px] text-muted-foreground">조건은 서버 허용 메트릭만 저장됩니다.</p>
          </div>
          <div className="flex gap-2">
            {form.id > 0 && (
              <button onClick={resetForm} className="rounded-lg bg-secondary px-3 py-2 text-xs font-bold text-muted-foreground hover:text-foreground">
                새 업적
              </button>
            )}
            <button onClick={saveAchievement} disabled={saving} className="flex items-center gap-1 rounded-lg bg-primary px-4 py-2 text-xs font-black text-primary-foreground disabled:opacity-50">
              <Save className="h-3.5 w-3.5" /> {saving ? '저장 중' : '저장'}
            </button>
          </div>
        </div>

        <div className="grid gap-3 lg:grid-cols-4">
          <Field label="업적 코드">
            <input value={form.code} disabled={form.id > 0} onChange={(e) => setForm({ ...form, code: e.target.value })} className="field-input disabled:opacity-60" placeholder="first_card" />
          </Field>
          <Field label="업적 이름">
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="field-input" placeholder="첫 소환" />
          </Field>
          <Field label="분류">
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as AchievementCategory })} className="field-input">
              {categories.map((category) => <option key={category} value={category}>{categoryLabels[category]}</option>)}
            </select>
          </Field>
          <Field label="등급">
            <select value={form.tier} onChange={(e) => setForm({ ...form, tier: e.target.value as AchievementTier })} className="field-input">
              {tiers.map((tier) => <option key={tier} value={tier}>{tier}</option>)}
            </select>
          </Field>
        </div>

        <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_160px_160px_140px]">
          <Field label="설명">
            <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="field-input" placeholder="업적 설명" />
          </Field>
          <Field label="아이콘">
            <input value={form.icon} onChange={(e) => setForm({ ...form, icon: e.target.value })} className="field-input" placeholder="Award" />
          </Field>
          <Field label="아이콘 색상">
            <input value={form.icon_color} onChange={(e) => setForm({ ...form, icon_color: e.target.value })} className="field-input font-mono" />
          </Field>
          <Field label="정렬값">
            <input type="number" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })} className="field-input" />
          </Field>
        </div>

        <div className="mt-3 grid gap-3 lg:grid-cols-[180px_180px_1fr]">
          <Field label="진행 방식">
            <select value={form.progress_mode} onChange={(e) => setForm({ ...form, progress_mode: e.target.value })} className="field-input" disabled={form.criteria_type === 'all'}>
              <option value="incremental">누적 이벤트</option>
              <option value="snapshot">현재 상태</option>
              <option value="composite">복합</option>
            </select>
          </Field>
          <Field label="반복 정책">
            <select value={form.repeat_policy} onChange={(e) => setForm({ ...form, repeat_policy: e.target.value })} className="field-input">
              <option value="once">1회</option>
              <option value="daily">매일</option>
              <option value="weekly">매주</option>
              <option value="monthly">매월</option>
              <option value="seasonal">시즌</option>
              <option value="repeatable">반복</option>
            </select>
          </Field>
          <Field label="숨김 힌트">
            <input value={form.hidden_hint} onChange={(e) => setForm({ ...form, hidden_hint: e.target.value })} className="field-input" placeholder="숨김 업적 힌트" />
          </Field>
        </div>

        <div className="mt-4 flex flex-wrap gap-3">
          <label className="flex items-center gap-2 rounded-xl border border-border bg-secondary/30 px-3 py-2 text-xs font-bold">
            <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
            활성
          </label>
          <label className="flex items-center gap-2 rounded-xl border border-border bg-secondary/30 px-3 py-2 text-xs font-bold">
            <input type="checkbox" checked={form.is_hidden} onChange={(e) => setForm({ ...form, is_hidden: e.target.checked })} />
            숨김 업적
          </label>
          <label className="flex items-center gap-2 rounded-xl border border-border bg-secondary/30 px-3 py-2 text-xs font-bold">
            <input type="checkbox" checked={form.confirm_hidden_economic_reward} onChange={(e) => setForm({ ...form, confirm_hidden_economic_reward: e.target.checked })} />
            숨김 고가 보상 확인
          </label>
          <label className="flex items-center gap-2 rounded-xl border border-border bg-secondary/30 px-3 py-2 text-xs font-bold">
            <input type="checkbox" checked={form.confirm_repeat_reward} onChange={(e) => setForm({ ...form, confirm_repeat_reward: e.target.checked })} />
            반복 보상 확인
          </label>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-bold">달성 조건</h3>
            <select value={form.criteria_type} onChange={(e) => setForm({ ...form, criteria_type: e.target.value as 'stat' | 'all' })} className="rounded-lg border border-border bg-secondary/40 px-3 py-2 text-xs font-bold">
              <option value="stat">단일 조건</option>
              <option value="all">모든 조건</option>
            </select>
          </div>
          <div className="space-y-2">
            {form.conditions.map((condition, index) => (
              <div key={index} className="grid gap-2 sm:grid-cols-[1fr_120px_auto]">
                <select value={condition.metric} onChange={(e) => updateCondition(index, { metric: e.target.value })} className="field-input">
                  {metricOptions.map((metric) => <option key={metric} value={metric}>{metric}</option>)}
                </select>
                <input type="number" min={1} value={condition.target} onChange={(e) => updateCondition(index, { target: Number(e.target.value) })} className="field-input" />
                <button disabled={form.conditions.length <= 1} onClick={() => setForm({ ...form, conditions: form.conditions.filter((_, i) => i !== index) })} className="rounded-lg bg-red-500/10 px-3 py-2 text-xs font-bold text-red-500 disabled:opacity-40">
                  삭제
                </button>
              </div>
            ))}
          </div>
          {form.criteria_type === 'all' && form.conditions.length < 8 && (
            <button onClick={() => setForm({ ...form, conditions: [...form.conditions, { metric: 'login.count', target: 1 }] })} className="mt-3 flex items-center gap-1 rounded-lg bg-secondary px-3 py-2 text-xs font-bold text-muted-foreground hover:text-foreground">
              <Plus className="h-3.5 w-3.5" /> 조건 추가
            </button>
          )}
        </div>

        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="flex items-center gap-1.5 text-sm font-bold"><Gift className="h-4 w-4" /> 보상</h3>
            <button onClick={() => setForm({ ...form, rewards: [...form.rewards, emptyReward()] })} className="flex items-center gap-1 rounded-lg bg-secondary px-3 py-2 text-xs font-bold text-muted-foreground hover:text-foreground">
              <Plus className="h-3.5 w-3.5" /> 추가
            </button>
          </div>
          <div className="space-y-2">
            {form.rewards.map((reward, index) => (
              <div key={index} className="grid gap-2 sm:grid-cols-[160px_1fr_110px_auto]">
                <select value={reward.type} onChange={(e) => updateReward(index, { type: e.target.value as AchievementRewardType })} className="field-input">
                  {rewardTypes.map((type) => <option key={type} value={type}>{type}</option>)}
                </select>
                {reward.type === 'point' && <input type="number" value={reward.points || 0} onChange={(e) => updateReward(index, { points: Number(e.target.value) })} className="field-input" placeholder="포인트" />}
                {reward.type === 'card' && <input value={reward.channel_id || ''} onChange={(e) => updateReward(index, { channel_id: e.target.value })} className="field-input" placeholder="스트리머 채널 ID" />}
                {reward.type === 'cosmetic' && <input type="number" value={reward.item_id || 0} onChange={(e) => updateReward(index, { item_id: Number(e.target.value) })} className="field-input" placeholder="아이템 ID" />}
                {reward.type === 'title' && (
                  titles.length > 0 ? (
                    <select value={reward.title_id || 0} onChange={(e) => updateReward(index, { title_id: Number(e.target.value) })} className="field-input">
                      <option value={0}>칭호 선택</option>
                      {titles.map((title) => <option key={title.id} value={title.id}>{title.name}</option>)}
                    </select>
                  ) : (
                    <span className="field-input flex items-center text-muted-foreground">칭호 탭에서 먼저 추가</span>
                  )
                )}
                {(reward.type === 'minigame_ticket' || reward.type === 'free_draw_ticket') && <span className="field-input flex items-center text-muted-foreground">티켓 수량</span>}
                {reward.type !== 'point' && reward.type !== 'title'
                  ? <input type="number" min={1} value={reward.quantity || 1} onChange={(e) => updateReward(index, { quantity: Number(e.target.value) })} className="field-input" />
                  : <span />}
                <button onClick={() => setForm({ ...form, rewards: form.rewards.filter((_, i) => i !== index) })} className="rounded-lg bg-red-500/10 px-3 py-2 text-xs font-bold text-red-500">
                  삭제
                </button>
              </div>
            ))}
            {form.rewards.length === 0 && <p className="rounded-xl border border-dashed border-border py-6 text-center text-xs text-muted-foreground">보상 없이 저장됩니다.</p>}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-bold">등록된 업적 ({items.length})</h3>
          <button onClick={fetchAchievements} disabled={loading} className="flex items-center gap-1 rounded-lg bg-secondary px-3 py-2 text-xs font-bold text-muted-foreground hover:text-foreground disabled:opacity-50">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> 새로고침
          </button>
        </div>
        <div className="grid gap-3 xl:grid-cols-2">
          {items.map((achievement) => (
            <div key={achievement.id} className="rounded-xl border border-border bg-secondary/20 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-black text-primary">{achievement.tier}</span>
                    <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-bold text-muted-foreground">{categoryLabels[achievement.category]}</span>
                    {achievement.is_hidden ? <EyeOff className="h-3.5 w-3.5 text-muted-foreground" /> : <Eye className="h-3.5 w-3.5 text-muted-foreground" />}
                  </div>
                  <p className="mt-2 truncate text-sm font-black">{achievement.name}</p>
                  <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">{achievement.code}</p>
                </div>
                <button onClick={() => editAchievement(achievement)} className="rounded-lg bg-card p-2 text-muted-foreground hover:text-foreground" title="수정">
                  <Edit3 className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center text-[10px] font-bold text-muted-foreground">
                <span className="rounded-lg bg-card px-2 py-2">완료 {Number((achievement as any).completed_count || 0).toLocaleString()}</span>
                <span className="rounded-lg bg-card px-2 py-2">수령 {Number((achievement as any).claimed_count || 0).toLocaleString()}</span>
                <span className={`rounded-lg px-2 py-2 ${achievement.is_active ? 'bg-emerald-500/10 text-emerald-500' : 'bg-card'}`}>{achievement.is_active ? '활성' : '비활성'}</span>
              </div>
            </div>
          ))}
          {items.length === 0 && <p className="rounded-xl border border-dashed border-border py-10 text-center text-xs text-muted-foreground xl:col-span-2">등록된 업적이 없습니다.</p>}
        </div>
      </div>
    </section>
  );
};

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <label className="space-y-1 text-xs font-bold">
    <span>{label}</span>
    {children}
  </label>
);
