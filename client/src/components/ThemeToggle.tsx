import { useTheme } from '../lib/theme';

const OPTIONS = [
  { value: 'light', label: '☀️', title: 'Light' },
  { value: 'system', label: '💻', title: 'System' },
  { value: 'dark', label: '🌙', title: 'Dark' },
] as const;

export function ThemeToggle() {
  const { preference, setPreference } = useTheme();

  return (
    <div className="flex items-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] p-0.5">
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          title={opt.title}
          aria-pressed={preference === opt.value}
          onClick={() => setPreference(opt.value)}
          className={`rounded-full px-2.5 py-1 text-sm transition ${
            preference === opt.value
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
