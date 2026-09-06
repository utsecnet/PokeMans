import { useEffect, useLayoutEffect, useRef, useState } from 'react';

const EDGE_PADDING = 8;

export interface PopoverCoords {
  top: number;
  left: number;
  openUp: boolean;
}

// Positions a popover at a viewport-clamped fixed position anchored to a trigger element,
// for rendering through a portal — an in-flow `absolute` popover gets clipped by any
// scrollable/overflow-hidden ancestor (e.g. a scrolling list it lives inside), and any
// click on that ancestor's own scrollbar reads as an "outside click" and closes it.
export function useAnchoredPopover<T extends HTMLElement>(width: number, estHeight = 200) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<PopoverCoords | null>(null);
  const triggerRef = useRef<T>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const left = Math.min(Math.max(EDGE_PADDING, rect.left), window.innerWidth - width - EDGE_PADDING);
    const openUp = rect.bottom + estHeight > window.innerHeight && rect.top > estHeight;
    setCoords({ left, top: openUp ? rect.top - 4 : rect.bottom + 4, openUp });
  }, [open, width, estHeight]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return { open, setOpen, triggerRef, popoverRef, coords };
}
