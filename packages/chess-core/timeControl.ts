/** How fast a game was played, as Lichess names them. */
export const SPEEDS = ['ultrabullet', 'bullet', 'blitz', 'rapid', 'classical', 'correspondence'] as const;
export type Speed = (typeof SPEEDS)[number];

/**
 * How fast a game was played, from its TimeControl tag, by Lichess's rule: the expected length is
 * the base time plus 40 increments (a game of about 40 moves each), and under 30 seconds is
 * ultrabullet, under 3 minutes bullet, under 8 blitz, under 25 rapid, and anything longer classical.
 * A time per move ("1/86400", Chess.com's daily chess) or a game with no clock that says it was
 * played by correspondence is correspondence. Anything else can't be told: null.
 */
export function speedOf(timeControl: string | null | undefined, event?: string | null): Speed | null {
  const tc = timeControl?.trim() ?? '';
  const clock = /^(\d+)(?:\+(\d+))?$/.exec(tc);
  if (clock) {
    const seconds = Number(clock[1]) + 40 * Number(clock[2] ?? 0);
    if (seconds < 30) return 'ultrabullet';
    if (seconds < 180) return 'bullet';
    if (seconds < 480) return 'blitz';
    if (seconds < 1500) return 'rapid';
    return 'classical';
  }
  if (/^\d+\/\d+$/.test(tc)) return 'correspondence';
  if ((tc === '-' || tc === '') && /correspondence|daily/i.test(event ?? '')) return 'correspondence';
  return null;
}

/** "180+2" as people say it: "3+2"; "600" is "10+0"; half a minute is "½". */
export function formatTimeControl(timeControl: string | null | undefined): string | null {
  const clock = /^(\d+)(?:\+(\d+))?$/.exec(timeControl?.trim() ?? '');
  if (!clock) return timeControl?.trim() && timeControl.trim() !== '-' ? timeControl.trim() : null;
  const minutes = Number(clock[1]) / 60;
  const base = Number.isInteger(minutes) ? String(minutes) : minutes === 0.5 ? '½' : minutes === 0.25 ? '¼' : minutes.toFixed(1);
  return `${base}+${clock[2] ?? 0}`;
}
