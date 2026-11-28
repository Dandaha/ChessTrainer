import type { Game, Header } from '@chess/chess-core';
import { useState } from 'react';
import { Modal } from '../Dialogs.tsx';
import { buttonClass, inputClass, primaryClass } from './ui.tsx';

/**
 * The game's header tags: the seven every PGN has, then any others (Elo, opening, time control…).
 * FEN and SetUp are left alone: they say where the moves start.
 */

const ROSTER = ['Event', 'Site', 'Date', 'Round', 'White', 'Black'] as const;
const FIXED = new Set<string>([...ROSTER, 'Result', 'FEN', 'SetUp']);
const SUGGESTED = ['WhiteElo', 'BlackElo', 'ECO', 'Opening', 'TimeControl', 'Termination', 'Annotator', 'PlyCount', 'UTCDate', 'UTCTime'];
const RESULTS = ['*', '1-0', '0-1', '1/2-1/2'];

/** What is wrong with the tags, or null. */
export function tagProblem(roster: Record<string, string>, extra: Header[]): string | null {
  const date = roster.Date?.trim();
  if (date && !/^(\d{4}|\?{4})\.(\d{2}|\?\?)\.(\d{2}|\?\?)$/.test(date)) return 'Write the date as 2026.11.28, with ?? for an unknown part.';
  const names = new Set<string>();
  for (const { name, value } of extra) {
    if (!name.trim() && !value.trim()) continue;
    if (!/^[A-Za-z0-9_]+$/.test(name.trim())) return `“${name}” cannot be a tag name: letters, digits and _ only.`;
    if (FIXED.has(name.trim()) || names.has(name.trim())) return `There is already a ${name.trim()} tag.`;
    names.add(name.trim());
    if (/Elo$/.test(name.trim()) && value.trim() && !/^\d{1,4}$/.test(value.trim())) return `${name.trim()} is a number, such as 1850.`;
  }
  return null;
}

export function GameTagsDialog({ game, onSave, onClose }: { game: Game; onSave(headers: Header[], result: string): void; onClose(): void }) {
  const value = (name: string) => game.headers.find((h) => h.name === name)?.value ?? '';
  const [roster, setRoster] = useState<Record<string, string>>(() =>
    Object.fromEntries(ROSTER.map((name) => [name, ['?', '????.??.??'].includes(value(name)) ? '' : value(name)])),
  );
  const [result, setResult] = useState(game.result);
  const [extra, setExtra] = useState<Header[]>(() => game.headers.filter((h) => !FIXED.has(h.name)).map((h) => ({ ...h })));
  const problem = tagProblem(roster, extra);
  const setUp = game.headers.filter((h) => h.name === 'FEN' || h.name === 'SetUp');

  const save = () => {
    if (problem) return;
    const headers: Header[] = [
      ...ROSTER.filter((name) => roster[name]!.trim()).map((name) => ({ name, value: roster[name]!.trim() })),
      { name: 'Result', value: result },
      ...setUp,
      ...extra.filter((h) => h.name.trim() && h.value.trim()).map((h) => ({ name: h.name.trim(), value: h.value.trim() })),
    ];
    onSave(headers, result);
    onClose();
  };

  return (
    <Modal title="Game tags" onClose={onClose}>
      <form
        className="space-y-3 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <div className="grid grid-cols-[6rem_1fr] items-center gap-x-3 gap-y-1.5">
          {ROSTER.map((name) => (
            <label key={name} className="contents">
              <span className="text-muted">{name}</span>
              <input
                aria-label={name}
                className={inputClass}
                value={roster[name]}
                placeholder={name === 'Date' ? 'YYYY.MM.DD' : name === 'Round' ? 'e.g. 1' : ''}
                onChange={(e) => setRoster((r) => ({ ...r, [name]: e.target.value }))}
              />
            </label>
          ))}
          <label className="contents">
            <span className="text-muted">Result</span>
            <select aria-label="Result" className={`${inputClass} w-40`} value={result} onChange={(e) => setResult(e.target.value)}>
              {RESULTS.map((r) => (
                <option key={r} value={r}>
                  {r === '*' ? 'Unfinished (*)' : r === '1/2-1/2' ? '½-½' : r}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="space-y-1.5">
          <span className="block text-xs text-muted">Other tags</span>
          <datalist id="tag-names">
            {SUGGESTED.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
          {extra.map((h, i) => (
            <div key={i} className="flex gap-2">
              <input
                aria-label="Tag name"
                list="tag-names"
                className={`${inputClass} w-36`}
                value={h.name}
                onChange={(e) => setExtra((list) => list.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
              />
              <input
                aria-label={`${h.name || 'Tag'} value`}
                className={`${inputClass} min-w-0 flex-1`}
                value={h.value}
                onChange={(e) => setExtra((list) => list.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
              />
              <button type="button" aria-label={`Remove ${h.name || 'tag'}`} className="px-1 text-muted hover:text-danger" onClick={() => setExtra((list) => list.filter((_, j) => j !== i))}>
                ✕
              </button>
            </div>
          ))}
          <button type="button" className="text-xs text-accent hover:underline" onClick={() => setExtra((list) => [...list, { name: '', value: '' }])}>
            + Add a tag
          </button>
        </div>

        {setUp.length > 0 && <p className="text-xs text-muted">The game starts from a set-up position (its FEN tag stays as it is).</p>}
        {problem && (
          <p role="alert" className="text-xs text-danger">
            {problem}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className={buttonClass} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={primaryClass} disabled={problem !== null}>
            Save tags
          </button>
        </div>
      </form>
    </Modal>
  );
}
