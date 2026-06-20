import React, { useEffect, useState } from 'react';
import { Editor } from '@tiptap/react';
import { cn } from '../../lib/utils';

interface EditorContextMenuProps {
  editor: Editor | null;
}

export const EditorContextMenu: React.FC<EditorContextMenuProps> = ({ editor }) => {
  const [menuState, setMenuState] = useState<{ x: number; y: number; show: boolean }>({ x: 0, y: 0, show: false });

  useEffect(() => {
    if (!editor) return;

    const handleContextMenu = (e: MouseEvent) => {
      if (!editor.isEditable) return;
      
      const { state } = editor;
      // Only show menu if text is selected
      if (state.selection.empty) {
        setMenuState({ show: false, x: 0, y: 0 });
        return;
      }

      e.preventDefault();
      setMenuState({
        show: true,
        x: e.clientX,
        y: e.clientY,
      });
    };

    const handleClick = () => {
      setMenuState((prev) => (prev.show ? { ...prev, show: false } : prev));
    };

    const editorDom = editor.view.dom;
    editorDom.addEventListener('contextmenu', handleContextMenu);
    document.addEventListener('click', handleClick);

    return () => {
      editorDom.removeEventListener('contextmenu', handleContextMenu);
      document.removeEventListener('click', handleClick);
    };
  }, [editor]);

  if (!menuState.show || !editor) return null;

  return (
    <div
      className="fixed z-50 flex bg-zinc-950 text-white rounded-lg shadow-xl border border-zinc-800 p-1 gap-1 items-center select-none"
      style={{ top: menuState.y, left: menuState.x }}
    >
      <button
        type="button"
        onClick={(e) => { 
          e.stopPropagation(); 
          editor.chain().focus().toggleBold().run(); 
          setMenuState(prev => ({...prev, show: false})); 
        }}
        className={cn('px-2.5 py-1 text-xs font-bold rounded transition-colors hover:bg-zinc-800',
          editor.isActive('bold') ? 'bg-zinc-800 text-amber-400' : 'text-zinc-300')}
        title="Negrito"
      >
        B
      </button>
      <button
        type="button"
        onClick={(e) => { 
          e.stopPropagation(); 
          editor.chain().focus().toggleItalic().run(); 
          setMenuState(prev => ({...prev, show: false})); 
        }}
        className={cn('px-2.5 py-1 text-xs italic rounded transition-colors hover:bg-zinc-800',
          editor.isActive('italic') ? 'bg-zinc-800 text-amber-400' : 'text-zinc-300')}
        title="Itálico"
      >
        I
      </button>
      <div className="w-px h-4 bg-zinc-800 self-stretch my-0.5" />
      <button
        type="button"
        onClick={(e) => { 
          e.stopPropagation(); 
          if (editor.isActive('textStyle', { color: '#CF0E0E' })) {
            editor.chain().focus().unsetColor().run();
          } else {
            editor.chain().focus().setColor('#CF0E0E').run();
          }
          setMenuState(prev => ({...prev, show: false})); 
        }}
        className={cn('px-2.5 py-1 text-xs rounded transition-colors hover:bg-zinc-800 flex items-center gap-1.5 font-medium',
          editor.isActive('textStyle', { color: '#CF0E0E' }) ? 'bg-zinc-800 text-white' : 'text-zinc-300'
        )}
        title="Cor Destaque"
      >
        <div className="w-3 h-3 rounded-full bg-[#CF0E0E]" />
        Cor
      </button>
    </div>
  );
};
