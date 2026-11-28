import type { MaterialRole, MaterialSide } from '@chess/chess-core';
import { pieceImage } from '../pieces.ts';

const NAMES: Record<MaterialRole, [string, string]> = {
  q: ['queen', 'queens'],
  r: ['rook', 'rooks'],
  b: ['bishop', 'bishops'],
  n: ['knight', 'knights'],
  p: ['pawn', 'pawns'],
};

/**
 * One side's strip at the board's edge, as on chess sites: the pieces it has taken more of than it
 * lost, in the colour of the side they were taken from (several of a kind overlap), and its lead in
 * points. Always its height, so the board does not move when the material changes.
 */
export function MaterialStrip({ side, material }: { side: 'white' | 'black'; material: MaterialSide }) {
  const groups = (['q', 'r', 'b', 'n', 'p'] as const)
    .map((role) => ({ role, count: material.up.filter((r) => r === role).length }))
    .filter((g) => g.count > 0);
  const taken = side === 'white' ? (role: MaterialRole) => role : (role: MaterialRole) => role.toUpperCase();
  const said = groups.map((g) => `${g.count} ${NAMES[g.role][g.count === 1 ? 0 : 1]}`).join(', ');
  const label = `${side === 'white' ? 'White' : 'Black'}${material.lead ? ` +${material.lead}` : ''}${said ? `: up ${said}` : ''}`;
  return (
    <div className="flex h-5 w-full items-center gap-1.5 text-xs text-muted" aria-label={groups.length || material.lead ? label : undefined} data-testid={`material-${side}`}>
      {groups.map((g) => (
        <span key={g.role} className="flex">
          {Array.from({ length: g.count }, (_, i) => (
            <img key={i} src={pieceImage(taken(g.role))} alt="" className={`h-4 w-4 ${i ? '-ml-2' : ''}`} />
          ))}
        </span>
      ))}
      {material.lead > 0 && <span className="font-semibold tabular-nums">+{material.lead}</span>}
    </div>
  );
}
