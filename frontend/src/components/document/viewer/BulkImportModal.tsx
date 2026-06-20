import React, { useState } from 'react';
import { ClipboardList, X, Eye } from 'lucide-react';
import { useBulkCreateBlocos } from '../../../hooks/useBlocos';

/** Parse raw pasted text into paragraphs */
function parseTextoBlocos(raw: string): string[] {
  return raw
    .split(/\n{2,}/)
    .map(p => p.replace(/\s+/g, ' ').trim())
    .filter(p => p.length > 0);
}

interface BulkImportModalProps {
  documentId: number;
  nextOrdem: number;   // ordem of the last existing bloco + 1
  onClose: () => void;
}

export const BulkImportModal: React.FC<BulkImportModalProps> = ({ documentId, nextOrdem, onClose }) => {
  const [rawText, setRawText] = useState('');
  const [preview, setPreview] = useState<string[]>([]);
  const [previewing, setPreviewing] = useState(false);
  const { mutate: bulkCreate, isPending } = useBulkCreateBlocos();

  const handlePreview = () => {
    const parsed = parseTextoBlocos(rawText);
    setPreview(parsed);
    setPreviewing(true);
  };

  const handleImport = () => {
    const parsed = previewing ? preview : parseTextoBlocos(rawText);
    if (!parsed.length) return;

    const items = parsed.map((conteudo, idx) => ({
      documento_id: documentId,
      conteudo,
      ordem: nextOrdem + idx,
      tipo: 'texto_livre',
    }));

    bulkCreate(items, { onSuccess: onClose });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/40 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-card w-full max-w-2xl rounded-xl shadow-2xl flex flex-col max-h-[85vh] border border-border overflow-hidden">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between bg-zinc-50 dark:bg-zinc-900 shrink-0">
          <div className="flex items-center gap-2 font-semibold text-zinc-800 dark:text-zinc-200">
            <ClipboardList size={18} className="text-blue-500" />
            Importar Texto em Lote
          </div>
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-zinc-200 text-zinc-500 transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {!previewing ? (
            <>
              <p className="text-sm text-zinc-500">
                Cole o texto abaixo. Cada <strong>parágrafo separado por linha em branco</strong> se tornará um bloco independente.
              </p>
              <textarea
                value={rawText}
                onChange={e => setRawText(e.target.value)}
                placeholder="Cole o texto aqui…"
                autoFocus
                className="w-full min-h-[280px] resize-y border border-border rounded-lg p-4 text-sm bg-transparent text-zinc-800 dark:text-zinc-200 outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400 font-mono leading-relaxed"
              />
            </>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <p className="text-sm text-zinc-600 font-medium">
                  Pré-visualização — <span className="text-blue-600 font-semibold">{preview.length} bloco{preview.length !== 1 ? 's' : ''}</span> serão criados
                </p>
                <button
                  onClick={() => setPreviewing(false)}
                  className="text-xs text-zinc-500 hover:text-zinc-700 underline underline-offset-2"
                >
                  Editar texto
                </button>
              </div>
              <ol className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
                {preview.map((p, i) => (
                  <li key={i} className="flex gap-3 p-3 bg-zinc-50 dark:bg-zinc-800/50 border border-border rounded-lg text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed">
                    <span className="text-zinc-400 font-mono shrink-0 select-none">{i + 1}.</span>
                    <span className="min-w-0 break-words">{p}</span>
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>

        <div className="px-6 py-4 border-t border-border flex justify-end gap-3 bg-zinc-50 dark:bg-zinc-900 shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-sm text-zinc-600 hover:bg-zinc-100 rounded-md transition-colors">
            Cancelar
          </button>
          {!previewing ? (
            <button
              onClick={handlePreview}
              disabled={!rawText.trim()}
              className="flex items-center gap-1.5 px-4 py-2 text-sm bg-zinc-900 text-white rounded-md hover:bg-zinc-800 disabled:opacity-50 transition-colors font-medium"
            >
              <Eye size={14} /> Pré-visualizar
            </button>
          ) : (
            <button
              onClick={handleImport}
              disabled={isPending || preview.length === 0}
              className="flex items-center gap-1.5 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:bg-slate-700 disabled:opacity-50 transition-colors font-medium"
            >
              <ClipboardList size={14} />
              {isPending ? 'Importando…' : `Importar ${preview.length} bloco${preview.length !== 1 ? 's' : ''}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
