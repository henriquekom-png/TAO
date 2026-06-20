import React, { useState, useEffect, useCallback } from 'react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import {
  FileText, Circle, Check,
  FileQuestion, FileEdit, Trash2, GripVertical, Plus, ClipboardList, X, Eye,
} from 'lucide-react';
import { useDocumento } from '../../hooks/useDocumentos';
import { useUpdateBloco, useReorderBlocos, useDeleteBloco, useCreateBloco, useBulkCreateBlocos } from '../../hooks/useBlocos';
import { useGenerateFromDocument } from '../../hooks/useQuestoes';
import { Bloco, Questao, Importancia } from '../../types';
import { cn } from '../../lib/utils';

import { useEditor, EditorContent } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import StarterKit from '@tiptap/starter-kit';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { markdownToHtml, htmlToMarkdown } from '../../lib/markdownHtmlConverter';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface DocumentViewerProps {
  documentId: number | null;
  selectedBlocoId?: number | null;
  scrollToBlocoId?: number | null;
  onScrollComplete?: () => void;
  onSelectBloco?: (id: number) => void;
  onGenerateSimulado?: (questions: Questao[]) => void;
}



const renderMarkdown = (text: string, identificador?: string, nextReview?: string): React.ReactNode[] => {
  const badge = identificador ? (
    <span className="inline-flex items-center gap-1.5 mr-2 align-baseline translate-y-[-1px]">
      <span className="bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded text-[11px] font-bold text-slate-600 select-none shadow-sm">
        {identificador}
      </span>
      {nextReview && (
        <span className="text-[11px] text-blue-500 font-medium" title="Next FSRS Review">FSRS: {nextReview}</span>
      )}
    </span>
  ) : null;

  if (!text) return badge ? [<p key="badge">{badge}</p>] : [];

  // Corrige quebras de linha órfãs geradas ao colar de PDFs (ex: Art. 1º \n Texto...)
  let cleanText = text;
  cleanText = cleanText.replace(/(Art\.\s*\d+[-A-Z0-9ºo.]*|§\s*\d+[-A-Z0-9ºo.]*|Parágrafo único\.?)\s*\n+/gi, '$1 ');
  cleanText = cleanText.replace(/(\b[IVXLCDM]+\s*-)\s*\n+/g, '$1 ');
  cleanText = cleanText.replace(/(\b[a-z]\))\s*\n+/g, '$1 ');

  const blocks = cleanText.split(/\n\n+/);
  return blocks.map((block, bIdx) => {
    const inlineNodes = block.split(/(\*\*.*?\*\*|\*.*?\*)/g).map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**'))
        return <strong key={i} className="font-semibold text-slate-900">{part.slice(2, -2)}</strong>;
      if (part.startsWith('*') && part.endsWith('*'))
        return <em key={i} className="italic text-slate-800">{part.slice(1, -1)}</em>;
      
      return part.split('\n').map((line, j, arr) => (
        <React.Fragment key={`${i}-${j}`}>
          {line}
          {j < arr.length - 1 && <br />}
        </React.Fragment>
      ));
    });
    
    return (
      <p key={bIdx} className={bIdx < blocks.length - 1 ? "mb-1.5" : ""}>
        {bIdx === 0 && badge}
        {inlineNodes}
      </p>
    );
  });
};

/** Parse raw pasted text into paragraphs */
function parseTextoBlocos(raw: string): string[] {
  return raw
    .split(/\n{2,}/)
    .map(p => p.replace(/\s+/g, ' ').trim())
    .filter(p => p.length > 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// AddBlocoButton — hover button between / after blocos
// ─────────────────────────────────────────────────────────────────────────────

interface AddBlocoButtonProps {
  documentId: number;
  insertAtOrdem: number;   // the ordem value the new bloco should occupy
  alwaysVisible?: boolean; // end-of-list button
  onCreated: (newId: number) => void;
}

const AddBlocoButton: React.FC<AddBlocoButtonProps> = ({ documentId, insertAtOrdem, alwaysVisible, onCreated }) => {
  const { mutate: createBloco, isPending } = useCreateBloco();

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    createBloco(
      { documento_id: documentId, conteudo: '', ordem: insertAtOrdem },
      { onSuccess: (newBloco) => onCreated(newBloco.id) }
    );
  };

  return (
    <div className={cn(
      'flex items-center gap-2 py-0.5 group/addbtn',
      alwaysVisible ? 'opacity-60 hover:opacity-100' : 'opacity-0 hover:opacity-100 focus-within:opacity-100',
      'transition-opacity duration-200'
    )}>
      <button
        onClick={handleClick}
        disabled={isPending}
        className={cn(
          'flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-slate-700',
          'border border-dashed border-border hover:border-slate-300 hover:bg-slate-50',
          'rounded-md px-2.5 py-1 transition-all duration-200',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          alwaysVisible && 'w-full justify-center border-solid border-zinc-200 text-zinc-500 mt-2'
        )}
      >
        <Plus size={12} />
        {isPending ? 'Criando…' : alwaysVisible ? 'Novo bloco' : 'Inserir bloco aqui'}
      </button>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// BulkImportModal
// ─────────────────────────────────────────────────────────────────────────────

interface BulkImportModalProps {
  documentId: number;
  nextOrdem: number;   // ordem of the last existing bloco + 1
  onClose: () => void;
}

const BulkImportModal: React.FC<BulkImportModalProps> = ({ documentId, nextOrdem, onClose }) => {
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
      <div className="bg-white w-full max-w-2xl rounded-xl shadow-2xl flex flex-col max-h-[85vh] border border-zinc-200 overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-zinc-100 flex items-center justify-between bg-zinc-50 shrink-0">
          <div className="flex items-center gap-2 font-semibold text-zinc-800">
            <ClipboardList size={18} className="text-blue-500" />
            Importar Texto em Lote
          </div>
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-zinc-200 text-zinc-500 transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
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
                className="w-full min-h-[280px] resize-y border border-zinc-200 rounded-lg p-4 text-sm text-zinc-800 outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400 font-mono leading-relaxed"
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
                  <li key={i} className="flex gap-3 p-3 bg-zinc-50 border border-zinc-100 rounded-lg text-sm text-zinc-700 leading-relaxed">
                    <span className="text-zinc-400 font-mono shrink-0 select-none">{i + 1}.</span>
                    <span className="min-w-0 break-words">{p}</span>
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-zinc-100 flex justify-end gap-3 bg-zinc-50 shrink-0">
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

// ─────────────────────────────────────────────────────────────────────────────
// GenerateSimuladoModal
// ─────────────────────────────────────────────────────────────────────────────

interface GenerateSimuladoModalProps {
  documentId: number;
  onClose: () => void;
  onSuccess: (questions: Questao[]) => void;
}

const GenerateSimuladoModal: React.FC<GenerateSimuladoModalProps> = ({ documentId, onClose, onSuccess }) => {
  const [quantidade, setQuantidade] = useState(5);
  const [dificuldade, setDificuldade] = useState('media');
  const { mutate: generateQuestions, isPending } = useGenerateFromDocument();

  const handleGenerate = () => {
    generateQuestions(
      { documento_id: documentId, quantidade, dificuldade },
      {
        onSuccess: (result) => {
          onSuccess(result.questoes);
        },
        onError: (err: any) => {
          alert('Erro ao gerar questões: ' + (err.response?.data?.detail || err.message));
        }
      }
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/40 backdrop-blur-sm p-4">
      <div className="bg-white w-full max-w-sm rounded-xl shadow-2xl overflow-hidden border border-zinc-200">
        <div className="px-6 py-4 border-b border-zinc-100 flex items-center justify-between bg-zinc-50">
          <div className="flex items-center gap-2 font-semibold text-zinc-800">
            <FileQuestion size={18} className="text-violet-500" />
            Gerar Simulado (IA)
          </div>
          <button onClick={onClose} disabled={isPending} className="p-1.5 rounded-md hover:bg-zinc-200 text-zinc-500 transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="p-6 space-y-5">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-zinc-700">Quantidade de Questões</label>
            <input
              type="number"
              min={1}
              max={20}
              value={quantidade}
              onChange={(e) => setQuantidade(Number(e.target.value))}
              className="w-full border border-zinc-200 rounded-lg p-2.5 text-sm text-zinc-800 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 transition-all"
              disabled={isPending}
            />
            <p className="text-xs text-zinc-500">A IA irá cobrir os pontos mais importantes do documento.</p>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-zinc-700">Dificuldade</label>
            <select
              value={dificuldade}
              onChange={(e) => setDificuldade(e.target.value)}
              className="w-full border border-zinc-200 rounded-lg p-2.5 text-sm text-zinc-800 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 transition-all"
              disabled={isPending}
            >
              <option value="facil">Fácil</option>
              <option value="media">Média</option>
              <option value="dificil">Difícil</option>
            </select>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-zinc-100 flex justify-end gap-3 bg-zinc-50">
          <button onClick={onClose} disabled={isPending} className="px-4 py-2 text-sm text-zinc-600 hover:bg-zinc-100 rounded-md transition-colors font-medium">
            Cancelar
          </button>
          <button
            onClick={handleGenerate}
            disabled={isPending}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:bg-slate-700 disabled:opacity-50 transition-colors font-semibold"
          >
            {isPending ? <Circle className="animate-spin" size={14} /> : <FileQuestion size={14} />}
            {isPending ? 'Gerando...' : 'Gerar Simulado'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// BlocoItem
// ─────────────────────────────────────────────────────────────────────────────

interface BlocoItemProps {
  bloco: Bloco;
  index: number;
  isSelected?: boolean;
  autoFocusEditor?: boolean;
  onClick?: () => void;
  onEditorMounted?: () => void;
}

const BlocoItem: React.FC<BlocoItemProps> = ({
  bloco, index, isSelected, autoFocusEditor, onClick, onEditorMounted,
}) => {
  const { mutate: updateBloco } = useUpdateBloco();
  const { mutate: deleteBloco } = useDeleteBloco();
  const [isEditing, setIsEditing] = useState(autoFocusEditor ?? false);
  const [localImportancia, setLocalImportancia] = useState<Importancia>(bloco.importancia);
  const [localIdentificador, setLocalIdentificador] = useState<string>(bloco.identificador || '');

  useEffect(() => {
    setLocalImportancia(bloco.importancia);
    setLocalIdentificador(bloco.identificador || '');
  }, [bloco.importancia, bloco.identificador]);

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
    content: markdownToHtml(bloco.conteudo),
    editorProps: {
      attributes: {
        class:
          'w-full min-h-[120px] text-[15px] p-3 outline-none bg-transparent text-zinc-900 prose prose-sm max-w-none focus:outline-none',
      },
    },
  });

  // Signal parent that the editor is ready so it can trigger focus
  useEffect(() => {
    if (editor) onEditorMounted?.();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  // Auto-focus when newly created
  useEffect(() => {
    if (autoFocusEditor && editor) {
      setIsEditing(true);
      setTimeout(() => editor.commands.focus(), 50);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFocusEditor, editor]);

  useEffect(() => {
    if (editor && isEditing) {
      editor.commands.setContent(markdownToHtml(bloco.conteudo));
    }
  }, [bloco.conteudo, editor, isEditing]);

  useEffect(() => {
    if (isEditing && editor) editor.commands.focus();
  }, [isEditing, editor]);



  const handleSave = () => {
    if (!editor) return;
    const md = htmlToMarkdown(editor.getHTML());
    const hasChanges = md !== bloco.conteudo || localImportancia !== bloco.importancia || localIdentificador !== (bloco.identificador || '');
    if (hasChanges) {
      updateBloco({ id: bloco.id, data: { conteudo: md, importancia: localImportancia, identificador: localIdentificador } });
    }
    setIsEditing(false);
  };

  const handleCancel = () => {
    if (editor) editor.commands.setContent(markdownToHtml(bloco.conteudo));
    setLocalImportancia(bloco.importancia);
    setLocalIdentificador(bloco.identificador || '');
    setIsEditing(false);
  };

  const handleTransformToPortal = () => {
    if (!editor) return;
    const targetId = prompt('Digite o ID do Bloco de destino para criar o Portal:');
    if (!targetId) return;
    const cleanId = parseInt(targetId.trim(), 10);
    if (isNaN(cleanId)) { alert('ID inválido.'); return; }
    editor.chain().focus().insertContent(`((${cleanId}))`).run();
  };

  return (
    <Draggable draggableId={String(bloco.id)} index={index}>
      {(provided, snapshot) => (
        <div
          id={`bloco-${bloco.id}`}
          ref={provided.innerRef}
          {...provided.draggableProps}
          onClick={onClick}
          onDoubleClick={() => setIsEditing(true)}
          className={cn(
            'group relative flex gap-3 p-3 -mx-3 rounded-xl transition-all duration-200 border cursor-pointer',
            isSelected
              ? 'border-slate-200 bg-slate-50 shadow-sm'
              : 'border-transparent hover:bg-slate-50/50 hover:border-border',
            snapshot.isDragging && 'shadow-soft bg-card border-slate-200 border opacity-95 rotate-[0.5deg]',
          )}
        >
          {/* Drag handle */}
          <div
            {...provided.dragHandleProps}
            onClick={(e) => e.stopPropagation()}
            className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-5 opacity-0 group-hover:opacity-100 transition-opacity text-zinc-300 hover:text-zinc-500 cursor-grab active:cursor-grabbing"
          >
            <GripVertical size={16} />
          </div>

          {/* Action toolbar */}
          <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-10 flex gap-1 bg-white/80 backdrop-blur-sm rounded-md p-0.5 border border-zinc-100 shadow-sm">
            {!isEditing && (
              <>
                <button
                  onClick={(e) => { e.stopPropagation(); setIsEditing(true); }}
                  className="p-1.5 text-zinc-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
                  title="Editar bloco"
                >
                  <FileEdit size={14} />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm('Deseja realmente excluir este bloco?')) deleteBloco(bloco.id);
                  }}
                  className="p-1.5 text-zinc-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
                  title="Excluir bloco"
                >
                  <Trash2 size={14} />
                </button>
              </>
            )}
          </div>



          {/* Content */}
          <div className="flex-1 min-w-0 space-y-1">
            {isEditing ? (
              <div className="mt-1" onClick={(e) => e.stopPropagation()}>
                <div className="mb-2 flex items-center gap-2">
                  <input
                    type="text"
                    value={localIdentificador}
                    onChange={(e) => setLocalIdentificador(e.target.value)}
                    placeholder="Identificador (ex: Art. 1º)"
                    className="text-xs px-2 py-1.5 rounded-md border border-slate-200 w-48 focus:outline-none focus:border-primary font-mono text-slate-700 shadow-sm"
                  />
                  <span className="text-[11px] text-slate-400">Identificador opcional</span>
                  {bloco.next_review && (
                    <span className="text-[11px] text-blue-500 font-medium ml-auto" title="Next FSRS Review">FSRS: {bloco.next_review}</span>
                  )}
                </div>
                {editor && (
                  <BubbleMenu
                    editor={editor}
                    options={{ placement: 'top' }}
                    className="flex bg-zinc-950 text-white rounded-lg shadow-xl border border-zinc-800 p-1 gap-1 items-center z-50 select-none"
                  >
                    <button
                      type="button"
                      onClick={() => editor.chain().focus().toggleBold().run()}
                      className={cn('px-2.5 py-1 text-xs font-bold rounded transition-colors hover:bg-zinc-800',
                        editor.isActive('bold') ? 'bg-zinc-800 text-amber-400' : 'text-zinc-300')}
                    >B</button>
                    <button
                      type="button"
                      onClick={() => editor.chain().focus().toggleItalic().run()}
                      className={cn('px-2.5 py-1 text-xs italic rounded transition-colors hover:bg-zinc-800',
                        editor.isActive('italic') ? 'bg-zinc-800 text-amber-400' : 'text-zinc-300')}
                    >I</button>
                    <div className="w-px h-4 bg-zinc-800 self-stretch my-0.5" />
                    <button
                      type="button"
                      onClick={handleTransformToPortal}
                      className="px-2.5 py-1 text-xs rounded transition-colors hover:bg-zinc-800 text-indigo-300 hover:text-indigo-200 font-medium"
                    >T (Portal)</button>
                  </BubbleMenu>
                )}
                <div className={cn(
                  "rounded-md border bg-white transition-all overflow-hidden focus-within:ring-2",
                  localImportancia === 'vital' ? "border-red-300 focus-within:ring-red-100 shadow-sm bg-red-50/10" : 
                  localImportancia === 'importante' ? "border-amber-300 focus-within:ring-amber-100 shadow-sm bg-amber-50/10" :
                  "border-blue-400 focus-within:ring-blue-100"
                )}>
                  <EditorContent editor={editor} />
                </div>
                <div className="flex justify-between items-center gap-2 mt-2">
                  <div className="flex gap-2">
                    <button 
                      onClick={() => setLocalImportancia(prev => prev === 'vital' ? 'normal' : 'vital')} 
                      className={cn(
                        "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors border",
                        localImportancia === 'vital' 
                          ? "bg-red-50 text-red-700 border-red-300" 
                          : "bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-50"
                      )}
                    >
                      <Check size={14} strokeWidth={2.5} className={cn(localImportancia === 'vital' ? 'text-red-600' : 'text-zinc-400')} />
                      Atenção
                    </button>
                    <button 
                      onClick={() => setLocalImportancia(prev => prev === 'importante' ? 'normal' : 'importante')} 
                      className={cn(
                        "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors border",
                        localImportancia === 'importante' 
                          ? "bg-amber-50 text-amber-700 border-amber-300" 
                          : "bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-50"
                      )}
                    >
                      <Check size={14} strokeWidth={2.5} className={cn(localImportancia === 'importante' ? 'text-amber-600' : 'text-zinc-400')} />
                      Importante
                    </button>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={handleCancel} className="px-3 py-1.5 text-xs text-zinc-500 hover:bg-zinc-100 rounded-md">
                      Cancelar
                    </button>
                    <button onClick={handleSave} className="px-3 py-1.5 text-xs bg-primary text-primary-foreground hover:bg-slate-700 rounded-md font-medium transition-colors">
                      Salvar
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className={cn('text-slate-800 text-[15px] leading-relaxed font-sans transition-colors',
                bloco.importancia === 'vital' && 'p-2 rounded-md border border-red-300 bg-red-50/20 -mx-2',
                bloco.importancia === 'importante' && 'p-2 rounded-md border border-amber-300 bg-amber-50/20 -mx-2',
                bloco.cor_fonte === 'destaque' && 'bg-yellow-100 px-1 rounded-sm',
                bloco.cor_fonte === 'vermelho' && 'text-red-600',
                bloco.cor_fonte === 'verde'    && 'text-green-600',
                bloco.cor_fonte === 'azul'     && 'text-blue-600',
              )}>
                {renderMarkdown(bloco.conteudo, bloco.identificador, bloco.next_review)}
              </div>
            )}
          </div>
        </div>
      )}
    </Draggable>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// DocumentViewer (main export)
// ─────────────────────────────────────────────────────────────────────────────

export const DocumentViewer: React.FC<DocumentViewerProps> = ({
  documentId, selectedBlocoId, scrollToBlocoId, onScrollComplete, onSelectBloco, onGenerateSimulado
}) => {
  const { data: doc, isLoading } = useDocumento(documentId);
  const { mutate: reorderBlocos } = useReorderBlocos();

  const [orderedBlocos, setOrderedBlocos] = useState<Bloco[]>([]);
  const [newBlocoId, setNewBlocoId] = useState<number | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showGenerateModal, setShowGenerateModal] = useState(false);

  // Sync local list with server data (but preserve optimistic order)
  useEffect(() => {
    if (doc?.blocos) setOrderedBlocos(doc.blocos);
  }, [doc?.blocos]);

  // Scroll-to-bloco support
  useEffect(() => {
    if (!scrollToBlocoId || isLoading) return;
    const timer = setTimeout(() => {
      const el = document.getElementById(`bloco-${scrollToBlocoId}`);
      if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); onScrollComplete?.(); }
    }, 300);
    return () => clearTimeout(timer);
  }, [scrollToBlocoId, isLoading, orderedBlocos, onScrollComplete]);

  // Clear auto-focus flag once the new bloco's editor is mounted
  const handleNewBlocoMounted = useCallback(() => {
    setNewBlocoId(null);
  }, []);

  const handleDragEnd = (result: DropResult) => {
    if (!result.destination || result.destination.index === result.source.index) return;
    const reordered = Array.from(orderedBlocos);
    const [moved] = reordered.splice(result.source.index, 1);
    reordered.splice(result.destination.index, 0, moved);
    setOrderedBlocos(reordered);
    reorderBlocos(reordered.map((b, idx) => ({ id: b.id, ordem: idx })));
  };

  const handleGenerateQuestions = async () => {
    if (!orderedBlocos.length) return;
    setShowGenerateModal(true);
  };

  // Compute the next available ordem (last bloco ordem + 1, or 0 if empty)
  const nextOrdem = orderedBlocos.length > 0
    ? (orderedBlocos[orderedBlocos.length - 1].ordem ?? orderedBlocos.length - 1) + 1
    : 0;

  // ── Empty / loading guards ──────────────────────────────────────────────
  if (!documentId) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-white min-h-full rounded-lg shadow-sm border border-zinc-100 p-8">
        <img 
          src="/mountain.png" 
          alt="Mountain" 
          className="opacity-90 mb-6 drop-shadow-sm"
          style={{ width: '20%' }}
        />
        <p 
          className="text-lg text-zinc-900/80 text-center max-w-md"
          style={{ fontFamily: 'Garamond, serif', fontWeight: 'normal', fontStyle: 'normal' }}
        >
          "The mountain is only there so you have a place to walk."
        </p>
      </div>
    );
  }

  if (isLoading) return <div className="p-8 text-zinc-500">Carregando documento…</div>;
  if (!doc)      return <div className="p-8 text-zinc-500">Documento não encontrado.</div>;

  return (
    <>
      <div className="max-w-3xl mx-auto bg-card p-8 sm:px-12 rounded-xl shadow-soft border border-border min-h-full">
        {/* Document header */}
        <div className="flex justify-between items-start mb-8 pb-4 border-b border-zinc-100">
          <div>
            <h1 className="text-[15px] font-bold text-zinc-900 tracking-tight">{doc.titulo}</h1>
            {doc.descricao && <p className="text-zinc-500 mt-1">{doc.descricao}</p>}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setShowImportModal(true)}
              className="flex items-center gap-2 bg-white border border-zinc-200 text-zinc-700 px-3 py-1.5 rounded-md text-sm font-medium hover:bg-zinc-50 hover:border-zinc-300 transition-colors shadow-sm"
            >
              <ClipboardList size={15} />
              Importar Texto
            </button>
            <button
              onClick={handleGenerateQuestions}
              className="flex items-center gap-2 bg-primary text-primary-foreground px-3 py-1.5 rounded-md text-sm font-medium hover:bg-slate-700 transition-colors shadow-sm"
            >
              <FileQuestion size={15} />
              Gerar Simulado
            </button>
          </div>
        </div>

        {/* Blocos list with DnD */}
        <DragDropContext onDragEnd={handleDragEnd}>
          <Droppable droppableId="blocos-list">
            {(provided, snapshot) => (
              <div
                ref={provided.innerRef}
                {...provided.droppableProps}
                className={cn(
                  'space-y-0 transition-colors rounded-lg',
                  snapshot.isDraggingOver && 'bg-blue-50/30',
                )}
              >
                {orderedBlocos.map((bloco, index) => (
                  <React.Fragment key={bloco.id}>
                    {/* Hover-only insert button BETWEEN blocos */}
                    <div className="h-3 group/zone hover:h-7 transition-all duration-150 flex items-center">
                      <AddBlocoButton
                        documentId={documentId}
                        insertAtOrdem={bloco.ordem}   // shift everything at & after this spot
                        onCreated={(id) => setNewBlocoId(id)}
                      />
                    </div>

                    <BlocoItem
                      bloco={bloco}
                      index={index}
                      isSelected={selectedBlocoId === bloco.id}
                      autoFocusEditor={newBlocoId === bloco.id}
                      onClick={() => onSelectBloco?.(bloco.id)}
                      onEditorMounted={newBlocoId === bloco.id ? handleNewBlocoMounted : undefined}
                    />
                  </React.Fragment>
                ))}

                {provided.placeholder}

                {orderedBlocos.length === 0 && (
                  <p className="text-zinc-400 text-center py-10 text-sm">
                    Este documento ainda não possui blocos.
                  </p>
                )}
              </div>
            )}
          </Droppable>
        </DragDropContext>

        {/* Always-visible "Novo bloco" button at the end */}
        {documentId && (
          <AddBlocoButton
            documentId={documentId}
            insertAtOrdem={nextOrdem}
            alwaysVisible
            onCreated={(id) => setNewBlocoId(id)}
          />
        )}
      </div>

      {/* Bulk Import Modal */}
      {showImportModal && (
        <BulkImportModal
          documentId={documentId}
          nextOrdem={nextOrdem}
          onClose={() => setShowImportModal(false)}
        />
      )}

      {/* Generate Simulado Modal */}
      {showGenerateModal && documentId && (
        <GenerateSimuladoModal
          documentId={documentId}
          onClose={() => setShowGenerateModal(false)}
          onSuccess={(questions) => {
            setShowGenerateModal(false);
            onGenerateSimulado?.(questions);
          }}
        />
      )}
    </>
  );
};
