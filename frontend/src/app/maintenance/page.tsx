'use client';

import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/lib/api';

export default function MaintenancePage() {
  const [maintenanceInfo, setMaintenanceInfo] = useState<{ startAt: string | null; endAt: string | null } | null>(null);
  const [imageUrl, setImageUrl] = useState<string>('/construction/01.png');

  useEffect(() => {
    // 점검 일정 조회
    const fetchStatus = async () => {
      try {
        const res = await apiFetch('/maintenance/status');
        if (res.ok) {
          const data = await res.json();
          setMaintenanceInfo(data);
        }
      } catch (err) {
        console.error('점검 정보 로드 실패:', err);
      }
    };

    // 공사중 랜덤 이미지 조회
    const fetchImages = async () => {
      try {
        const res = await fetch('/api/maintenance/images');
        if (res.ok) {
          const data = await res.json();
          if (data.images && data.images.length > 0) {
            const randomIndex = Math.floor(Math.random() * data.images.length);
            setImageUrl(`/construction/${data.images[randomIndex]}`);
          }
        }
      } catch (err) {
        console.error('공사중 이미지 로드 실패:', err);
      }
    };

    fetchStatus();
    fetchImages();
  }, []);

  const formatDate = (isoStr: string | null) => {
    if (!isoStr) return '점검 완료 시까지';
    const d = new Date(isoStr);
    return d.toLocaleString('ko-KR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Seoul'
    });
  };

  // 화면 90%를 채우면서 내부 비율 유지하는 동적 스케일링
  const containerRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardScale, setCardScale] = useState(1);

  useEffect(() => {
    const updateScale = () => {
      if (!containerRef.current || !cardRef.current) return;
      const vw = containerRef.current.clientWidth;
      const vh = containerRef.current.clientHeight;
      // 카드의 자연 크기(scale=1 상태) 측정
      const cardNatW = cardRef.current.scrollWidth;
      const cardNatH = cardRef.current.scrollHeight;
      if (cardNatW === 0 || cardNatH === 0) return;
      // 뷰포트의 90%에 맞추는 스케일 비율 산출 (가로·세로 중 작은 쪽)
      const scaleX = (vw * 0.9) / cardNatW;
      const scaleY = (vh * 0.9) / cardNatH;
      setCardScale(Math.min(scaleX, scaleY, 2.5)); // 최대 2.5배 제한
    };

    updateScale();
    const ro = new ResizeObserver(updateScale);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={containerRef}
      className="flex min-h-screen flex-col items-center justify-center bg-background text-foreground select-none overflow-hidden"
    >
      <div
        ref={cardRef}
        className="w-[420px] rounded-2xl border border-border bg-card p-8 shadow-xl space-y-6 animate-in fade-in duration-300 origin-center"
        style={{ transform: `scale(${cardScale})` }}
      >
        {/* 공사중 이미지 */}
        <div className="flex justify-center">
          <img
            src={imageUrl}
            alt="공사중"
            className="h-44 w-auto object-contain rounded-xl select-none pointer-events-none"
            style={{ maxHeight: '180px' }}
          />
        </div>

        <div className="space-y-2">
          <h2 className="text-xl font-black text-rose-500">서비스 시스템 점검 중</h2>
          <p className="text-xs text-muted-foreground leading-relaxed">
            더 안정적인 서비스를 제공하기 위해 서버 점검 및 유지보수 작업을 진행하고 있습니다. 점검 중에는 서비스 이용이 일시적으로 제한됩니다.
          </p>
        </div>

        {/* 점검 시간 상세 안내 */}
        <div className="rounded-xl bg-secondary/40 p-4 text-left space-y-2 text-xs border border-border/50">
          <div className="flex justify-between">
            <span className="font-bold text-muted-foreground">점검 시작 날짜</span>
            <span className="font-mono font-bold text-foreground">
              {maintenanceInfo ? formatDate(maintenanceInfo.startAt) : '진행 중'}
            </span>
          </div>
          <div className="flex justify-between border-t border-border/30 pt-2">
            <span className="font-bold text-muted-foreground">종료 예상 날짜</span>
            <span className="font-mono font-bold text-primary">
              {maintenanceInfo ? formatDate(maintenanceInfo.endAt) : '진행 중'}
            </span>
          </div>
        </div>

        <p className="text-[10px] text-muted-foreground font-bold">
          불편을 드려 죄송하며, 신속히 작업을 마친 후 정상화하겠습니다. 감사합니다.
        </p>
      </div>
    </div>
  );
}
