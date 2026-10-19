/**
 * The rename affordance.
 *
 * A collection title has always been editable by clicking it, and nothing on screen said so
 * -- issue #1 asked for an ability that was already there and invisible. This is that
 * ability made visible, and it opens the same inline form clicking the title does.
 */
export function PencilIcon({ className = 'size-4' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      className={className}
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M16.9 4.5l1.7-1.7a1.9 1.9 0 112.6 2.6L10.6 16.1a4.5 4.5 0 01-1.9 1.1L6 18l.8-2.7a4.5 4.5 0 011.1-1.9L16.9 4.5zm0 0L19.5 7.1"
      />
    </svg>
  );
}
