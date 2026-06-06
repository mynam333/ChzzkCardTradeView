'use client';

import React, { useRef, useCallback } from 'react';
import { Cropper, CropperRef } from 'react-advanced-cropper';
import { ImageRestriction } from 'advanced-cropper';
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
 * - 드래그로 위치 이동, 마우스 휠/핀치로 줌 조절
 * - 테두리 밖은 반투명 어두운 오버레이
 * - 확인 시 Canvas API로 크롭 결과 Blob 추출
 */
export const ImageCropModal: React.FC<ImageCropModalProps> = ({
  imageSrc,
  star,
  onConfirm,
  onCancel,
}) => {
  const cropperRef = useRef<CropperRef>(null);

  // 크롭 확인: getCanvas()로 Blob 추출
  const handleConfirm = useCallback(() => {
    const cropper = cropperRef.current;
    if (!cropper) return;

    const canvas = cropper.getCanvas({
      width: 640,   // 5:8 비율 기준 최종 출력 크기 (640×1024)
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
        style={{ maxHeight: '95dvh', width: 'min(600px, 96vw)' }}
      >
        {/* 헤더 */}
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
        <p className="px-5 pt-3 pb-1 text-[11px] text-muted-foreground shrink-0">
          밝은 테두리 안쪽 영역이 카드에 저장됩니다. 드래그로 위치를, 휠·핀치로 크기를 조절하세요.
        </p>

        {/* 크롭 에디터 영역 */}
        <div
          className="relative flex-1 min-h-0 overflow-hidden mx-5 mb-3 rounded-xl border border-border/40"
          style={{ maxHeight: '55vh' }}
        >
          <Cropper
            ref={cropperRef}
            src={imageSrc}
            stencilProps={{
              aspectRatio: 5 / 8,
              // 비율 고정 시 핸들 조절보다 위치 이동 우선
              movable: true,
              resizable: false,
            }}
            // 이미지가 스텐실 밖으로 나가지 않도록 제한
            imageRestriction={ImageRestriction.stencil}
            // 이미지 드래그/줌 허용 (스텐실 위치는 고정)
            transformImage={{
              adjustStencil: false,
            }}
            className="h-full w-full"
            style={{ height: '100%' }}
          />
        </div>

        {/* 줌 컨트롤 */}
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

        {/* 하단 버튼 */}
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
