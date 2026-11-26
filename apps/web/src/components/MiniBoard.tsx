import { DARK_SQUARE, LIGHT_SQUARE, pieceImage, placement } from '../pieces.ts';

/** A static board drawn as SVG: light enough for a grid of dozens, and for print. */
export function MiniBoard({
  fen,
  flipped = false,
  className = '',
  coordinates = false,
}: {
  fen: string;
  flipped?: boolean;
  className?: string;
  coordinates?: boolean;
}) {
  const squares = [];
  for (let r = 0; r < 8; r += 1) {
    for (let f = 0; f < 8; f += 1) {
      squares.push(
        <rect key={`${f}${r}`} x={f} y={r} width={1} height={1} fill={(r + f) % 2 === 0 ? LIGHT_SQUARE : DARK_SQUARE} />,
      );
    }
  }
  return (
    <svg viewBox="0 0 8 8" className={`block aspect-square w-full ${className}`} role="img" aria-label="Chess position">
      {squares}
      {coordinates &&
        Array.from({ length: 8 }, (_, i) => (
          <g key={i} fontSize={0.22} fontWeight={600} fontFamily="sans-serif">
            <text x={i + 0.92} y={7.94} textAnchor="end" fill={(i + 7) % 2 === 0 ? DARK_SQUARE : LIGHT_SQUARE}>
              {'abcdefgh'[flipped ? 7 - i : i]}
            </text>
            <text x={0.05} y={i + 0.25} fill={i % 2 === 0 ? DARK_SQUARE : LIGHT_SQUARE}>
              {flipped ? i + 1 : 8 - i}
            </text>
          </g>
        ))}
      {placement(fen).map(([file, rank, code]) => (
        <image
          key={`${file}${rank}`}
          href={pieceImage(code)}
          x={flipped ? 7 - file : file}
          y={flipped ? rank : 7 - rank}
          width={1}
          height={1}
        />
      ))}
    </svg>
  );
}
