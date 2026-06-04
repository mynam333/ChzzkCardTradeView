'use client';

import React, { useState } from 'react';
import { X } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { cardImage } from '@/lib/cosmetics';

// 이미지 신고 사유 프리셋 (마지막 '기타'는 직접 입력)
export const REPORT_REASONS = [
  '선정적/음란한 이미지',
  '폭력적·혐오스러운 이미지',
  '저작권 침해 이미지',
  '타인 사칭·도용',
  '욕설·비방 등 부적절한 내용',
  '기타',
];

/** 신고 대상 카드 — 모달이 필요로 하는 최소 형태(컴포넌트 디커플링) */
export interface ReportTargetCard {
  star?: number;
  streamer?: {
    name: string;
    channel_id: string;
    custom_images?: (string | null)[] | null;
    custom_image_url?: string | null;
    logo_url?: string | null;
  } | null;
}

interface Props {
  card: ReportTargetCard;
  onClose: () => void;
  /** 결과 안내(성공/실패) — 부모의 알림 표시기 연결 */
  onResult: (title: string, message: string, type?: 'success' | 'error' | 'warning' | 'info') => void;
}

/**
 * 카드 이미지 신고 모달 (GachaTab에서 분리된 자기완결형 컴포넌트).
 * 해당 별 이미지 + 스트리머 정보를 보여주고, 사유 선택/직접 입력 후 신고를 전송합니다.
 */
export const ReportCardModal: React.FC<Props> = ({ card, onClose, onResult }) => {
  const [reason, setReason] = useState('');
  const [custom, setCustom] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!card.streamer) return null;
  const streamer = card.streamer;
  const star = card.star || 0;

  const handleSubmit = async () => {
    const isEtc = reason === '기타';
    const finalReason = isEtc ? custom.trim() : reason;
    if (!finalReason) {
      onResult('신고 사유 필요', isEtc ? '신고 사유를 직접 입력해 주세요.' : '신고 사유를 선택해 주세요.', 'warning');
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiFetch(`/cards/${streamer.channel_id}/report`, {
        method: 'POST',
        body: JSON.stringify({ reason: finalReason, star })
      });
      const data = await res.json();
      if (res.ok) {
        onResult('신고 접수 완료', '신고가 접수되었습니다. 검토 후 조치하겠습니다.', 'success');
        onClose();
      } else {
        onResult('신고 실패', data.message || '신고 접수에 실패했습니다.', 'error');
      }
    } catch {
      onResult('통신 오류', '서버와의 통신 중 오류가 발생했습니다.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => !submitting && onClose()}>
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl animate-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border/60 pb-3">
          <h3 className="text-base font-bold flex items-center gap-1.5 text-red-500">🚩 이미지 신고</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
        </div>

        {/* 신고 대상 카드 이미지 + 정보 */}
        <div className="mt-4 flex items-center gap-3 rounded-xl border border-border bg-secondary/30 p-3">
          <div className="relative h-24 w-[60px] shrink-0 overflow-hidden rounded-lg border border-border/70 bg-secondary">
            <img src={cardImage(streamer, star)} alt={streamer.name} className="h-full w-full object-cover" />
            <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[9px] font-black text-amber-300">{star}★</span>
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold truncate">{streamer.name}</p>
            <p className="text-[10px] text-muted-foreground truncate">{streamer.channel_id}</p>
            <p className="mt-1 text-[10px] text-muted-foreground">{star}성 카드 이미지를 신고합니다.</p>
          </div>
        </div>

        {/* 신고 사유 선택 */}
        <div className="mt-4 space-y-1.5">
          <p className="text-xs font-bold text-muted-foreground">신고 사유</p>
          {REPORT_REASONS.map((r) => (
            <label key={r} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-xs transition ${reason === r ? 'border-red-500/50 bg-red-500/10 font-bold text-foreground' : 'border-border bg-secondary/30 text-muted-foreground hover:bg-secondary/60'}`}>
              <input type="radio" name="report-reason" value={r} checked={reason === r} onChange={() => setReason(r)} className="accent-red-500" />
              {r}
            </label>
          ))}
          {reason === '기타' && (
            <textarea
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              maxLength={500}
              rows={3}
              placeholder="신고 사유를 직접 입력해 주세요. (최대 500자)"
              className="mt-1 w-full resize-none rounded-lg border border-border bg-secondary/40 px-3 py-2 text-xs"
            />
          )}
        </div>

        <div className="mt-5 flex gap-2">
          <button
            onClick={onClose}
            disabled={submitting}
            className="flex-1 rounded-lg bg-secondary px-4 py-2.5 text-xs font-bold text-muted-foreground hover:text-foreground disabled:opacity-50"
          >취소</button>
          <button
            onClick={handleSubmit}
            disabled={submitting || !reason || (reason === '기타' && !custom.trim())}
            className="flex-1 rounded-lg bg-red-500 px-4 py-2.5 text-xs font-bold text-white hover:bg-red-600 disabled:opacity-50 disabled:pointer-events-none"
          >{submitting ? '접수 중…' : '신고 접수'}</button>
        </div>
      </div>
    </div>
  );
};
