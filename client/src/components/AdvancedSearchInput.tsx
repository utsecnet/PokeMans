import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { QuerySchema } from '../lib/queryLanguage';
import {
  applySuggestion,
  computeSuggestions,
  currentToken,
  type Suggestion,
} from '../lib/advancedSearchLogic';

export function AdvancedSearchInput<T>({
  value,
  onChange,
  schema,
  placeholder,
  helpHref,
}: {
  value: string;
  onChange: (next: string) => void;
  schema: QuerySchema<T>;
  placeholder?: string;
  helpHref: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [highlight, setHighlight] = useState(0);
  const [tokenStart, setTokenStart] = useState(0);

  // Takes the text/cursor explicitly rather than reading the `value` prop, so it's never
  // one keystroke behind — an onChange fires before this component re-renders with the
  // new value, so a closure over the prop would still see the stale text.
  const refreshSuggestions = (text: string, cursor: number | null) => {
    if (cursor == null) {
      setOpen(false);
      return;
    }
    const { start, text: token } = currentToken(text, cursor);
    const next = computeSuggestions(token, schema);
    setTokenStart(start);
    setSuggestions(next);
    setHighlight(0);
    setOpen(next.length > 0);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const accept = (s: Suggestion) => {
    const el = inputRef.current;
    if (!el || el.selectionStart == null) return;
    const { text, cursor: nextCursor } = applySuggestion(value, tokenStart, el.selectionStart, s);
    onChange(text);
    setOpen(false);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(nextCursor, nextCursor);
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || suggestions.length === 0) return;
    if (e.key === 'Tab' || e.key === 'Enter') {
      e.preventDefault();
      accept(suggestions[highlight]);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => (h + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => (h - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div ref={wrapRef} className="relative flex-1">
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          refreshSuggestions(e.target.value, e.target.selectionStart);
        }}
        onKeyDown={handleKeyDown}
        onKeyUp={(e) => {
          if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
            refreshSuggestions(e.currentTarget.value, e.currentTarget.selectionStart);
          }
        }}
        onClick={(e) => refreshSuggestions(value, e.currentTarget.selectionStart)}
        onFocus={(e) => refreshSuggestions(value, e.currentTarget.selectionStart)}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 pr-16 font-mono text-sm outline-none focus:border-[var(--color-accent)]"
      />
      <Link
        to={helpHref}
        title="Advanced search help"
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full border border-[var(--color-border)] px-2 py-0.5 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-accent)]"
      >
        ?
      </Link>

      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-full max-w-sm overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg">
          {suggestions.map((s, i) => (
            <button
              key={s.label + i}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                accept(s);
              }}
              className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-sm ${
                i === highlight ? 'bg-[var(--color-accent)] text-[var(--color-accent-contrast)]' : ''
              }`}
            >
              <span className="font-mono">{s.label}</span>
              {s.hint && (
                <span
                  className={`ml-2 truncate text-xs ${
                    i === highlight ? 'text-[var(--color-accent-contrast)]/80' : 'text-[var(--color-text-muted)]'
                  }`}
                >
                  {s.hint}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
