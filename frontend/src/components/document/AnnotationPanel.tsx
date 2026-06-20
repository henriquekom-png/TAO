import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { X, FileEdit, GripVertical, Trash2, Eye, Link2 } from 'lucide-react';
import {
  useAnotacoesByBloco,
  useCreateAnotacao,
  useUpdateAnotacao,
  useReorderAnotacoes,
  useDeleteAnotacao,
} from '../../hooks/useAnotacoes';
import { useResolvePortals, PortalNavigationTarget } from '../../hooks/usePortals';
import { Anotacao } from '../../types';
import { cn } from '../../lib/utils';
import {
  parsePortalSegments,
  extractPortalIds,
  isPurePortalRef,
  rebuildContentFromSegments,
  PortalSegment,
} from '../../lib/portalParser';
import { PortalInline, PortalTransclusion } from './PortalBlock';
import mermaid from 'mermaid';
import { useEditor, EditorContent } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import StarterKit from '@tiptap/starter-kit';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { markdownToHtml, htmlToMarkdown } from '../../lib/markdownHtmlConverter';
import { api } from '../../api/client';

// Initialize mermaid
mermaid.initialize({
  startOnLoad: false,
  theme: 'neutral',
  securityLevel: 'loose',
});

interface AnnotationPanelProps {
  blocoId: string | null;
  onClose: () => void;
  onGoToSource?: (target: PortalNavigationTarget) => void;
}

interface AutoResizeTextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
}

const AutoResizeTextarea: React.FC<AutoResizeTextareaProps> = ({ value, onChange, className, ...props }) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const adjustHeight = () => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${textarea.scrollHeight}px`;
    }
  };

  useEffect(() => {
    adjustHeight();
  }, [value]);

  return (
    <textarea
      ref={textareaRef}
      value={value}
      onChange={onChange}
      className={cn(
        "w-full h-auto min-h-[60px] p-3 text-[14px] text-zinc-800 bg-white resize-y overflow-auto outline-none transition-colors",
        className
      )}
      {...props}
    />
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// TipTap Editor Component for Rich Note Editing
// ─────────────────────────────────────────────────────────────────────────────

interface TipTapEditorProps {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  onOpenPortalSearch?: (insertCallback: (id: string) => void) => void;
  className?: string;
  autoFocus?: boolean;
}

const TipTapEditor: React.FC<TipTapEditorProps> = ({
  value,
  onChange,
  placeholder,
  onOpenPortalSearch,
  className,
  autoFocus = false,
}) => {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Table.configure({
        resizable: true,
      }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content: markdownToHtml(value),
    editorProps: {
      attributes: {
        class: cn(
          'w-full min-h-[60px] text-[14px] p-3 outline-none focus:outline-none bg-white text-zinc-800 prose prose-sm max-w-none',
          className
        ),
        'data-placeholder': placeholder || '',
      },
    },
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      const md = htmlToMarkdown(html);
      onChange(md);
    },
  });

  // Sync value from outside
  useEffect(() => {
    if (editor && value !== htmlToMarkdown(editor.getHTML())) {
      editor.commands.setContent(markdownToHtml(value));
    }
  }, [value, editor]);

  // Handle focus
  useEffect(() => {
    if (editor && autoFocus) {
      setTimeout(() => editor.commands.focus(), 50);
    }
  }, [autoFocus, editor]);

  if (!editor) return null;

  return (
    <div className="relative w-full group/editor">
      <BubbleMenu
        editor={editor}
        options={{ placement: 'top' }}
        className="flex bg-zinc-950 text-white rounded-lg shadow-xl border border-zinc-800 p-1 gap-1 items-center z-50 select-none"
      >
        {editor.isActive('table') ? (
          <>
            <button
              type="button"
              onClick={() => editor.chain().focus().addRowAfter().run()}
              className="px-2 py-0.5 text-[10px] bg-zinc-800 text-zinc-300 rounded hover:bg-zinc-700 hover:text-white"
              title="Adicionar linha abaixo"
            >
              + Linha
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().addColumnAfter().run()}
              className="px-2 py-0.5 text-[10px] bg-zinc-800 text-zinc-300 rounded hover:bg-zinc-700 hover:text-white"
              title="Adicionar coluna após"
            >
              + Coluna
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().deleteRow().run()}
              className="px-2 py-0.5 text-[10px] bg-zinc-800 text-red-400 rounded hover:bg-red-950 hover:text-red-300"
              title="Excluir linha"
            >
              - Linha
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().deleteColumn().run()}
              className="px-2 py-0.5 text-[10px] bg-zinc-800 text-red-400 rounded hover:bg-red-950 hover:text-red-300"
              title="Excluir coluna"
            >
              - Coluna
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().deleteTable().run()}
              className="px-2 py-0.5 text-[10px] bg-zinc-800 text-red-500 rounded hover:bg-red-900 hover:text-white font-bold"
              title="Excluir tabela"
            >
              Excluir Tabela
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleBold().run()}
              className={cn(
                'px-2.5 py-1 text-xs font-bold rounded transition-colors hover:bg-zinc-800',
                editor.isActive('bold') ? 'bg-zinc-800 text-amber-400' : 'text-zinc-300'
              )}
            >
              B
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleItalic().run()}
              className={cn(
                'px-2.5 py-1 text-xs italic rounded transition-colors hover:bg-zinc-800',
                editor.isActive('italic') ? 'bg-zinc-800 text-amber-400' : 'text-zinc-300'
              )}
            >
              I
            </button>
            <div className="w-px h-4 bg-zinc-800 self-stretch my-0.5" />
            <button
              type="button"
              onClick={() => {
                if (onOpenPortalSearch) {
                  onOpenPortalSearch((selectedId: string) => {
                    editor.chain().focus().insertContent(`((${selectedId}))`).run();
                  });
                }
              }}
              className="px-2 py-1 text-xs rounded transition-colors hover:bg-slate-800 text-slate-300 hover:text-slate-200 font-medium flex items-center gap-0.5"
            >
              <Link2 size={11} /> Portal
            </button>
            <button
              type="button"
              onClick={() => {
                editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
              }}
              className="px-2 py-1 text-xs rounded transition-colors hover:bg-zinc-800 text-emerald-300 hover:text-emerald-200 font-medium flex items-center gap-0.5"
            >
              📅 Tabela
            </button>
          </>
        )}
      </BubbleMenu>
      <EditorContent editor={editor} />
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Portal Search Modal Component (RemNote Style Search)
// ─────────────────────────────────────────────────────────────────────────────

interface PortalSearchModalProps {
  onClose: () => void;
  onSelect: (id: string) => void;
}

const PortalSearchModal: React.FC<PortalSearchModalProps> = ({ onClose, onSelect }) => {
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
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md border border-zinc-200 overflow-hidden flex flex-col max-h-[70vh]">
        {/* Header */}
        <div className="px-4 py-3 border-b border-zinc-100 flex items-center justify-between bg-zinc-50">
          <span className="font-semibold text-sm text-zinc-800 flex items-center gap-1.5">
            <Link2 size={16} className="text-indigo-500" />
            Criar Portal: Buscar Bloco
          </span>
          <button onClick={onClose} className="p-1 rounded hover:bg-zinc-200 text-zinc-400 hover:text-zinc-600 transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Input */}
        <div className="p-3 border-b border-zinc-100 bg-white">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Digite palavras-chave do bloco..."
            className="w-full text-sm px-3 py-2 border border-border rounded-lg outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            autoFocus
          />
        </div>

        {/* Results List */}
        <div className="flex-1 overflow-y-auto p-2 min-h-[150px] bg-zinc-50/50">
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
              onClick={() => {
                onSelect(bloco.id);
              }}
              className="w-full text-left p-3 hover:bg-white hover:shadow-sm hover:border-zinc-300 border border-transparent rounded-lg mb-1 transition-all flex flex-col gap-1 group bg-white"
            >
              <div className="text-xs font-semibold text-indigo-600 flex items-center justify-between">
                <span>{bloco.identificador ? bloco.identificador : 'Bloco'}</span>
                <span className="text-[10px] text-zinc-400 font-normal ml-auto">
                  in {bloco.pasta_nome} &rsaquo; {bloco.documento_titulo}
                </span>
              </div>
              <div className="text-sm text-zinc-800 line-clamp-2 leading-relaxed">
                {bloco.conteudo || <span className="text-zinc-400 italic">Bloco vazio</span>}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Annotation Content Editor supporting inline portals and TipTap
// ─────────────────────────────────────────────────────────────────────────────

interface AnnotationContentEditorProps {
  content: string;
  onChange: (content: string) => void;
  portalMap: Record<string, import('../../hooks/usePortals').ResolvedPortal>;
  onGoToSource: (target: PortalNavigationTarget) => void;
  onOpenPortalSearch: (insertCallback: (id: string) => void) => void;
}

const AnnotationContentEditor: React.FC<AnnotationContentEditorProps> = ({
  content,
  onChange,
  portalMap,
  onGoToSource,
  onOpenPortalSearch,
}) => {
  const segments = useMemo(() => parsePortalSegments(content), [content]);
  const hasPortals = segments.some((s) => s.type === 'portal');

  const updateTextSegment = useCallback(
    (segmentIndex: number, newValue: string) => {
      const updated: PortalSegment[] = segments.map((seg, i) =>
        i === segmentIndex && seg.type === 'text' ? { type: 'text', value: newValue } : seg
      );
      onChange(rebuildContentFromSegments(updated));
    },
    [segments, onChange]
  );

  if (!hasPortals) {
    return (
      <TipTapEditor
        value={content}
        onChange={onChange}
        placeholder="Escreva sua anotação aqui..."
        onOpenPortalSearch={onOpenPortalSearch}
        className="w-full"
      />
    );
  }

  return (
    <div className="p-3 space-y-0">
      {segments.map((seg, i) =>
        seg.type === 'text' ? (
          <TipTapEditor
            key={`text-${i}`}
            value={seg.value}
            onChange={(newValue) => updateTextSegment(i, newValue)}
            placeholder={seg.value === '' && i === 0 ? 'Escreva sua anotação aqui...' : undefined}
            onOpenPortalSearch={onOpenPortalSearch}
            className="w-full min-h-[40px] p-0"
          />
        ) : (
          <PortalInline
            key={`portal-${seg.refId}-${i}`}
            refId={seg.refId}
            resolved={portalMap[String(seg.refId)]}
            onGoToSource={onGoToSource}
          />
        )
      )}
    </div>
  );
};

interface MermaidRendererProps {
  chart: string;
}

const MermaidRenderer: React.FC<MermaidRendererProps> = ({ chart }) => {
  const [svgContent, setSvgContent] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    const elementId = `mermaid-${Math.floor(Math.random() * 1000000)}`;

    const renderDiagram = async () => {
      try {
        setError(null);
        const cleanChart = chart.trim();
        if (cleanChart) {
          const { svg } = await mermaid.render(elementId, cleanChart);
          if (isMounted) {
            setSvgContent(svg);
          }
        }
      } catch (err: any) {
        console.error('Mermaid rendering error:', err);
        const badEl = document.getElementById(elementId);
        if (badEl) badEl.remove();
        
        if (isMounted) {
          setError('Erro de sintaxe no fluxograma');
        }
      }
    };

    renderDiagram();

    return () => {
      isMounted = false;
    };
  }, [chart]);

  if (error) {
    return (
      <div className="p-3 text-xs text-red-500 bg-red-50 border border-red-100 rounded-md font-mono select-none">
        ⚠️ {error}
      </div>
    );
  }

  return (
    <div 
      className="w-full flex justify-center p-3 bg-zinc-50 border border-zinc-100 rounded-md overflow-x-auto select-none"
      dangerouslySetInnerHTML={{ __html: svgContent || '<span class="text-xs text-zinc-400 select-none">Renderizando fluxograma...</span>' }}
    />
  );
};

interface ContentBlock {
  type: 'text' | 'mermaid';
  content: string;
}

function parseContentBlocks(content: string): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  const regex = /```mermaid\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      blocks.push({
        type: 'text',
        content: content.substring(lastIndex, match.index),
      });
    }
    blocks.push({
      type: 'mermaid',
      content: match[1].trim(),
    });
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < content.length) {
    blocks.push({
      type: 'text',
      content: content.substring(lastIndex),
    });
  }

  return blocks;
}

interface AnotacaoItemProps {
  anot: Anotacao;
  index: number;
  portalMap: Record<string, import('../../hooks/usePortals').ResolvedPortal>;
  onGoToSource: (target: PortalNavigationTarget) => void;
  onDelete: (id: string) => void;
  onOpenPortalSearch: (insertCallback: (id: string) => void) => void;
}

const AnotacaoItem: React.FC<AnotacaoItemProps> = ({ anot, index, portalMap, onGoToSource, onDelete, onOpenPortalSearch }) => {
  const { mutate: updateAnotacao } = useUpdateAnotacao();
  const [content, setContent] = useState(anot.conteudo);
  const [isSaving, setIsSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  const isPortalType = anot.tipo === 'portal' || isPurePortalRef(anot.conteudo);
  const portalRefId = isPortalType ? extractPortalIds(anot.conteudo)[0] : null;

  const hasMermaid = anot.tipo === 'fluxograma' || content.includes('```mermaid');

  const lastSavedContentRef = useRef(anot.conteudo);

  useEffect(() => {
    setContent(anot.conteudo);
    lastSavedContentRef.current = anot.conteudo;
  }, [anot.conteudo]);

  useEffect(() => {
    setIsEditing(!hasMermaid);
  }, [hasMermaid]);

  useEffect(() => {
    if (isPortalType) return;
    if (content === lastSavedContentRef.current) return;

    setIsSaving(true);
    const timer = setTimeout(() => {
      const valueToSave = content;
      lastSavedContentRef.current = valueToSave;
      updateAnotacao(
        { id: anot.id, data: { conteudo: valueToSave } },
        {
          onSuccess: () => {
            setIsSaving(false);
          },
          onError: () => {
            lastSavedContentRef.current = anot.conteudo;
            setIsSaving(false);
          }
        }
      );
    }, 1500);

    return () => clearTimeout(timer);
  }, [content, anot.conteudo, anot.id, updateAnotacao, isPortalType]);

  const renderPreviewContent = () => {
    if (anot.tipo === 'fluxograma') {
      return <MermaidRenderer chart={content} />;
    }

    const blocks = parseContentBlocks(content);
    return (
      <div className="space-y-3 p-3">
        {blocks.map((block, i) => {
          if (block.type === 'mermaid') {
            return <MermaidRenderer key={i} chart={block.content} />;
          }
          let cleanText = block.content;
          cleanText = cleanText.replace(/(Art\.\s*\d+[-A-Z0-9ºo.]*|§\s*\d+[-A-Z0-9ºo.]*|Parágrafo único\.?)\s*\n+/gi, '$1 ');
          cleanText = cleanText.replace(/(\b[IVXLCDM]+\s*-)\s*\n+/g, '$1 ');
          cleanText = cleanText.replace(/(\b[a-z]\))\s*\n+/g, '$1 ');

          return (
            <div key={i} className="text-slate-800 text-[14px] leading-relaxed">
              {cleanText.split(/\n\n+/).map((para, pIdx, arr) => (
                <p key={pIdx} className={pIdx < arr.length - 1 ? "mb-1.5" : ""}>
                  {para.split('\n').map((line, lIdx, lArr) => (
                    <React.Fragment key={lIdx}>
                      {line}
                      {lIdx < lArr.length - 1 && <br />}
                    </React.Fragment>
                  ))}
                </p>
              ))}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <Draggable draggableId={`anot-${anot.id}`} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          className={cn(
            "bg-card border border-transparent hover:border-border rounded-xl shadow-soft-sm overflow-hidden flex flex-row items-stretch relative group min-h-[60px]",
            "transition-all focus-within:border-slate-300 focus-within:ring-1 focus-within:ring-slate-300",
            snapshot.isDragging && "shadow-soft border-slate-300 rotate-[0.5deg] opacity-95"
          )}
        >
          {/* Subtle vertical Drag Handle on the left */}
          <div
            {...provided.dragHandleProps}
            className="flex items-center justify-center w-6 bg-zinc-50/50 hover:bg-zinc-50 border-r border-zinc-100 text-zinc-300 hover:text-zinc-500 cursor-grab active:cursor-grabbing transition-colors shrink-0"
            title="Arrastar para reordenar"
          >
            <GripVertical size={14} />
          </div>

          {/* Action Overlay (top right) - visible on hover */}
          <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity bg-white/95 backdrop-blur-sm px-1.5 py-1 rounded-md shadow-sm border border-zinc-200 z-10">
            {isSaving && (
              <span className="text-[10px] text-amber-600 font-medium animate-pulse mr-1 select-none">
                Salvando...
              </span>
            )}
            
            {hasMermaid && (
              <button
                onClick={() => setIsEditing(!isEditing)}
                className={cn(
                  "p-1 rounded text-zinc-400 hover:bg-zinc-100 transition-colors",
                  isEditing ? "hover:text-emerald-600" : "hover:text-amber-600"
                )}
                title={isEditing ? "Visualizar gráfico" : "Editar fluxograma"}
              >
                {isEditing ? <Eye size={13} /> : <FileEdit size={13} />}
              </button>
            )}

            <button
              onClick={() => onDelete(anot.id)}
              className="p-1 text-zinc-400 hover:text-red-600 rounded hover:bg-red-50 transition-colors"
              title="Excluir anotação"
            >
              <Trash2 size={13} />
            </button>
          </div>

          {/* Content Area */}
          <div className="flex-1 min-w-0 flex flex-col justify-center">
            {isPortalType && portalRefId ? (
              <PortalTransclusion
                refId={portalRefId}
                resolved={portalMap[String(portalRefId)]}
                onGoToSource={onGoToSource}
              />
            ) : !isEditing && hasMermaid ? (
              renderPreviewContent()
            ) : (
              <AnnotationContentEditor
                content={content}
                onChange={setContent}
                portalMap={portalMap}
                onGoToSource={onGoToSource}
                onOpenPortalSearch={onOpenPortalSearch}
              />
            )}
          </div>
        </div>
      )}
    </Draggable>
  );
};

export const AnnotationPanel: React.FC<AnnotationPanelProps> = ({ blocoId, onClose, onGoToSource }) => {
  const { data: anotacoes, isLoading } = useAnotacoesByBloco(blocoId);
  const { mutate: createAnotacao } = useCreateAnotacao();
  const { mutate: reorderAnotacoes } = useReorderAnotacoes();
  const { mutate: deleteAnotacao } = useDeleteAnotacao();

  const [orderedAnotacoes, setOrderedAnotacoes] = useState<Anotacao[]>([]);
  const [editContent, setEditContent] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [creationType, setCreationType] = useState<'texto' | 'fluxograma'>('texto');

  // Portal Search Modal state
  const [openPortalSearch, setOpenPortalSearch] = useState(false);
  const [portalSearchCallback, setPortalSearchCallback] = useState<((id: string) => void) | null>(null);

  useEffect(() => {
    setEditContent('');
    setIsCreating(false);
    setOpenPortalSearch(false);
  }, [blocoId]);

  useEffect(() => {
    if (anotacoes) setOrderedAnotacoes(anotacoes);
  }, [anotacoes]);

  const allPortalIds = useMemo(() => {
    const ids = new Set<string>();
    for (const anot of orderedAnotacoes) {
      extractPortalIds(anot.conteudo).forEach((id) => ids.add(id));
    }
    return Array.from(ids);
  }, [orderedAnotacoes]);

  const { data: portalMap = {} } = useResolvePortals(allPortalIds);

  const handleGoToSource = useCallback(
    (target: PortalNavigationTarget) => {
      onGoToSource?.(target);
    },
    [onGoToSource]
  );

  const handleDelete = (anotacaoId: string) => {
    if (confirm('Tem certeza que deseja excluir esta anotação?')) {
      // Optimistic: remove from local state immediately
      setOrderedAnotacoes((prev) => prev.filter((a) => a.id !== anotacaoId));
      deleteAnotacao(
        { id: anotacaoId, blocoId: blocoId! },
        {
          onError: (err) => {
            console.error('Erro ao deletar anotação:', err);
            // Revert: refetch to restore the item
            if (anotacoes) setOrderedAnotacoes(anotacoes);
            alert('Erro ao excluir a anotação. Tente novamente.');
          },
        }
      );
    }
  };

  const handleOpenPortalSearch = useCallback((callback: (id: string) => void) => {
    setPortalSearchCallback(() => callback);
    setOpenPortalSearch(true);
  }, []);

  const handleInitiateCreation = (type: 'texto' | 'portal' | 'fluxograma' | 'tabela') => {
    if (type === 'portal') {
      handleOpenPortalSearch((selectedId: string) => {
        createAnotacao(
          { bloco_id: blocoId!, conteudo: `((${selectedId}))`, tipo: 'portal', ordem: orderedAnotacoes.length },
          {
            onSuccess: () => {
              setOpenPortalSearch(false);
            },
            onError: (err) => {
              console.error('Erro ao criar portal:', err);
              alert('Erro ao criar o portal. Tente novamente.');
            },
          }
        );
      });
      return;
    }

    if (type === 'tabela') {
      setCreationType('texto');
      setEditContent('<table><thead><tr><th>Cabeçalho 1</th><th>Cabeçalho 2</th><th>Cabeçalho 3</th></tr></thead><tbody><tr><td></td><td></td><td></td></tr><tr><td></td><td></td><td></td></tr></tbody></table>');
      setIsCreating(true);
      return;
    }

    if (type === 'fluxograma') {
      setCreationType('fluxograma');
      const template = `graph TD
  A[Início] --> B[Processo]
  B --> C{Decisão}
  C -->|Sim| D[Fim 1]
  C -->|Não| E[Fim 2]`;
      setEditContent(template);
      setIsCreating(true);
      return;
    }

    // Default text note
    setCreationType('texto');
    setEditContent('');
    setIsCreating(true);
  };

  if (!blocoId) return null;

  const handleDragEnd = (result: DropResult) => {
    if (!result.destination || result.destination.index === result.source.index) return;

    const reordered = Array.from(orderedAnotacoes);
    const [moved] = reordered.splice(result.source.index, 1);
    reordered.splice(result.destination.index, 0, moved);
    setOrderedAnotacoes(reordered);

    reorderAnotacoes(reordered.map((a, idx) => ({ id: a.id, ordem: idx })));
  };

  const handleCreate = () => {
    createAnotacao(
      { bloco_id: blocoId, conteudo: editContent, tipo: creationType, ordem: orderedAnotacoes.length },
      { onSuccess: () => { setIsCreating(false); setEditContent(''); } }
    );
  };

  return (
    <div className="w-full min-w-0 bg-background border-l border-border flex flex-col h-full shadow-soft-sm animate-in slide-in-from-right-8 duration-300">
      <div className="h-14 px-4 border-b border-border flex items-center justify-between bg-card shrink-0 shadow-soft-sm">
        <div className="flex items-center gap-2">
          <FileEdit size={18} className="text-amber-500" />
          <h2 className="font-semibold text-sm text-zinc-800">Anotações do Bloco</h2>
          {orderedAnotacoes.length > 0 && (
            <span className="bg-amber-100 text-amber-700 text-xs font-bold px-1.5 py-0.5 rounded-full">
              {orderedAnotacoes.length}
            </span>
          )}
        </div>
        <button onClick={onClose} className="p-1 text-zinc-400 hover:text-zinc-600 rounded-md hover:bg-zinc-100 transition-colors">
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {isLoading ? (
          <div className="text-center text-zinc-400 text-sm py-8">Carregando anotações...</div>
        ) : (
          <>
            {orderedAnotacoes.length === 0 && !isCreating ? (
              <div className="text-center py-10 px-4">
                <p className="text-zinc-400 text-sm mb-4">Nenhuma anotação neste bloco.</p>
                <div className="flex flex-col gap-2 max-w-xs mx-auto">
                  <button
                    onClick={() => handleInitiateCreation('texto')}
                    className="flex items-center justify-center gap-2 text-xs font-medium bg-amber-100 text-amber-700 px-4 py-2 rounded-lg hover:bg-amber-200 transition-colors w-full"
                  >
                    📝 + Nota de Texto
                  </button>
                  <button
                    onClick={() => handleInitiateCreation('portal')}
                    className="flex items-center justify-center gap-2 text-xs font-medium bg-amber-100 text-amber-700 px-4 py-2 rounded-lg hover:bg-amber-200 transition-colors w-full"
                  >
                    🔗 + Portal
                  </button>
                  <button
                    onClick={() => handleInitiateCreation('tabela')}
                    className="flex items-center justify-center gap-2 text-xs font-medium bg-amber-100 text-amber-700 px-4 py-2 rounded-lg hover:bg-amber-200 transition-colors w-full"
                  >
                    📅 + Tabela
                  </button>
                  <button
                    onClick={() => handleInitiateCreation('fluxograma')}
                    className="flex items-center justify-center gap-2 text-xs font-medium bg-amber-100 text-amber-700 px-4 py-2 rounded-lg hover:bg-amber-200 transition-colors w-full"
                  >
                    📊 + Fluxograma
                  </button>
                </div>
              </div>
            ) : (
              <>
                <p className="text-[11px] text-zinc-400 flex items-center gap-1 select-none">
                  <GripVertical size={11} /> Arraste para reordenar
                </p>

                <DragDropContext onDragEnd={handleDragEnd}>
                  <Droppable droppableId="anotacoes-list">
                    {(provided, snapshot) => (
                      <div
                        ref={provided.innerRef}
                        {...provided.droppableProps}
                        className={cn(
                          "space-y-3 transition-colors rounded-lg",
                          snapshot.isDraggingOver && "bg-amber-50/50"
                        )}
                      >
                        {orderedAnotacoes.map((anot, index) => (
                          <AnotacaoItem
                            key={anot.id}
                            anot={anot}
                            index={index}
                            portalMap={portalMap}
                            onGoToSource={handleGoToSource}
                            onDelete={handleDelete}
                            onOpenPortalSearch={handleOpenPortalSearch}
                          />
                        ))}
                        {provided.placeholder}
                      </div>
                    )}
                  </Droppable>
                </DragDropContext>

                {!isCreating && (
                  <div className="flex gap-2 w-full mt-4 border-t border-zinc-100 pt-3">
                    <button
                      onClick={() => handleInitiateCreation('texto')}
                      className="flex-1 py-2 px-1 border border-zinc-200 rounded-lg text-[10px] font-semibold text-zinc-600 hover:text-amber-700 hover:border-amber-300 hover:bg-amber-50 transition-colors flex items-center justify-center gap-1"
                    >
                      📝 + Texto
                    </button>
                    <button
                      onClick={() => handleInitiateCreation('portal')}
                      className="flex-1 py-2 px-1 border border-zinc-200 rounded-lg text-[10px] font-semibold text-zinc-600 hover:text-amber-700 hover:border-amber-300 hover:bg-amber-50 transition-colors flex items-center justify-center gap-1"
                    >
                      🔗 + Portal
                    </button>
                    <button
                      onClick={() => handleInitiateCreation('tabela')}
                      className="flex-1 py-2 px-1 border border-zinc-200 rounded-lg text-[10px] font-semibold text-zinc-600 hover:text-amber-700 hover:border-amber-300 hover:bg-amber-50 transition-colors flex items-center justify-center gap-1"
                    >
                      📅 + Tabela
                    </button>
                    <button
                      onClick={() => handleInitiateCreation('fluxograma')}
                      className="flex-1 py-2 px-1 border border-zinc-200 rounded-lg text-[10px] font-semibold text-zinc-600 hover:text-amber-700 hover:border-amber-300 hover:bg-amber-50 transition-colors flex items-center justify-center gap-1"
                    >
                      📊 + Fluxo
                    </button>
                  </div>
                )}
              </>
            )}

            {isCreating && (
              <div className="bg-white border border-amber-200 rounded-lg shadow-sm p-3 space-y-2 animate-in fade-in">
                <div className="text-xs font-semibold text-amber-700 uppercase mb-2">
                  Nova Anotação ({creationType === 'fluxograma' ? 'Fluxograma' : 'Texto'})
                </div>
                {creationType === 'fluxograma' ? (
                  <AutoResizeTextarea
                    value={editContent}
                    onChange={e => setEditContent(e.target.value)}
                    placeholder="Sintaxe Mermaid..."
                    className="w-full text-sm p-2 border border-zinc-300 rounded-md focus:ring-amber-500 focus:border-amber-500 outline-none"
                    autoFocus
                  />
                ) : (
                  <TipTapEditor
                    value={editContent}
                    onChange={setEditContent}
                    placeholder="Escreva sua nota aqui..."
                    onOpenPortalSearch={handleOpenPortalSearch}
                    autoFocus
                  />
                )}
                <div className="flex justify-end gap-2">
                  <button onClick={() => setIsCreating(false)} className="px-3 py-1.5 text-xs text-zinc-500 hover:bg-zinc-100 rounded-md">
                    Cancelar
                  </button>
                  <button
                    onClick={handleCreate}
                    disabled={!editContent.trim()}
                    className="px-3 py-1.5 text-xs bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 rounded-md font-medium"
                  >
                    Criar
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {openPortalSearch && (
        <PortalSearchModal
          onClose={() => setOpenPortalSearch(false)}
          onSelect={(id) => {
            if (portalSearchCallback) {
              portalSearchCallback(id);
            }
          }}
        />
      )}
    </div>
  );
};
