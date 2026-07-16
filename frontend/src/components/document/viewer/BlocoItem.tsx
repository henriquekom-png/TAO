import React, { useState, useEffect } from 'react';
import { Draggable } from '@hello-pangea/dnd';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { Color } from '@tiptap/extension-color';
import { TextStyle } from '@tiptap/extension-text-style';
import { FileEdit, Trash2, GripVertical, Check } from 'lucide-react';
import { useUpdateBloco, useDeleteBloco } from '../../../hooks/useBlocos';
import { Bloco, Importancia } from '../../../types';
import { cn } from '../../../lib/utils';
import { markdownToHtml, htmlToMarkdown } from '../../../lib/markdownHtmlConverter';
import { EditorContextMenu } from '../EditorContextMenu';

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

  let cleanText = text;
  cleanText = cleanText.replace(/(Art\.\s*\d+[-A-Z0-9ºo.]*|§\s*\d+[-A-Z0-9ºo.]*|Parágrafo único\.?)\s*\n+/gi, '$1 ');
  cleanText = cleanText.replace(/(\b[IVXLCDM]+\s*-)\s*\n+/g, '$1 ');
  cleanText = cleanText.replace(/(\b[a-z]\))\s*\n+/g, '$1 ');

  const blocks = cleanText.split(/\n\n+/);
  return blocks.map((block, bIdx) => {
    const inlineNodes = block.split(/(\*\*.*?\*\*|\*.*?\*|<span[^>]*style=["'][^"']*color:\s*[^"']+["'][^>]*>.*?<\/span>)/gi).map((part, i) => {
      if (!part) return null;
      if (part.startsWith('**') && part.endsWith('**'))
        return <strong key={i} className="font-semibold text-slate-900 dark:text-slate-100">{part.slice(2, -2)}</strong>;
      if (part.startsWith('*') && part.endsWith('*'))
        return <em key={i} className="italic text-slate-800 dark:text-slate-300">{part.slice(1, -1)}</em>;
      
      const spanMatch = part.match(/^<span[^>]*style=["'][^"']*color:\s*([^;"']+)[^"']*["'][^>]*>(.*?)<\/span>$/i);
      if (spanMatch) {
        return <span key={i} style={{ color: spanMatch[1].trim() }}>{spanMatch[2]}</span>;
      }
      
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

interface BlocoItemProps {
  bloco: Bloco;
  index: number;
  isSelected?: boolean;
  autoFocusEditor?: boolean;
  onClick?: () => void;
  onOpenNotes?: () => void;
  onEditorMounted?: () => void;
}

export const BlocoItem: React.FC<BlocoItemProps> = ({
  bloco, index, isSelected, autoFocusEditor, onClick, onOpenNotes, onEditorMounted,
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
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      TextStyle,
      Color,
    ],
    content: markdownToHtml(bloco.conteudo),
    editorProps: {
      attributes: {
        class: 'w-full min-h-[120px] text-[0.9375rem] p-3 outline-none bg-transparent text-zinc-900 dark:text-zinc-100 prose dark:prose-invert prose-sm max-w-none focus:outline-none',
      },
    },
  });

  useEffect(() => {
    if (editor) onEditorMounted?.();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

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

  return (
    <Draggable draggableId={String(bloco.id)} index={index}>
      {(provided, snapshot) => (
        <div
          id={`bloco-${bloco.id}`}
          ref={provided.innerRef}
          {...provided.draggableProps}
          onClick={onClick}
          onDoubleClick={(e) => { e.stopPropagation(); onOpenNotes?.(); }}
          className={cn(
            'group relative flex gap-3 p-3 -mx-3 rounded-xl transition-all duration-200 border cursor-pointer touch-manipulation',
            isSelected
              ? 'border-border bg-slate-50 dark:bg-zinc-800/50 shadow-sm'
              : 'border-transparent hover:bg-slate-50/50 dark:hover:bg-zinc-800/30 hover:border-border',
            snapshot.isDragging && 'shadow-soft bg-card border-border border opacity-95 rotate-[0.5deg]',
          )}
        >
          <div
            {...provided.dragHandleProps}
            onClick={(e) => e.stopPropagation()}
            className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-5 opacity-0 group-hover:opacity-100 transition-opacity text-zinc-300 hover:text-zinc-500 cursor-grab active:cursor-grabbing"
          >
            <GripVertical size={16} />
          </div>

          <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-10 flex gap-1 bg-white/80 dark:bg-zinc-800/80 backdrop-blur-sm rounded-md p-0.5 border border-border shadow-sm">
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
                {editor && <EditorContextMenu editor={editor} />}
                <div className={cn(
                  "rounded-md border bg-white dark:bg-zinc-900 transition-all overflow-hidden focus-within:ring-2",
                  localImportancia === 'vital' ? "border-red-300 dark:border-red-800 focus-within:ring-red-100 shadow-sm bg-red-50/10 dark:bg-transparent" : 
                  localImportancia === 'importante' ? "border-amber-300 dark:border-amber-700 focus-within:ring-amber-100 shadow-sm bg-amber-50/10 dark:bg-transparent" :
                  "border-blue-400 dark:border-zinc-700 focus-within:ring-blue-100"
                )}>
                  <EditorContent editor={editor} />
                </div>
                <div className="flex justify-between items-center gap-2 mt-2">
                  <div className="flex gap-2">
                    <button 
                      onClick={() => setLocalImportancia(prev => prev === 'vital' ? 'normal' : 'vital')} 
                      className={cn(
                        "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors border",
                        localImportancia === 'vital' ? "bg-red-50 text-red-700 border-red-300 dark:bg-red-900/40 dark:text-red-400 dark:border-red-800" : "bg-white text-zinc-600 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700"
                      )}
                    >
                      <Check size={14} strokeWidth={2.5} className={cn(localImportancia === 'vital' ? 'text-red-600' : 'text-zinc-400')} />
                      Atenção
                    </button>
                    <button 
                      onClick={() => setLocalImportancia(prev => prev === 'importante' ? 'normal' : 'importante')} 
                      className={cn(
                        "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors border",
                        localImportancia === 'importante' ? "bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-900/40 dark:text-amber-400 dark:border-amber-800" : "bg-white text-zinc-600 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700"
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
                    <button onClick={handleSave} className="px-3 py-1.5 text-xs bg-primary text-primary-foreground hover:bg-slate-700 rounded-md font-medium">
                      Salvar
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className={cn('text-slate-800 dark:text-slate-300 text-[0.9375rem] leading-relaxed font-sans transition-colors',
                bloco.importancia === 'vital' && 'p-2 rounded-md border border-red-300 dark:border-red-800 bg-red-50/20 dark:bg-transparent -mx-2',
                bloco.importancia === 'importante' && 'p-2 rounded-md border border-amber-300 dark:border-amber-700 bg-amber-50/20 dark:bg-transparent -mx-2',
                bloco.cor_fonte === 'destaque' && 'bg-yellow-100 px-1 rounded-sm text-yellow-900',
                bloco.cor_fonte === 'vermelho' && 'text-red-600',
                bloco.cor_fonte === 'verde'    && 'text-green-600',
                bloco.cor_fonte === 'azul'     && 'text-blue-600',
              )}>
                {renderMarkdown(bloco.conteudo, bloco.identificador || undefined, bloco.next_review || undefined)}
              </div>
            )}
          </div>
        </div>
      )}
    </Draggable>
  );
};
