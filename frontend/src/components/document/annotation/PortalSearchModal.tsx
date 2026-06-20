import React, { useState, useEffect } from 'react';
import { X, Link2 } from 'lucide-react';
import { api } from '../../../api/client';

interface PortalSearchModalProps {
  onClose: () => void;
  onSelect: (id: number) => void;
}

export const PortalSearchModal: React.FC<PortalSearchModalProps> = ({ onClose, onSelect }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    
    setLoading(true);
    const delayDebounce = setTimeout(async () => {
      try {
        const response = await api.get(`/blocos/search?q=${encodeURIComponent(query)}`);
        setResults(response.data);
      } catch (err) {
        console.error('Erro na busca de blocos:', err);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => clearTimeout(delayDebounce);
  }, [query]);

  return (
    <div className="fixed inset-0 bg-zinc-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-2xl w-full max-w-md border border-border overflow-hidden flex flex-col max-h-[70vh] transition-colors">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between bg-zinc-50 dark:bg-zinc-800">
          <span className="font-semibold text-sm text-zinc-800 dark:text-zinc-200 flex items-center gap-1.5">
            <Link2 size={16} className="text-indigo-500" />
            Criar Portal: Buscar Bloco
          </span>
          <button onClick={onClose} className="p-1 rounded hover:bg-zinc-200 text-zinc-400 hover:text-zinc-600 transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="p-3 border-b border-border bg-white dark:bg-zinc-900">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Digite palavras-chave do bloco..."
            className="w-full text-sm px-3 py-2 border border-border bg-transparent text-zinc-800 dark:text-zinc-100 rounded-lg outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            autoFocus
          />
        </div>

        <div className="flex-1 overflow-y-auto p-2 min-h-[150px] bg-zinc-50/50 dark:bg-zinc-950/50">
          {loading && (
            <div className="text-center py-8 text-xs text-zinc-400 animate-pulse">
              Buscando blocos...
            </div>
          )}

          {!loading && !query.trim() && (
            <div className="text-center py-8 text-xs text-zinc-400">
              Digite algo para buscar blocos ou anotações.
            </div>
          )}

          {!loading && query.trim() && results.length === 0 && (
            <div className="text-center py-8 text-xs text-zinc-400">
              Nenhum bloco encontrado para "{query}".
            </div>
          )}

          {!loading && results.map((bloco) => (
            <button
              key={bloco.id}
              onClick={() => onSelect(bloco.id)}
              className="w-full text-left p-3 hover:bg-white dark:hover:bg-zinc-800 hover:shadow-sm border border-transparent hover:border-border rounded-lg mb-1 transition-all flex flex-col gap-1 group bg-white dark:bg-zinc-900/50"
            >
              <div className="text-xs font-semibold text-indigo-600 flex items-center justify-between">
                <span>{bloco.identificador ? bloco.identificador : 'Bloco'}</span>
                <span className="text-[10px] text-zinc-400 font-normal ml-auto">
                  in {bloco.pasta_nome} &rsaquo; {bloco.documento_titulo}
                </span>
              </div>
              <div className="text-sm text-zinc-800 dark:text-zinc-300 line-clamp-2 leading-relaxed">
                {bloco.conteudo || <span className="text-zinc-400 italic">Bloco vazio</span>}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
