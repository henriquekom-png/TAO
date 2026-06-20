import React, { useState, useEffect, useRef } from 'react';
import { Draggable } from '@hello-pangea/dnd';
import { FileEdit, GripVertical, Trash2, Eye } from 'lucide-react';
import { useUpdateAnotacao } from '../../../hooks/useAnotacoes';
import { Anotacao } from '../../../types';
import { cn } from '../../../lib/utils';
import { isPurePortalRef, extractPortalIds } from '../../../lib/portalParser';
import { PortalTransclusion } from '../PortalBlock';
import { MermaidRenderer } from './MermaidRenderer';
import { AnnotationContentEditor } from './TipTapEditors';
import { PortalNavigationTarget } from '../../../hooks/usePortals';

function parseContentBlocks(content: string) {
  const blocks: { type: 'text' | 'mermaid'; content: string }[] = [];
  const regex = /```mermaid\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      blocks.push({ type: 'text', content: content.substring(lastIndex, match.index) });
    }
    blocks.push({ type: 'mermaid', content: match[1].trim() });
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < content.length) {
    blocks.push({ type: 'text', content: content.substring(lastIndex) });
  }
  return blocks;
}

interface AnotacaoItemProps {
  anot: Anotacao;
  index: number;
  portalMap: Record<string, import('../../../hooks/usePortals').ResolvedPortal>;
  onGoToSource: (target: PortalNavigationTarget) => void;
  onDelete: (id: string) => void;
  onOpenPortalSearch: (insertCallback: (id: string) => void) => void;
}

export const AnotacaoItem: React.FC<AnotacaoItemProps> = ({ anot, index, portalMap, onGoToSource, onDelete, onOpenPortalSearch }) => {
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
          onSuccess: () => setIsSaving(false),
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
    if (anot.tipo === 'fluxograma') return <MermaidRenderer chart={content} />;

    const blocks = parseContentBlocks(content);
    return (
      <div className="space-y-3 p-3">
        {blocks.map((block, i) => {
          if (block.type === 'mermaid') return <MermaidRenderer key={i} chart={block.content} />;
          
          let cleanText = block.content;
          cleanText = cleanText.replace(/(Art\.\s*\d+[-A-Z0-9ºo.]*|§\s*\d+[-A-Z0-9ºo.]*|Parágrafo único\.?)\s*\n+/gi, '$1 ');
          cleanText = cleanText.replace(/(\b[IVXLCDM]+\s*-)\s*\n+/g, '$1 ');
          cleanText = cleanText.replace(/(\b[a-z]\))\s*\n+/g, '$1 ');

          return (
            <div key={i} className="text-slate-800 dark:text-slate-300 text-[14px] leading-relaxed transition-colors">
              {cleanText.split(/\n\n+/).map((para, pIdx, arr) => {
                const inlineNodes = para.split(/(\*\*.*?\*\*|\*.*?\*|<span[^>]*style=["'][^"']*color:\s*[^"']+["'][^>]*>.*?<\/span>)/gi).map((part, idx) => {
                  if (!part) return null;
                  if (part.startsWith('**') && part.endsWith('**'))
                    return <strong key={idx} className="font-semibold text-slate-900 dark:text-slate-100">{part.slice(2, -2)}</strong>;
                  if (part.startsWith('*') && part.endsWith('*'))
                    return <em key={idx} className="italic text-slate-800 dark:text-slate-300">{part.slice(1, -1)}</em>;
                  
                  const spanMatch = part.match(/^<span[^>]*style=["'][^"']*color:\s*([^;"']+)[^"']*["'][^>]*>(.*?)<\/span>$/i);
                  if (spanMatch) {
                    return <span key={idx} style={{ color: spanMatch[1].trim() }}>{spanMatch[2]}</span>;
                  }
                  
                  return part.split('\n').map((line, lIdx, lArr) => (
                    <React.Fragment key={`${idx}-${lIdx}`}>
                      {line}
                      {lIdx < lArr.length - 1 && <br />}
                    </React.Fragment>
                  ));
                });
                return (
                  <p key={pIdx} className={pIdx < arr.length - 1 ? "mb-1.5" : ""}>
                    {inlineNodes}
                  </p>
                );
              })}
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
            "bg-white dark:bg-zinc-900 border border-transparent hover:border-border rounded-xl shadow-soft-sm overflow-hidden flex flex-row items-stretch relative group min-h-[60px]",
            "transition-all focus-within:border-slate-300 dark:focus-within:border-zinc-700 focus-within:ring-1 focus-within:ring-slate-300 dark:focus-within:ring-zinc-700",
            snapshot.isDragging && "shadow-soft border-slate-300 dark:border-zinc-700 rotate-[0.5deg] opacity-95"
          )}
        >
          <div
            {...provided.dragHandleProps}
            className="flex items-center justify-center w-6 bg-zinc-50/50 dark:bg-zinc-900/50 hover:bg-zinc-50 dark:hover:bg-zinc-800 border-r border-border text-zinc-300 dark:text-zinc-600 hover:text-zinc-500 dark:hover:text-zinc-400 cursor-grab active:cursor-grabbing transition-colors shrink-0"
            title="Arrastar para reordenar"
          >
            <GripVertical size={14} />
          </div>

          <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity bg-white/95 dark:bg-zinc-800/95 backdrop-blur-sm px-1.5 py-1 rounded-md shadow-sm border border-border z-10">
            {isSaving && (
              <span className="text-[10px] text-amber-600 font-medium animate-pulse mr-1 select-none">
                Salvando...
              </span>
            )}
            
            <button
              onClick={() => setIsEditing(!isEditing)}
              className={cn(
                "p-1 rounded text-zinc-400 hover:bg-zinc-100 transition-colors",
                isEditing ? "hover:text-emerald-600" : "hover:text-amber-600"
              )}
              title={isEditing ? "Visualizar anotação" : "Editar anotação"}
            >
              {isEditing ? <Eye size={13} /> : <FileEdit size={13} />}
            </button>

            <button
              onClick={() => onDelete(anot.id)}
              className="p-1 text-zinc-400 hover:text-red-600 rounded hover:bg-red-50 transition-colors"
              title="Excluir anotação"
            >
              <Trash2 size={13} />
            </button>
          </div>

          <div className="flex-1 min-w-0 flex flex-col justify-center">
            {isPortalType && portalRefId ? (
              <PortalTransclusion
                refId={portalRefId}
                resolved={portalMap[String(portalRefId)]}
                onGoToSource={onGoToSource}
              />
            ) : !isEditing ? (
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
