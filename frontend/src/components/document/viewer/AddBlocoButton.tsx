import React from 'react';
import { Plus } from 'lucide-react';
import { useCreateBloco } from '../../../hooks/useBlocos';
import { cn } from '../../../lib/utils';

interface AddBlocoButtonProps {
  documentId: number;
  insertAtOrdem: number;   // the ordem value the new bloco should occupy
  alwaysVisible?: boolean; // end-of-list button
  onCreated: (newId: number) => void;
}

export const AddBlocoButton: React.FC<AddBlocoButtonProps> = ({ documentId, insertAtOrdem, alwaysVisible, onCreated }) => {
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
