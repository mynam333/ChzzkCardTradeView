'use client';

import React from 'react';
import { createPortal } from 'react-dom';
import { EyeOff, RotateCcw } from 'lucide-react';
import { useApp } from './AppContext';

type BlindableCardImageProps = React.ImgHTMLAttributes<HTMLImageElement> & {
  src?: string | null;
  placeholderClassName?: string;
  allowUnblind?: boolean;
  imageBlindMenuEnabled?: boolean;
};

export const BlindableCardImage: React.FC<BlindableCardImageProps> = ({
  src,
  alt = '',
  className = '',
  placeholderClassName = '',
  allowUnblind = false,
  imageBlindMenuEnabled = true,
  onContextMenu,
  ...props
}) => {
  const { isImageBlinded, blindImage, unblindImage } = useApp();
  const [menu, setMenu] = React.useState<{ x: number; y: number } | null>(null);
  const imageSrc = src || '';
  const blinded = isImageBlinded(imageSrc);
  const showMenu = Boolean(imageSrc);
  const closeMenu = React.useCallback(() => setMenu(null), []);

  React.useEffect(() => {
    if (!menu) return;
    window.addEventListener('click', closeMenu);
    window.addEventListener('scroll', closeMenu, true);
    return () => {
      window.removeEventListener('click', closeMenu);
      window.removeEventListener('scroll', closeMenu, true);
    };
  }, [closeMenu, menu]);

  const handleContextMenu = (event: React.MouseEvent) => {
    onContextMenu?.(event as React.MouseEvent<HTMLImageElement>);
    if (!imageBlindMenuEnabled || event.defaultPrevented || !showMenu) return;
    event.preventDefault();
    event.stopPropagation();
    setMenu({
      x: Math.min(event.clientX, window.innerWidth - 220),
      y: Math.min(event.clientY, window.innerHeight - 96)
    });
  };

  const menuNode = menu && typeof document !== 'undefined' ? createPortal(
    <div
      className="fixed z-[120] w-52 overflow-hidden rounded-2xl border border-border bg-card/95 p-1.5 text-xs shadow-2xl backdrop-blur-md animate-in fade-in duration-100"
      style={{ left: menu.x, top: menu.y }}
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        onClick={async () => {
          if (blinded) await unblindImage(imageSrc);
          else await blindImage(imageSrc);
          setMenu(null);
        }}
        className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left font-black text-foreground transition hover:bg-secondary/80"
      >
        {blinded ? '👁️ 이미지 블라인드 해제' : '🚫 같은 이미지 블라인드'}
      </button>
    </div>,
    document.body
  ) : null;

  if (blinded) {
    return (
      <>
      <div
        className={`${className} ${placeholderClassName} flex select-none flex-col items-center justify-center gap-1.5 bg-[radial-gradient(circle_at_50%_20%,rgba(45,212,191,0.16),rgba(15,23,42,0.92)_62%)] text-center text-white`}
        role="img"
        aria-label={`${alt || '카드 이미지'} 블라인드됨`}
        title="내가 블라인드한 이미지입니다"
        onContextMenu={handleContextMenu}
      >
        <div className="flex h-9 w-9 items-center justify-center rounded-2xl border border-white/20 bg-white/12 shadow-lg backdrop-blur">
          <EyeOff className="h-4 w-4" />
        </div>
        <div className="max-w-[82%] rounded-full border border-white/15 bg-black/24 px-2.5 py-1 text-[9px] font-black shadow-sm backdrop-blur">
          블라인드된 이미지
        </div>
        {allowUnblind && (
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              unblindImage(imageSrc);
            }}
            className="pointer-events-auto mt-0.5 inline-flex items-center gap-1 rounded-full border border-white/20 bg-white/14 px-2.5 py-1 text-[9px] font-black text-white shadow-sm backdrop-blur transition hover:bg-white/24"
          >
            <RotateCcw className="h-3 w-3" /> 해제
          </button>
        )}
      </div>
      {menuNode}
      </>
    );
  }

  return (
    <>
      <img src={imageSrc} alt={alt} className={className} onContextMenu={handleContextMenu} {...props} />
      {menuNode}
    </>
  );
};
