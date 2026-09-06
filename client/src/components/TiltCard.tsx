import { useCallback, useEffect, useRef } from 'react';
import type { RefObject } from 'react';

const TAP_SLOP = 8; // px of travel that turns a tap into a drag
const SHADOW_THROW = 18; // px the shadow slides as the card leans away from the light

/**
 * A card that leans toward the pointer in 3D, with a specular highlight and a holo sheen
 * that track the light source — the physical-card feel the TCG games use.
 *
 * With a mouse it follows the cursor on hover; with touch or a pen it follows a drag, so
 * the card can be turned on a phone the same way. A press that doesn't travel is a tap and
 * calls `onActivate`; anything past `TAP_SLOP` is a rotation and is swallowed, so turning
 * the card never doubles as clicking it.
 *
 * Pointer moves fire far faster than React can usefully re-render, so nothing here is
 * state: handlers write CSS custom properties on the wrapper inside one rAF, and the
 * transform, glare and shadow are all pure CSS reading those properties.
 */
export function TiltCard({
  src,
  alt,
  onActivate,
  maxTilt = 12,
  className = '',
  imageClassName = '',
  imageRef,
  label,
}: {
  src: string;
  alt: string;
  onActivate?: () => void;
  maxTilt?: number;
  className?: string;
  imageClassName?: string;
  imageRef?: RefObject<HTMLImageElement | null>;
  label?: string;
}) {
  // The wrapper is deliberately the untransformed element: measuring a rotated box would
  // feed the rotation back into its own input and the card would judder.
  const wrapRef = useRef<HTMLButtonElement>(null);
  const frameRef = useRef(0);
  const nextRef = useRef<{ rx: number; ry: number; mx: number; my: number; glare: number } | null>(null);
  const draggingRef = useRef(false);
  const movedRef = useRef(false);
  const startRef = useRef({ x: 0, y: 0 });

  const flush = useCallback(() => {
    frameRef.current = 0;
    const el = wrapRef.current;
    const next = nextRef.current;
    if (!el || !next) return;
    el.style.setProperty('--tilt-x', `${next.rx.toFixed(2)}deg`);
    el.style.setProperty('--tilt-y', `${next.ry.toFixed(2)}deg`);
    el.style.setProperty('--glare-x', `${next.mx.toFixed(1)}%`);
    el.style.setProperty('--glare-y', `${next.my.toFixed(1)}%`);
    el.style.setProperty('--glare', `${next.glare}`);
    // The shadow falls away from the highlight, which is what sells the light as a light
    // rather than a sticker painted on the card.
    const throwX = (-next.ry / maxTilt) * SHADOW_THROW;
    const throwY = (next.rx / maxTilt) * SHADOW_THROW;
    el.style.setProperty('--shadow-x', `${throwX.toFixed(1)}px`);
    el.style.setProperty('--shadow-y', `${(throwY + 12).toFixed(1)}px`);
  }, [maxTilt]);

  const schedule = useCallback(
    (next: { rx: number; ry: number; mx: number; my: number; glare: number }) => {
      nextRef.current = next;
      if (!frameRef.current) frameRef.current = requestAnimationFrame(flush);
    },
    [flush],
  );

  const track = useCallback(
    (clientX: number, clientY: number) => {
      const el = wrapRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const cx = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      const cy = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
      el.dataset.settling = 'false';
      schedule({
        // Positive rotateY pushes the right edge back and positive rotateX pushes the top
        // back, so the corner under the pointer is always the one being leaned away.
        ry: (cx - 0.5) * 2 * maxTilt,
        rx: -(cy - 0.5) * 2 * maxTilt,
        mx: cx * 100,
        my: cy * 100,
        glare: 1,
      });
    },
    [maxTilt, schedule],
  );

  const rest = useCallback(() => {
    const el = wrapRef.current;
    if (el) el.dataset.settling = 'true';
    schedule({ rx: 0, ry: 0, mx: 50, my: 50, glare: 0 });
  }, [schedule]);

  useEffect(() => () => cancelAnimationFrame(frameRef.current), []);

  const handleDown = (e: React.PointerEvent) => {
    draggingRef.current = true;
    movedRef.current = false;
    startRef.current = { x: e.clientX, y: e.clientY };
    try {
      wrapRef.current?.setPointerCapture(e.pointerId);
    } catch {
      // Capture is a nicety — without it a drag that leaves the card just stops early.
    }
    track(e.clientX, e.clientY);
  };

  const handleMove = (e: React.PointerEvent) => {
    if (draggingRef.current && !movedRef.current) {
      const dx = e.clientX - startRef.current.x;
      const dy = e.clientY - startRef.current.y;
      if (dx * dx + dy * dy > TAP_SLOP * TAP_SLOP) movedRef.current = true;
    }
    if (e.pointerType === 'mouse' || draggingRef.current) track(e.clientX, e.clientY);
  };

  const handleUp = (e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    if (wrapRef.current?.hasPointerCapture(e.pointerId)) {
      wrapRef.current.releasePointerCapture(e.pointerId);
    }
    // A mouse keeps its lean while the cursor is still over the card; a finger that has
    // lifted is no longer pointing at anything, so the card settles back.
    if (e.pointerType !== 'mouse') rest();
  };

  return (
    <button
      type="button"
      ref={wrapRef}
      aria-label={label ?? alt}
      data-settling="true"
      className={`tilt ${className}`}
      onPointerDown={handleDown}
      onPointerMove={handleMove}
      onPointerUp={handleUp}
      onPointerCancel={handleUp}
      onPointerLeave={() => {
        if (!draggingRef.current) rest();
      }}
      onBlur={rest}
      onClick={() => {
        if (movedRef.current) {
          movedRef.current = false;
          return;
        }
        onActivate?.();
      }}
    >
      <span className="tilt-inner">
        <img
          ref={imageRef}
          src={src}
          alt={alt}
          draggable={false}
          className={`tilt-image ${imageClassName}`}
        />
        <span className="tilt-glare" aria-hidden="true" />
        <span className="tilt-sheen" aria-hidden="true" />
      </span>
    </button>
  );
}
