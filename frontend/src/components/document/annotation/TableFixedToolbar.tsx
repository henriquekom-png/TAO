import React from 'react';
import { Editor } from '@tiptap/react';
import { cn } from '../../../lib/utils';
import { Trash, Trash2 } from 'lucide-react';

interface TableFixedToolbarProps {
  editor: Editor;
}

export const TableFixedToolbar: React.FC<TableFixedToolbarProps> = ({ editor }) => {
  if (!editor) return null;

  const isTableActive = editor.isActive('table');

  return (
    <div
      className={cn(
        "overflow-hidden transition-all duration-300 ease-in-out border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 w-full",
        isTableActive ? "max-h-16 opacity-100 border-b" : "max-h-0 opacity-0 border-b-0"
      )}
    >
      <div className="flex items-center gap-1 p-2 w-full justify-between overflow-x-auto">
        <div className="flex items-center gap-1">
          <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mr-2 ml-1 select-none hidden sm:block">Tabela</span>
          <div className="h-4 w-px bg-zinc-300 dark:bg-zinc-700 mx-1 hidden sm:block" />
          
          <button
            type="button"
            onClick={() => editor.chain().focus().addColumnBefore().run()}
            className="px-2 py-1.5 text-zinc-600 hover:text-zinc-900 hover:bg-zinc-200 dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-zinc-800 rounded transition-colors text-[11px] font-medium flex items-center gap-1 whitespace-nowrap"
            title="Adicionar Coluna à Esquerda"
          >
            + Col Esq
          </button>
          
          <button
            type="button"
            onClick={() => editor.chain().focus().addColumnAfter().run()}
            className="px-2 py-1.5 text-zinc-600 hover:text-zinc-900 hover:bg-zinc-200 dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-zinc-800 rounded transition-colors text-[11px] font-medium flex items-center gap-1 whitespace-nowrap"
            title="Adicionar Coluna à Direita"
          >
            + Col Dir
          </button>
          
          <button
            type="button"
            onClick={() => editor.chain().focus().deleteColumn().run()}
            className="px-2 py-1.5 text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30 rounded transition-colors text-[11px] font-medium flex items-center gap-1 whitespace-nowrap"
            title="Excluir Coluna Atual"
          >
            <Trash size={12} /> Col
          </button>

          <div className="h-4 w-px bg-zinc-300 dark:bg-zinc-700 mx-1" />

          <button
            type="button"
            onClick={() => editor.chain().focus().addRowBefore().run()}
            className="px-2 py-1.5 text-zinc-600 hover:text-zinc-900 hover:bg-zinc-200 dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-zinc-800 rounded transition-colors text-[11px] font-medium flex items-center gap-1 whitespace-nowrap"
            title="Adicionar Linha Acima"
          >
            + Lin Acima
          </button>

          <button
            type="button"
            onClick={() => editor.chain().focus().addRowAfter().run()}
            className="px-2 py-1.5 text-zinc-600 hover:text-zinc-900 hover:bg-zinc-200 dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-zinc-800 rounded transition-colors text-[11px] font-medium flex items-center gap-1 whitespace-nowrap"
            title="Adicionar Linha Abaixo"
          >
            + Lin Abaixo
          </button>

          <button
            type="button"
            onClick={() => editor.chain().focus().deleteRow().run()}
            className="px-2 py-1.5 text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30 rounded transition-colors text-[11px] font-medium flex items-center gap-1 whitespace-nowrap"
            title="Excluir Linha Atual"
          >
            <Trash size={12} /> Lin
          </button>
        </div>

        <button
          type="button"
          onClick={() => editor.chain().focus().deleteTable().run()}
          className="px-2 py-1.5 text-red-600 hover:text-white hover:bg-red-600 dark:text-red-400 dark:hover:text-white dark:hover:bg-red-600/80 rounded transition-colors text-[11px] flex items-center gap-1 font-semibold whitespace-nowrap ml-2"
          title="Excluir Tabela Inteira"
        >
          <Trash2 size={12} /> Excluir Tabela
        </button>
      </div>
    </div>
  );
};
