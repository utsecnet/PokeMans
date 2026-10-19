import { useUnits } from '../lib/unitsContext';

/**
 * Metric or imperial, in the shape of the theme toggle.
 *
 * The two readings either side of it on the settings page are what the labels do not say:
 * the words name the system, and 1m next to 3ft shows what picking it does.
 */
const OPTIONS = [
  { value: 'metric', label: 'metric' },
  { value: 'imperial', label: 'imperial' },
] as const;

export function UnitToggle() {
  const { system, setSystem } = useUnits();

  return (
    <div className="flex items-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] p-0.5">
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          aria-pressed={system === opt.value}
          onClick={() => setSystem(opt.value)}
          className={`rounded-full px-3 py-1 text-sm transition ${
            system === opt.value
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
