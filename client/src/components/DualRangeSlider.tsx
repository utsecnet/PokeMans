import { useEffect, useRef, useState } from 'react';

interface Range {
  min: number;
  max: number;
}

// Both thumbs are visual only (pointer-events: none) — all pointer interaction is
// handled by the track itself, which decides in code which thumb a given pointer
// position should move. That's deliberate: when the min and max thumbs are dragged to
// the same spot (fully valid — e.g. min pushed all the way up against max), two
// separately-hit-testable overlapping elements have no reliable way to both stay
// clickable, since whichever is later in paint order always wins the hit test and the
// other becomes permanently unreachable. Routing everything through one always-hit
// track sidesteps that entirely. Keyboard access (Tab + arrow keys) still targets each
// thumb individually via a real focusable element per thumb.
export function DualRangeSlider({
  bounds,
  value,
  onChange,
  step = 1,
}: {
  bounds: Range;
  value: Range;
  onChange: (value: Range) => void;
  step?: number;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const minThumbRef = useRef<HTMLDivElement>(null);
  const maxThumbRef = useRef<HTMLDivElement>(null);
  const valueRef = useRef(value);
  valueRef.current = value;
  const [dragging, setDragging] = useState<'min' | 'max' | null>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);

  // If this slider unmounts mid-drag (e.g. the filter panel it's in goes away because the
  // view switched, or the page navigated) the pointerup that would normally remove these
  // window listeners never fires — clean up on unmount too, not just on pointerup.
  useEffect(() => {
    return () => dragCleanupRef.current?.();
  }, []);

  const { min, max } = bounds;
  const span = Math.max(1, max - min);
  const minPct = ((value.min - min) / span) * 100;
  const maxPct = ((value.max - min) / span) * 100;

  // The two thumbs are never allowed within this many value-units of each other — kept
  // in value terms (a % of the span) rather than pixels so it holds regardless of how
  // wide the track renders. This is on top of (not instead of) routing all pointer
  // handling through the track: it guarantees the thumbs stay two visually distinct,
  // separately-grabbable dots instead of one merged blob, even at rest.
  const minGap = Math.max(step, span * 0.03);

  const posToValue = (clientX: number) => {
    const track = trackRef.current;
    if (!track) return min;
    const rect = track.getBoundingClientRect();
    const ratio = rect.width === 0 ? 0 : Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const raw = min + ratio * span;
    return Math.round(raw / step) * step;
  };

  const moveThumb = (thumb: 'min' | 'max', raw: number) => {
    const current = valueRef.current;
    if (thumb === 'min') {
      const next = Math.max(min, Math.min(raw, current.max - minGap));
      if (next !== current.min) onChange({ min: next, max: current.max });
    } else {
      const next = Math.min(max, Math.max(raw, current.min + minGap));
      if (next !== current.max) onChange({ min: current.min, max: next });
    }
  };

  const handleTrackDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const raw = posToValue(e.clientX);
    const current = valueRef.current;
    const distToMin = Math.abs(raw - current.min);
    const distToMax = Math.abs(raw - current.max);
    // Ties (thumbs coincide, or the click lands exactly between them) go to whichever
    // side of the pair the pointer is on, so both remain reachable from a resting state.
    const thumb: 'min' | 'max' =
      distToMin !== distToMax
        ? distToMin < distToMax
          ? 'min'
          : 'max'
        : raw < (current.min + current.max) / 2
          ? 'min'
          : 'max';

    e.preventDefault();
    const track = e.currentTarget;
    track.setPointerCapture(e.pointerId);
    setDragging(thumb);
    (thumb === 'min' ? minThumbRef : maxThumbRef).current?.focus();
    moveThumb(thumb, raw);

    const move = (ev: PointerEvent) => moveThumb(thumb, posToValue(ev.clientX));
    const cleanup = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      dragCleanupRef.current = null;
    };
    const up = () => {
      setDragging(null);
      cleanup();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    dragCleanupRef.current = cleanup;
  };

  const handleKeyDown = (thumb: 'min' | 'max', e: React.KeyboardEvent) => {
    let delta = 0;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') delta = -step;
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') delta = step;
    else return;
    e.preventDefault();
    const current = valueRef.current;
    moveThumb(thumb, (thumb === 'min' ? current.min : current.max) + delta);
  };

  return (
    <div
      ref={trackRef}
      className="relative h-4 cursor-pointer touch-none"
      onPointerDown={handleTrackDown}
    >
      <div className="pointer-events-none absolute top-1/2 h-1 w-full -translate-y-1/2 rounded-full bg-[var(--color-border)]" />
      <div
        className="pointer-events-none absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-[var(--color-accent)]"
        style={{ left: `${minPct}%`, right: `${100 - maxPct}%` }}
      />
      <div
        ref={minThumbRef}
        role="slider"
        tabIndex={0}
        aria-label="Minimum"
        aria-valuemin={min}
        aria-valuemax={value.max}
        aria-valuenow={value.min}
        onKeyDown={(e) => handleKeyDown('min', e)}
        className={`pointer-events-none absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--color-surface)] bg-[var(--color-accent)] shadow focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] ${dragging === 'min' ? 'z-20' : 'z-10'}`}
        style={{ left: `${minPct}%` }}
      />
      <div
        ref={maxThumbRef}
        role="slider"
        tabIndex={0}
        aria-label="Maximum"
        aria-valuemin={value.min}
        aria-valuemax={max}
        aria-valuenow={value.max}
        onKeyDown={(e) => handleKeyDown('max', e)}
        className={`pointer-events-none absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--color-surface)] bg-[var(--color-accent)] shadow focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] ${dragging === 'max' ? 'z-20' : 'z-10'}`}
        style={{ left: `${maxPct}%` }}
      />
    </div>
  );
}
