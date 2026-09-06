import { DualRangeSlider } from '../DualRangeSlider';

interface Range {
  min: number;
  max: number;
}

export function RangeFilterContent({
  bounds,
  value,
  onChange,
  onClear,
  formatValue,
}: {
  bounds: Range;
  value: Range;
  onChange: (v: Range) => void;
  onClear: () => void;
  formatValue?: (n: number) => string;
}) {
  const fmt = formatValue ?? String;
  const isActive = value.min !== bounds.min || value.max !== bounds.max;

  return (
    <div>
      <div className="mb-1.5 flex justify-between text-[var(--color-text-muted)]">
        <span>
          {fmt(value.min)}–{fmt(value.max)}
        </span>
      </div>
      <DualRangeSlider bounds={bounds} value={value} onChange={onChange} />
      {isActive && (
        <button type="button" onClick={onClear} className="mt-2 text-[var(--color-accent)] underline">
          Clear
        </button>
      )}
    </div>
  );
}
