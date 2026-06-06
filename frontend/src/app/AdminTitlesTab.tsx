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

  const selectedTitle = titles.find((title) => title.id === selectedTitleId) || null;
  const previewTitle: UserTitle = {
    id: form.id || -1,
    name: form.name || '칭호 미리보기',
    css: form.css,
    icon_name: form.icon_name || null,
    icon_color: form.icon_color
  };
  const iconExists = !form.icon_name || Boolean(icons[form.icon_name as keyof typeof icons]);
  const iconOptions = useMemo(() => suggestedIcons.filter((name) => icons[name as keyof typeof icons]), []);

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
      if (selectedTitleId === title.id) setSelectedTitleId(null);
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
    if (res.ok) await fetchUsers();
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
                <button className="w-full text-left" onClick={() => setSelectedTitleId(title.id)}>
                  <UserTitleBadge title={title} />
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
        <div className="relative mb-3">
          <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="닉네임 또는 채널 ID 검색"
            className="w-full rounded-lg border border-border bg-secondary/40 py-2 pl-9 pr-3 text-xs" />
        </div>
        <div className="grid gap-2 md:grid-cols-2">
          {loadingUsers ? <p className="col-span-full py-8 text-center text-xs text-muted-foreground">불러오는 중...</p> : users.map((user) => {
            const awarded = Boolean(selectedTitle && user.titles.some((title) => title.id === selectedTitle.id));
            return (
              <div key={user.id} className="flex items-center gap-3 rounded-xl border border-border bg-secondary/20 p-3">
                {/* 외부 채널 이미지 도메인이 동적이라 Next Image 최적화 대상에 고정할 수 없습니다. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={user.avatar_url || `https://api.dicebear.com/7.x/pixel-art/svg?seed=${user.id}`} alt="" className="h-9 w-9 rounded-full object-cover" />
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
