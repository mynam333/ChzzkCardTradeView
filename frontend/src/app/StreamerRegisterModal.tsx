'use client';

import React, { useState } from 'react';
import { Plus, X, Check } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { AlertModal, AlertType } from './AlertModal';

interface ChzzkSearchResult {
  channelId: string;
  channelName: string;
  channelImageUrl: string;
  followerCount?: number;
}

interface Props {
  /** 트리거 버튼 클래스 (배치/디자인은 부모가 제어) */
  className?: string;
  /** 트리거 버튼 내용 */
  children?: React.ReactNode;
  /** 등록 성공 시 콜백(목록 갱신 등) */
  onRegistered?: () => void;
}

/**
 * 신규 스트리머 카드 등록 — 트리거 버튼 + 검색/등록 모달을 포함한 자기완결형 컴포넌트.
 * (기존 보관함(GachaTab)에서 분리해 메인 히어로 등 어디서든 재사용 가능)
 */
export const StreamerRegisterModal: React.FC<Props> = ({ className, children, onRegistered }) => {
  const [open, setOpen] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [results, setResults] = useState<ChzzkSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<ChzzkSearchResult | null>(null);
  const [disclaimerChecked, setDisclaimerChecked] = useState(false);
  const [registering, setRegistering] = useState(false);

  // 모달형 알림 (기존 setAlertModal 동작과 동일)
  const [alert, setAlert] = useState<{ open: boolean; title: string; message: string; type: AlertType }>(
    { open: false, title: '', message: '', type: 'info' }
  );
  const showAlert = (title: string, message: string, type: AlertType = 'info') =>
    setAlert({ open: true, title, message, type });

  const reset = () => {
    setKeyword('');
    setResults([]);
    setSelected(null);
    setDisclaimerChecked(false);
  };
  const close = () => { setOpen(false); reset(); };

  const handleSearch = async () => {
    if (!keyword.trim()) { showAlert('입력 필요', '검색할 스트리머 명칭을 입력해 주세요.', 'warning'); return; }
    setSearching(true);
    setSelected(null);
    try {
      const res = await apiFetch(`/streamers/search?keyword=${encodeURIComponent(keyword)}`);
      if (res.ok) setResults(await res.json());
      else showAlert('검색 실패', '스트리머 검색에 실패했습니다.', 'error');
    } catch {
      showAlert('통신 오류', '통신 중 오류가 발생했습니다.', 'error');
    } finally {
      setSearching(false);
    }
  };

  const handleRegister = async () => {
    if (!selected) { showAlert('등록 오류', '등록할 스트리머를 리스트에서 선택해 주세요.', 'error'); return; }
    // 팔로워 150명 미만 1차 차단 (서버에서도 재검증)
    if (selected.followerCount !== undefined && Number(selected.followerCount) < 150) {
      showAlert('등록 불가', `팔로워 수 150명 이상인 스트리머만 등록할 수 있습니다. (현재: ${Number(selected.followerCount).toLocaleString()}명)`, 'warning');
      return;
    }
    if (!disclaimerChecked) { showAlert('동의 필요', '등록 책임 조항 및 약관 동의를 완료해 주세요.', 'warning'); return; }

    setRegistering(true);
    try {
      const res = await apiFetch('/streamers/register', {
        method: 'POST',
        body: JSON.stringify({
          channelId: selected.channelId,
          channelName: selected.channelName,
          channelImageUrl: selected.channelImageUrl,
          followerCount: selected.followerCount
        })
      });
      const data = await res.json();
      if (res.ok) {
        showAlert('등록 완료', data.message || '성공적으로 스트리머 카드가 등록되었습니다!', 'success');
        close();
        onRegistered?.();
      } else {
        showAlert('등록 실패', data.message || '스트리머 등록에 실패했습니다.', 'error');
      }
    } catch {
      showAlert('통신 오류', '서버 전송 중 에러가 발생했습니다.', 'error');
    } finally {
      setRegistering(false);
    }
  };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className}>
        {children ?? (<><Plus className="h-3.5 w-3.5" /> 스트리머 추가</>)}
      </button>

      {open && (
        <div className="modal-backdrop z-[80] bg-black/60 backdrop-blur-sm" onClick={() => !registering && close()}>
          <div className="modal-panel modal-panel-md modal-panel-scroll rounded-2xl border border-border bg-card p-5 shadow-2xl animate-in zoom-in-95 duration-200 sm:p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-border/60 pb-3">
              <h3 className="text-base font-bold flex items-center gap-2">
                <Plus className="h-4.5 w-4.5 text-primary" /> 신규 스트리머 카드 등록
              </h3>
              <button onClick={close} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
            </div>

            <div className="mt-4 space-y-4">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
                  placeholder="치지직 스트리머 이름을 입력하세요"
                  className="flex-1 rounded-lg border border-border bg-secondary/50 px-3 py-2 text-xs focus:border-primary focus:outline-none"
                />
                <button
                  onClick={handleSearch}
                  disabled={searching}
                  className="rounded-lg bg-primary px-4 py-2 text-xs font-bold text-primary-foreground hover:bg-primary/90"
                >
                  {searching ? '검색 중...' : '검색'}
                </button>
              </div>

              {/* 검색 결과 리스트 */}
              {results.length > 0 && (
                <div className="border border-border/80 rounded-xl max-h-48 overflow-y-auto p-1.5 space-y-1">
                  {results.map((ch) => {
                    const isSelected = selected?.channelId === ch.channelId;
                    return (
                      <div
                        key={ch.channelId}
                        onClick={() => setSelected(ch)}
                        className={`flex items-center justify-between p-2 rounded-lg cursor-pointer transition ${isSelected ? 'bg-primary/10 border border-primary/40' : 'hover:bg-secondary/60 border border-transparent'}`}
                      >
                        <div className="flex items-center gap-2.5">
                          <img src={ch.channelImageUrl} alt={ch.channelName} className="h-8 w-8 rounded-full border border-border/60 object-cover" />
                          <div>
                            <p className="text-xs font-bold text-foreground">{ch.channelName}</p>
                            <p className="text-[9.5px] text-muted-foreground">{(ch.followerCount || 0).toLocaleString()} 팔로워</p>
                          </div>
                        </div>
                        {isSelected && <Check className="h-4 w-4 text-primary" />}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* 하단 약관 및 동의 체크 */}
              <div className="rounded-lg bg-secondary/30 border border-border/50 p-3 space-y-2.5">
                <div className="text-[0.62rem] text-muted-foreground leading-relaxed">
                  <p className="font-bold text-foreground/80 mb-1">⚠️ 신규 스트리머 카드 등록 책임 조항</p>
                  본 서비스를 통해 신규 스트리머의 정보를 등록하여 카드를 활성화하는 모든 행위의 주체는 사용자 본인이며, 이로 인해 발생할 수 있는 초상권, 저작권, 퍼블리시티권 분쟁을 포함한 민형사상의 모든 법적 책임은 카드 등록자 본인에게 전적으로 귀속됩니다.
                </div>
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={disclaimerChecked}
                    onChange={(e) => setDisclaimerChecked(e.target.checked)}
                    className="mt-0.5 rounded border-border"
                  />
                  <span className="text-[0.65rem] font-semibold text-foreground/90">
                    위 조항의 내용을 충분히 숙지하였으며 책임을 확인했습니다.
                  </span>
                </label>
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-2 border-t border-border/60 pt-4">
              <button
                onClick={close}
                className="rounded-lg px-4 py-2 text-xs font-bold bg-secondary text-muted-foreground hover:bg-secondary/80"
              >취소</button>
              <button
                onClick={handleRegister}
                disabled={registering || !selected || !disclaimerChecked}
                className="rounded-lg bg-primary px-5 py-2 text-xs font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:pointer-events-none"
              >{registering ? '등록 중...' : '스트리머 등록 완료'}</button>
            </div>
          </div>
        </div>
      )}

      {/* 모달형 알림 (등록 결과/검증) — 등록 모달보다 위(z-90)에 표시 */}
      <AlertModal
        open={alert.open}
        title={alert.title}
        message={alert.message}
        type={alert.type}
        onClose={() => setAlert((a) => ({ ...a, open: false }))}
      />
    </>
  );
};
