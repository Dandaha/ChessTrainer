import type { ConceptLevel } from '../api.ts';

/** A concept's level, basic to advanced: how far along a player usually is when it starts to matter. */

export const LEVELS: readonly ConceptLevel[] = ['basic', 'intermediate', 'advanced'];

export const LEVEL_NAMES: Record<ConceptLevel, string> = {
  basic: 'Basic',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
};

/** Easiest first, the ones without a level last. */
export const levelRank = (level: ConceptLevel | null) => (level ? LEVELS.indexOf(level) : LEVELS.length);

const BAR_HEIGHTS = ['h-1.5', 'h-2.5', 'h-3.5'];

/**
 * Three bars, one to three of them filled, like a signal: the level at a glance, named on hover. Only
 * a picture: wherever it stands the level is also written (the row's tooltip, the group's name, the
 * page), so screen readers skip it rather than read the name twice.
 */
export function LevelMark({ level, className = '' }: { level: ConceptLevel; className?: string }) {
  const filled = LEVELS.indexOf(level) + 1;
  return (
    <span aria-hidden title={LEVEL_NAMES[level]} data-level={level} className={`inline-flex h-3.5 shrink-0 items-end gap-[2px] ${className}`}>
      {BAR_HEIGHTS.map((height, i) => (
        <span key={height} className={`w-[3px] rounded-[1px] bg-current ${height} ${i < filled ? '' : 'opacity-25'}`} />
      ))}
    </span>
  );
}

/** The editor's choice of level: not set, or one of the three. */
export function LevelPicker({ value, onChange }: { value: ConceptLevel | null; onChange(level: ConceptLevel | null): void }) {
  const options: [ConceptLevel | null, string][] = [[null, 'Not set'], ...LEVELS.map((l): [ConceptLevel, string] => [l, LEVEL_NAMES[l]])];
  return (
    <div role="radiogroup" aria-label="Level" className="flex w-full rounded-lg border border-field bg-surface p-0.5">
      {options.map(([level, name]) => {
        const on = value === level;
        return (
          <button
            key={name}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(level)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1 text-sm transition-colors ${
              on ? 'bg-accent-soft font-medium text-text' : 'text-muted hover:text-text'
            }`}
          >
            {level && <LevelMark level={level} className={on ? 'text-accent' : ''} />}
            {name}
          </button>
        );
      })}
    </div>
  );
}
