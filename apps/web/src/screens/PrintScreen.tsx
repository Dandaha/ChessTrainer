import { useEffect, useState } from 'react';
import { type SavedPosition, api } from '../api.ts';
import { MiniBoard } from '../components/MiniBoard.tsx';
import { navigate } from '../router.ts';

/**
 * A printable worksheet for a set: boards with room to write, answers on the
 * last page. "Print" in the browser saves it as a PDF.
 */
export function PrintScreen({ setId }: { setId: string }) {
  const [items, setItems] = useState<SavedPosition[] | null>(null);
  const [name, setName] = useState('');

  useEffect(() => {
    api.savedPositions({ setId, limit: 500 }).then((d) => setItems(d.positions)).catch(() => setItems([]));
    api.sets().then((sets) => setName(sets.find((s) => s.id === setId)?.name ?? 'Worksheet')).catch(() => {});
  }, [setId]);

  if (!items) return <p className="p-8">Loading…</p>;

  return (
    <div className="worksheet mx-auto max-w-[50rem] bg-white p-8 text-black">
      <div className="mb-6 flex items-center gap-3 print:hidden">
        <button type="button" onClick={() => window.print()} className="rounded-md bg-[#2f6b4a] px-3 py-1.5 text-sm font-medium text-white">
          Print or save as PDF
        </button>
        <button type="button" onClick={() => navigate('positions')} className="rounded-md border border-[#ddd] px-3 py-1.5 text-sm">
          Back
        </button>
        <span className="text-sm text-[#666]">In the print dialog, choose “Save as PDF” for a file.</span>
      </div>

      <h1 className="mb-1 text-2xl font-semibold [overflow-wrap:anywhere]">{name}</h1>
      <p className="mb-6 text-sm text-[#666]">Name: ______________________ Date: ____________</p>

      <div className="grid grid-cols-2 gap-x-8 gap-y-6">
        {items.map((p, i) => (
          <div key={p.id} className="min-w-0 break-inside-avoid space-y-2 [overflow-wrap:anywhere]">
            <div className="text-sm font-semibold">
              {i + 1}. {p.title}{' '}
              <span className="font-normal text-[#666]">({p.sideToSolve === 'white' ? 'White' : 'Black'} to play)</span>
            </div>
            <MiniBoard fen={p.fen} flipped={p.sideToSolve === 'black'} coordinates />
            <div className="space-y-3 pt-1">
              <div className="border-b border-[#bbb]" style={{ height: '1.4rem' }} />
              <div className="border-b border-[#bbb]" style={{ height: '1.4rem' }} />
            </div>
          </div>
        ))}
      </div>

      <section className="mt-10 break-before-page">
        <h2 className="mb-4 text-xl font-semibold">Answers</h2>
        <ol className="space-y-2 text-sm [overflow-wrap:anywhere]">
          {items.map((p, i) => (
            <li key={p.id}>
              <span className="font-semibold">
                {i + 1}. {p.title}:
              </span>{' '}
              {[p.answer, p.keyIdea].filter(Boolean).join(' — ') || <span className="text-[#888]">no answer written</span>}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
