import { createPortal } from 'react-dom';
import type { MouseEvent, ReactNode, RefObject } from 'react';
import type { PopoverCoords } from '../lib/useAnchoredPopover';

export function PortalPopoverPanel({
  popoverRef,
  coords,
  width,
  className = '',
  onClick,
  children,
}: {
  popoverRef: RefObject<HTMLDivElement | null>;
  coords: PopoverCoords;
  width: number;
  className?: string;
  onClick?: (e: MouseEvent) => void;
  children: ReactNode;
}) {
  return createPortal(
    <div
      ref={popoverRef}
      onClick={onClick ?? ((e) => e.stopPropagation())}
      style={{
        position: 'fixed',
        top: coords.top,
        left: coords.left,
        width,
        transform: coords.openUp ? 'translateY(-100%)' : undefined,
      }}
      className={`z-50 ${className}`}
    >
      {children}
    </div>,
    document.body,
  );
}
