import { useCallback, useEffect, useRef } from 'react';
import type { RefObject } from 'react';

const TAP_SLOP = 8; // px of travel that turns a tap into a drag
const SHADOW_THROW = 18; // px the shadow slides as the card leans

/**
 * The light is fixed in the room, above and in front of the card. Nothing about it follows
 * the pointer: the pointer sets the card's angle, and the reflection goes where that angle
 * sends it. A highlight pinned under the cursor reads as a torch being carried across the
 * card; a reflection that stays put while the card turns under it reads as glossy stock.
 *
 * Where it lands follows from the surface normal. Lean an edge away and the normal turns
 * toward that edge, so the reflection slides the other way — toward the edge coming forward.
 * For a true mirror at this perspective the offset is d·θ, about 250px at full tilt, which
 * is wider than the card: the reflection would flick off the edge the instant you moved.
 * Holo stock scatters rather than mirrors, so the travel is scaled to cross most of the face
 * and only just run off, which is what makes it read as a sweep instead of a flash.
 */
const LIGHT_TRAVEL_X = 1.35;
/**
 * The same lean moves the reflection the same distance in px either way, but the card is
 * taller than it is wide, so vertically that distance covers less of the face. Scaled by the
 * 2.5:3.5 card ratio, so a diagonal lean sweeps the reflection in a straight line rather
 * than around an ellipse.
 */
const LIGHT_TRAVEL_Y = LIGHT_TRAVEL_X * (2.5 / 3.5);
/** The light is above the viewer, so its reflection sits above centre on a card held flat. */
const LIGHT_REST_Y = 34;
/**
 * A reflection seen off-axis stretches along the direction it is travelling — the same
 * reason a low sun draws a long streak on water rather than a disc. Grown from the tilt on
 * each axis independently, so a left-right lean smears it sideways.
 */
const LIGHT_SPREAD = 26;
const LIGHT_SIZE = 52;

/**
 * A card that leans toward the pointer in 3D, with a specular reflection and a holo sheen
 * cast by a fixed light — the physical-card feel the TCG games use.
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
  stars = false,
  className = '',
  imageClassName = '',
  imageRef,
  label,
}: {
  src: string;
  alt: string;
  onActivate?: () => void;
  maxTilt?: number;
  /**
   * Whether the room's light is star-shaped for this card. Deliberately a boolean and not a
   * rarity: what makes a card rare is the caller's problem, and this component's is only
   * ever the light.
   */
  stars?: boolean;
  className?: string;
  imageClassName?: string;
  imageRef?: RefObject<HTMLImageElement | null>;
  label?: string;
}) {
  // The wrapper is deliberately the untransformed element: measuring a rotated box would
  // feed the rotation back into its own input and the card would judder.
  const wrapRef = useRef<HTMLButtonElement>(null);
  const frameRef = useRef(0);
  const nextRef = useRef<{ rx: number; ry: number; lit: number } | null>(null);
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

    // The whole light model: position derived from the card's angle and nothing else. The
    // pointer's coordinates never reach this — they only ever set rx and ry above.
    const leanX = next.ry / maxTilt;
    const leanY = next.rx / maxTilt;
    el.style.setProperty('--light-x', `${(50 - leanX * LIGHT_TRAVEL_X * 50).toFixed(1)}%`);
    el.style.setProperty('--light-y', `${(LIGHT_REST_Y + leanY * LIGHT_TRAVEL_Y * 50).toFixed(1)}%`);
    el.style.setProperty('--light-w', `${(LIGHT_SIZE + Math.abs(leanX) * LIGHT_SPREAD).toFixed(1)}%`);
    el.style.setProperty('--light-h', `${(LIGHT_SIZE + Math.abs(leanY) * LIGHT_SPREAD).toFixed(1)}%`);
    el.style.setProperty('--lit', `${next.lit}`);

    // The card leaning changes how it sits under that same fixed light, so the shadow it
    // throws shifts with the lean.
    const throwX = (-next.ry / maxTilt) * SHADOW_THROW;
    const throwY = (next.rx / maxTilt) * SHADOW_THROW;
    el.style.setProperty('--shadow-x', `${throwX.toFixed(1)}px`);
    el.style.setProperty('--shadow-y', `${(throwY + 12).toFixed(1)}px`);
  }, [maxTilt]);

  const schedule = useCallback(
    (next: { rx: number; ry: number; lit: number }) => {
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
        lit: 1,
      });
    },
    [maxTilt, schedule],
  );

  const rest = useCallback(() => {
    const el = wrapRef.current;
    if (el) el.dataset.settling = 'true';
    schedule({ rx: 0, ry: 0, lit: 0 });
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
        {/* Directly on the art and under every reflection, because that is where a clear
            coat physically sits: the lacquer is above the paint, and what the light plays
            on is the lacquer. */}
        <span className="tilt-clearcoat" aria-hidden="true" />
        <span className="tilt-glare" aria-hidden="true" />
        <span className="tilt-sheen" aria-hidden="true" />
        {/* Above the soft reflection, because a glossier surface returns a sharper image of
            the light and the two are meant to read as one surface, not two. */}
        {/* Two nested masks, not two mask layers: the outer is the bar of light, the inner
            the foil stamped on the card, and what shows is the overlap. mask-composite would
            express that in one element, but intersect composites to nothing in Chrome here
            — verified with a flat red fill, both as `intersect` and as `intersect, add`. */}
        {stars && (
          <span className="tilt-stars" aria-hidden="true">
            <span className="tilt-stars-foil" />
          </span>
        )}
      </span>
    </button>
  );
}
