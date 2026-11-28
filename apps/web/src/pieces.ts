import piecesCss from '@lichess-org/chessground/assets/chessground.cburnett.css?raw';

/**
 * The piece images the board uses, taken from chessground's own stylesheet,
 * so mini-boards, PNG exports and printed worksheets look like the board.
 */

export type PieceCode = 'K' | 'Q' | 'R' | 'B' | 'N' | 'P' | 'k' | 'q' | 'r' | 'b' | 'n' | 'p';

const ROLE: Record<string, string> = { k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' };

const images = new Map<string, string>();
for (const match of piecesCss.matchAll(/piece\.(\w+)\.(white|black)\s*\{\s*background-image:\s*url\('([^']+)'\)/g)) {
  images.set(`${match[1]}.${match[2]}`, match[3]!);
}

/** The data: URL of a piece, by FEN letter. */
export function pieceImage(code: string): string {
  const color = code === code.toUpperCase() ? 'white' : 'black';
  return images.get(`${ROLE[code.toLowerCase()]}.${color}`) ?? '';
}

/** The pieces of a FEN's placement field as [file 0-7, rank 0-7 from the bottom, letter]. */
export function placement(fen: string): [number, number, string][] {
  const out: [number, number, string][] = [];
  fen
    .split(' ')[0]!
    .split('/')
    .forEach((row, i) => {
      let file = 0;
      for (const ch of row) {
        if (/\d/.test(ch)) file += Number(ch);
        else {
          out.push([file, 7 - i, ch]);
          file += 1;
        }
      }
    });
  return out;
}

export const LIGHT_SQUARE = '#f0d9b5';
export const DARK_SQUARE = '#b58863';

/** Draws a position onto a canvas and returns it as a PNG blob. */
export async function boardPng(fen: string, flipped: boolean, size = 800): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const sq = size / 8;
  for (let r = 0; r < 8; r += 1) {
    for (let f = 0; f < 8; f += 1) {
      ctx.fillStyle = (r + f) % 2 === 0 ? LIGHT_SQUARE : DARK_SQUARE;
      ctx.fillRect(f * sq, r * sq, sq, sq);
    }
  }
  await Promise.all(
    placement(fen).map(
      ([file, rank, code]) =>
        new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = () => {
            const x = flipped ? 7 - file : file;
            const y = flipped ? rank : 7 - rank;
            ctx.drawImage(img, x * sq, y * sq, sq, sq);
            resolve();
          };
          img.onerror = () => resolve();
          img.src = pieceImage(code);
        }),
    ),
  );
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'));
}

export function download(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A file name from a title, keeping letters and digits of any alphabet (Каспаров, 李), dropping the rest. */
export function safeFileName(name: string): string {
  return name.normalize('NFC').replace(/[^\p{L}\p{N}\- ]+/gu, '').trim().replace(/\s+/g, '-') || 'position';
}
