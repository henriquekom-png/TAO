/**
 * QuizSessionModal
 * ================
 * Full-featured simulado (exam-practice) modal.
 *
 * Screen flow:
 *   1. QuizSetupScreen  — filter form; user hits "Iniciar Simulado"
 *   2. QuizQuestionScreen — one question at a time with answer panel
 *   3. QuizResultsScreen  — final score summary
 *
 * Subcomponents (defined in this file for colocation):
 *   - QuizSetupScreen
 *   - QuizProgress
 *   - QuizQuestionCard
 *   - MultipleChoicePanel
 *   - CertoErradoPanel
 *   - CombinacaoItensPanel
 *   - QuizFeedbackBlock  (comment + source link — shown post-submit)
 *   - QuizResultsScreen
 */

import React, { useState } from 'react';
import {
  X,
  ClipboardList,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Trophy,
  BookOpen,
  RefreshCw,
  Loader2,
  AlertCircle,
  RotateCcw,
  FastForward,
  Pencil,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { markdownToHtml } from '../../lib/markdownHtmlConverter';
import { useQuizSession } from '../../hooks/useQuizSession';
import type { Questao, QuestaoItem, DificuldadeQuestao, QuizScore } from '../../types';

// ─── Props ────────────────────────────────────────────────────────────────────

interface QuizSessionModalProps {
  onClose: () => void;
  /** Called when user clicks "Revisar material de origem"; closes modal & navigates. */
  onGoToSource: (blocoId: number) => void;
  onEditQuestion?: (question: Questao) => void;
  preloadedQuestions?: Questao[];
}

// ─── Root Modal ───────────────────────────────────────────────────────────────

export const QuizSessionModal: React.FC<QuizSessionModalProps> = ({
  onClose,
  onGoToSource,
  onEditQuestion,
  preloadedQuestions,
}) => {
  const quiz = useQuizSession();

  React.useEffect(() => {
    if (preloadedQuestions && preloadedQuestions.length > 0) {
      quiz.initSessionWithQuestions(preloadedQuestions);
    }
  }, [preloadedQuestions, quiz.initSessionWithQuestions]);

  const currentQuestion = quiz.questionsArray[quiz.currentIndex] ?? null;
  const showSetup = quiz.questionsArray.length === 0 && !quiz.isLoading && !preloadedQuestions;
  const showQuestion = quiz.questionsArray.length > 0 && !quiz.isFinished;
  const showResults = quiz.isFinished;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/50 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Modal de Simulado"
    >
      <div className="bg-white dark:bg-zinc-900 w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh] transition-colors">
        {/* Header */}
        <div className="h-14 px-5 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between bg-white dark:bg-zinc-900 shrink-0 transition-colors">
          <div className="flex items-center gap-2.5 text-zinc-800 dark:text-zinc-100 font-semibold">
            <ClipboardList size={18} className="text-violet-500" />
            <span>Simulado</span>
            {showQuestion && (
              <span className="ml-1 bg-violet-100 dark:bg-violet-900/50 text-violet-700 dark:text-violet-300 px-2 py-0.5 rounded-full text-xs font-bold">
                {quiz.currentIndex + 1} / {quiz.questionsArray.length}
              </span>
            )}
          </div>
          <button
            id="quiz-session-close"
            onClick={onClose}
            className="p-1.5 text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            aria-label="Fechar simulado"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {quiz.isLoading && <LoadingScreen />}

          {quiz.error && !quiz.isLoading && (
            <ErrorScreen message={quiz.error} onRetry={quiz.resetSession} />
          )}

          {!quiz.isLoading && !quiz.error && showSetup && (
            <QuizSetupScreen
              onStart={quiz.startSession}
            />
          )}

          {!quiz.isLoading && !quiz.error && showQuestion && currentQuestion && (
            <QuizQuestionScreen
              question={currentQuestion}
              currentIndex={quiz.currentIndex}
              total={quiz.questionsArray.length}
              selectedAnswer={quiz.selectedAnswer}
              itemAnswers={quiz.itemAnswers}
              isSubmitted={quiz.isSubmitted}
              score={quiz.score}
              onSelectAnswer={quiz.selectAnswer}
              onToggleItem={quiz.toggleItemAnswer}
              onSubmit={quiz.submitAnswer}
              onNext={quiz.nextQuestion}
              onSkip={quiz.skipQuestion}
              onGoToSource={onGoToSource}
              onEditQuestion={onEditQuestion}
              onQuit={() => quiz.resetSession()}
            />
          )}

          {!quiz.isLoading && !quiz.error && showResults && (
            <QuizResultsScreen
              score={quiz.score}
              onRestart={quiz.resetSession}
              onClose={onClose}
            />
          )}
        </div>
      </div>
    </div>
  );
};

// ─── Loading ──────────────────────────────────────────────────────────────────

const LoadingScreen: React.FC = () => (
  <div className="flex flex-col items-center justify-center py-20 gap-4 text-zinc-500">
    <Loader2 size={36} className="animate-spin text-violet-500" />
    <p className="text-sm font-medium">Buscando questões...</p>
  </div>
);

// ─── Error ────────────────────────────────────────────────────────────────────

const ErrorScreen: React.FC<{ message: string; onRetry: () => void }> = ({
  message,
  onRetry,
}) => (
  <div className="flex flex-col items-center justify-center py-16 gap-4 px-8 text-center">
    <AlertCircle size={40} className="text-red-400" />
    <p className="text-zinc-700 dark:text-zinc-300 font-medium">{message}</p>
    <button
      onClick={onRetry}
      className="flex items-center gap-2 px-4 py-2 bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors text-sm font-medium"
    >
      <RotateCcw size={14} /> Tentar novamente
    </button>
  </div>
);

// ─── Setup Screen ─────────────────────────────────────────────────────────────

interface SetupForm {
  materia: string;
  banca: string;
  dificuldade: DificuldadeQuestao | '';
  limit: number;
}

const QuizSetupScreen: React.FC<{
  onStart: (params: ReturnType<typeof useQuizSession>['startSession'] extends (p: infer P) => unknown ? P : never) => void;
}> = ({ onStart }) => {
  const [form, setForm] = useState<SetupForm>({
    materia: '',
    banca: '',
    dificuldade: '',
    limit: 10,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onStart({
      materia:    form.materia    || undefined,
      banca:      form.banca      || undefined,
      dificuldade: (form.dificuldade as DificuldadeQuestao) || undefined,
      limit:      form.limit,
    });
  };

  const field =
    'w-full border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-800 dark:text-zinc-200 bg-white dark:bg-zinc-950 ' +
    'focus:outline-none focus:ring-2 focus:ring-violet-400 focus:border-transparent transition';

  return (
    <div className="p-8">
      <div className="mb-7">
        <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100 mb-1">Configurar Simulado</h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Deixe os campos em branco para buscar questões de todas as categorias.
        </p>
      </div>

      <form id="quiz-setup-form" onSubmit={handleSubmit} className="space-y-5">
        <div className="grid grid-cols-2 gap-4">
          {/* Matéria */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="quiz-materia" className="text-xs font-semibold text-zinc-600 dark:text-zinc-400 uppercase tracking-wide">
              Matéria
            </label>
            <input
              id="quiz-materia"
              type="text"
              placeholder="Ex.: Direito do Trabalho"
              className={field}
              value={form.materia}
              onChange={(e) => setForm((f) => ({ ...f, materia: e.target.value }))}
            />
          </div>

          {/* Banca */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="quiz-banca" className="text-xs font-semibold text-zinc-600 dark:text-zinc-400 uppercase tracking-wide">
              Banca
            </label>
            <input
              id="quiz-banca"
              type="text"
              placeholder="Ex.: CESPE, FGV"
              className={field}
              value={form.banca}
              onChange={(e) => setForm((f) => ({ ...f, banca: e.target.value }))}
            />
          </div>

          {/* Dificuldade */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="quiz-dificuldade" className="text-xs font-semibold text-zinc-600 dark:text-zinc-400 uppercase tracking-wide">
              Dificuldade
            </label>
            <select
              id="quiz-dificuldade"
              className={field}
              value={form.dificuldade}
              onChange={(e) => setForm((f) => ({ ...f, dificuldade: e.target.value as DificuldadeQuestao | '' }))}
            >
              <option value="">Qualquer</option>
              <option value="facil">Fácil</option>
              <option value="media">Média</option>
              <option value="dificil">Difícil</option>
            </select>
          </div>

          {/* Quantidade */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="quiz-limit" className="text-xs font-semibold text-zinc-600 dark:text-zinc-400 uppercase tracking-wide">
              Quantidade (máx. 50)
            </label>
            <input
              id="quiz-limit"
              type="number"
              min={1}
              max={50}
              className={field}
              value={form.limit}
              onChange={(e) =>
                setForm((f) => ({ ...f, limit: Math.min(50, Math.max(1, Number(e.target.value))) }))
              }
            />
          </div>
        </div>

        <button
          id="quiz-start-btn"
          type="submit"
          className="w-full flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-700 text-white font-semibold py-3 rounded-xl transition-colors shadow-md hover:shadow-lg mt-2"
        >
          <ClipboardList size={16} />
          Iniciar Simulado
        </button>
      </form>
    </div>
  );
};

// ─── Progress Bar ─────────────────────────────────────────────────────────────

const QuizProgress: React.FC<{
  currentIndex: number;
  total: number;
  score: QuizScore;
}> = ({ currentIndex, total, score }) => {
  const pct = Math.round(((currentIndex) / total) * 100);
  return (
    <div className="px-8 pt-6 pb-2 space-y-2">
      <div className="flex justify-between items-center text-xs text-zinc-500 dark:text-zinc-400 font-medium">
        <span>Questão {currentIndex + 1} de {total}</span>
        <span className="text-emerald-600 dark:text-emerald-500 font-semibold">{score.acertos} acerto{score.acertos !== 1 ? 's' : ''}</span>
      </div>
      <div className="w-full bg-zinc-100 dark:bg-zinc-800 rounded-full h-1.5">
        <div
          className="bg-violet-500 h-1.5 rounded-full transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
};

// ─── Question Card ────────────────────────────────────────────────────────────

const QuizQuestionCard: React.FC<{ question: Questao }> = ({ question }) => {
  const meta = [question.banca, question.ano, question.cargo].filter(Boolean).join(' · ');
  const tipoLabel: Record<string, string> = {
    multipla_escolha: 'Múltipla Escolha',
    certo_errado: 'Certo ou Errado',
    combinacao_itens: 'Combinação de Itens',
  };

  return (
    <div className="px-8 py-5">
      <div className="flex flex-wrap gap-2 mb-4">
        {question.materia && (
          <span className="bg-violet-50 text-violet-700 text-xs font-semibold px-2.5 py-1 rounded-full border border-violet-200">
            {question.materia}
          </span>
        )}
        <span className="bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 text-xs font-medium px-2.5 py-1 rounded-full">
          {tipoLabel[question.tipo] ?? question.tipo}
        </span>
        <span
          className={cn(
            'text-xs font-medium px-2.5 py-1 rounded-full',
            question.dificuldade === 'facil'  && 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800',
            question.dificuldade === 'media'   && 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800',
            question.dificuldade === 'dificil' && 'bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800',
          )}
        >
          {question.dificuldade === 'facil' ? 'Fácil' : question.dificuldade === 'media' ? 'Média' : 'Difícil'}
        </span>
        {meta && (
          <span className="bg-zinc-50 dark:bg-zinc-800/50 text-zinc-500 dark:text-zinc-400 text-xs px-2.5 py-1 rounded-full border border-zinc-200 dark:border-zinc-700">
            {meta}
          </span>
        )}
      </div>

      <p className="text-zinc-800 dark:text-zinc-200 text-[15px] leading-relaxed font-medium whitespace-pre-wrap">
        {question.enunciado}
      </p>
    </div>
  );
};

// ─── Multiple Choice Panel ────────────────────────────────────────────────────

type AlternativaKey = 'alternativa_a' | 'alternativa_b' | 'alternativa_c' | 'alternativa_d' | 'alternativa_e';
const ALTERNATIVAS: { key: AlternativaKey; letter: string }[] = [
  { key: 'alternativa_a', letter: 'A' },
  { key: 'alternativa_b', letter: 'B' },
  { key: 'alternativa_c', letter: 'C' },
  { key: 'alternativa_d', letter: 'D' },
  { key: 'alternativa_e', letter: 'E' },
];

const MultipleChoicePanel: React.FC<{
  question: Questao;
  selectedAnswer: string | null;
  isSubmitted: boolean;
  onSelect: (a: string) => void;
}> = ({ question, selectedAnswer, isSubmitted, onSelect }) => {
  return (
    <div className="px-8 pb-2 space-y-2.5">
      {ALTERNATIVAS.map(({ key, letter }) => {
        const text = question[key];
        if (!text) return null;

        const isSelected = selectedAnswer === letter;
        const isCorrect  = question.gabarito.toUpperCase() === letter;

        let variant = 'border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:border-violet-300 dark:hover:border-violet-700 hover:bg-violet-50 dark:hover:bg-violet-900/30 text-zinc-800 dark:text-zinc-200';
        if (isSubmitted) {
          if (isCorrect)               variant = 'border-emerald-400 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-900 dark:text-emerald-100';
          else if (isSelected)         variant = 'border-red-400 bg-red-50 dark:bg-red-900/30 text-red-900 dark:text-red-100';
          else                         variant = 'border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50 text-zinc-500 dark:text-zinc-400 opacity-60';
        } else if (isSelected) {
          variant = 'border-violet-500 bg-violet-50 dark:bg-violet-900/40 text-violet-900 dark:text-violet-100';
        }

        return (
          <button
            key={letter}
            id={`quiz-alt-${letter.toLowerCase()}`}
            onClick={() => !isSubmitted && onSelect(letter)}
            disabled={isSubmitted}
            className={cn(
              'w-full flex items-start gap-3 px-4 py-3 rounded-xl border-2 text-left transition-all duration-150',
              variant,
              !isSubmitted && 'cursor-pointer',
            )}
          >
            <span
              className={cn(
                'shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold mt-0.5',
                isSubmitted && isCorrect   ? 'bg-emerald-500 text-white'
                : isSubmitted && isSelected ? 'bg-red-500 text-white'
                : isSelected                 ? 'bg-violet-600 text-white'
                :                             'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400',
              )}
            >
              {letter}
            </span>
            <span className="text-sm text-zinc-800 dark:text-zinc-200 leading-relaxed">{text}</span>
            {isSubmitted && isCorrect  && <CheckCircle2 size={18} className="shrink-0 ml-auto text-emerald-500 mt-0.5" />}
            {isSubmitted && isSelected && !isCorrect && <XCircle size={18} className="shrink-0 ml-auto text-red-500 mt-0.5" />}
          </button>
        );
      })}
    </div>
  );
};

// ─── Certo / Errado Panel ────────────────────────────────────────────────────

const CertoErradoPanel: React.FC<{
  gabarito: string;
  selectedAnswer: string | null;
  isSubmitted: boolean;
  onSelect: (a: string) => void;
}> = ({ gabarito, selectedAnswer, isSubmitted, onSelect }) => {
  const options = [
    { value: 'Certo', emoji: '✅' },
    { value: 'Errado', emoji: '❌' },
  ];

  return (
    <div className="px-8 pb-2 flex gap-4 justify-center">
      {options.map(({ value, emoji }) => {
        const isSelected = selectedAnswer === value;
        const isCorrect  = gabarito.trim().toLowerCase() === value.toLowerCase();

        let variant = 'border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:border-violet-300 dark:hover:border-violet-700 hover:bg-violet-50 dark:hover:bg-violet-900/30 text-zinc-700 dark:text-zinc-300';
        if (isSubmitted) {
          if (isCorrect)               variant = 'border-emerald-400 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-200';
          else if (isSelected)         variant = 'border-red-400 bg-red-50 dark:bg-red-900/30 text-red-800 dark:text-red-200';
          else                         variant = 'border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50 text-zinc-400 dark:text-zinc-500 opacity-60';
        } else if (isSelected) {
          variant = 'border-violet-500 bg-violet-50 dark:bg-violet-900/40 text-violet-800 dark:text-violet-200';
        }

        return (
          <button
            key={value}
            id={`quiz-certo-errado-${value.toLowerCase()}`}
            onClick={() => !isSubmitted && onSelect(value)}
            disabled={isSubmitted}
            className={cn(
              'flex-1 flex flex-col items-center justify-center gap-2 py-6 rounded-2xl border-2 font-semibold text-lg transition-all duration-150',
              variant,
              !isSubmitted && 'cursor-pointer',
            )}
          >
            <span className="text-3xl">{emoji}</span>
            <span>{value}</span>
          </button>
        );
      })}
    </div>
  );
};

// ─── Combinação de Itens Panel ────────────────────────────────────────────────

const CombinacaoItensPanel: React.FC<{
  itens: QuestaoItem[];
  itemAnswers: Record<number, boolean>;
  isSubmitted: boolean;
  onToggle: (id: number, value: boolean) => void;
}> = ({ itens, itemAnswers, isSubmitted, onToggle }) => {
  return (
    <div className="px-8 pb-2 space-y-3">
      <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-1">
        Julgue cada item:
      </p>
      {itens.map((item) => {
        const userAnswer = itemAnswers[item.id];
        const hasAnswer  = userAnswer !== undefined;
        const isCorrect  = item.correto === null ? true : item.correto === userAnswer;

        return (
          <div
            key={item.id}
            className={cn(
              'rounded-xl border-2 p-4 transition-all duration-150',
              isSubmitted
                ? item.correto !== null && !isCorrect
                  ? 'border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/30'
                  : 'border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/30'
                : 'border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900',
            )}
          >
            <div className="flex items-start gap-3 mb-3">
              <span className="shrink-0 w-7 h-7 rounded-full bg-violet-100 dark:bg-violet-900/50 text-violet-700 dark:text-violet-300 text-xs font-bold flex items-center justify-center mt-0.5">
                {item.numero}
              </span>
              <p className="text-sm text-zinc-800 dark:text-zinc-200 leading-relaxed">{item.enunciado}</p>
            </div>

            <div className="flex gap-2 pl-10">
              {[true, false].map((val) => {
                const label    = val ? 'Certo' : 'Errado';
                const selected = hasAnswer && userAnswer === val;
                const correct  = isSubmitted && item.correto === val;
                const wrong    = isSubmitted && selected && item.correto !== val;

                return (
                  <button
                    key={label}
                    id={`quiz-item-${item.id}-${label.toLowerCase()}`}
                    onClick={() => !isSubmitted && onToggle(item.id, val)}
                    disabled={isSubmitted}
                    className={cn(
                      'px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors',
                      correct ? 'bg-emerald-500 text-white border-emerald-500'
                      : wrong  ? 'bg-red-500 text-white border-red-500'
                      : selected ? 'bg-violet-600 text-white border-violet-600'
                      : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700 hover:border-violet-300 dark:hover:border-violet-700',
                      !isSubmitted && 'cursor-pointer',
                    )}
                  >
                    {label}
                  </button>
                );
              })}
              {isSubmitted && (
                <span className="ml-auto self-center">
                  {isCorrect
                    ? <CheckCircle2 size={16} className="text-emerald-500" />
                    : <XCircle     size={16} className="text-red-500" />}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

// ─── Feedback Block (post-submit) ─────────────────────────────────────────────

const QuizFeedbackBlock: React.FC<{
  question: Questao;
  isCorrect: boolean;
  onGoToSource: (blocoId: number) => void;
}> = ({ question, isCorrect, onGoToSource }) => {
  return (
    <div className="mx-8 mb-4 rounded-xl overflow-hidden border border-zinc-200 dark:border-zinc-800">
      {/* Result banner */}
      <div
        className={cn(
          'flex items-center gap-2.5 px-5 py-3 font-semibold text-sm',
          isCorrect ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white',
        )}
      >
        {isCorrect
          ? <><CheckCircle2 size={18} /> Resposta Correta!</>
          : <><XCircle size={18} /> Resposta Incorreta</>}
      </div>

      {/* Comment */}
      {question.comentario && (
        <div className="p-5 bg-zinc-50 dark:bg-zinc-900/50 border-t border-zinc-100 dark:border-zinc-800">
          <p className="text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide mb-2">
            📝 Comentário do gabarito
          </p>
          <div
            className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed [&_strong]:font-semibold [&_strong]:text-zinc-900 dark:[&_strong]:text-zinc-100 [&_em]:italic [&_p]:mb-2 [&_p:last-child]:mb-0"
            dangerouslySetInnerHTML={{ __html: markdownToHtml(question.comentario) }}
          />
        </div>
      )}

      {/* Source link */}
      {question.bloco_origem_id && (
        <div className="px-5 pb-4 border-t border-zinc-100 dark:border-zinc-800 pt-3 flex">
          <button
            id="quiz-review-source-btn"
            onClick={() => onGoToSource(question.bloco_origem_id!)}
            className="flex items-center gap-2 text-xs font-semibold text-violet-700 dark:text-violet-300 hover:text-violet-900 dark:hover:text-violet-100 bg-violet-50 dark:bg-violet-900/30 hover:bg-violet-100 dark:hover:bg-violet-900/50 border border-violet-200 dark:border-violet-800 px-3 py-1.5 rounded-lg transition-colors"
          >
            <BookOpen size={14} />
            Revisar material de origem
          </button>
        </div>
      )}
    </div>
  );
};

// ─── Question Screen ──────────────────────────────────────────────────────────

interface QuizQuestionScreenProps {
  question: Questao;
  currentIndex: number;
  total: number;
  selectedAnswer: string | null;
  itemAnswers: Record<number, boolean>;
  isSubmitted: boolean;
  score: QuizScore;
  onSelectAnswer: (a: string) => void;
  onToggleItem: (id: number, value: boolean) => void;
  onSubmit: () => void;
  onNext: () => void;
  onSkip: () => void;
  onGoToSource: (blocoId: number) => void;
  onEditQuestion?: (question: Questao) => void;
  onQuit: () => void;
}

const QuizQuestionScreen: React.FC<QuizQuestionScreenProps> = ({
  question,
  currentIndex,
  total,
  selectedAnswer,
  itemAnswers,
  isSubmitted,
  score,
  onSelectAnswer,
  onToggleItem,
  onSubmit,
  onNext,
  onSkip,
  onGoToSource,
  onEditQuestion,
  onQuit,
}) => {
  // Determine if user has provided an answer (to enable the submit button)
  const hasAnswer =
    question.tipo === 'combinacao_itens'
      ? (question.itens ?? []).length > 0 &&
        (question.itens ?? []).every((item) => item.correto === null || itemAnswers[item.id] !== undefined)
      : selectedAnswer !== null;

  // Evaluate correctness for feedback block
  const isCorrect = isSubmitted
    ? question.tipo === 'combinacao_itens'
      ? (question.itens ?? []).every((item) =>
          item.correto === null ? true : itemAnswers[item.id] === item.correto
        )
      : selectedAnswer?.toUpperCase() === question.gabarito.toUpperCase()
    : false;

  const isLastQuestion = currentIndex + 1 >= total;

  return (
    <div className="pb-6">
      <QuizProgress currentIndex={currentIndex} total={total} score={score} />
      <QuizQuestionCard question={question} />

      {/* Answer panels */}
      <div className="mt-1">
        {question.tipo === 'multipla_escolha' && (
          <MultipleChoicePanel
            question={question}
            selectedAnswer={selectedAnswer}
            isSubmitted={isSubmitted}
            onSelect={onSelectAnswer}
          />
        )}

        {question.tipo === 'certo_errado' && (
          <CertoErradoPanel
            gabarito={question.gabarito}
            selectedAnswer={selectedAnswer}
            isSubmitted={isSubmitted}
            onSelect={onSelectAnswer}
          />
        )}

        {question.tipo === 'combinacao_itens' && (
          <CombinacaoItensPanel
            itens={question.itens ?? []}
            itemAnswers={itemAnswers}
            isSubmitted={isSubmitted}
            onToggle={onToggleItem}
          />
        )}
      </div>

      {/* Post-submission feedback */}
      {isSubmitted && (
        <div className="mt-4 animate-in fade-in slide-in-from-bottom-4 duration-300">
          <QuizFeedbackBlock
            question={question}
            isCorrect={isCorrect}
            onGoToSource={onGoToSource}
          />
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center justify-between px-8 mt-4 gap-3">
        <div className="flex items-center gap-4">
          <button
            id="quiz-quit-btn"
            onClick={onQuit}
            className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 underline transition-colors"
          >
            Encerrar sessão
          </button>
          
          {!isSubmitted && (
            <button
              onClick={onSkip}
              className="flex items-center gap-1.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 px-3 py-1.5 rounded-lg"
              title="Pular esta questão"
            >
              <FastForward size={14} /> Pular
            </button>
          )}

          {onEditQuestion && (
            <button
              onClick={() => onEditQuestion(question)}
              className="flex items-center gap-1.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400 hover:text-violet-700 dark:hover:text-violet-300 transition-colors bg-zinc-100 dark:bg-zinc-800 hover:bg-violet-50 dark:hover:bg-violet-900/30 px-3 py-1.5 rounded-lg"
              title="Corrigir no banco de questões"
            >
              <Pencil size={14} /> Corrigir
            </button>
          )}
        </div>

        {!isSubmitted ? (
          <button
            id="quiz-submit-btn"
            onClick={onSubmit}
            disabled={!hasAnswer}
            className={cn(
              'flex items-center gap-2 px-6 py-2.5 rounded-xl font-semibold text-sm transition-all duration-150',
              hasAnswer
                ? 'bg-violet-600 hover:bg-violet-700 text-white shadow-md hover:shadow-lg'
                : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-600 cursor-not-allowed',
            )}
          >
            Responder
            <ChevronRight size={16} />
          </button>
        ) : (
          <button
            id="quiz-next-btn"
            onClick={onNext}
            className="flex items-center gap-2 px-6 py-2.5 rounded-xl font-semibold text-sm bg-zinc-900 hover:bg-zinc-800 text-white shadow-md hover:shadow-lg transition-all duration-150"
          >
            {isLastQuestion ? 'Ver resultado' : 'Próxima'}
            <ChevronRight size={16} />
          </button>
        )}
      </div>
    </div>
  );
};

// ─── Results Screen ───────────────────────────────────────────────────────────

const QuizResultsScreen: React.FC<{
  score: QuizScore;
  onRestart: () => void;
  onClose: () => void;
}> = ({ score, onRestart, onClose }) => {
  const pct = score.total > 0 ? Math.round((score.acertos / score.total) * 100) : 0;
  const resultColor =
    pct >= 70 ? 'text-emerald-600' : pct >= 50 ? 'text-amber-600' : 'text-red-500';
  const resultLabel =
    pct >= 70 ? 'Ótimo desempenho!' : pct >= 50 ? 'Bom trabalho!' : 'Continue praticando!';

  return (
    <div className="flex flex-col items-center justify-center py-12 px-8 text-center gap-6">
      <Trophy size={52} className={cn('mb-2', pct >= 70 ? 'text-amber-400' : 'text-zinc-300')} />

      <div>
        <p className={cn('text-5xl font-extrabold mb-1', resultColor)}>{pct}%</p>
        <p className="text-lg font-semibold text-zinc-800 dark:text-zinc-200">{resultLabel}</p>
      </div>

      <div className="bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-2xl px-8 py-5 w-full max-w-xs">
        <div className="flex justify-between items-center text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-3">
          <span>Acertos</span>
          <span className="text-emerald-600 dark:text-emerald-500 font-bold text-base">{score.acertos}</span>
        </div>
        <div className="flex justify-between items-center text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-3">
          <span>Erros</span>
          <span className="text-red-500 dark:text-red-400 font-bold text-base">{score.total - score.acertos}</span>
        </div>
        <div className="border-t border-zinc-200 dark:border-zinc-700 pt-3 flex justify-between items-center text-sm font-semibold text-zinc-700 dark:text-zinc-300">
          <span>Total</span>
          <span className="text-base">{score.total}</span>
        </div>
      </div>

      <div className="flex gap-3 w-full max-w-xs">
        <button
          id="quiz-restart-btn"
          onClick={onRestart}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 font-semibold rounded-xl transition-colors text-sm"
        >
          <RefreshCw size={15} /> Novo simulado
        </button>
        <button
          id="quiz-results-close-btn"
          onClick={onClose}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-violet-600 hover:bg-violet-700 text-white font-semibold rounded-xl transition-colors text-sm shadow-md"
        >
          Concluir
        </button>
      </div>
    </div>
  );
};
