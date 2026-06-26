import React, { useEffect, useCallback, useMemo } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { Color } from '@tiptap/extension-color';
import { TextStyle } from '@tiptap/extension-text-style';
import { markdownToHtml, htmlToMarkdown } from '../../../lib/markdownHtmlConverter';
import { EditorContextMenu } from '../EditorContextMenu';
import { TableFixedToolbar } from './TableFixedToolbar';
import { cn } from '../../../lib/utils';
import { parsePortalSegments, rebuildContentFromSegments, PortalSegment } from '../../../lib/portalParser';
import { PortalInline } from '../PortalBlock';
import { PortalNavigationTarget } from '../../../hooks/usePortals';

interface TipTapEditorProps {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  onOpenPortalSearch?: (insertCallback: (id: number) => void) => void;
  className?: string;
  autoFocus?: boolean;
}

export const TipTapEditor: React.FC<TipTapEditorProps> = ({
  value,
  onChange,
  placeholder,
  className,
  autoFocus = false,
}) => {
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
    content: markdownToHtml(value),
    editorProps: {
      attributes: {
        class: cn(
          'w-full min-h-[60px] text-[14px] p-3 outline-none focus:outline-none bg-white dark:bg-transparent text-zinc-800 dark:text-slate-300 prose dark:prose-invert prose-sm max-w-none transition-colors',
          className
        ),
        'data-placeholder': placeholder || '',
      },
    },
    onUpdate: ({ editor }) => {
      onChange(htmlToMarkdown(editor.getHTML()));
    },
  });

  useEffect(() => {
    if (editor && value !== htmlToMarkdown(editor.getHTML())) {
      editor.commands.setContent(markdownToHtml(value));
    }
  }, [value, editor]);

  useEffect(() => {
    if (editor && autoFocus) setTimeout(() => editor.commands.focus(), 50);
  }, [autoFocus, editor]);

  if (!editor) return null;

  return (
    <div className="relative w-full group/editor flex flex-col">
      <TableFixedToolbar editor={editor} />
      <EditorContextMenu editor={editor} />
      <EditorContent editor={editor} />
    </div>
  );
};

interface AnnotationContentEditorProps {
  content: string;
  onChange: (content: string) => void;
  portalMap: Record<string, import('../../../hooks/usePortals').ResolvedPortal>;
  onGoToSource: (target: PortalNavigationTarget) => void;
  onOpenPortalSearch: (insertCallback: (id: number) => void) => void;
}

export const AnnotationContentEditor: React.FC<AnnotationContentEditorProps> = ({
  content, onChange, portalMap, onGoToSource, onOpenPortalSearch,
}) => {
  const segments = useMemo(() => parsePortalSegments(content), [content]);
  const hasPortals = segments.some((s) => s.type === 'portal');

  const updateTextSegment = useCallback((segmentIndex: number, newValue: string) => {
    const updated: PortalSegment[] = segments.map((seg, i) =>
      i === segmentIndex && seg.type === 'text' ? { type: 'text', value: newValue } : seg
    );
    onChange(rebuildContentFromSegments(updated));
  }, [segments, onChange]);

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
