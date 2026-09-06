import { Link } from 'react-router-dom';
import type { EvolutionNode } from '../types';
import { formatName } from '../lib/format';

function TransitionHint({ node }: { node: EvolutionNode }) {
  if (!node.trigger) return null;
  return (
    <div className="flex flex-col items-center px-1 text-[10px] leading-tight text-[var(--color-text-muted)]">
      <span className="text-sm">→</span>
      {node.minLevel != null && <span>Lv. {node.minLevel}</span>}
      {node.item && <span className="max-w-[4.5rem] truncate capitalize">{formatName(node.item)}</span>}
      {!node.minLevel && !node.item && node.trigger !== 'level-up' && (
        <span className="max-w-[4.5rem] truncate capitalize">{formatName(node.trigger)}</span>
      )}
    </div>
  );
}

function NodeCard({ node, currentId }: { node: EvolutionNode; currentId?: number }) {
  const isCurrent = node.id === currentId;
  return (
    <Link
      to={`/pokemon/${node.id}`}
      className={`flex flex-col items-center rounded-lg p-1.5 transition ${
        isCurrent
          ? // ring-inset keeps the highlight confined to this node's own box — a
            // non-inset ring draws as a box-shadow extending outward past the element's
            // edges, which pokes outside the scroll container when this is the first
            // (leftmost) node in the chain, with no margin to absorb the overflow.
            'bg-[var(--color-accent)]/10 ring-2 ring-inset ring-[var(--color-accent)]'
          : 'hover:bg-[var(--color-bg)]'
      }`}
    >
      <img
        src={node.spriteUrl ?? undefined}
        alt={node.name}
        className="h-14 w-14 object-contain"
      />
      <span className={`text-xs capitalize ${isCurrent ? 'font-semibold' : ''}`}>
        {formatName(node.name)}
      </span>
    </Link>
  );
}

function Branch({ node, currentId }: { node: EvolutionNode; currentId?: number }) {
  return (
    <div className="flex items-center">
      <NodeCard node={node} currentId={currentId} />
      {node.children.length > 0 && (
        <div className="flex flex-col gap-1">
          {node.children.map((child) => (
            <div key={child.id} className="flex items-center">
              <TransitionHint node={child} />
              <Branch node={child} currentId={currentId} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function EvolutionTree({
  root,
  currentId,
}: {
  root: EvolutionNode;
  currentId?: number;
}) {
  return (
    <div className="overflow-x-auto">
      <div className="inline-flex min-w-full">
        <Branch node={root} currentId={currentId} />
      </div>
    </div>
  );
}
