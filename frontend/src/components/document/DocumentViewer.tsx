import React, { useState, useEffect, useCallback } from 'react';
import { DragDropContext, Droppable, DropResult } from '@hello-pangea/dnd';
import { FileQuestion, ClipboardList, MoreVertical } from 'lucide-react';
import { motion } from 'framer-motion';
import { useDocumento } from '../../hooks/useDocumentos';
import { useReorderBlocos } from '../../hooks/useBlocos';
import { Bloco, Questao } from '../../types';
import { cn } from '../../lib/utils';

// Subcomponents extracted for performance
import { AddBlocoButton } from './viewer/AddBlocoButton';
import { BulkImportModal } from './viewer/BulkImportModal';
import { GenerateSimuladoModal } from './viewer/GenerateSimuladoModal';
import { BlocoItem } from './viewer/BlocoItem';

interface DocumentViewerProps {
  documentId: number | null;
  selectedBlocoId?: number | null;
  scrollToBlocoId?: number | null;
  onScrollComplete?: () => void;
  onSelectBloco?: (id: number) => void;
  onGenerateSimulado?: (questions: Questao[]) => void;
  onOpenNotes?: () => void;
  onBackToMenu?: () => void;
}

export const DocumentViewer: React.FC<DocumentViewerProps> = ({
  documentId, selectedBlocoId, scrollToBlocoId, onScrollComplete, onSelectBloco, onGenerateSimulado, onOpenNotes, onBackToMenu
}) => {
  const { data: doc, isLoading } = useDocumento(documentId);
  const { mutate: reorderBlocos } = useReorderBlocos();

  const [orderedBlocos, setOrderedBlocos] = useState<Bloco[]>([]);
  const [newBlocoId, setNewBlocoId] = useState<number | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [isDocMenuOpen, setIsDocMenuOpen] = useState(false);

  useEffect(() => {
    if (doc?.blocos) setOrderedBlocos(doc.blocos);
  }, [doc?.blocos]);

  useEffect(() => {
    if (!scrollToBlocoId || isLoading) return;
    const timer = setTimeout(() => {
      const el = document.getElementById(`bloco-${scrollToBlocoId}`);
      if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); onScrollComplete?.(); }
    }, 300);
    return () => clearTimeout(timer);
  }, [scrollToBlocoId, isLoading, orderedBlocos, onScrollComplete]);

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

  const nextOrdem = orderedBlocos.length > 0
    ? (orderedBlocos[orderedBlocos.length - 1].ordem ?? orderedBlocos.length - 1) + 1
    : 0;

  if (!documentId) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-white dark:bg-card min-h-full rounded-lg shadow-sm border border-border p-8 transition-colors">
        <img 
          src="/mountain.png" 
          alt="Mountain" 
          className="opacity-90 mb-6 drop-shadow-sm"
          style={{ width: '20%' }}
        />
        <p 
          className="text-lg text-zinc-900/80 dark:text-zinc-200/80 text-center max-w-md"
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
      <motion.div 
        className="max-w-3xl mx-auto bg-card p-8 sm:px-12 rounded-xl shadow-soft border border-border min-h-full touch-pan-y"
        drag="x"
        dragDirectionLock={true}
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.2}
        onDragEnd={(_, { offset, velocity }) => {
          if (offset.x > 100 || velocity.x > 500) {
            onBackToMenu?.();
          }
        }}
      >
        <div className="flex justify-between items-start mb-8 pb-4 border-b border-border">
          <div>
            <h1 className="text-[15px] font-bold text-zinc-900 dark:text-zinc-100 tracking-tight">{doc.titulo}</h1>
            {doc.descricao && <p className="text-zinc-500 mt-1">{doc.descricao}</p>}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {/* Desktop Action Buttons */}
            <div className="hidden md:flex items-center gap-2">
              <button
                onClick={() => setShowImportModal(true)}
                className="flex items-center gap-2 bg-white dark:bg-zinc-800 border border-border text-zinc-700 dark:text-zinc-300 px-3 py-1.5 rounded-md text-sm font-medium hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors shadow-sm"
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

            {/* Mobile Actions Menu */}
            <div className="md:hidden relative">
              <button
                onClick={() => setIsDocMenuOpen(!isDocMenuOpen)}
                className="p-1.5 rounded-md bg-white dark:bg-zinc-800 border border-border text-slate-600 dark:text-zinc-300 shadow-sm"
              >
                <MoreVertical size={20} />
              </button>
              
              {isDocMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setIsDocMenuOpen(false)}></div>
                  <div className="absolute right-0 top-full mt-2 w-48 bg-white dark:bg-zinc-800 border border-border rounded-md shadow-lg z-50 p-2 flex flex-col gap-2">
                    <button
                      onClick={() => { setShowImportModal(true); setIsDocMenuOpen(false); }}
                      className="flex items-center gap-2 w-full bg-slate-50 dark:bg-zinc-900/50 text-zinc-700 dark:text-zinc-300 px-3 py-2.5 rounded-md text-sm font-medium hover:bg-slate-100 transition-colors text-left"
                    >
                      <ClipboardList size={16} />
                      Importar Texto
                    </button>
                    <button
                      onClick={() => { handleGenerateQuestions(); setIsDocMenuOpen(false); }}
                      className="flex items-center gap-2 w-full bg-primary text-primary-foreground px-3 py-2.5 rounded-md text-sm font-medium hover:bg-slate-700 transition-colors text-left"
                    >
                      <FileQuestion size={16} />
                      Gerar Simulado
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

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
                    <div className="h-3 group/zone hover:h-7 transition-all duration-150 flex items-center">
                      <AddBlocoButton
                        documentId={documentId}
                        insertAtOrdem={bloco.ordem}
                        onCreated={(id) => setNewBlocoId(id)}
                      />
                    </div>

                    <BlocoItem
                      bloco={bloco}
                      index={index}
                      isSelected={selectedBlocoId === bloco.id}
                      autoFocusEditor={newBlocoId === bloco.id}
                      onClick={() => onSelectBloco?.(bloco.id)}
                      onOpenNotes={onOpenNotes}
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

        {documentId && (
          <AddBlocoButton
            documentId={documentId}
            insertAtOrdem={nextOrdem}
            alwaysVisible
            onCreated={(id) => setNewBlocoId(id)}
          />
        )}
      </motion.div>

      {showImportModal && (
        <BulkImportModal
          documentId={documentId}
          nextOrdem={nextOrdem}
          onClose={() => setShowImportModal(false)}
        />
      )}

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
