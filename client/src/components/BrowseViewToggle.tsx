import { useLocation, useNavigate } from 'react-router-dom';
import { useBrowseView, type BrowseView } from '../lib/browseView';

const OPTIONS: { value: BrowseView; label: string }[] = [
  { value: 'pokemon', label: 'Pokémon' },
  { value: 'cards', label: 'Cards' },
];

export function BrowseViewToggle() {
  const { view, setView } = useBrowseView();
  const navigate = useNavigate();
  const location = useLocation();

  const select = (next: BrowseView) => {
    setView(next);
    // From a detail, collection, or settings page these double as top-level navigation:
    // picking a view takes you back to the browser already showing it.
    if (location.pathname !== '/') navigate('/');
  };

  return (
    <div
      role="group"
      aria-label="Browse"
      className="flex items-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] p-0.5"
    >
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          aria-pressed={view === opt.value}
          onClick={() => select(opt.value)}
          className={`rounded-full px-2.5 py-1 text-xs font-medium transition sm:px-3.5 sm:text-sm ${
            view === opt.value
              ? 'bg-[var(--color-accent)] text-[var(--color-accent-contrast)]'
              : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
