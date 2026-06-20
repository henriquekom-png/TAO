/**
 * Sidebar.tsx — Native HTML5 Drag & Drop tree
 *
 * Drop rules:
 *  • Drag DOCUMENTO onto a PASTA header → move to that pasta
 *  • Drag DOCUMENTO onto another DOC    → reorder (or move+reorder)
 *  • Drag PASTA onto another PASTA      → re-parent
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  ChevronRight, ChevronDown, Folder, FileText, Database,
  FolderPlus, FilePlus, Trash2, Check, X, Pencil, GripVertical, BrainCircuit,
} from 'lucide-react';
import {
  usePastasTree, useCreatePasta, useDeletePasta, useRenamePasta, useMovePasta,
} from '../../hooks/usePastas';
import {
  useDocumentosByPasta, useCreateDocumento, useRenameDocumento,
  useMoveDocumento, useReorderDocumento,
} from '../../hooks/useDocumentos';
import { Pasta } from '../../types';
import { api } from '../../api/client';
import { cn } from '../../lib/utils';
import { Timer } from './Timer';

// ─────────────────────────────────────────────────────────────────────────────
// Module-level drag payload — shared across the recursive tree without
// prop-drilling. Cleared after every drop or dragEnd.
// ─────────────────────────────────────────────────────────────────────────────

type DragPayload =
  | { kind: 'doc';   docId: number; sourcePastaId: number; currentOrdem: number }
  | { kind: 'pasta'; pastaId: number; currentParentId: number | null };

let _dragging: DragPayload | null = null;

// ─────────────────────────────────────────────────────────────────────────────
// InlineEdit — turns a label into a text input for renaming
// ─────────────────────────────────────────────────────────────────────────────

const InlineEdit: React.FC<{
  initialValue: string;
  onConfirm: (v: string) => void;
  onCancel: () => void;
}> = ({ initialValue, onConfirm, onCancel }) => {
  const [value, setValue] = useState(initialValue);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);

  const commit = () => {
    const t = value.trim();
    if (t && t !== initialValue) onConfirm(t);
    else onCancel();
  };

  return (
    <input
      ref={ref}
      value={value}
      onChange={e => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
        e.stopPropagation();
      }}
      onClick={e => e.stopPropagation()}
      className="flex-1 min-w-0 bg-white border border-indigo-300 rounded px-1 text-sm outline-none focus:ring-1 focus:ring-indigo-400 text-zinc-800"
    />
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// InlineForm — for creating new items
// ─────────────────────────────────────────────────────────────────────────────

const InlineForm: React.FC<{
  placeholder: string;
  onConfirm: (v: string) => void;
  onCancel: () => void;
  isPending?: boolean;
}> = ({ placeholder, onConfirm, onCancel, isPending }) => {
  const [value, setValue] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);

  return (
    <div className="mx-2 mb-1 flex items-center gap-1 bg-white border border-indigo-200 rounded-md shadow-sm px-2 py-1.5">
      <input
        ref={ref} value={value} disabled={isPending}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && value.trim()) onConfirm(value.trim());
          if (e.key === 'Escape') onCancel();
        }}
        placeholder={placeholder}
        className="flex-1 text-sm bg-transparent outline-none text-zinc-800 placeholder-zinc-400 min-w-0"
      />
      <button onClick={() => value.trim() && onConfirm(value.trim())} disabled={!value.trim() || isPending}
        className="p-0.5 text-indigo-600 hover:text-indigo-800 disabled:opacity-40">
        <Check size={14} />
      </button>
      <button onClick={onCancel} className="p-0.5 text-zinc-400 hover:text-zinc-600"><X size={14} /></button>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Context menu
// ─────────────────────────────────────────────────────────────────────────────

type CtxState = {
  type: 'pasta' | 'documento';
  id: number;
  name: string;
  pastaId?: number;
  parentId?: number | null;
  nivel?: number;
  x: number;
  y: number;
};

const ContextMenu: React.FC<{
  state: CtxState;
  onNewSubpasta?: () => void;
  onNewDocumento?: () => void;
  onRename: () => void;
  onDelete: () => void;
  onClose: () => void;
}> = ({ state, onNewSubpasta, onNewDocumento, onRename, onDelete, onClose }) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const out = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', out, true);
    document.addEventListener('keydown', esc, true);
    return () => {
      document.removeEventListener('mousedown', out, true);
      document.removeEventListener('keydown', esc, true);
    };
  }, [onClose]);

  const mi = 'flex items-center gap-2.5 px-3 py-2 text-sm w-full text-left rounded-md transition-colors cursor-pointer';

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        top: Math.min(state.y, window.innerHeight - 210),
        left: Math.min(state.x, window.innerWidth - 215),
        zIndex: 9999,
      }}
      className="bg-white border border-zinc-200 rounded-lg shadow-xl py-1 w-52 select-none animate-in fade-in duration-100"
    >
      <div className="px-3 py-1.5 text-xs font-semibold text-zinc-400 uppercase tracking-wider border-b border-zinc-100 mb-1 truncate">
        {state.name}
      </div>
      {state.type === 'pasta' && (
        <>
          <button className={cn(mi, 'text-zinc-700 hover:bg-indigo-50 hover:text-indigo-800')} onClick={() => { onNewSubpasta?.(); onClose(); }}>
            <FolderPlus size={14} className="text-indigo-500 shrink-0" /> Nova Subpasta
          </button>
          <button className={cn(mi, 'text-zinc-700 hover:bg-amber-50 hover:text-amber-800')} onClick={() => { onNewDocumento?.(); onClose(); }}>
            <FilePlus size={14} className="text-amber-500 shrink-0" /> Novo Documento
          </button>
          <div className="border-t border-zinc-100 my-1" />
        </>
      )}
      <button className={cn(mi, 'text-zinc-700 hover:bg-blue-50 hover:text-blue-800')} onClick={() => { onRename(); onClose(); }}>
        <Pencil size={14} className="text-blue-500 shrink-0" /> Renomear
      </button>
      <div className="border-t border-zinc-100 my-1" />
      <button className={cn(mi, 'text-red-600 hover:bg-red-50')} onClick={() => { onDelete(); onClose(); }}>
        <Trash2 size={14} className="shrink-0" />
        {state.type === 'pasta' ? 'Excluir Pasta' : 'Excluir Documento'}
      </button>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// PastaTreeNode — recursive folder row
// ─────────────────────────────────────────────────────────────────────────────

interface PastaTreeNodeProps {
  pasta: Pasta;
  level: number;
  // Selection
  selectedDocId: number | null | undefined;
  expandPastaIds: number[];
  onSelectDoc: (id: number) => void;
  // Context menu
  onContextMenu: (e: React.MouseEvent, ctx: CtxState) => void;
  // Rename
  renamingPastaId: number | null;
  renamingDocId: number | null;
  onPastaRenameConfirm: (id: number, nome: string) => void;
  onDocRenameConfirm: (id: number, titulo: string) => void;
  onRenameCancel: () => void;
  // DnD state
  dropTargetPastaId: number | null;
  dropIndicatorDocId: number | null;
  dropIndicatorPos: 'before' | 'after' | null;
  // DnD callbacks
  onDragOverPasta: (e: React.DragEvent, pastaId: number) => void;
  onDragLeavePasta: (e: React.DragEvent) => void;
  onDropOnPasta: (e: React.DragEvent, pasta: Pasta) => void;
  onDragOverDoc: (e: React.DragEvent, docId: number) => void;
  onDragLeaveDoc: (e: React.DragEvent) => void;
  onDropOnDoc: (e: React.DragEvent, targetDocId: number, targetOrdem: number, pastaId: number) => void;
}

const PastaTreeNode: React.FC<PastaTreeNodeProps> = ({
  pasta, level,
  selectedDocId, expandPastaIds, onSelectDoc,
  onContextMenu,
  renamingPastaId, renamingDocId, onPastaRenameConfirm, onDocRenameConfirm, onRenameCancel,
  dropTargetPastaId, dropIndicatorDocId, dropIndicatorPos,
  onDragOverPasta, onDragLeavePasta, onDropOnPasta,
  onDragOverDoc, onDragLeaveDoc, onDropOnDoc,
}) => {
  const [expanded, setExpanded] = useState(expandPastaIds.includes(pasta.id));
  const isRenaming = renamingPastaId === pasta.id;
  const isDropTarget = dropTargetPastaId === pasta.id;

  useEffect(() => {
    if (expandPastaIds.includes(pasta.id)) setExpanded(true);
  }, [expandPastaIds, pasta.id]);

  const { data: documentos, isLoading: docsLoading, isFetched } = useDocumentosByPasta(pasta.id, expanded);

  const hasChildren = (pasta.children?.length ?? 0) > 0;
  const hasDocuments = (documentos?.length ?? 0) > 0;
  const isEmpty = isFetched && !docsLoading && !hasDocuments && !hasChildren;
  const indentPx = level * 12 + 8;
  const docIndentPx = (level + 1) * 12 + 28;

  // All child props — explicit, no spread magic
  const childProps: Omit<PastaTreeNodeProps, 'pasta' | 'level'> = {
    selectedDocId, expandPastaIds, onSelectDoc,
    onContextMenu,
    renamingPastaId, renamingDocId, onPastaRenameConfirm, onDocRenameConfirm, onRenameCancel,
    dropTargetPastaId, dropIndicatorDocId, dropIndicatorPos,
    onDragOverPasta, onDragLeavePasta, onDropOnPasta,
    onDragOverDoc, onDragLeaveDoc, onDropOnDoc,
  };

  return (
    <div>
      {/* ── Pasta header row ─────────────────────────────────────────────── */}
      <div
        className={cn(
          'flex items-center py-1.5 px-2 cursor-pointer rounded-md text-sm text-zinc-700 group transition-all select-none',
          isDropTarget
            ? 'bg-indigo-100 ring-1 ring-inset ring-indigo-300 text-indigo-800'
            : 'hover:bg-zinc-100',
        )}
        style={{ paddingLeft: `${indentPx}px` }}
        onClick={() => !isRenaming && setExpanded(v => !v)}
        onContextMenu={e => {
          e.preventDefault(); e.stopPropagation();
          onContextMenu(e, { type: 'pasta', id: pasta.id, name: pasta.nome, parentId: pasta.parent_id, nivel: pasta.nivel, x: e.clientX, y: e.clientY });
        }}
        draggable={!isRenaming}
        onDragStart={e => {
          _dragging = { kind: 'pasta', pastaId: pasta.id, currentParentId: pasta.parent_id ?? null };
          e.dataTransfer.effectAllowed = 'move';
          e.stopPropagation();
        }}
        onDragEnd={() => { _dragging = null; }}
        onDragOver={e => onDragOverPasta(e, pasta.id)}
        onDragLeave={onDragLeavePasta}
        onDrop={e => onDropOnPasta(e, pasta)}
      >
        <div className="w-4 h-4 mr-1 text-zinc-400 flex items-center justify-center shrink-0">
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </div>
        <Folder size={14} className={cn('mr-2 shrink-0 transition-colors', expanded ? 'text-amber-500' : 'text-zinc-400')} />
        {isRenaming ? (
          <InlineEdit initialValue={pasta.nome} onConfirm={nome => onPastaRenameConfirm(pasta.id, nome)} onCancel={onRenameCancel} />
        ) : (
          <>
            <span className="truncate font-medium flex-1">{pasta.nome}</span>
            <GripVertical size={12} className="opacity-0 group-hover:opacity-25 text-zinc-400 shrink-0 mr-0.5" />
          </>
        )}
      </div>

      {/* ── Children ─────────────────────────────────────────────────────── */}
      {expanded && (
        <div className="flex flex-col">
          {/* Sub-pastas */}
          {hasChildren && pasta.children!.map(child => (
            <PastaTreeNode key={child.id} pasta={child} level={level + 1} {...childProps} />
          ))}

          {/* Loading spinner */}
          {docsLoading && (
            <div className="py-1 text-xs text-zinc-400 flex items-center gap-1.5" style={{ paddingLeft: `${docIndentPx}px` }}>
              <span className="inline-block w-3 h-3 border-2 border-zinc-300 border-t-transparent rounded-full animate-spin" />
              Carregando...
            </div>
          )}

          {/* Document rows */}
          {hasDocuments && documentos!.map((doc, idx) => {
            const isRenamingDoc = renamingDocId === doc.id;
            const isSelected = selectedDocId === doc.id;
            const showBefore = dropIndicatorDocId === doc.id && dropIndicatorPos === 'before';
            const showAfter  = dropIndicatorDocId === doc.id && dropIndicatorPos === 'after';

            return (
              <React.Fragment key={doc.id}>
                {showBefore && (
                  <div className="h-0.5 rounded-full bg-indigo-400 mx-1" style={{ marginLeft: `${docIndentPx}px` }} />
                )}
                <div
                  className={cn(
                    'flex items-center py-1.5 px-2 cursor-pointer rounded-md text-sm transition-colors select-none group/doc',
                    isSelected
                      ? 'bg-amber-100 text-amber-900 font-medium'
                      : 'text-zinc-600 hover:bg-amber-50 hover:text-amber-800',
                  )}
                  style={{ paddingLeft: `${docIndentPx}px` }}
                  onClick={e => { e.stopPropagation(); onSelectDoc(doc.id); }}
                  onContextMenu={e => {
                    e.preventDefault(); e.stopPropagation();
                    onContextMenu(e, { type: 'documento', id: doc.id, name: doc.titulo, pastaId: pasta.id, x: e.clientX, y: e.clientY });
                  }}
                  draggable={!isRenamingDoc}
                  onDragStart={e => {
                    _dragging = { kind: 'doc', docId: doc.id, sourcePastaId: pasta.id, currentOrdem: doc.ordem ?? idx };
                    e.dataTransfer.effectAllowed = 'move';
                    e.stopPropagation();
                  }}
                  onDragEnd={() => { _dragging = null; }}
                  onDragOver={e => onDragOverDoc(e, doc.id)}
                  onDragLeave={onDragLeaveDoc}
                  onDrop={e => onDropOnDoc(e, doc.id, doc.ordem ?? idx, pasta.id)}
                >
                  <GripVertical size={12} className="mr-1 opacity-0 group-hover/doc:opacity-25 text-zinc-400 shrink-0 cursor-grab" />
                  <FileText size={13} className="mr-2 text-zinc-400 shrink-0" />
                  {isRenamingDoc ? (
                    <InlineEdit initialValue={doc.titulo} onConfirm={titulo => onDocRenameConfirm(doc.id, titulo)} onCancel={onRenameCancel} />
                  ) : (
                    <span className="truncate">{doc.titulo}</span>
                  )}
                </div>
                {showAfter && (
                  <div className="h-0.5 rounded-full bg-indigo-400 mx-1" style={{ marginLeft: `${docIndentPx}px` }} />
                )}
              </React.Fragment>
            );
          })}

          {isEmpty && (
            <div className="py-1 text-xs text-zinc-400 italic" style={{ paddingLeft: `${docIndentPx}px` }}>
              Vazio
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Sidebar
// ─────────────────────────────────────────────────────────────────────────────

interface SidebarProps {
  onSelectDoc: (id: number) => void;
  selectedDocId?: number | null;
  expandPastaIds?: number[];
  /** Called when user clicks the Banco de Questões & Simulados entry */
  onSelectHub?: () => void;
  /** Whether the hub is the active view (highlights the hub button) */
  isHubActive?: boolean;
}

export const Sidebar: React.FC<SidebarProps> = ({
  onSelectDoc,
  selectedDocId,
  expandPastaIds = [],
  onSelectHub,
  isHubActive = false,
}) => {
  const { data: treeData, isLoading } = usePastasTree();
  const { mutate: createPasta,    isPending: creatingPasta } = useCreatePasta();
  const { mutate: createDocumento, isPending: creatingDoc  } = useCreateDocumento();
  const { mutate: deletePasta    } = useDeletePasta();
  const { mutate: renamePasta    } = useRenamePasta();
  const { mutate: movePasta      } = useMovePasta();
  const { mutate: renameDocumento} = useRenameDocumento();
  const { mutate: moveDocumento  } = useMoveDocumento();
  const { mutate: reorderDocumento } = useReorderDocumento();

  // UI state
  const [contextMenu,   setContextMenu]   = useState<CtxState | null>(null);
  const [inlineTarget,  setInlineTarget]  = useState<{ pastaId: number; pastaNivel: number } | null>(null);
  const [inlineMode,    setInlineMode]    = useState<'subpasta' | 'documento' | null>(null);
  const [renamingPastaId, setRenamingPastaId] = useState<number | null>(null);
  const [renamingDocId,   setRenamingDocId]   = useState<number | null>(null);

  // DnD visual state — kept flat/simple to avoid re-render storms
  const [dropTargetPastaId,  setDropTargetPastaId]  = useState<number | null>(null);
  const [dropIndicatorDocId, setDropIndicatorDocId] = useState<number | null>(null);
  const [dropIndicatorPos,   setDropIndicatorPos]   = useState<'before' | 'after' | null>(null);

  const closeForm    = useCallback(() => { setInlineMode(null); setInlineTarget(null); }, []);
  const cancelRename = useCallback(() => { setRenamingPastaId(null); setRenamingDocId(null); }, []);

  const clearDrop = useCallback(() => {
    setDropTargetPastaId(null);
    setDropIndicatorDocId(null);
    setDropIndicatorPos(null);
  }, []);

  // ── Context menu ───────────────────────────────────────────────────────────
  const handleContextMenu = useCallback((e: React.MouseEvent, ctx: CtxState) => {
    e.preventDefault();
    setContextMenu(ctx);
  }, []);

  const handleRenameItem = useCallback(() => {
    if (!contextMenu) return;
    if (contextMenu.type === 'pasta') setRenamingPastaId(contextMenu.id);
    else setRenamingDocId(contextMenu.id);
  }, [contextMenu]);

  const handleDeleteItem = useCallback(() => {
    if (!contextMenu) return;
    if (contextMenu.type === 'pasta') {
      if (window.confirm(`Excluir a pasta "${contextMenu.name}"?\nIsso removerá todos os documentos e blocos dentro dela.`))
        deletePasta(contextMenu.id);
    }
  }, [contextMenu, deletePasta]);

  const handlePastaRenameConfirm = useCallback((id: number, nome: string) => {
    renamePasta({ id, nome }, { onSuccess: cancelRename });
  }, [renamePasta, cancelRename]);

  const handleDocRenameConfirm = useCallback((id: number, titulo: string) => {
    renameDocumento({ id, titulo }, { onSuccess: cancelRename });
  }, [renameDocumento, cancelRename]);

  // ── DnD — pasta ────────────────────────────────────────────────────────────
  const handleDragOverPasta = useCallback((e: React.DragEvent, pastaId: number) => {
    if (!_dragging) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    setDropTargetPastaId(pastaId);
    setDropIndicatorDocId(null);
    setDropIndicatorPos(null);
  }, []);

  const handleDragLeavePasta = useCallback((e: React.DragEvent) => {
    e.stopPropagation();
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDropTargetPastaId(null);
    }
  }, []);

  const handleDropOnPasta = useCallback((e: React.DragEvent, targetPasta: Pasta) => {
    e.preventDefault();
    e.stopPropagation();
    clearDrop();
    const payload = _dragging;
    _dragging = null;
    if (!payload) return;

    if (payload.kind === 'doc') {
      if (payload.sourcePastaId === targetPasta.id) return;
      moveDocumento({ id: payload.docId, pasta_id: targetPasta.id, source_pasta_id: payload.sourcePastaId });
    } else if (payload.kind === 'pasta') {
      if (payload.pastaId === targetPasta.id || payload.currentParentId === targetPasta.id) return;
      movePasta({ id: payload.pastaId, parent_id: targetPasta.id, nivel: (targetPasta.nivel ?? 0) + 1 });
    }
  }, [clearDrop, moveDocumento, movePasta]);

  // ── DnD — document rows (position-aware) ───────────────────────────────────
  const handleDragOverDoc = useCallback((e: React.DragEvent, docId: number) => {
    if (!_dragging || _dragging.kind !== 'doc') return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    setDropTargetPastaId(null);
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const pos: 'before' | 'after' = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
    setDropIndicatorDocId(docId);
    setDropIndicatorPos(pos);
  }, []);

  const handleDragLeaveDoc = useCallback((e: React.DragEvent) => {
    e.stopPropagation();
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDropIndicatorDocId(null);
      setDropIndicatorPos(null);
    }
  }, []);

  const handleDropOnDoc = useCallback((
    e: React.DragEvent,
    targetDocId: number,
    targetOrdem: number,
    pastaId: number,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    clearDrop();
    const payload = _dragging;
    _dragging = null;
    if (!payload || payload.kind !== 'doc') return;
    if (payload.docId === targetDocId) return;

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const insertBefore = e.clientY < rect.top + rect.height / 2;
    const newOrdem = insertBefore ? targetOrdem - 0.5 : targetOrdem + 0.5;

    if (payload.sourcePastaId === pastaId) {
      reorderDocumento({ id: payload.docId, ordem: newOrdem, pasta_id: pastaId });
    } else {
      moveDocumento({ id: payload.docId, pasta_id: pastaId, ordem: newOrdem, source_pasta_id: payload.sourcePastaId });
    }
  }, [clearDrop, reorderDocumento, moveDocumento]);

  // ── Backup ─────────────────────────────────────────────────────────────────
  const handleBackup = async () => {
    try {
      const response = await api.post('/database/backup', null, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `tao_backup_${Date.now()}.json`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch { alert('Backup falhou!'); }
  };

  // Props passed to every PastaTreeNode (explicit — no magic spread)
  const nodeProps: Omit<PastaTreeNodeProps, 'pasta' | 'level'> = {
    selectedDocId: selectedDocId ?? null,
    expandPastaIds,
    onSelectDoc,
    onContextMenu: handleContextMenu,
    renamingPastaId,
    renamingDocId,
    onPastaRenameConfirm: handlePastaRenameConfirm,
    onDocRenameConfirm: handleDocRenameConfirm,
    onRenameCancel: cancelRename,
    dropTargetPastaId,
    dropIndicatorDocId,
    dropIndicatorPos,
    onDragOverPasta: handleDragOverPasta,
    onDragLeavePasta: handleDragLeavePasta,
    onDropOnPasta: handleDropOnPasta,
    onDragOverDoc: handleDragOverDoc,
    onDragLeaveDoc: handleDragLeaveDoc,
    onDropOnDoc: handleDropOnDoc,
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      <div className="w-full bg-zinc-50 border-r border-zinc-200 flex flex-col h-full">
        {/* Header */}
        <div className="p-4 border-b border-zinc-200 flex items-center justify-between shrink-0">
          <h2 className="font-semibold text-lg text-zinc-800 tracking-tight">TAO</h2>
        </div>

        {/* Timer */}
        <Timer />

        {/* Tree */}
        <div className="flex-1 overflow-y-auto p-2 flex flex-col min-h-0">
          <div className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2 mt-2 px-2">
            Workspace
            <span className="ml-1 normal-case font-normal text-zinc-300">(botão direito • arraste para mover)</span>
          </div>


          {/* Inline creation form */}
          {inlineMode && inlineTarget && (
            <InlineForm
              placeholder={inlineMode === 'subpasta' ? 'Nome da nova subpasta...' : 'Título do novo documento...'}
              onConfirm={
                inlineMode === 'subpasta'
                  ? (nome) => createPasta(
                      { nome, parent_id: inlineTarget.pastaId, nivel: inlineTarget.pastaNivel + 1, ordem: 0 },
                      { onSuccess: closeForm },
                    )
                  : (titulo) => createDocumento(
                      { titulo, pasta_id: inlineTarget.pastaId, ordem: 0 },
                      { onSuccess: (doc) => { closeForm(); onSelectDoc(doc.id); } },
                    )
              }
              onCancel={closeForm}
              isPending={inlineMode === 'subpasta' ? creatingPasta : creatingDoc}
            />
          )}

          {isLoading && <div className="px-2 text-sm text-zinc-500">Carregando...</div>}

          {!isLoading && (
            <div className="flex flex-col gap-0.5">
              {Array.isArray(treeData)
                ? treeData.map((pasta: Pasta) => (
                    <PastaTreeNode key={pasta.id} pasta={pasta} level={0} {...nodeProps} />
                  ))
                : treeData
                  ? <PastaTreeNode pasta={treeData as Pasta} level={0} {...nodeProps} />
                  : <div className="px-2 text-sm text-zinc-400 italic">Nenhuma pasta encontrada.</div>
              }
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-zinc-200 shrink-0 flex flex-col gap-3">
          {/* Hub shortcut */}
          <button
            id="sidebar-hub-btn"
            onClick={onSelectHub}
            className={cn(
              'flex items-center gap-2.5 w-full px-3 py-2.5 rounded-xl text-sm font-semibold transition-all border',
              isHubActive
                ? 'bg-violet-100 text-violet-800 border-violet-300 shadow-sm'
                : 'bg-white text-zinc-700 border-zinc-200 hover:bg-violet-50 hover:text-violet-700 hover:border-violet-200 shadow-sm',
            )}
          >
            <BrainCircuit size={16} className={isHubActive ? 'text-violet-600' : 'text-violet-400'} shrink-0="true" />
            <span className="truncate">🧠 Banco de Questões</span>
          </button>

          <button
            onClick={handleBackup}
            className="flex items-center justify-center w-full py-2 px-3 bg-white border border-zinc-200 rounded-md text-sm font-medium text-zinc-700 hover:bg-zinc-50 transition-colors shadow-sm"
          >
            <Database size={14} className="mr-2" />
            Backup do Banco
          </button>
        </div>
      </div>

      {/* Context menu — rendered outside sidebar div to avoid z-index clipping */}
      {contextMenu && (
        <ContextMenu
          state={contextMenu}
          onNewSubpasta={contextMenu.type === 'pasta' ? () => {
            setInlineTarget({ pastaId: contextMenu.id, pastaNivel: contextMenu.nivel ?? 0 });
            setInlineMode('subpasta');
          } : undefined}
          onNewDocumento={contextMenu.type === 'pasta' ? () => {
            setInlineTarget({ pastaId: contextMenu.id, pastaNivel: contextMenu.nivel ?? 0 });
            setInlineMode('documento');
          } : undefined}
          onRename={handleRenameItem}
          onDelete={handleDeleteItem}
          onClose={() => setContextMenu(null)}
        />
      )}
    </>
  );
};
