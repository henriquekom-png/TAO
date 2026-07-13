import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { DragDropContext, Droppable, DropResult } from '@hello-pangea/dnd';
import { X, FileEdit, GripVertical } from 'lucide-react';
import { motion } from 'framer-motion';
import {
  useAnotacoesByBloco,
  useCreateAnotacao,
  useReorderAnotacoes,
  useDeleteAnotacao,
} from '../../hooks/useAnotacoes';
import { useResolvePortals, PortalNavigationTarget } from '../../hooks/usePortals';
import { Anotacao } from '../../types';
import { cn } from '../../lib/utils';
import { extractPortalIds } from '../../lib/portalParser';

import { AutoResizeTextarea } from './annotation/AutoResizeTextarea';
import { TipTapEditor } from './annotation/TipTapEditors';
import { PortalSearchModal } from './annotation/PortalSearchModal';
import { AnotacaoItem } from './annotation/AnotacaoItem';

interface AnnotationPanelProps {
  blocoId: number | null;
  onClose: () => void;
  onGoToSource?: (target: PortalNavigationTarget) => void;
  onBackToDocument?: () => void;
}

export const AnnotationPanel: React.FC<AnnotationPanelProps> = ({ blocoId, onClose, onGoToSource, onBackToDocument }) => {
  const { data: anotacoes, isLoading } = useAnotacoesByBloco(blocoId);
  const { mutate: createAnotacao } = useCreateAnotacao();
  const { mutate: reorderAnotacoes } = useReorderAnotacoes();
  const { mutate: deleteAnotacao } = useDeleteAnotacao();

  const [orderedAnotacoes, setOrderedAnotacoes] = useState<Anotacao[]>([]);
  const [editContent, setEditContent] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [creationType, setCreationType] = useState<'texto' | 'fluxograma'>('texto');

  const [openPortalSearch, setOpenPortalSearch] = useState(false);
  const [portalSearchCallback, setPortalSearchCallback] = useState<((id: number) => void) | null>(null);

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

  const handleGoToSource = useCallback((target: PortalNavigationTarget) => {
    onGoToSource?.(target);
  }, [onGoToSource]);

  const handleDelete = (anotacaoId: number) => {
    if (confirm('Tem certeza que deseja excluir esta anotação?')) {
      setOrderedAnotacoes((prev) => prev.filter((a) => a.id !== anotacaoId));
      deleteAnotacao(
        { id: anotacaoId, blocoId: blocoId! },
        {
          onError: (err) => {
            console.error('Erro ao deletar anotação:', err);
            if (anotacoes) setOrderedAnotacoes(anotacoes);
            alert('Erro ao excluir a anotação. Tente novamente.');
          },
        }
      );
    }
  };

  const handleOpenPortalSearch = useCallback((callback: (id: number) => void) => {
    setPortalSearchCallback(() => callback);
    setOpenPortalSearch(true);
  }, []);

  const handleInitiateCreation = (type: 'texto' | 'portal' | 'fluxograma' | 'tabela') => {
    if (type === 'portal') {
      handleOpenPortalSearch((selectedId: number) => {
        createAnotacao(
          { bloco_id: blocoId!, conteudo: `((${selectedId}))`, tipo: 'portal', ordem: orderedAnotacoes.length },
          {
            onSuccess: () => setOpenPortalSearch(false),
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
      const template = `graph TD\n  A[Início] --> B[Processo]\n  B --> C{Decisão}\n  C -->|Sim| D[Fim 1]\n  C -->|Não| E[Fim 2]`;
      setEditContent(template);
      setIsCreating(true);
      return;
    }

    setCreationType('texto');
    setEditContent('');
    setIsCreating(true);
  };

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
      { bloco_id: blocoId!, conteudo: editContent, tipo: creationType, ordem: orderedAnotacoes.length },
      { onSuccess: () => { setIsCreating(false); setEditContent(''); } }
    );
  };

  if (!blocoId) return null;

  return (
    <motion.div 
      className="w-full min-w-0 bg-zinc-50/50 dark:bg-zinc-950 border-l border-border flex flex-col h-full shadow-soft-sm animate-in slide-in-from-right-8 duration-300 transition-colors touch-pan-y"
      drag="x"
      dragDirectionLock={true}
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.2}
      onDragEnd={(_, { offset, velocity }) => {
        if (offset.x > 100 || velocity.x > 500) {
          onBackToDocument?.();
        }
      }}
    >
      <div className="h-14 px-4 border-b border-border flex items-center justify-between bg-card shrink-0 shadow-soft-sm transition-colors">
        <div className="flex items-center gap-2">
          <FileEdit size={18} className="text-amber-500" />
          <h2 className="font-semibold text-sm text-zinc-800 dark:text-zinc-200">Anotações do Bloco</h2>
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
                  <button onClick={() => handleInitiateCreation('texto')} className="flex items-center justify-center gap-2 text-xs font-medium bg-amber-100 text-amber-700 px-4 py-2 rounded-lg hover:bg-amber-200 transition-colors w-full">📝 + Nota de Texto</button>
                  <button onClick={() => handleInitiateCreation('portal')} className="flex items-center justify-center gap-2 text-xs font-medium bg-amber-100 text-amber-700 px-4 py-2 rounded-lg hover:bg-amber-200 transition-colors w-full">🔗 + Portal</button>
                  <button onClick={() => handleInitiateCreation('tabela')} className="flex items-center justify-center gap-2 text-xs font-medium bg-amber-100 text-amber-700 px-4 py-2 rounded-lg hover:bg-amber-200 transition-colors w-full">📅 + Tabela</button>
                  <button onClick={() => handleInitiateCreation('fluxograma')} className="flex items-center justify-center gap-2 text-xs font-medium bg-amber-100 text-amber-700 px-4 py-2 rounded-lg hover:bg-amber-200 transition-colors w-full">📊 + Fluxograma</button>
                </div>
              </div>
            ) : (
              <>
                <p className="text-[11px] text-zinc-400 flex items-center gap-1 select-none"><GripVertical size={11} /> Arraste para reordenar</p>
                <DragDropContext onDragEnd={handleDragEnd}>
                  <Droppable droppableId="anotacoes-list">
                    {(provided, snapshot) => (
                      <div ref={provided.innerRef} {...provided.droppableProps} className={cn("space-y-3 transition-colors rounded-lg", snapshot.isDraggingOver && "bg-amber-50/50")}>
                        {orderedAnotacoes.map((anot, index) => (
                          <AnotacaoItem key={anot.id} anot={anot} index={index} portalMap={portalMap} onGoToSource={handleGoToSource} onDelete={handleDelete} onOpenPortalSearch={handleOpenPortalSearch} />
                        ))}
                        {provided.placeholder}
                      </div>
                    )}
                  </Droppable>
                </DragDropContext>

                {!isCreating && (
                  <div className="flex gap-2 w-full mt-4 border-t border-border pt-3">
                    <button onClick={() => handleInitiateCreation('texto')} className="flex-1 py-2 px-1 border border-zinc-200 rounded-lg text-[10px] font-semibold text-zinc-600 hover:text-amber-700 hover:border-amber-300 hover:bg-amber-50 transition-colors flex items-center justify-center gap-1">📝 + Texto</button>
                    <button onClick={() => handleInitiateCreation('portal')} className="flex-1 py-2 px-1 border border-zinc-200 rounded-lg text-[10px] font-semibold text-zinc-600 hover:text-amber-700 hover:border-amber-300 hover:bg-amber-50 transition-colors flex items-center justify-center gap-1">🔗 + Portal</button>
                    <button onClick={() => handleInitiateCreation('tabela')} className="flex-1 py-2 px-1 border border-zinc-200 rounded-lg text-[10px] font-semibold text-zinc-600 hover:text-amber-700 hover:border-amber-300 hover:bg-amber-50 transition-colors flex items-center justify-center gap-1">📅 + Tabela</button>
                    <button onClick={() => handleInitiateCreation('fluxograma')} className="flex-1 py-2 px-1 border border-zinc-200 rounded-lg text-[10px] font-semibold text-zinc-600 hover:text-amber-700 hover:border-amber-300 hover:bg-amber-50 transition-colors flex items-center justify-center gap-1">📊 + Fluxo</button>
                  </div>
                )}
              </>
            )}

            {isCreating && (
              <div className="bg-white dark:bg-zinc-900 border border-amber-200 dark:border-amber-900 rounded-lg shadow-sm p-3 space-y-2 animate-in fade-in transition-colors">
                <div className="text-xs font-semibold text-amber-700 uppercase mb-2">Nova Anotação ({creationType === 'fluxograma' ? 'Fluxograma' : 'Texto'})</div>
                {creationType === 'fluxograma' ? (
                  <AutoResizeTextarea value={editContent} onChange={e => setEditContent(e.target.value)} placeholder="Sintaxe Mermaid..." className="w-full text-sm p-2 border border-zinc-300 rounded-md focus:ring-amber-500 focus:border-amber-500 outline-none" autoFocus />
                ) : (
                  <TipTapEditor value={editContent} onChange={setEditContent} placeholder="Escreva sua nota aqui..." onOpenPortalSearch={handleOpenPortalSearch} autoFocus />
                )}
                <div className="flex justify-end gap-2">
                  <button onClick={() => setIsCreating(false)} className="px-3 py-1.5 text-xs text-zinc-500 hover:bg-zinc-100 rounded-md">Cancelar</button>
                  <button onClick={handleCreate} disabled={!editContent.trim()} className="px-3 py-1.5 text-xs bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 rounded-md font-medium">Criar</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {openPortalSearch && <PortalSearchModal onClose={() => setOpenPortalSearch(false)} onSelect={(id) => { if (portalSearchCallback) portalSearchCallback(id); }} />}
    </motion.div>
  );
};
