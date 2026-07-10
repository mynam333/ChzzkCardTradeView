'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Award, Edit3, Eye, EyeOff, Gift, Plus, RefreshCw, Save } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { appIconExists, suggestedIconOptions } from '@/lib/iconLibrary';
import { useApp } from './AppContext';
import type { AchievementCategory, AchievementReward, AchievementRewardType, AchievementTier, AdminAchievement, ShopItem, UserTitle } from '@/lib/types';

type ConditionForm = { metric: string; target: number };

const metricOptions = [
  'login.count',
  'login.daily.count',
  'login.current_streak_days',
  'login.max_streak_days',
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
  'minigame.failure.count',
  'minigame.perfect.count',
  'minigame.speed_bonus.count',
  'shop.purchase.count',
  'cosmetic.equip.count',
  'coupon.claim.count',
  'profile.representative.set',
  'profile.status_message.set',
  'achievement.completed_count',
  'achievement.claimed_count',
  'achievement.claimable_count',
  'inventory.card_count',
  'inventory.unique_streamer_count',
  'inventory.star.0.count',
  'inventory.star.1.count',
  'inventory.star.2.count',
  'inventory.star.3.count',
  'inventory.star.4.count',
  'inventory.star.5.count',
  'inventory.total_star_sum',
  'inventory.unique_star_level_count',
  'inventory.low_serial.1.count',
  'inventory.low_serial.10.count',
  'inventory.low_serial.100.count',
  'inventory.locked_count',
  'inventory.hidden_count',
  'inventory.favorite_count',
  'inventory.cosmetic_equipped_count',
  'inventory.border_equipped_count',
  'inventory.name_effect_equipped_count',
  'user.title_count',
  'user.cosmetic_count',
  'user.unique_cosmetic_count',
  'user.border_cosmetic_count',
  'user.name_effect_cosmetic_count',
  'user.point_balance',
  'user.total_asset',
  'user.free_draw_ticket_balance',
  'user.bonus_free_draw_ticket_balance',
  'user.minigame_ticket_balance',
  'user.account_age_days',
  'market.active_listing_count',
  'market.active_fixed_listing_count',
  'market.active_auction_listing_count',
  'market.sold_listing_count',
  'market.bought_listing_count',
  'market.active_bid_count',
  'market.watch_count',
  'shop.unique_purchase_count',
  'coupon.redeemed_unique_count',
  'community.friend_count'
];

const metricLabels: Record<string, string> = {
  'login.count': '로그인 횟수',
  'login.daily.count': '로그인 일수',
  'login.current_streak_days': '현재 연속 출석일',
  'login.max_streak_days': '최대 연속 출석일',
  'card.acquired.count': '카드 획득 수',
  'card.sold.count': '카드 판매 수',
  'card.fused.count': '카드 한계돌파 횟수',
  'card.star.5.count': '5성 카드 획득 수',
  'trade.completed.count': '교환 완료 수',
  'market.listed.count': '마켓 등록 수',
  'market.purchase.count': '마켓 구매 수',
  'market.sale.count': '마켓 판매 수',
  'market.bid.count': '마켓 입찰 수',
  'minigame.success.count': '미니게임 성공 수',
  'minigame.success.quiz.count': '퀴즈 성공 수',
  'minigame.success.puzzle.count': '퍼즐 성공 수',
  'minigame.success.match.count': '매치 성공 수',
  'minigame.success.value_duel.count': '가치 대결 성공 수',
  'minigame.success.crop_detective.count': '크롭 탐정 성공 수',
  'minigame.failure.count': '미니게임 실패 수',
  'minigame.perfect.count': '미니게임 퍼펙트 수',
  'minigame.speed_bonus.count': '미니게임 속도 보너스 수',
  'shop.purchase.count': '상점 구매 수',
  'cosmetic.equip.count': '코스메틱 장착 수',
  'coupon.claim.count': '쿠폰 사용 수',
  'profile.representative.set': '대표 카드 설정 여부',
  'profile.status_message.set': '상태 메시지 설정 여부',
  'achievement.completed_count': '달성한 업적 수',
  'achievement.claimed_count': '보상 수령한 업적 수',
  'achievement.claimable_count': '보상 수령 대기 업적 수',
  'inventory.card_count': '보유 카드 수',
  'inventory.unique_streamer_count': '보유 스트리머 카드 종류',
  'inventory.star.0.count': '보유 0성 카드 수',
  'inventory.star.1.count': '보유 1성 카드 수',
  'inventory.star.2.count': '보유 2성 카드 수',
  'inventory.star.3.count': '보유 3성 카드 수',
  'inventory.star.4.count': '보유 4성 카드 수',
  'inventory.star.5.count': '보유 5성 카드 수',
  'inventory.total_star_sum': '보유 카드 별 합계',
  'inventory.unique_star_level_count': '보유 카드 등급 종류',
  'inventory.low_serial.1.count': '시리얼 1번 카드 수',
  'inventory.low_serial.10.count': '시리얼 10번 이하 카드 수',
  'inventory.low_serial.100.count': '시리얼 100번 이하 카드 수',
  'inventory.locked_count': '잠금 카드 수',
  'inventory.hidden_count': '숨김 카드 수',
  'inventory.favorite_count': '즐겨찾기 카드 수',
  'inventory.cosmetic_equipped_count': '장착 코스메틱 슬롯 수',
  'inventory.border_equipped_count': '장착 테두리 수',
  'inventory.name_effect_equipped_count': '장착 이름 이펙트 수',
  'user.title_count': '보유 칭호 수',
  'user.cosmetic_count': '보유 코스메틱 수',
  'user.unique_cosmetic_count': '보유 코스메틱 종류',
  'user.border_cosmetic_count': '보유 테두리 코스메틱 수',
  'user.name_effect_cosmetic_count': '보유 이름 이펙트 수',
  'user.point_balance': '보유 포인트',
  'user.total_asset': '총 자산',
  'user.free_draw_ticket_balance': '보유 무료 소환권 수',
  'user.bonus_free_draw_ticket_balance': '보유 추가 무료 소환권 수',
  'user.minigame_ticket_balance': '보유 미니게임 티켓 수',
  'user.account_age_days': '가입 후 경과일',
  'market.active_listing_count': '진행 중인 마켓 판매 등록 수',
  'market.active_fixed_listing_count': '진행 중인 고정가 판매 등록 수',
  'market.active_auction_listing_count': '진행 중인 경매 등록 수',
  'market.sold_listing_count': '마켓 판매 완료 수',
  'market.bought_listing_count': '마켓 구매 완료 수',
  'market.active_bid_count': '진행 중인 경매 입찰 수',
  'market.watch_count': '마켓 관심 알림 수',
  'shop.unique_purchase_count': '구매한 상점 아이템 종류',
  'coupon.redeemed_unique_count': '사용한 쿠폰 종류',
  'community.friend_count': '친구 수'
};

const conditionPreview = (condition: ConditionForm) => {
  const target = Math.max(1, Math.floor(Number(condition.target || 1)));
  const label = metricLabels[condition.metric] || condition.metric;
  if (condition.metric === 'profile.representative.set' || condition.metric === 'profile.status_message.set') return label.replace(' 여부', '');
  if (condition.metric === 'login.current_streak_days') return `연속 출석 ${target.toLocaleString()}일 유지`;
  if (condition.metric === 'login.max_streak_days') return `최대 연속 출석 ${target.toLocaleString()}일 이상`;
  if (condition.metric === 'user.point_balance') return `${target.toLocaleString()}P 이상 보유`;
  if (condition.metric === 'user.total_asset') return `총 자산 ${target.toLocaleString()}P 이상`;
  if (condition.metric === 'user.account_age_days') return `가입 후 ${target.toLocaleString()}일 이상`;
  return `${label} ${target.toLocaleString()} 이상`;
};

const categories: AchievementCategory[] = ['start', 'attendance', 'collection', 'growth', 'economy', 'trade', 'market', 'minigame', 'community', 'streamer', 'event', 'hidden'];
const tiers: AchievementTier[] = ['bronze', 'silver', 'gold', 'platinum', 'legendary', 'event'];
const rewardTypes: AchievementRewardType[] = ['point', 'card', 'cosmetic', 'minigame_ticket', 'free_draw_ticket', 'title'];

const categoryLabels: Record<AchievementCategory, string> = {
  start: '시작',
  attendance: '출석',
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

const rewardTypeLabels: Record<AchievementRewardType, string> = {
  point: '포인트',
  card: '스트리머 카드',
  cosmetic: '코스메틱',
  minigame_ticket: '미니게임 티켓',
  free_draw_ticket: '무료 소환권',
  title: '칭호'
};

const cosmeticTypeLabels: Record<ShopItem['type'], string> = {
  border: '테두리',
  name_effect: '이름 이펙트',
  emote: '아레나 이모트',
  card_frame: '아레나 카드 프레임',
  name_flare: '아레나 이름 연출',
  hit_vfx: '아레나 타격 VFX',
  summon_vfx: '아레나 소환 VFX',
  ready_stamp: '아레나 준비 스탬프',
  nameplate: '아레나 네임플레이트',
  ko_text: '아레나 KO 문구'
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
  limited_winner_count: 0,
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

const normalizeReward = (reward: AchievementReward, cosmetics: ShopItem[] = [], titles: UserTitle[] = []): AchievementReward => {
  if (reward.type === 'point') return { type: 'point', points: Math.max(1, Math.floor(Number(reward.points || 0))) };
  if (reward.type === 'card') return { type: 'card', channel_id: String(reward.channel_id || '').trim(), quantity: Math.max(1, Math.floor(Number(reward.quantity || 1))) };
  if (reward.type === 'cosmetic') {
    const itemId = Math.max(1, Math.floor(Number(reward.item_id || 0)));
    const item = cosmetics.find((cosmetic) => cosmetic.id === itemId);
    return {
      type: 'cosmetic',
      item_id: itemId,
      quantity: Math.max(1, Math.floor(Number(reward.quantity || 1))),
      ...(item ? { label: item.name } : {}),
      ...(reward.revoke_when_unmet ? { revoke_when_unmet: true } : {})
    };
  }
  if (reward.type === 'title') {
    const titleId = Math.floor(Number(reward.title_id || 0));
    const title = titles.find((item) => item.id === titleId);
    return {
      type: 'title',
      title_id: titleId,
      ...(title ? { label: title.name } : {}),
      ...(reward.revoke_when_unmet ? { revoke_when_unmet: true } : {})
    };
  }
  return { type: reward.type, quantity: Math.max(1, Math.floor(Number(reward.quantity || 1))) };
};

export const AdminAchievementsTab: React.FC = () => {
  const { toast } = useApp();
  const [items, setItems] = useState<AdminAchievement[]>([]);
  const [titles, setTitles] = useState<UserTitle[]>([]);
  const [cosmetics, setCosmetics] = useState<ShopItem[]>([]);
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

  const fetchCosmetics = async () => {
    try {
      const res = await apiFetch('/admin/shop/items');
      if (res.ok) setCosmetics(await res.json());
    } catch {
      // 코스메틱 목록 조회 실패는 숫자 ID 저장 폴백으로 처리합니다.
    }
  };

  useEffect(() => {
    void fetchAchievements();
    void fetchTitles();
    void fetchCosmetics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resetForm = () => setForm({ ...emptyForm, rewards: [emptyReward()], conditions: [{ metric: 'card.acquired.count', target: 1 }] });

  const cosmeticName = (itemId?: number) =>
    cosmetics.find((item) => item.id === Number(itemId || 0))?.name || `아이템#${itemId || 0}`;

  const titleName = (titleId?: number) =>
    titles.find((title) => title.id === Number(titleId || 0))?.name || `칭호#${titleId || 0}`;

  const rewardPreview = (reward: AchievementReward) => {
    const quantity = Math.max(1, Math.floor(Number(reward.quantity || 1)));
    if (reward.type === 'point') return `${Number(reward.points || 0).toLocaleString()}P 지급`;
    if (reward.type === 'card') return `${reward.channel_id || '스트리머 채널'} 카드 ${quantity.toLocaleString()}장 지급`;
    if (reward.type === 'cosmetic') return `${cosmeticName(reward.item_id)} ${quantity.toLocaleString()}개 지급`;
    if (reward.type === 'title') return `${titleName(reward.title_id)} 칭호 지급`;
    if (reward.type === 'minigame_ticket') return `추가 미니게임 티켓 ${quantity.toLocaleString()}장 지급`;
    return `추가 무료 소환권 ${quantity.toLocaleString()}장 지급`;
  };

  const rewardPreviewText = (reward: AchievementReward) =>
    `${rewardPreview(reward)}${reward.revoke_when_unmet ? ' · 조건 미달 시 회수' : ''}`;

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
      limited_winner_count: Math.max(0, Math.floor(Number(achievement.limited_winner_count || 0))),
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
          if (nextType === 'cosmetic') return { type: 'cosmetic', item_id: cosmetics[0]?.id || 0, quantity: 1, ...(cosmetics[0] ? { label: cosmetics[0].name } : {}) };
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
    if (!appIconExists(form.icon)) return toast('존재하는 Lucide 또는 MDI 아이콘명을 입력해 주세요.', 'warning');
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
      limited_winner_count: Math.max(0, Math.floor(Number(form.limited_winner_count || 0))),
      criteria_json: criteriaJson,
      rewards_json: form.rewards.map((reward) => normalizeReward(reward, cosmetics, titles)),
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
            <p className="mt-1 text-[11px] text-muted-foreground">조건은 한글로 선택하고 서버에는 안전한 메트릭 키로 저장됩니다.</p>
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
            <input
              list="achievement-icon-options"
              value={form.icon}
              onChange={(e) => setForm({ ...form, icon: e.target.value })}
              className={`field-input ${appIconExists(form.icon) ? '' : 'border-red-500'}`}
              placeholder="Award 또는 mdi:trophy"
            />
            <datalist id="achievement-icon-options">{suggestedIconOptions.map((name) => <option key={name} value={name} />)}</datalist>
            {!appIconExists(form.icon) && <span className="text-[10px] text-red-500">Lucide 또는 @mdi/js에 없는 아이콘입니다.</span>}
          </Field>
          <Field label="아이콘 색상">
            <input value={form.icon_color} onChange={(e) => setForm({ ...form, icon_color: e.target.value })} className="field-input font-mono" />
          </Field>
          <Field label="정렬값">
            <input type="number" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })} className="field-input" />
          </Field>
        </div>

        <div className="mt-3 grid gap-3 lg:grid-cols-[180px_180px_180px_1fr]">
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
          <Field label="선착순 한정">
            <input
              type="number"
              min={0}
              value={form.limited_winner_count}
              onChange={(e) => setForm({ ...form, limited_winner_count: Math.max(0, Math.floor(Number(e.target.value || 0))) })}
              className="field-input"
              placeholder="0 = 무제한"
            />
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
                  {metricOptions.map((metric) => <option key={metric} value={metric}>{metricLabels[metric] || metric}</option>)}
                </select>
                <input type="number" min={1} value={condition.target} onChange={(e) => updateCondition(index, { target: Number(e.target.value) })} className="field-input" />
                <button disabled={form.conditions.length <= 1} onClick={() => setForm({ ...form, conditions: form.conditions.filter((_, i) => i !== index) })} className="rounded-lg bg-red-500/10 px-3 py-2 text-xs font-bold text-red-500 disabled:opacity-40">
                  삭제
                </button>
                <p className="text-[10px] font-bold text-muted-foreground sm:col-span-3">
                  {conditionPreview(condition)}
                </p>
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
                  {rewardTypes.map((type) => <option key={type} value={type}>{rewardTypeLabels[type]}</option>)}
                </select>
                {reward.type === 'point' && <input type="number" value={reward.points || 0} onChange={(e) => updateReward(index, { points: Number(e.target.value) })} className="field-input" placeholder="포인트" />}
                {reward.type === 'card' && <input value={reward.channel_id || ''} onChange={(e) => updateReward(index, { channel_id: e.target.value })} className="field-input" placeholder="스트리머 채널 ID" />}
                {reward.type === 'cosmetic' && (
                  cosmetics.length > 0 ? (
                    <select value={reward.item_id || 0} onChange={(e) => {
                      const itemId = Number(e.target.value);
                      const item = cosmetics.find((cosmetic) => cosmetic.id === itemId);
                      updateReward(index, { item_id: itemId, label: item?.name });
                    }} className="field-input">
                      <option value={0}>코스메틱 선택</option>
                      {cosmetics.map((item) => (
                        <option key={item.id} value={item.id}>
                          [{cosmeticTypeLabels[item.type]}] {item.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="field-input flex items-center text-muted-foreground">상점 관리에서 먼저 추가</span>
                  )
                )}
                {reward.type === 'title' && (
                  titles.length > 0 ? (
                    <select value={reward.title_id || 0} onChange={(e) => {
                      const titleId = Number(e.target.value);
                      const title = titles.find((item) => item.id === titleId);
                      updateReward(index, { title_id: titleId, label: title?.name });
                    }} className="field-input">
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
                <p className="text-[10px] font-bold text-muted-foreground sm:col-span-4">
                  {rewardPreviewText(reward)}
                </p>
                {(reward.type === 'cosmetic' || reward.type === 'title') && (
                  <label className="flex items-center gap-2 text-[10px] font-bold text-muted-foreground sm:col-span-4">
                    <input
                      type="checkbox"
                      checked={reward.revoke_when_unmet === true}
                      onChange={(e) => updateReward(index, { revoke_when_unmet: e.target.checked })}
                    />
                    조건을 더 이상 만족하지 않으면 이 보상 회수
                  </label>
                )}
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
                    {Number(achievement.limited_winner_count || 0) > 0 && (
                      <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-black text-amber-600">
                        선착순 {Number(achievement.limited_winner_count).toLocaleString()}명
                      </span>
                    )}
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
