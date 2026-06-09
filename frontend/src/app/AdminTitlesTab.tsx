'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Award, Edit3, RefreshCw, Search, Trash2, UserMinus, UserPlus, icons } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import type { AdminUser, UserTitle } from '@/lib/types';
import { useApp } from './AppContext';
import { UserTitleBadge, UserTitleList } from './UserTitleBadge';

const emptyForm = {
  id: 0,
  name: '',
  description: '',
  css: '',
  icon_name: 'Award',
  icon_color: '#facc15'
};

const suggestedIcons = ['Award', 'BadgeCheck', 'Crown', 'Diamond', 'Flame', 'Gem', 'Heart', 'Medal', 'ShieldCheck', 'Sparkles', 'Star', 'Trophy', 'Zap'];

export const AdminTitlesTab: React.FC = () => {
  const { toast } = useApp();
  const [titles, setTitles] = useState<UserTitle[]>([]);
  const [form, setForm] = useState({ ...emptyForm });
  const [selectedTitleId, setSelectedTitleId] = useState<number | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [bulkAwarding, setBulkAwarding] = useState(false);
  const [bulkMode, setBulkMode] = useState<'award' | 'revoke'>('award');

  const selectedTitle = titles.find((title) => title.id === selectedTitleId) || null;
  const previewTitle: UserTitle = {
    id: form.id || -1,
    name: form.name || '칭호 미리보기',
    description: form.description || '칭호에 마우스를 올리면 설명이 이렇게 표시됩니다.',
    css: form.css,
    icon_name: form.icon_name || null,
    icon_color: form.icon_color
  };
  const iconExists = !form.icon_name || Boolean(icons[form.icon_name as keyof typeof icons]);
  const iconOptions = useMemo(() => suggestedIcons.filter((name) => icons[name as keyof typeof icons]), []);
  const selectableUsers = selectedTitle
    ? users.filter((user) => {
      const ownsTitle = user.titles.some((title) => title.id === selectedTitle.id);
      return bulkMode === 'award' ? !ownsTitle : ownsTitle;
    })
    : [];
  const allVisibleSelected = selectableUsers.length > 0
    && selectableUsers.every((user) => selectedUserIds.includes(user.id));

  const fetchTitles = async () => {
    const res = await apiFetch('/admin/titles');
    if (res.ok) setTitles(await res.json());
  };

  const fetchUsers = async (keyword = search) => {
    setLoadingUsers(true);
    try {
      const params = new URLSearchParams({ page: '1', limit: '50' });
      if (keyword.trim()) params.set('q', keyword.trim());
      const res = await apiFetch(`/admin/users?${params.toString()}`);
      if (res.ok) setUsers((await res.json()).users || []);
    } finally {
      setLoadingUsers(false);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchTitles();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => fetchUsers(search), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const editTitle = (title: UserTitle) => {
    setForm({
      id: title.id,
      name: title.name,
      description: title.description || '',
      css: title.css,
      icon_name: title.icon_name || '',
      icon_color: title.icon_color
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const saveTitle = async () => {
    if (!form.name.trim()) return toast('칭호명을 입력해 주세요.');
    if (!iconExists) return toast('존재하는 Lucide 아이콘명을 입력해 주세요.');
    setSaving(true);
    try {
      const res = await apiFetch(form.id ? `/admin/titles/${form.id}` : '/admin/titles', {
        method: form.id ? 'PUT' : 'POST',
        body: JSON.stringify({
          name: form.name,
          description: form.description,
          css: form.css,
          icon_name: form.icon_name,
          icon_color: form.icon_color
        })
      });
      const data = await res.json();
      if (!res.ok) return toast(data.message || '칭호 저장에 실패했습니다.');
      toast(form.id ? '칭호를 수정했습니다.' : '칭호를 생성했습니다.');
      setForm({ ...emptyForm });
      await fetchTitles();
      await fetchUsers();
    } finally {
      setSaving(false);
    }
  };

  const removeTitle = async (title: UserTitle) => {
    if (!window.confirm(`[${title.name}] 칭호와 모든 수여 기록을 삭제할까요?`)) return;
    const res = await apiFetch(`/admin/titles/${title.id}`, { method: 'DELETE' });
    const data = await res.json();
    toast(data.message || (res.ok ? '칭호를 삭제했습니다.' : '칭호 삭제에 실패했습니다.'));
    if (res.ok) {
      if (selectedTitleId === title.id) {
        setSelectedTitleId(null);
        setSelectedUserIds([]);
      }
      if (form.id === title.id) setForm({ ...emptyForm });
      await fetchTitles();
      await fetchUsers();
    }
  };

  const setAwarded = async (user: AdminUser, awarded: boolean) => {
    if (!selectedTitle) return;
    const res = await apiFetch(`/admin/titles/${selectedTitle.id}/users/${encodeURIComponent(user.id)}`, {
      method: awarded ? 'POST' : 'DELETE'
    });
    const data = await res.json();
    toast(data.message || (res.ok ? '처리했습니다.' : '처리에 실패했습니다.'));
    if (res.ok) {
      setSelectedUserIds((current) => current.filter((id) => id !== user.id));
      await fetchUsers();
    }
  };

  const selectTitleForAssignment = (titleId: number) => {
    setSelectedTitleId(titleId);
    setSelectedUserIds([]);
  };

  const changeBulkMode = (mode: 'award' | 'revoke') => {
    setBulkMode(mode);
    setSelectedUserIds([]);
  };

  const toggleUserSelection = (userId: string) => {
    if (!selectedUserIds.includes(userId) && selectedUserIds.length >= 500) {
      toast('한 번에 최대 500명까지 선택할 수 있습니다.');
      return;
    }
    setSelectedUserIds(
      selectedUserIds.includes(userId)
        ? selectedUserIds.filter((id) => id !== userId)
        : [...selectedUserIds, userId]
    );
  };

  const toggleVisibleUsers = () => {
    const visibleIds = selectableUsers.map((user) => user.id);
    if (allVisibleSelected) {
      const visibleSet = new Set(visibleIds);
      setSelectedUserIds(selectedUserIds.filter((id) => !visibleSet.has(id)));
      return;
    }
    const merged = [...new Set([...selectedUserIds, ...visibleIds])];
    if (merged.length > 500) toast('한 번에 최대 500명까지만 선택됩니다.');
    setSelectedUserIds(merged.slice(0, 500));
  };

  const processSelectedUsers = async () => {
    const actionLabel = bulkMode === 'award' ? '수여' : '회수';
    if (!selectedTitle) return toast(`${actionLabel}할 칭호를 먼저 선택해 주세요.`);
    if (selectedUserIds.length === 0) return toast(`${actionLabel}할 유저를 선택해 주세요.`);

    setBulkAwarding(true);
    try {
      const res = await apiFetch(`/admin/titles/${selectedTitle.id}/${bulkMode === 'award' ? 'award-many' : 'revoke-many'}`, {
        method: 'POST',
        body: JSON.stringify({ user_ids: selectedUserIds })
      });
      const data = await res.json();
      if (!res.ok) {
        toast(data.message || `칭호 일괄 ${actionLabel}에 실패했습니다.`);
        return;
      }
      const skipped = bulkMode === 'award'
        ? (data.already_owned_count || 0) + (data.invalid_count || 0)
        : (data.not_owned_count || 0) + (data.invalid_count || 0);
      toast(`${data.message}${skipped > 0 ? ` (${skipped}명 제외)` : ''}`);
      setSelectedUserIds([]);
      await fetchUsers();
    } finally {
      setBulkAwarding(false);
    }
  };

  return (
    <section className="space-y-5">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.8fr)]">
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="flex items-center gap-1.5 text-sm font-bold">
              <Award className="h-4 w-4 text-amber-400" /> {form.id ? '칭호 수정' : '새 칭호 생성'}
            </h3>
            {form.id > 0 && (
              <button onClick={() => setForm({ ...emptyForm })} className="text-xs text-muted-foreground hover:text-foreground">새 칭호로 전환</button>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-xs font-bold">
              <span>칭호명</span>
              <input value={form.name} maxLength={40} onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full rounded-lg border border-border bg-secondary/40 px-3 py-2 font-normal" placeholder="예: 전설의 수집가" />
            </label>
            <label className="space-y-1 text-xs font-bold">
              <span>Lucide 아이콘명</span>
              <input list="title-icon-options" value={form.icon_name} onChange={(e) => setForm({ ...form, icon_name: e.target.value.trim() })}
                className={`w-full rounded-lg border bg-secondary/40 px-3 py-2 font-normal ${iconExists ? 'border-border' : 'border-red-500'}`} placeholder="Crown" />
              <datalist id="title-icon-options">{iconOptions.map((name) => <option key={name} value={name} />)}</datalist>
              {!iconExists && <span className="text-[10px] text-red-500">lucide-react에 없는 아이콘입니다.</span>}
            </label>
          </div>

          <label className="mt-3 block space-y-1 text-xs font-bold">
            <span>칭호 설명</span>
            <textarea value={form.description} maxLength={300} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3}
              className="w-full resize-y rounded-lg border border-border bg-secondary/40 px-3 py-2 text-xs font-normal leading-relaxed"
              placeholder="예: 첫 번째 이벤트를 함께한 유저에게 지급되는 기념 칭호입니다." />
            <span className="block text-[10px] font-normal text-muted-foreground">{form.description.length}/300 · 칭호에 마우스를 올리면 표시됩니다.</span>
          </label>

          <label className="mt-3 block space-y-1 text-xs font-bold">
            <span>아이콘 색상</span>
            <span className="flex gap-2">
              <input type="color" value={form.icon_color} onChange={(e) => setForm({ ...form, icon_color: e.target.value })}
                className="h-9 w-12 cursor-pointer rounded border border-border bg-transparent p-1" />
              <input value={form.icon_color} maxLength={7} onChange={(e) => setForm({ ...form, icon_color: e.target.value })}
                className="min-w-0 flex-1 rounded-lg border border-border bg-secondary/40 px-3 py-2 font-mono font-normal" />
            </span>
          </label>

          <label className="mt-3 block space-y-1 text-xs font-bold">
            <span>칭호 CSS</span>
            <textarea value={form.css} onChange={(e) => setForm({ ...form, css: e.target.value })} rows={10}
              className="w-full resize-y rounded-lg border border-border bg-zinc-950 px-3 py-2 font-mono text-[11px] font-normal text-zinc-100"
              placeholder={'background: linear-gradient(135deg, #713f12, #facc15);\ncolor: white;\nbox-shadow: 0 0 12px rgba(250,204,21,.5);'} />
            <p className="text-[10px] font-normal leading-relaxed text-muted-foreground">
              CSS 선언문은 이 칭호에만 자동 적용됩니다. 복합 효과는 <code>{'{{selector}}'}</code>를 선택자로 사용하거나, 첫 클래스가 칭호 요소를 가리키는 완성 CSS를 입력하세요.
            </p>
          </label>

          <div className="mt-4 flex items-center justify-between rounded-xl border border-dashed border-border bg-secondary/20 p-4">
            <UserTitleBadge title={previewTitle} />
            <button disabled={saving} onClick={saveTitle}
              className="rounded-lg bg-primary px-4 py-2 text-xs font-bold text-primary-foreground disabled:opacity-50">
              {saving ? '저장 중...' : form.id ? '수정 저장' : '칭호 생성'}
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-bold">등록된 칭호 ({titles.length})</h3>
            <button onClick={fetchTitles} className="text-muted-foreground hover:text-foreground"><RefreshCw className="h-4 w-4" /></button>
          </div>
          <div className="max-h-[620px] space-y-2 overflow-y-auto pr-1">
            {titles.map((title) => (
              <div key={title.id} className={`rounded-xl border p-3 transition ${selectedTitleId === title.id ? 'border-primary bg-primary/5' : 'border-border bg-secondary/20'}`}>
                <button className="w-full text-left" onClick={() => selectTitleForAssignment(title.id)}>
                  <UserTitleBadge title={title} />
                  <span className="mt-2 block line-clamp-2 text-[10px] leading-relaxed text-muted-foreground">
                    {title.description || '설명 없음'}
                  </span>
                </button>
                <div className="mt-2 flex justify-end gap-1">
                  <button onClick={() => editTitle(title)} className="rounded-lg p-2 text-muted-foreground hover:bg-secondary hover:text-foreground" title="수정"><Edit3 className="h-3.5 w-3.5" /></button>
                  <button onClick={() => removeTitle(title)} className="rounded-lg p-2 text-muted-foreground hover:bg-red-500/10 hover:text-red-500" title="삭제"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              </div>
            ))}
            {titles.length === 0 && <p className="py-10 text-center text-xs text-muted-foreground">등록된 칭호가 없습니다.</p>}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="flex items-center gap-1.5 text-sm font-bold"><UserPlus className="h-4 w-4" /> 칭호 수여 및 회수</h3>
            <p className="mt-1 text-[10px] text-muted-foreground">{selectedTitle ? `[${selectedTitle.name}] 칭호를 관리합니다.` : '위 목록에서 관리할 칭호를 선택하세요.'}</p>
          </div>
          {selectedTitle && <UserTitleBadge title={selectedTitle} />}
        </div>
        <div className="mb-3 flex flex-col gap-2 sm:flex-row">
          <div className="flex shrink-0 rounded-lg bg-secondary p-1">
            <button
              onClick={() => changeBulkMode('award')}
              className={`rounded-md px-3 py-1.5 text-[10px] font-bold transition ${bulkMode === 'award' ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground'}`}
            >
              일괄 수여
            </button>
            <button
              onClick={() => changeBulkMode('revoke')}
              className={`rounded-md px-3 py-1.5 text-[10px] font-bold transition ${bulkMode === 'revoke' ? 'bg-card text-red-500 shadow-sm' : 'text-muted-foreground'}`}
            >
              일괄 회수
            </button>
          </div>
          <div className="relative min-w-0 flex-1">
            <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="닉네임 또는 채널 ID 검색"
              className="w-full rounded-lg border border-border bg-secondary/40 py-2 pl-9 pr-3 text-xs" />
          </div>
          <button
            disabled={!selectedTitle || selectableUsers.length === 0}
            onClick={toggleVisibleUsers}
            className="rounded-lg bg-secondary px-3 py-2 text-[10px] font-bold text-muted-foreground hover:text-foreground disabled:opacity-40"
          >
            {allVisibleSelected
              ? '현재 검색 결과 선택 해제'
              : `현재 ${bulkMode === 'award' ? '미보유자' : '보유자'} 전체 선택 (${selectableUsers.length})`}
          </button>
          <button
            disabled={!selectedTitle || selectedUserIds.length === 0 || bulkAwarding}
            onClick={processSelectedUsers}
            className={`flex items-center justify-center gap-1 rounded-lg px-4 py-2 text-[10px] font-bold text-white disabled:opacity-40 ${bulkMode === 'award' ? 'bg-primary' : 'bg-red-500'}`}
          >
            {bulkMode === 'award' ? <UserPlus className="h-3 w-3" /> : <UserMinus className="h-3 w-3" />}
            {bulkAwarding
              ? `${bulkMode === 'award' ? '수여' : '회수'} 중...`
              : `선택 ${selectedUserIds.length}명 일괄 ${bulkMode === 'award' ? '수여' : '회수'}`}
          </button>
        </div>
        {selectedUserIds.length > 0 && (
          <p className="mb-3 text-[10px] font-bold text-primary">
            검색 결과를 변경해도 선택은 유지됩니다. 현재 총 {selectedUserIds.length}명 선택됨
          </p>
        )}
        <div className="grid gap-2 md:grid-cols-2">
          {loadingUsers ? <p className="col-span-full py-8 text-center text-xs text-muted-foreground">불러오는 중...</p> : users.map((user) => {
            const awarded = Boolean(selectedTitle && user.titles.some((title) => title.id === selectedTitle.id));
            const checked = selectedUserIds.includes(user.id);
            return (
              <div key={user.id} className={`flex items-center gap-3 rounded-xl border p-3 transition ${checked ? 'border-primary bg-primary/5' : 'border-border bg-secondary/20'}`}>
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={!selectedTitle || (bulkMode === 'award' ? awarded : !awarded)}
                  onChange={() => toggleUserSelection(user.id)}
                  aria-label={`${user.username} 선택`}
                  className="h-4 w-4 shrink-0 accent-primary disabled:opacity-30"
                />
                {/* 외부 채널 이미지 도메인이 동적이라 Next Image 최적화 대상에 고정할 수 없습니다. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={user.avatar_url || `https://api.dicebear.com/10.x/fun-emoji/svg?seed=${user.id}`} alt="" className="h-9 w-9 rounded-full object-cover" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-bold">{user.username}</p>
                  <p className="truncate text-[9px] text-muted-foreground">{user.id}</p>
                  <div className="mt-1"><UserTitleList titles={user.titles} compact /></div>
                </div>
                <button disabled={!selectedTitle} onClick={() => setAwarded(user, !awarded)}
                  className={`flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-2 text-[10px] font-bold disabled:opacity-40 ${awarded ? 'bg-red-500/10 text-red-500' : 'bg-primary/10 text-primary'}`}>
                  {awarded ? <UserMinus className="h-3 w-3" /> : <UserPlus className="h-3 w-3" />}
                  {awarded ? '회수' : '수여'}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};
