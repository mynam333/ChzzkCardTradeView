'use client';

import React, { useRef, useCallback } from 'react';
import { Cropper, CropperRef, ImageRestriction } from 'react-advanced-cropper';
import 'react-advanced-cropper/dist/style.css';
import { X, Crop, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';

interface ImageCropModalProps {
  /** 원본 이미지 ObjectURL */
  imageSrc: string;
  /** 몇 성 카드인지 (타이틀 표시용) */
  star: number;
  /** 크롭 확인 시 호출 — croppedBlob을 반환 */
  onConfirm: (croppedBlob: Blob) => void;
  /** 취소 시 호출 */
  onCancel: () => void;
}

/**
 * 5:8 비율 고정 카드 이미지 크롭 모달
 * - 스텐실(크롭 영역)이 5:8 비율 고정, 이미지만 드래그/줌하여 위치 조절
 * - 에디터 높이 350px 고정 → flex 높이 계산 의존 없이 하단 잘림 방지
 * - imageRestriction.fitArea → 이미지가 에디터에 맞게 초기화, 스텐실이 5:8 오버레이
 * - 확인 시 Canvas API로 640×1024 WebP Blob 추출
 */
export const ImageCropModal: React.FC<ImageCropModalProps> = ({
  imageSrc,
  star,
  onConfirm,
  onCancel,
}) => {
  const cropperRef = useRef<CropperRef>(null);

  // 크롭 확인: getCanvas()로 5:8 비율 Blob 추출
  const handleConfirm = useCallback(() => {
    const cropper = cropperRef.current;
    if (!cropper) return;

    const canvas = cropper.getCanvas({
      width: 640,   // 5:8 기준 최종 출력 크기 (640×1024)
      height: 1024,
    });

    if (!canvas) return;

    canvas.toBlob(
      (blob) => {
        if (blob) onConfirm(blob);
      },
      'image/webp',
      0.92,
    );
  }, [onConfirm]);

  // 줌인
  const handleZoomIn = () => {
    cropperRef.current?.zoomImage(1.15);
  };

  // 줌아웃
  const handleZoomOut = () => {
    cropperRef.current?.zoomImage(1 / 1.15);
  };

  // 리셋 (초기 위치로)
  const handleReset = () => {
    cropperRef.current?.reset();
  };

  const starLabel = star === 0 ? '0성' : `${star}성`;

  return (
    <div className="modal-backdrop z-[90] bg-black/60 backdrop-blur-sm">
      <div
        className="modal-panel modal-panel-lg rounded-2xl border border-border bg-card shadow-2xl animate-in zoom-in-95 duration-200 flex flex-col"
        style={{ width: 'min(560px, 96vw)' }}
      >
        {/* 헤더 — 기존 모달 헤더 패턴과 동일 */}
        <div className="flex items-center justify-between border-b border-border/60 px-5 py-4 shrink-0">
          <h3 className="text-sm font-bold flex items-center gap-2">
            <Crop className="h-4 w-4 text-primary" />
            {starLabel} 카드 이미지 편집
            <span className="text-[11px] font-normal text-muted-foreground">
              (5:8 비율 고정)
            </span>
          </h3>
          <button
            onClick={onCancel}
            className="text-muted-foreground hover:text-foreground transition"
            aria-label="닫기"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* 안내 텍스트 */}
        <p className="px-5 pt-3 pb-2 text-[11px] text-muted-foreground shrink-0">
          하얀 테두리 안쪽 영역이 카드에 저장됩니다. 이미지를 드래그하여 위치를, 휠·핀치로 크기를 조절하세요.
        </p>

        {/* 크롭 에디터 영역
            — 명시적 고정 높이(350px)로 flex 높이 계산 의존 없이 확실한 영역 확보.
              라이브러리 .advanced-cropper 자체 CSS가 background:black이므로
              라이트/다크 무관하게 에디터 내부는 항상 어두운 배경(이미지 편집 UX 표준).
        */}
        <div
          className="mx-5 mb-3 rounded-xl overflow-hidden border border-border/40"
          style={{ height: '350px' }}
        >
          <Cropper
            ref={cropperRef}
            src={imageSrc}
            stencilProps={{
              // 5:8 비율 고정 (세로형 카드)
              // movable: false — 스텐실 중앙 고정, 이미지만 드래그
              // resizable: true(기본값) — 비율 유지하며 스텐실 크기 조절 허용
              aspectRatio: 5 / 8,
              movable: false,
            }}
            // stencil: 이미지가 스텐실 영역을 완전히 벗어나지 않는 범위에서
            //          좌우/상하 자유롭게 드래그 가능.
            // (fitArea는 이미지가 에디터를 꽉 채워 드래그 여백이 없어지는 문제가 있었음)
            imageRestriction={ImageRestriction.stencil}
            className="w-full"
            style={{ height: '100%' }}
          />
        </div>

        {/* 줌 컨트롤 — bg-secondary/border-border 테마 변수로 라이트/다크 자동 대응 */}
        <div className="flex items-center justify-center gap-3 px-5 pb-3 shrink-0">
          <button
            onClick={handleZoomOut}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-secondary text-muted-foreground hover:bg-secondary/70 hover:text-foreground transition"
            aria-label="축소"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <span className="text-[11px] text-muted-foreground select-none">줌 조절</span>
          <button
            onClick={handleZoomIn}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-secondary text-muted-foreground hover:bg-secondary/70 hover:text-foreground transition"
            aria-label="확대"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
          <div className="h-4 w-px bg-border mx-1" />
          <button
            onClick={handleReset}
            className="flex h-8 items-center gap-1.5 rounded-full border border-border bg-secondary px-3 text-[11px] text-muted-foreground hover:bg-secondary/70 hover:text-foreground transition"
            aria-label="초기화"
          >
            <RotateCcw className="h-3 w-3" />
            초기화
          </button>
        </div>

        {/* 하단 버튼 — 기존 모달 패턴과 동일 */}
        <div className="flex items-center justify-end gap-2 border-t border-border/60 px-5 py-4 shrink-0">
          <button
            onClick={onCancel}
            className="rounded-lg bg-secondary px-4 py-2 text-xs font-bold text-muted-foreground hover:bg-secondary/80 transition"
          >
            취소
          </button>
          <button
            onClick={handleConfirm}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-5 py-2 text-xs font-bold text-primary-foreground hover:bg-primary/90 transition shadow-md shadow-primary/20"
          >
            <Crop className="h-3.5 w-3.5" />
            이 영역으로 자르기
          </button>
        </div>
      </div>
    </div>
  );
};
