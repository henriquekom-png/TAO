import { useState, useEffect, useRef } from 'react';
import { Search, FileText, Pin, Edit3, Loader2, X } from 'lucide-react';
import { api } from '../../api/client';
import { PortalNavigationTarget } from '../../hooks/usePortals';

interface SearchResultItem {
  kind: 'documento' | 'bloco' | 'anotacao';
  id: number;
  title: string;
  subtitle: string;
  documento_id: number;
  bloco_id: number | null;
  pasta_id: number;
  pasta_path: number[];
}

interface SearchResponse {
  results: SearchResultItem[];
}

interface GlobalSearchProps {
  onSelectResult: (target: PortalNavigationTarget) => void;
}

export function GlobalSearch({ onSelectResult }: GlobalSearchProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Debounce search
  useEffect(() => {
    if (query.trim().length < 3) {
      setResults([]);
      setIsLoading(false);
      setIsOpen(false);
      return;
    }

    const timer = setTimeout(async () => {
      setIsLoading(true);
      try {
        const { data } = await api.get<SearchResponse>(`/search?q=${encodeURIComponent(query.trim())}`);
        setResults(data.results.slice(0, 10)); // limit to 10 results
        setIsOpen(true);
      } catch (error) {
        console.error("Search failed", error);
      } finally {
        setIsLoading(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [query]);

  const handleSelect = (item: SearchResultItem) => {
    setIsOpen(false);
    setQuery('');
    onSelectResult({
      pastaPath: item.pasta_path,
      docId: item.documento_id,
      blocoId: item.bloco_id || 0
    });
  };

  const getIcon = (kind: string) => {
    switch (kind) {
      case 'documento': return <FileText size={16} className="text-blue-500 mt-1 shrink-0" />;
      case 'bloco': return <Pin size={16} className="text-amber-500 mt-1 shrink-0" />;
      case 'anotacao': return <Edit3 size={16} className="text-emerald-500 mt-1 shrink-0" />;
      default: return <Search size={16} className="text-zinc-500 mt-1 shrink-0" />;
    }
  };

  return (
    <div className="relative w-full max-w-md mx-4" ref={containerRef}>
      <div className="relative flex items-center">
        <Search size={16} className="absolute left-3 text-zinc-400" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => { if (query.length >= 3) setIsOpen(true); }}
          placeholder="Buscar em Tudo..."
          className="w-full bg-zinc-100 dark:bg-zinc-800 border-none rounded-full py-1.5 pl-9 pr-8 text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-500 dark:placeholder-zinc-400 focus:ring-2 focus:ring-indigo-500 focus:bg-white dark:focus:bg-zinc-700 transition-colors"
        />
        {isLoading && (
          <Loader2 size={14} className="absolute right-3 text-zinc-400 animate-spin" />
        )}
        {!isLoading && query && (
          <button 
            onClick={() => { setQuery(''); setIsOpen(false); }}
            className="absolute right-3 text-zinc-400 hover:text-zinc-600"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* Dropdown */}
      {isOpen && query.length >= 3 && (
        <div className="absolute top-full mt-2 w-full bg-white dark:bg-zinc-900 border border-border rounded-lg shadow-xl overflow-hidden z-[9999]">
          {results.length === 0 && !isLoading ? (
            <div className="p-4 text-sm text-zinc-500 dark:text-zinc-400 text-center">
              Nenhum resultado encontrado para "{query}"
            </div>
          ) : (
            <ul className="max-h-96 overflow-y-auto py-1">
              {results.map((item) => (
                <li key={`${item.kind}-${item.id}`}>
                  <button
                    onClick={() => handleSelect(item)}
                    className="w-full text-left px-4 py-2.5 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors flex gap-3 items-start border-b border-border last:border-0"
                  >
                    {getIcon(item.kind)}
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200 truncate">{item.title}</p>
                      {item.subtitle && (
                        <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate mt-0.5">{item.subtitle}</p>
                      )}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
