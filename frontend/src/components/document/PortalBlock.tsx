import React, { useState, useEffect } from 'react';
import { ExternalLink, Link2, AlertTriangle } from 'lucide-react';
import { useEditor, EditorContent } from '@tiptap/react';
import { EditorContextMenu } from './EditorContextMenu';
import StarterKit from '@tiptap/starter-kit';
import { markdownToHtml, htmlToMarkdown } from '../../lib/markdownHtmlConverter';
import { Color } from '@tiptap/extension-color';
import { TextStyle } from '@tiptap/extension-text-style';
import { useUpdateBloco } from '../../hooks/useBlocos';
import { useUpdateAnotacao } from '../../hooks/useAnotacoes';
import { ResolvedPortal, PortalNavigationTarget, portalToNavTarget } from '../../hooks/usePortals';
import { cn } from '../../lib/utils';

interface GoToSourceButtonProps {
  onGoToSource: (target: PortalNavigationTarget) => void;
  target: PortalNavigationTarget;
  label?: string;
}

const GoToSourceButton: React.FC<GoToSourceButtonProps> = ({ onGoToSource, target, label = 'Ir para origem' }) => (
  <button
    type="button"
    onClick={() => onGoToSource(target)}
    className="inline-flex items-center gap-1 text-[10px] font-medium text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 px-1.5 py-0.5 rounded transition-colors shrink-0"
    title={label}
  >
    <ExternalLink size={11} />
    <span className="hidden sm:inline">{label}</span>
  </button>
);

interface EditableSourceFieldProps {
  value: string;
  onSave: (value: string) => void;
  placeholder?: string;
  minHeight?: string;
  className?: string;
}

const EditableSourceField: React.FC<EditableSourceFieldProps> = ({
  value,
  onSave,
  placeholder = 'Conteúdo vazio...',
  minHeight = 'min-h-[60px]',
  className,
}) => {
  const [isSaving, setIsSaving] = useState(false);
  const saveTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);

  const editor = useEditor({
    extensions: [StarterKit, TextStyle, Color],
    content: markdownToHtml(value),
    editorProps: {
      attributes: {
        class: cn(
          'w-full outline-none prose dark:prose-invert prose-sm max-w-none text-[0.8125rem] text-zinc-800 dark:text-zinc-200 leading-relaxed bg-transparent cursor-text',
          minHeight,
          className
        ),
        'data-placeholder': placeholder,
      },
    },
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      const md = htmlToMarkdown(html);
      
      setIsSaving(true);
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      
      saveTimeoutRef.current = setTimeout(() => {
        onSave(md);
        setIsSaving(false);
      }, 1500);
    },
  });

  useEffect(() => {
    if (editor && value !== htmlToMarkdown(editor.getHTML())) {
      editor.commands.setContent(markdownToHtml(value));
    }
  }, [value, editor]);

  if (!editor) return null;

  return (
    <div className="relative group/editor">
      <EditorContextMenu editor={editor} />
      <EditorContent editor={editor} className="w-full" />
      {isSaving && (
        <span className="absolute top-1 right-1 text-[9px] text-indigo-500 animate-pulse">Salvando...</span>
      )}
    </div>
  );
};

interface PortalInlineProps {
  refId: string;
  resolved?: ResolvedPortal;
  onGoToSource: (target: PortalNavigationTarget) => void;
}

export const PortalInline: React.FC<PortalInlineProps> = ({ refId, resolved, onGoToSource }) => {
  const { mutate: updateBloco } = useUpdateBloco();
  const { mutate: updateAnotacao } = useUpdateAnotacao();

  if (!resolved) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-zinc-100 dark:bg-zinc-800 border border-dashed border-zinc-300 dark:border-zinc-700 rounded text-xs text-zinc-400">
        <Link2 size={10} /> Carregando (({refId}))...
      </span>
    );
  }

  if (!resolved.found) {
    const errorMsg = resolved.conteudo
      ? resolved.conteudo
      : `(( ${refId} )) não encontrado`;
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-50 dark:bg-red-900/20 border border-dashed border-red-200 dark:border-red-800/50 rounded text-xs text-red-600 dark:text-red-400">
        <AlertTriangle size={10} />
        <span>{errorMsg}</span>
      </span>
    );
  }

  const handleSave = (newContent: string) => {
    if (resolved.kind === 'bloco') {
      updateBloco({ id: resolved.id, data: { conteudo: newContent } });
    } else {
      updateAnotacao({ id: resolved.id, data: { conteudo: newContent } });
    }
  };

  return (
    <div className="my-1 border-l-2 border-dashed border-indigo-300 dark:border-indigo-500/50 bg-indigo-50/40 dark:bg-indigo-900/10 rounded-r-md pl-3 pr-2 py-2 transition-colors">
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-[10px] font-semibold text-indigo-600 uppercase tracking-wide flex items-center gap-1">
          <Link2 size={10} />
          {resolved.identificador || `Portal #${refId}`}
        </span>
        <GoToSourceButton onGoToSource={onGoToSource} target={portalToNavTarget(resolved)} />
      </div>
      <EditableSourceField value={resolved.conteudo} onSave={handleSave} minHeight="min-h-[48px]" />
    </div>
  );
};

interface PortalTransclusionProps {
  refId: string;
  resolved?: ResolvedPortal;
  onGoToSource: (target: PortalNavigationTarget) => void;
}

export const PortalTransclusion: React.FC<PortalTransclusionProps> = ({ refId, resolved, onGoToSource }) => {
  const { mutate: updateBloco } = useUpdateBloco();
  const { mutate: updateAnotacao } = useUpdateAnotacao();

  if (!resolved) {
    return (
      <div className="p-4 text-sm text-zinc-400 flex items-center gap-2">
        <Link2 size={14} className="animate-pulse" /> Resolvendo portal (({refId}))...
      </div>
    );
  }

  if (!resolved.found) {
    const hasBackendMsg = !!resolved.conteudo;
    return (
      <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 rounded-md text-sm text-red-600 dark:text-red-400 flex flex-col gap-2 transition-colors">
        <div className="flex items-center gap-2 font-medium">
          <AlertTriangle size={14} />
          {hasBackendMsg ? resolved.conteudo : (
            <>Bloco <code className="bg-red-100 dark:bg-red-900/40 px-1 rounded">{refId}</code> não encontrado.</>
          )}
        </div>
        {hasBackendMsg && (
          <div className="text-[10px] text-red-400 italic">
            ID original: {refId}
          </div>
        )}
      </div>
    );
  }

  const navTarget = portalToNavTarget(resolved);

  const handleMainSave = (val: string) => {
    if (resolved.kind === 'anotacao') {
      updateAnotacao({ id: resolved.id, data: { conteudo: val } });
    } else {
      updateBloco({ id: resolved.bloco_id, data: { conteudo: val } });
    }
  };

  return (
    <div className="border-l-[3px] border-dashed border-indigo-400 dark:border-indigo-500/50 bg-indigo-50/30 dark:bg-indigo-900/10 rounded-r-lg overflow-hidden transition-colors">
      <div className="flex items-center justify-between px-3 py-2 bg-indigo-50/60 dark:bg-indigo-900/20 border-b border-indigo-100 dark:border-indigo-800/30">
        <div className="flex items-center gap-2 min-w-0">
          <Link2 size={14} className="text-indigo-500 shrink-0" />
          <div className="min-w-0">
            {resolved.identificador && (
              <span className="text-xs font-semibold text-indigo-700 dark:text-indigo-400 mr-2">{resolved.identificador}</span>
            )}
            <span className="text-[10px] text-indigo-500 dark:text-indigo-400 truncate">
              {resolved.documento_titulo}
            </span>
          </div>
        </div>
        <GoToSourceButton onGoToSource={onGoToSource} target={navTarget} />
      </div>

      <div className="px-3 py-2">
        <EditableSourceField
          value={resolved.conteudo}
          onSave={handleMainSave}
          minHeight="min-h-[80px]"
        />
      </div>


    </div>
  );
};
