import React, { useState } from 'react';
import { FileQuestion, X, Circle } from 'lucide-react';
import { useGenerateFromDocument } from '../../../hooks/useQuestoes';
import { Questao } from '../../../types';

interface GenerateSimuladoModalProps {
  documentId: number;
  onClose: () => void;
  onSuccess: (questions: Questao[]) => void;
}

export const GenerateSimuladoModal: React.FC<GenerateSimuladoModalProps> = ({ documentId, onClose, onSuccess }) => {
  const [quantidade, setQuantidade] = useState(5);
  const [dificuldade, setDificuldade] = useState('media');
  const { mutate: generateQuestions, isPending } = useGenerateFromDocument();

  const handleGenerate = () => {
    generateQuestions(
      { documento_id: documentId, quantidade, dificuldade },
      {
        onSuccess: (result) => {
          onSuccess(result.questoes);
        },
        onError: (err: any) => {
          alert('Erro ao gerar questões: ' + (err.response?.data?.detail || err.message));
        }
      }
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/40 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-card w-full max-w-sm rounded-xl shadow-2xl overflow-hidden border border-border">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between bg-zinc-50 dark:bg-zinc-900">
          <div className="flex items-center gap-2 font-semibold text-zinc-800 dark:text-zinc-200">
            <FileQuestion size={18} className="text-violet-500" />
            Gerar Simulado (IA)
          </div>
          <button onClick={onClose} disabled={isPending} className="p-1.5 rounded-md hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-500 dark:text-zinc-400 transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="p-6 space-y-5">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Quantidade de Questões</label>
            <input
              type="number"
              min={1}
              max={20}
              value={quantidade}
              onChange={(e) => setQuantidade(Number(e.target.value))}
              className="w-full border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/50 rounded-lg p-2.5 text-sm text-zinc-800 dark:text-zinc-200 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 dark:focus:ring-violet-900/50 transition-all"
              disabled={isPending}
            />
            <p className="text-xs text-zinc-500 dark:text-zinc-400">A IA irá cobrir os pontos mais importantes do documento.</p>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Dificuldade</label>
            <select
              value={dificuldade}
              onChange={(e) => setDificuldade(e.target.value)}
              className="w-full border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/50 rounded-lg p-2.5 text-sm text-zinc-800 dark:text-zinc-200 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 dark:focus:ring-violet-900/50 transition-all"
              disabled={isPending}
            >
              <option value="facil">Fácil</option>
              <option value="media">Média</option>
              <option value="dificil">Difícil</option>
            </select>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-zinc-100 dark:border-zinc-800 flex justify-end gap-3 bg-zinc-50 dark:bg-zinc-900">
          <button onClick={onClose} disabled={isPending} className="px-4 py-2 text-sm text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-md transition-colors font-medium">
            Cancelar
          </button>
          <button
            onClick={handleGenerate}
            disabled={isPending}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:bg-slate-700 disabled:opacity-50 transition-colors font-semibold"
          >
            {isPending ? <Circle className="animate-spin" size={14} /> : <FileQuestion size={14} />}
            {isPending ? 'Gerando...' : 'Gerar Simulado'}
          </button>
        </div>
      </div>
    </div>
  );
};
