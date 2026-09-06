import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const POPOVER_WIDTH = 224; // w-56
const EDGE_PADDING = 8;
const EST_HEIGHT = 260; // rough ceiling for the tallest popover content, used only to decide flip-up vs flip-down

// Small "funnel" icon + popover used in table column headers. Rendered through a portal
// at a viewport-clamped fixed position rather than as a normal absolutely-positioned
// child — the table wraps in overflow-x-auto for horizontal scrolling, which clips any
// in-flow popover that tries to extend past its edge (most visibly the rightmost column's
// filter, hidden behind the table's own right edge).
export function FilterPopover({
  active,
  children,
}: {
  active: boolean;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number; openUp: boolean } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    const left = Math.min(
      Math.max(EDGE_PADDING, rect.left),
      window.innerWidth - POPOVER_WIDTH - EDGE_PADDING,
    );
    const openUp = rect.bottom + EST_HEIGHT > window.innerHeight && rect.top > EST_HEIGHT;
    setCoords({
      left,
      top: openUp ? rect.top - 4 : rect.bottom + 4,
      openUp,
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (btnRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        title="Filter"
        className={`ml-1 inline-flex h-4 w-4 items-center justify-center rounded ${
          active ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
        }`}
      >
        <svg viewBox="0 0 24 24" fill="currentColor" className="h-3 w-3">
          <path d="M3 4a1 1 0 0 1 1-1h16a1 1 0 0 1 .8 1.6l-6.3 8.2v6a1 1 0 0 1-1.45.9l-3-1.5A1 1 0 0 1 9.5 17v-3.2L3.2 5.6A1 1 0 0 1 3 4Z" />
        </svg>
      </button>
      {open &&
        coords &&
        createPortal(
          <div
            ref={popoverRef}
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'fixed',
              top: coords.top,
              left: coords.left,
              width: POPOVER_WIDTH,
              transform: coords.openUp ? 'translateY(-100%)' : undefined,
            }}
            className="z-50 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-left text-xs font-normal normal-case shadow-lg"
          >
            {children(() => setOpen(false))}
          </div>,
          document.body,
        )}
    </>
  );
}
