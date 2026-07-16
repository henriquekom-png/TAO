/**
 * QuestoesHub.tsx
 * ================
 * Unified Questions & Quiz Dashboard — rendered in the central workspace
 * when the user clicks "🧠 Banco de Questões & Simulados" in the Sidebar.
 *
 * Tabs:
 *   1. 🚀 Realizar Simulados  — QuizSetupScreen + inline quiz session
 *   2. 🗃️ Gerenciar Questões  — paginated table, filters, CRUD modals
 */

import React, { useState } from 'react';
import {
  ClipboardList, Database, Plus, Zap, Pencil, Search,
  ChevronLeft, ChevronRight, X, Check, Loader2, AlertCircle,
  CheckCircle2, XCircle, RotateCcw, Trophy, RefreshCw,
  ChevronDown, FastForward, Trash2,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { markdownToHtml } from '../../lib/markdownHtmlConverter';
import {
  useQuestoesPaginated, usePatchQuestao, useIngestQuestoes, useQuestaoDetail, useDeleteQuestao,
  type QuestoesFiltros, type QuestaoUpdatePayload,
} from '../../hooks/useQuestoes';
import { useQuizSession } from '../../hooks/useQuizSession';
import type {
  Questao, TipoQuestao, DificuldadeQuestao, QuizScore, QuestaoItem,
  QuizSessionParams,
} from '../../types';

// ─────────────────────────────────────────────────────────────────────────────
// Root hub
// ─────────────────────────────────────────────────────────────────────────────

type TabId = 'simulado' | 'gerenciar';

export const QuestoesHub: React.FC<{
  initialEditQuestao?: Questao | null;
  onClearInitialEditQuestao?: () => void;
}> = ({ initialEditQuestao, onClearInitialEditQuestao }) => {
  const [activeTab, setActiveTab] = useState<TabId>(initialEditQuestao ? 'gerenciar' : 'simulado');
  const [editingQuestao, setEditingQuestao] = useState<Questao | null>(initialEditQuestao ?? null);

  React.useEffect(() => {
    if (initialEditQuestao) {
      setActiveTab('gerenciar');
      setEditingQuestao(initialEditQuestao);
      onClearInitialEditQuestao?.();
    }
  }, [initialEditQuestao, onClearInitialEditQuestao]);


  const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = [
    { id: 'simulado',  label: 'Realizar Simulados',   icon: <ClipboardList size={16} /> },
    { id: 'gerenciar', label: 'Gerenciar Questões',    icon: <Database size={16} /> },
  ];

  return (
    <div className="h-full flex flex-col bg-zinc-50 dark:bg-zinc-950">
      {/* Page Header */}
      <div className="bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 px-8 pt-6 pb-0 shrink-0">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-9 h-9 rounded-xl bg-violet-100 flex items-center justify-center shrink-0">
            <span className="text-lg">🧠</span>
          </div>
          <div>
            <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100 leading-tight">
              Banco de Questões &amp; Simulados
            </h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Pratique com simulados e gerencie seu banco de questões
            </p>
          </div>
        </div>

        {/* Tab Bar */}
        <div className="flex gap-0 -mb-px">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              id={`hub-tab-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex items-center gap-2 px-5 py-3 text-sm font-semibold border-b-2 transition-colors',
                activeTab === tab.id
                  ? 'border-violet-600 text-violet-700 bg-violet-50 dark:bg-violet-500/10/50 dark:bg-violet-500/10'
                  : 'border-transparent text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 hover:border-zinc-300 dark:hover:border-zinc-700',
              )}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {activeTab === 'simulado'  && <SimuladoTab />}
        {activeTab === 'gerenciar' && (
          <GerenciarTab 
            externalEditingQuestao={editingQuestao} 
            onClearExternalEditing={() => setEditingQuestao(null)} 
          />
        )}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Tab 1 — Simulado
// ─────────────────────────────────────────────────────────────────────────────

const SimuladoTab: React.FC = () => {
  const quiz = useQuizSession();
  const [editingQuestao, setEditingQuestao] = useState<Questao | null>(null);
  const { mutate: patchQuestao, isPending: patching } = usePatchQuestao();

  const currentQuestion = quiz.questionsArray[quiz.currentIndex] ?? null;
  const showSetup       = quiz.questionsArray.length === 0 && !quiz.isLoading;
  const showQuestion    = quiz.questionsArray.length > 0 && !quiz.isFinished;
  const showResults     = quiz.isFinished;
  const hasPrevious     = quiz.visitedHistory.length > 0;

  return (
    <div className="max-w-3xl mx-auto px-6 py-8">
      {quiz.isLoading && <HubLoadingBlock text="Buscando questões..." />}

      {quiz.error && !quiz.isLoading && (
        <HubErrorBlock message={quiz.error} onRetry={quiz.resetSession} />
      )}

      {!quiz.isLoading && !quiz.error && showSetup && (
        <HubSetupForm onStart={quiz.startSession} />
      )}

      {!quiz.isLoading && !quiz.error && showQuestion && currentQuestion && (
        <HubQuestionView
          question={currentQuestion}
          currentIndex={quiz.currentIndex}
          total={quiz.questionsArray.length}
          selectedAnswer={quiz.selectedAnswer}
          itemAnswers={quiz.itemAnswers}
          isSubmitted={quiz.isSubmitted}
          score={quiz.score}
          hasPrevious={hasPrevious}
          onSelectAnswer={quiz.selectAnswer}
          onToggleItem={quiz.toggleItemAnswer}
          onSubmit={quiz.submitAnswer}
          onNext={quiz.nextQuestion}
          onSkip={quiz.skipQuestion}
          onPrevious={quiz.goToPrevious}
          onQuit={quiz.resetSession}
          onEditQuestion={(q) => setEditingQuestao(q)}
          onGoToSource={() => {/* no-op inside hub — no external navigation needed */}}
        />
      )}

      {!quiz.isLoading && !quiz.error && showResults && (
        <HubResultsView
          score={quiz.score}
          onRestart={quiz.resetSession}
        />
      )}

      {/* Inline edit modal — opens over the simulado without leaving the tab */}
      {editingQuestao && (
        <EditQuestaoModal
          questao={editingQuestao}
          isSaving={patching}
          onSave={(payload) => {
            patchQuestao({ id: editingQuestao.id, payload }, {
              onSuccess: (updated) => {
                quiz.updateQuestionInSession(updated);
                setEditingQuestao(null);
              },
            });
          }}
          onClose={() => setEditingQuestao(null)}
        />
      )}
    </div>
  );
};

// ─── Setup Form (hub version) ─────────────────────────────────────────────────

const HubSetupForm: React.FC<{
  onStart: (p: QuizSessionParams) => void;
}> = ({ onStart }) => {
  const [form, setForm] = useState({
    materia: '', banca: '', dificuldade: '' as DificuldadeQuestao | '', limit: 10,
  });

  const fieldCls =
    'w-full border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-800 dark:text-zinc-200 bg-white dark:bg-zinc-900 ' +
    'focus:outline-none focus:ring-2 focus:ring-violet-400 dark:focus:ring-violet-500/50 focus:border-transparent transition';

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm p-8">
      <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100 mb-1">🚀 Configurar Simulado</h2>
      <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-6">
        Defina os filtros e inicie uma sessão de prática. Deixe em branco para buscar de todas as categorias.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          onStart({
            materia:     form.materia     || undefined,
            banca:       form.banca       || undefined,
            dificuldade: (form.dificuldade as DificuldadeQuestao) || undefined,
            limit:       form.limit,
          });
        }}
        className="space-y-4"
      >
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">Matéria</label>
            <input className={fieldCls} placeholder="Ex.: Direito do Trabalho"
              value={form.materia} onChange={(e) => setForm(f => ({ ...f, materia: e.target.value }))} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">Banca</label>
            <input className={fieldCls} placeholder="Ex.: CESPE, FGV"
              value={form.banca} onChange={(e) => setForm(f => ({ ...f, banca: e.target.value }))} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">Dificuldade</label>
            <select className={fieldCls} value={form.dificuldade}
              onChange={(e) => setForm(f => ({ ...f, dificuldade: e.target.value as DificuldadeQuestao | '' }))}>
              <option value="">Qualquer</option>
              <option value="facil">Fácil</option>
              <option value="media">Média</option>
              <option value="dificil">Difícil</option>
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">Quantidade (máx. 50)</label>
            <input type="number" min={1} max={50} className={fieldCls} value={form.limit}
              onChange={(e) => setForm(f => ({ ...f, limit: Math.min(50, Math.max(1, Number(e.target.value))) }))} />
          </div>
        </div>
        <button type="submit"
          className="w-full flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-700 text-white font-semibold py-3 rounded-xl transition-colors shadow-md mt-2">
          <ClipboardList size={16} /> Iniciar Simulado
        </button>
      </form>
    </div>
  );
};

// ─── Question View (hub — inline, no modal) ───────────────────────────────────

interface HubQuestionViewProps {
  question:       Questao;
  currentIndex:   number;
  total:          number;
  selectedAnswer: string | null;
  itemAnswers:    Record<number, boolean>;
  isSubmitted:    boolean;
  score:          QuizScore;
  hasPrevious:    boolean;
  onSelectAnswer: (a: string) => void;
  onToggleItem:   (id: number, v: boolean) => void;
  onSubmit:       () => void;
  onNext:         () => void;
  onSkip:         () => void;
  onPrevious:     () => void;
  onQuit:         () => void;
  onEditQuestion: (q: Questao) => void;
  onGoToSource:   (blocoId: number) => void;
}

const HubQuestionView: React.FC<HubQuestionViewProps> = ({
  question, currentIndex, total, selectedAnswer, itemAnswers,
  isSubmitted, score, hasPrevious, onSelectAnswer, onToggleItem, onSubmit, onNext, onSkip,
  onPrevious, onQuit, onEditQuestion,
}) => {
  const pct = Math.round((currentIndex / total) * 100);
  const isLastQuestion = currentIndex + 1 >= total;

  const hasAnswer =
    question.tipo === 'combinacao_itens'
      ? (question.itens ?? []).length > 0 &&
        (question.itens ?? []).every((it) => it.correto === null || itemAnswers[it.id] !== undefined)
      : selectedAnswer !== null;

  const isCorrect = isSubmitted
    ? question.tipo === 'combinacao_itens'
      ? (question.itens ?? []).every((it) => it.correto === null || itemAnswers[it.id] === it.correto)
      : selectedAnswer?.toUpperCase() === question.gabarito.toUpperCase()
    : false;

  const tipoMap: Record<string, string> = {
    multipla_escolha: 'Múltipla Escolha',
    certo_errado: 'Certo ou Errado',
    combinacao_itens: 'Combinação de Itens',
  };

  return (
    <div className="space-y-5">
      {/* Progress */}
      <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm px-6 py-4">
        <div className="flex justify-between items-center text-xs text-zinc-500 dark:text-zinc-400 font-medium mb-2">
          <span>Questão {currentIndex + 1} de {total}</span>
          <span className="text-emerald-600 font-semibold">{score.acertos} acerto{score.acertos !== 1 ? 's' : ''}</span>
        </div>
        <div className="w-full bg-zinc-100 dark:bg-zinc-800 rounded-full h-1.5">
          <div className="bg-violet-500 h-1.5 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {/* Question card */}
      <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm p-6">
        <div className="flex flex-wrap gap-2 mb-4">
          {question.materia && (
            <span className="bg-violet-50 dark:bg-violet-500/10 text-violet-700 text-xs font-semibold px-2.5 py-1 rounded-full border border-violet-200 dark:border-violet-500/20">
              {question.materia}
            </span>
          )}
          <span className="bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 text-xs font-medium px-2.5 py-1 rounded-full">
            {tipoMap[question.tipo] ?? question.tipo}
          </span>
          <span className={cn(
            'text-xs font-medium px-2.5 py-1 rounded-full',
            question.dificuldade === 'facil'  && 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 border border-emerald-200 dark:border-emerald-500/20',
            question.dificuldade === 'media'   && 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 border border-amber-200 dark:border-amber-500/20',
            question.dificuldade === 'dificil' && 'bg-red-50 dark:bg-red-500/10 text-red-700 border border-red-200 dark:border-red-500/20',
          )}>
            {question.dificuldade === 'facil' ? 'Fácil' : question.dificuldade === 'media' ? 'Média' : 'Difícil'}
          </span>
          {[question.banca, question.ano, question.cargo].filter(Boolean).length > 0 && (
            <span className="bg-zinc-50 dark:bg-zinc-950 text-zinc-500 dark:text-zinc-400 text-xs px-2.5 py-1 rounded-full border border-zinc-200 dark:border-zinc-800">
              {[question.banca, question.ano, question.cargo].filter(Boolean).join(' · ')}
            </span>
          )}
        </div>
        <p className="text-zinc-800 dark:text-zinc-200 text-[15px] leading-relaxed font-medium whitespace-pre-wrap">
          {question.enunciado}
        </p>
      </div>

      {/* Answer panels */}
      <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm p-6 space-y-3">
        {question.tipo === 'multipla_escolha' && (
          <HubMultipleChoice question={question} selectedAnswer={selectedAnswer} isSubmitted={isSubmitted} onSelect={onSelectAnswer} />
        )}
        {question.tipo === 'certo_errado' && (
          <HubCertoErrado gabarito={question.gabarito} selectedAnswer={selectedAnswer} isSubmitted={isSubmitted} onSelect={onSelectAnswer} />
        )}
        {question.tipo === 'combinacao_itens' && (
          <HubCombinacaoItens itens={question.itens ?? []} itemAnswers={itemAnswers} isSubmitted={isSubmitted} onToggle={onToggleItem} />
        )}
      </div>

      {/* Feedback */}
      {isSubmitted && (
        <div className={cn(
          'rounded-2xl border-2 overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-300',
          isCorrect ? 'border-emerald-300 dark:border-emerald-500/40' : 'border-red-300 dark:border-red-500/40',
        )}>
          <div className={cn(
            'flex items-center gap-2.5 px-5 py-3 font-semibold text-sm',
            isCorrect ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white',
          )}>
            {isCorrect ? <><CheckCircle2 size={18} /> Resposta Correta!</> : <><XCircle size={18} /> Resposta Incorreta</>}
          </div>
          {question.comentario && (
            <div className="p-5 bg-white dark:bg-zinc-900">
              <p className="text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide mb-2">📝 Comentário do gabarito</p>
              <div
                className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed [&_strong]:font-semibold [&_strong]:text-zinc-900 [&_em]:italic [&_p]:mb-2 [&_p:last-child]:mb-0"
                dangerouslySetInnerHTML={{ __html: markdownToHtml(question.comentario) }}
              />
            </div>
          )}
        </div>
      )}

      {/* Action row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={onQuit} className="text-xs text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 underline transition-colors">
            Encerrar sessão
          </button>
          {hasPrevious && (
            <button
              onClick={onPrevious}
              className="flex items-center gap-1.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 px-3 py-1.5 rounded-lg"
              title="Voltar para a questão anterior"
            >
              <ChevronLeft size={14} /> Anterior
            </button>
          )}
          {!isSubmitted && (
            <button
              onClick={onSkip}
              className="flex items-center gap-1.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 px-3 py-1.5 rounded-lg"
              title="Pular esta questão"
            >
              <FastForward size={14} /> Pular
            </button>
          )}
          <button
            onClick={() => onEditQuestion(question)}
            className="flex items-center gap-1.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400 hover:text-violet-700 transition-colors bg-zinc-100 dark:bg-zinc-800 hover:bg-violet-50 dark:hover:bg-violet-500/20 px-3 py-1.5 rounded-lg"
            title="Editar esta questão no banco"
          >
            <Pencil size={14} /> Editar questão
          </button>
        </div>
        
        {!isSubmitted ? (
          <button onClick={onSubmit} disabled={!hasAnswer}
            className={cn(
              'flex items-center gap-2 px-6 py-2.5 rounded-xl font-semibold text-sm transition-all',
              hasAnswer ? 'bg-violet-600 hover:bg-violet-700 text-white shadow-md' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-500 cursor-not-allowed',
            )}>
            Responder <ChevronRight size={16} />
          </button>
        ) : (
          <button onClick={onNext}
            className="flex items-center gap-2 px-6 py-2.5 rounded-xl font-semibold text-sm bg-zinc-900 hover:bg-zinc-800 text-white shadow-md transition-all">
            {isLastQuestion ? 'Ver resultado' : 'Próxima'} <ChevronRight size={16} />
          </button>
        )}
      </div>
    </div>
  );
};

// Answer sub-panels (hub inline versions)
type AltKey = 'alternativa_a' | 'alternativa_b' | 'alternativa_c' | 'alternativa_d' | 'alternativa_e';
const ALTS: { key: AltKey; letter: string }[] = [
  { key: 'alternativa_a', letter: 'A' }, { key: 'alternativa_b', letter: 'B' },
  { key: 'alternativa_c', letter: 'C' }, { key: 'alternativa_d', letter: 'D' },
  { key: 'alternativa_e', letter: 'E' },
];

const HubMultipleChoice: React.FC<{ question: Questao; selectedAnswer: string | null; isSubmitted: boolean; onSelect: (a: string) => void }> =
  ({ question, selectedAnswer, isSubmitted, onSelect }) => (
    <div className="space-y-2">
      {ALTS.map(({ key, letter }) => {
        const text = question[key]; if (!text) return null;
        const sel  = selectedAnswer === letter;
        const corr = question.gabarito.toUpperCase() === letter;
        let cls = 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-violet-300 dark:hover:border-violet-500/50 hover:bg-violet-50 dark:hover:bg-violet-500/20';
        if (isSubmitted) {
          if (corr) cls = 'border-emerald-400 bg-emerald-50 dark:bg-emerald-500/10';
          else if (sel) cls = 'border-red-400 bg-red-50 dark:bg-red-500/10';
          else cls = 'border-zinc-100 dark:border-zinc-800/50 bg-zinc-50 dark:bg-zinc-950 opacity-60';
        } else if (sel) cls = 'border-violet-500 bg-violet-50 dark:bg-violet-500/10';
        return (
          <button key={letter} onClick={() => !isSubmitted && onSelect(letter)} disabled={isSubmitted}
            className={cn('w-full flex items-start gap-3 px-4 py-3 rounded-xl border-2 text-left transition-all', cls, !isSubmitted && 'cursor-pointer')}>
            <span className={cn('shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold mt-0.5',
              isSubmitted && corr ? 'bg-emerald-500 text-white' : isSubmitted && sel ? 'bg-red-500 text-white'
              : sel ? 'bg-violet-600 text-white' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400')}>
              {letter}
            </span>
            <span className="text-sm text-zinc-800 dark:text-zinc-200 leading-relaxed">{text}</span>
            {isSubmitted && corr && <CheckCircle2 size={18} className="shrink-0 ml-auto text-emerald-500 mt-0.5" />}
            {isSubmitted && sel && !corr && <XCircle size={18} className="shrink-0 ml-auto text-red-500 mt-0.5" />}
          </button>
        );
      })}
    </div>
  );

const HubCertoErrado: React.FC<{ gabarito: string; selectedAnswer: string | null; isSubmitted: boolean; onSelect: (a: string) => void }> =
  ({ gabarito, selectedAnswer, isSubmitted, onSelect }) => (
    <div className="flex gap-4 justify-center">
      {[{ v: 'Certo', e: '✅' }, { v: 'Errado', e: '❌' }].map(({ v, e }) => {
        const sel  = selectedAnswer === v;
        const corr = gabarito.trim().toLowerCase() === v.toLowerCase();
        let cls = 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-violet-300 dark:hover:border-violet-500/50 text-zinc-700 dark:text-zinc-300';
        if (isSubmitted) {
          if (corr) cls = 'border-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-800';
          else if (sel) cls = 'border-red-400 bg-red-50 dark:bg-red-500/10 text-red-800';
          else cls = 'border-zinc-100 dark:border-zinc-800/50 bg-zinc-50 dark:bg-zinc-950 text-zinc-400 dark:text-zinc-500 opacity-60';
        } else if (sel) cls = 'border-violet-500 bg-violet-50 dark:bg-violet-500/10 text-violet-800';
        return (
          <button key={v} onClick={() => !isSubmitted && onSelect(v)} disabled={isSubmitted}
            className={cn('flex-1 flex flex-col items-center justify-center gap-2 py-6 rounded-2xl border-2 font-semibold text-lg transition-all', cls, !isSubmitted && 'cursor-pointer')}>
            <span className="text-3xl">{e}</span><span>{v}</span>
          </button>
        );
      })}
    </div>
  );

const HubCombinacaoItens: React.FC<{ itens: QuestaoItem[]; itemAnswers: Record<number, boolean>; isSubmitted: boolean; onToggle: (id: number, v: boolean) => void }> =
  ({ itens, itemAnswers, isSubmitted, onToggle }) => (
    <div className="space-y-3">
      <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">Julgue cada item:</p>
      {itens.map((item) => {
        const ua = itemAnswers[item.id]; const has = ua !== undefined;
        const ok = item.correto === null ? true : item.correto === ua;
        return (
          <div key={item.id} className={cn('rounded-xl border-2 p-4 transition-all',
            isSubmitted ? item.correto !== null && !ok ? 'border-red-300 dark:border-red-500/40 bg-red-50 dark:bg-red-500/10' : 'border-emerald-300 dark:border-emerald-500/40 bg-emerald-50 dark:bg-emerald-500/10' : 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900')}>
            <div className="flex items-start gap-3 mb-3">
              <span className="shrink-0 w-7 h-7 rounded-full bg-violet-100 text-violet-700 text-xs font-bold flex items-center justify-center mt-0.5">{item.numero}</span>
              <p className="text-sm text-zinc-800 dark:text-zinc-200 leading-relaxed">{item.enunciado}</p>
            </div>
            <div className="flex gap-2 pl-10">
              {[true, false].map((val) => {
                const label = val ? 'Certo' : 'Errado'; const sel2 = has && ua === val;
                const corr2 = isSubmitted && item.correto === val; const wrong2 = isSubmitted && sel2 && item.correto !== val;
                return (
                  <button key={label} onClick={() => !isSubmitted && onToggle(item.id, val)} disabled={isSubmitted}
                    className={cn('px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors',
                      corr2 ? 'bg-emerald-500 text-white border-emerald-500' : wrong2 ? 'bg-red-500 text-white border-red-500'
                      : sel2 ? 'bg-violet-600 text-white border-violet-600' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-800 hover:border-violet-300 dark:hover:border-violet-500/50',
                      !isSubmitted && 'cursor-pointer')}>
                    {label}
                  </button>
                );
              })}
              {isSubmitted && <span className="ml-auto self-center">{ok ? <CheckCircle2 size={16} className="text-emerald-500" /> : <XCircle size={16} className="text-red-500" />}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );

const HubResultsView: React.FC<{ score: QuizScore; onRestart: () => void }> = ({ score, onRestart }) => {
  const pct = score.total > 0 ? Math.round((score.acertos / score.total) * 100) : 0;
  const color = pct >= 70 ? 'text-emerald-600' : pct >= 50 ? 'text-amber-600' : 'text-red-500';
  const label = pct >= 70 ? 'Ótimo desempenho!' : pct >= 50 ? 'Bom trabalho!' : 'Continue praticando!';
  return (
    <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm p-10 flex flex-col items-center text-center gap-5">
      <Trophy size={52} className={pct >= 70 ? 'text-amber-400' : 'text-zinc-300 dark:text-zinc-600'} />
      <div>
        <p className={cn('text-5xl font-extrabold mb-1', color)}>{pct}%</p>
        <p className="text-lg font-semibold text-zinc-800 dark:text-zinc-200">{label}</p>
      </div>
      <div className="bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-2xl px-8 py-5 w-full max-w-xs">
        {[['Acertos', score.acertos, 'text-emerald-600'], ['Erros', score.total - score.acertos, 'text-red-500'], ['Total', score.total, 'text-zinc-700 dark:text-zinc-300']].map(([l, v, c]) => (
          <div key={l as string} className="flex justify-between items-center text-sm font-medium text-zinc-600 dark:text-zinc-400 py-1.5 border-b border-zinc-100 dark:border-zinc-800/50 last:border-0">
            <span>{l}</span><span className={cn('font-bold text-base', c)}>{v}</span>
          </div>
        ))}
      </div>
      <button onClick={onRestart} className="flex items-center gap-2 px-6 py-3 bg-violet-600 hover:bg-violet-700 text-white font-semibold rounded-xl transition-colors shadow-md">
        <RefreshCw size={15} /> Novo Simulado
      </button>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Tab 2 — Gerenciar Questões
// ─────────────────────────────────────────────────────────────────────────────

const GerenciarTab: React.FC<{
  externalEditingQuestao?: Questao | null;
  onClearExternalEditing?: () => void;
}> = ({ externalEditingQuestao, onClearExternalEditing }) => {
  const [filtros, setFiltros] = useState<QuestoesFiltros>({ page: 1, limit: 20 });
  const [searchDraft, setSearchDraft] = useState('');
  const [editingQuestao,  setEditingQuestao]  = useState<Questao | null>(null);
  const [showInsertModal, setShowInsertModal] = useState(false);
  const [showIngestModal, setShowIngestModal] = useState(false);

  React.useEffect(() => {
    if (externalEditingQuestao) {
      setEditingQuestao(externalEditingQuestao);
      onClearExternalEditing?.();
    }
  }, [externalEditingQuestao, onClearExternalEditing]);

  const { data, isLoading, isError } = useQuestoesPaginated(filtros);
  const { mutate: patchQuestao, isPending: patching } = usePatchQuestao();
  const { mutate: deleteQuestao, isPending: deleting } = useDeleteQuestao();

  const totalPages = data ? Math.ceil(data.total / (data.limit || 20)) : 1;

  const applySearch = () => {
    setFiltros(f => ({ ...f, search: searchDraft || undefined, page: 1 }));
  };

  const tipoLabel: Record<string, string> = {
    multipla_escolha: 'M.E.', certo_errado: 'C/E', combinacao_itens: 'Comb.',
  };
  const difColor: Record<string, string> = {
    facil: 'text-emerald-700 bg-emerald-50 dark:bg-emerald-500/10', media: 'text-amber-700 bg-amber-50 dark:bg-amber-500/10', dificil: 'text-red-700 bg-red-50 dark:bg-red-500/10',
  };

  return (
    <div className="px-8 py-6 space-y-5">
      {/* Action bar */}
      <div className="flex flex-wrap items-center gap-3">
        <button id="hub-insert-btn" onClick={() => setShowInsertModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold rounded-lg transition-colors shadow-sm">
          <Plus size={15} /> Inserir Manualmente
        </button>
        <button id="hub-ingest-btn" onClick={() => setShowIngestModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-lg transition-colors shadow-sm">
          <Zap size={15} /> Ingestão Inteligente via IA
        </button>

        {/* Quick filters */}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {/* Search */}
          <div className="flex items-center border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden bg-white dark:bg-zinc-900 shadow-sm">
            <input placeholder="Buscar no enunciado..." value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && applySearch()}
              className="px-3 py-2 text-sm outline-none bg-transparent min-w-[200px]" />
            <button onClick={applySearch} className="px-3 py-2 text-zinc-400 dark:text-zinc-500 hover:text-violet-600 border-l border-zinc-200 dark:border-zinc-800 transition-colors">
              <Search size={14} />
            </button>
          </div>

          {/* Tipo filter */}
          <FilterSelect
            value={filtros.tipo || ''}
            onChange={(v) => setFiltros(f => ({ ...f, tipo: v as TipoQuestao | '', page: 1 }))}
            options={[
              { value: '', label: 'Tipo: Todos' },
              { value: 'multipla_escolha', label: 'Múltipla Escolha' },
              { value: 'certo_errado', label: 'Certo/Errado' },
              { value: 'combinacao_itens', label: 'Combinação' },
            ]}
          />

          {/* Dificuldade filter */}
          <FilterSelect
            value={filtros.dificuldade || ''}
            onChange={(v) => setFiltros(f => ({ ...f, dificuldade: v as DificuldadeQuestao | '', page: 1 }))}
            options={[
              { value: '', label: 'Dificuldade: Todas' },
              { value: 'facil', label: 'Fácil' },
              { value: 'media', label: 'Média' },
              { value: 'dificil', label: 'Difícil' },
            ]}
          />
        </div>
      </div>

      {/* Stats bar */}
      {data && (
        <div className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">
          {data.total} questão{data.total !== 1 ? 'ões' : ''} encontrada{data.total !== 1 ? 's' : ''}
          {filtros.search ? ` · busca: "${filtros.search}"` : ''}
        </div>
      )}

      {/* Table */}
      {isLoading && <HubLoadingBlock text="Carregando questões..." />}
      {isError   && <HubErrorBlock message="Erro ao carregar questões." onRetry={() => setFiltros(f => ({ ...f }))} />}

      {!isLoading && !isError && data && (
        <>
          <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-zinc-50 dark:bg-zinc-950 border-b border-zinc-200 dark:border-zinc-800 text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                  <th className="px-5 py-3 text-left w-16">ID</th>
                  <th className="px-5 py-3 text-left">Enunciado</th>
                  <th className="px-5 py-3 text-left w-28">Matéria</th>
                  <th className="px-5 py-3 text-left w-20">Tipo</th>
                  <th className="px-5 py-3 text-left w-20">Dific.</th>
                  <th className="px-5 py-3 text-left w-24">Banca</th>
                  <th className="px-5 py-3 text-right w-24">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {data.data.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-5 py-10 text-center text-zinc-400 dark:text-zinc-500 italic text-sm">
                      Nenhuma questão encontrada com os filtros aplicados.
                    </td>
                  </tr>
                ) : data.data.map((q) => (
                  <tr key={q.id} className="hover:bg-violet-50 dark:hover:bg-violet-500/20/30 transition-colors">
                    <td className="px-5 py-3 text-zinc-400 dark:text-zinc-500 font-mono text-xs">{q.id}</td>
                    <td className="px-5 py-3 text-zinc-800 dark:text-zinc-200 max-w-xs">
                      <span className="line-clamp-2 leading-snug">{q.enunciado}</span>
                    </td>
                    <td className="px-5 py-3">
                      <span className="text-xs text-zinc-600 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 rounded-full">{q.materia || '—'}</span>
                    </td>
                    <td className="px-5 py-3 text-xs font-medium text-violet-700">{tipoLabel[q.tipo] ?? q.tipo}</td>
                    <td className="px-5 py-3">
                      <span className={cn('text-xs font-semibold px-2 py-0.5 rounded-full', difColor[q.dificuldade])}>
                        {q.dificuldade === 'facil' ? 'Fácil' : q.dificuldade === 'media' ? 'Média' : 'Difícil'}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-xs text-zinc-500 dark:text-zinc-400">{q.banca || '—'}</td>
                    <td className="px-5 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          id={`hub-edit-${q.id}`}
                          onClick={() => setEditingQuestao(q)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-800 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors"
                        >
                          <Pencil size={12} /> Editar
                        </button>
                        <button
                          id={`hub-delete-${q.id}`}
                          onClick={() => {
                            if (window.confirm("Tem certeza que deseja excluir esta questão?")) {
                              deleteQuestao(q.id);
                            }
                          }}
                          disabled={deleting}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800/50 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 hover:border-red-300 dark:hover:border-red-700 transition-colors disabled:opacity-50"
                        >
                          <Trash2 size={12} /> Excluir
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2">
              <button onClick={() => setFiltros(f => ({ ...f, page: Math.max(1, (f.page ?? 1) - 1) }))}
                disabled={(filtros.page ?? 1) <= 1}
                className="p-2 rounded-lg border border-zinc-200 dark:border-zinc-800 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-40 transition-colors">
                <ChevronLeft size={16} />
              </button>
              <span className="text-sm text-zinc-600 dark:text-zinc-400 font-medium px-2">
                Página {filtros.page ?? 1} de {totalPages}
              </span>
              <button onClick={() => setFiltros(f => ({ ...f, page: Math.min(totalPages, (f.page ?? 1) + 1) }))}
                disabled={(filtros.page ?? 1) >= totalPages}
                className="p-2 rounded-lg border border-zinc-200 dark:border-zinc-800 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-40 transition-colors">
                <ChevronRight size={16} />
              </button>
            </div>
          )}
        </>
      )}

      {/* Edit Modal */}
      {editingQuestao && (
        <EditQuestaoModal
          questao={editingQuestao}
          isSaving={patching}
          onSave={(payload) => {
            patchQuestao({ id: editingQuestao.id, payload }, {
              onSuccess: () => setEditingQuestao(null),
            });
          }}
          onClose={() => setEditingQuestao(null)}
        />
      )}

      {/* Insert Manually Modal */}
      {showInsertModal && (
        <InsertQuestaoModal onClose={() => setShowInsertModal(false)} />
      )}

      {/* Ingest Modal */}
      {showIngestModal && (
        <IngestModal onClose={() => setShowIngestModal(false)} />
      )}
    </div>
  );
};

// ─── Filter Select helper ─────────────────────────────────────────────────────

const FilterSelect: React.FC<{
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}> = ({ value, onChange, options }) => (
  <div className="relative">
    <select value={value} onChange={(e) => onChange(e.target.value)}
      className="appearance-none border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-2 pr-8 text-sm text-zinc-700 dark:text-zinc-300 bg-white dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-violet-400 dark:focus:ring-violet-500/50 cursor-pointer shadow-sm">
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
    <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 dark:text-zinc-500 pointer-events-none" />
  </div>
);

// ─── Edit Modal ───────────────────────────────────────────────────────────────

const EditQuestaoModal: React.FC<{
  questao: Questao;
  isSaving: boolean;
  onSave: (payload: QuestaoUpdatePayload) => void;
  onClose: () => void;
}> = ({ questao, isSaving, onSave, onClose }) => {
  const { data: fullQuestao, isLoading } = useQuestaoDetail(questao.id);

  const [form, setForm] = useState<QuestaoUpdatePayload>({
    banca:         questao.banca       ?? '',
    ano:           questao.ano         ?? undefined,
    cargo:         questao.cargo       ?? '',
    materia:       questao.materia,
    tipo:          questao.tipo,
    enunciado:     questao.enunciado,
    alternativa_a: questao.alternativa_a ?? '',
    alternativa_b: questao.alternativa_b ?? '',
    alternativa_c: questao.alternativa_c ?? '',
    alternativa_d: questao.alternativa_d ?? '',
    alternativa_e: questao.alternativa_e ?? '',
    gabarito:      questao.gabarito,
    comentario:    questao.comentario  ?? '',
    dificuldade:   questao.dificuldade,
    itens:         [],
  });

  React.useEffect(() => {
    if (fullQuestao?.itens) {
      setForm(f => ({
        ...f,
        itens: fullQuestao.itens?.map(i => ({ numero: i.numero, enunciado: i.enunciado, correto: i.correto })) || []
      }));
    }
  }, [fullQuestao]);

  const field = 'w-full border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-800 dark:text-zinc-200 bg-white dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-violet-400 dark:focus:ring-violet-500/50 transition';
  const ta    = `${field} resize-y`;

  return (
    <ModalShell title={`✏️ Editar Questão #${questao.id}`} onClose={onClose} maxW="max-w-2xl">
      <div className="space-y-4 overflow-y-auto max-h-[65vh] pr-1">
        <div className="grid grid-cols-3 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">Banca</label>
            <input className={field} value={form.banca ?? ''} onChange={(e) => setForm(f => ({ ...f, banca: e.target.value }))} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">Ano</label>
            <input type="number" className={field} value={form.ano ?? ''} onChange={(e) => setForm(f => ({ ...f, ano: e.target.value ? Number(e.target.value) : undefined }))} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">Dificuldade</label>
            <select className={field} value={form.dificuldade} onChange={(e) => setForm(f => ({ ...f, dificuldade: e.target.value as DificuldadeQuestao }))}>
              <option value="facil">Fácil</option><option value="media">Média</option><option value="dificil">Difícil</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">Matéria</label>
            <input className={field} value={form.materia ?? ''} onChange={(e) => setForm(f => ({ ...f, materia: e.target.value }))} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">Cargo</label>
            <input className={field} value={form.cargo ?? ''} onChange={(e) => setForm(f => ({ ...f, cargo: e.target.value }))} />
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">Enunciado *</label>
          <textarea rows={4} className={ta} value={form.enunciado} onChange={(e) => setForm(f => ({ ...f, enunciado: e.target.value }))} />
        </div>

        {form.tipo === 'multipla_escolha' && (
          <div className="space-y-2">
            {(['a','b','c','d','e'] as const).map((l) => {
              const key = `alternativa_${l}` as keyof QuestaoUpdatePayload;
              return (
                <div key={l} className="flex items-start gap-2">
                  <span className="mt-2 w-6 h-6 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 text-xs font-bold flex items-center justify-center shrink-0">{l.toUpperCase()}</span>
                  <input className={`${field} flex-1`} placeholder={`Alternativa ${l.toUpperCase()}`}
                    value={(form[key] as string) ?? ''}
                    onChange={(e) => setForm(f => ({ ...f, [key]: e.target.value }))} />
                </div>
              );
            })}
          </div>
        )}

        {form.tipo === 'combinacao_itens' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">Itens da Combinação</label>
              <button
                onClick={() => setForm(f => ({ ...f, itens: [...(f.itens || []), { numero: '', enunciado: '', correto: null }] }))}
                className="text-xs font-semibold text-violet-600 flex items-center gap-1 hover:text-violet-700"
              >
                <Plus size={12} /> Adicionar Item
              </button>
            </div>
            {isLoading && <div className="text-xs text-zinc-500 dark:text-zinc-400">Carregando itens...</div>}
            {(!isLoading && form.itens) && form.itens.map((item, idx) => (
              <div key={idx} className="flex flex-col gap-2 bg-zinc-50 dark:bg-zinc-950 p-3 rounded-lg border border-zinc-200 dark:border-zinc-800 shadow-sm relative">
                <div className="flex gap-2 items-center justify-between">
                  <div className="flex items-center gap-2">
                    <input
                      className={`${field} w-20 text-center font-semibold`}
                      placeholder="Nº (I, II)"
                      value={item.numero}
                      onChange={(e) => {
                        const newItens = [...form.itens!];
                        newItens[idx].numero = e.target.value;
                        setForm({ ...form, itens: newItens });
                      }}
                    />
                    <select
                      className={`${field} w-32`}
                      value={item.correto === true ? 'true' : item.correto === false ? 'false' : 'null'}
                      onChange={(e) => {
                        const v = e.target.value;
                        const newItens = [...form.itens!];
                        newItens[idx].correto = v === 'true' ? true : v === 'false' ? false : null;
                        setForm({ ...form, itens: newItens });
                      }}
                    >
                      <option value="null">Neutro</option>
                      <option value="true">Certo</option>
                      <option value="false">Errado</option>
                    </select>
                  </div>
                  <button
                    onClick={() => {
                      const newItens = [...form.itens!];
                      newItens.splice(idx, 1);
                      setForm({ ...form, itens: newItens });
                    }}
                    className="p-1.5 text-zinc-400 dark:text-zinc-500 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors"
                    title="Remover item"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
                <textarea
                  className={`${ta} w-full`}
                  rows={2}
                  placeholder="Enunciado do item"
                  value={item.enunciado}
                  onChange={(e) => {
                    const newItens = [...form.itens!];
                    newItens[idx].enunciado = e.target.value;
                    setForm({ ...form, itens: newItens });
                  }}
                />
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">Gabarito *</label>
          <input className={field} value={form.gabarito} onChange={(e) => setForm(f => ({ ...f, gabarito: e.target.value }))}
            placeholder={form.tipo === 'multipla_escolha' ? 'A, B, C, D ou E' : form.tipo === 'certo_errado' ? 'Certo ou Errado' : 'I-Certo, II-Errado...'} />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">Comentário / Justificativa</label>
          <textarea rows={3} className={ta} value={form.comentario ?? ''} onChange={(e) => setForm(f => ({ ...f, comentario: e.target.value }))} />
          <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-0.5">
            Formatação: <code className="bg-zinc-100 dark:bg-zinc-800 px-1 rounded text-[10px]">**negrito**</code>{' '}
            <code className="bg-zinc-100 dark:bg-zinc-800 px-1 rounded text-[10px]">*itálico*</code>{' '}
            · Enter = nova linha · Enter×2 = novo parágrafo
          </p>
        </div>
      </div>

      <div className="flex justify-end gap-3 pt-4 border-t border-zinc-100 dark:border-zinc-800/50 mt-4">
        <button onClick={onClose} disabled={isSaving} className="px-4 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-800 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors">
          Cancelar
        </button>
        <button onClick={() => onSave(form)} disabled={isSaving || !form.enunciado || !form.gabarito}
          className="flex items-center gap-2 px-5 py-2 text-sm font-semibold text-white bg-violet-600 hover:bg-violet-700 rounded-lg transition-colors disabled:opacity-50 shadow-sm">
          {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          Salvar Alterações
        </button>
      </div>
    </ModalShell>
  );
};

// ─── Insert Manually Modal ────────────────────────────────────────────────────

const InsertQuestaoModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { mutate: ingest, isPending, isSuccess, data: result } = useIngestQuestoes();
  const [tipo, setTipo] = useState<TipoQuestao>('multipla_escolha');
  const [form, setForm] = useState({
    banca: '', ano: '', cargo: '', materia: '',
    enunciado: '', alt_a: '', alt_b: '', alt_c: '', alt_d: '', alt_e: '',
    gabarito: '', comentario: '', dificuldade: 'media' as DificuldadeQuestao,
  });
  const [itens, setItens] = useState<{numero: string; enunciado: string; correto: boolean | null}[]>([
    {numero: 'I', enunciado: '', correto: null},
    {numero: 'II', enunciado: '', correto: null},
  ]);

  const field = 'w-full border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-800 dark:text-zinc-200 bg-white dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-violet-400 dark:focus:ring-violet-500/50 transition';
  const ta    = `${field} resize-y`;

  const handleSubmit = () => {
    const payload: Record<string, unknown> = {
      tipo, materia: form.materia, enunciado: form.enunciado,
      gabarito: form.gabarito, comentario: form.comentario, dificuldade: form.dificuldade,
    };
    if (form.banca) payload.banca = form.banca;
    if (form.ano)   payload.ano   = Number(form.ano);
    if (form.cargo) payload.cargo = form.cargo;
    if (tipo === 'multipla_escolha') {
      payload.alternativa_a = form.alt_a; payload.alternativa_b = form.alt_b;
      payload.alternativa_c = form.alt_c; payload.alternativa_d = form.alt_d;
      payload.alternativa_e = form.alt_e;
    } else if (tipo === 'combinacao_itens') {
      payload.itens = itens.filter(i => i.numero || i.enunciado);
    }
    ingest({ texto: JSON.stringify(payload), formato: 'json' });
  };

  if (isSuccess && result) {
    return (
      <ModalShell title="➕ Inserir Questão" onClose={onClose}>
        <div className="flex flex-col items-center gap-4 py-6">
          <CheckCircle2 size={48} className="text-emerald-500" />
          <p className="text-zinc-800 dark:text-zinc-200 font-semibold">Questão inserida com sucesso!</p>
          <button onClick={onClose} className="px-5 py-2 bg-violet-600 text-white text-sm font-semibold rounded-lg hover:bg-violet-700 transition-colors">Fechar</button>
        </div>
      </ModalShell>
    );
  }

  return (
    <ModalShell title="➕ Inserir Questão Manualmente" onClose={onClose} maxW="max-w-2xl">
      <div className="space-y-4 overflow-y-auto max-h-[65vh] pr-1">
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">Tipo *</label>
            <select className={field} value={tipo} onChange={(e) => setTipo(e.target.value as TipoQuestao)}>
              <option value="multipla_escolha">Múltipla Escolha</option>
              <option value="certo_errado">Certo/Errado</option>
              <option value="combinacao_itens">Combinação de Itens</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">Dificuldade</label>
            <select className={field} value={form.dificuldade} onChange={(e) => setForm(f => ({ ...f, dificuldade: e.target.value as DificuldadeQuestao }))}>
              <option value="facil">Fácil</option><option value="media">Média</option><option value="dificil">Difícil</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">Matéria</label>
            <input className={field} value={form.materia} onChange={(e) => setForm(f => ({ ...f, materia: e.target.value }))} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">Banca</label>
            <input className={field} value={form.banca} onChange={(e) => setForm(f => ({ ...f, banca: e.target.value }))} />
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">Enunciado *</label>
          <textarea rows={4} className={`${field} resize-y`} value={form.enunciado} onChange={(e) => setForm(f => ({ ...f, enunciado: e.target.value }))} />
        </div>

        {tipo === 'multipla_escolha' && (
          <div className="space-y-2">
            {(['a','b','c','d','e'] as const).map((l) => (
              <div key={l} className="flex items-start gap-2">
                <span className="mt-2 w-6 h-6 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 text-xs font-bold flex items-center justify-center shrink-0">{l.toUpperCase()}</span>
                <input className={`${field} flex-1`} placeholder={`Alternativa ${l.toUpperCase()}`}
                  value={form[`alt_${l}` as keyof typeof form]}
                  onChange={(e) => setForm(f => ({ ...f, [`alt_${l}`]: e.target.value }))} />
              </div>
            ))}
          </div>
        )}

        {tipo === 'combinacao_itens' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">Itens da Combinação</label>
              <button
                onClick={() => setItens(curr => [...curr, { numero: '', enunciado: '', correto: null }])}
                className="text-xs font-semibold text-violet-600 flex items-center gap-1 hover:text-violet-700"
              >
                <Plus size={12} /> Adicionar Item
              </button>
            </div>
            {itens.map((item, idx) => (
              <div key={idx} className="flex flex-col gap-2 bg-zinc-50 dark:bg-zinc-950 p-3 rounded-lg border border-zinc-200 dark:border-zinc-800 shadow-sm relative">
                <div className="flex gap-2 items-center justify-between">
                  <div className="flex items-center gap-2">
                    <input
                      className={`${field} w-20 text-center font-semibold`}
                      placeholder="Nº (I, II)"
                      value={item.numero}
                      onChange={(e) => {
                        const newItens = [...itens];
                        newItens[idx].numero = e.target.value;
                        setItens(newItens);
                      }}
                    />
                    <select
                      className={`${field} w-32`}
                      value={item.correto === true ? 'true' : item.correto === false ? 'false' : 'null'}
                      onChange={(e) => {
                        const v = e.target.value;
                        const newItens = [...itens];
                        newItens[idx].correto = v === 'true' ? true : v === 'false' ? false : null;
                        setItens(newItens);
                      }}
                    >
                      <option value="null">Neutro</option>
                      <option value="true">Certo</option>
                      <option value="false">Errado</option>
                    </select>
                  </div>
                  <button
                    onClick={() => {
                      const newItens = [...itens];
                      newItens.splice(idx, 1);
                      setItens(newItens);
                    }}
                    className="p-1.5 text-zinc-400 dark:text-zinc-500 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors"
                    title="Remover item"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
                <textarea
                  className={`${ta} w-full`}
                  rows={2}
                  placeholder="Enunciado do item"
                  value={item.enunciado}
                  onChange={(e) => {
                    const newItens = [...itens];
                    newItens[idx].enunciado = e.target.value;
                    setItens(newItens);
                  }}
                />
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">Gabarito *</label>
          <input className={field} value={form.gabarito} onChange={(e) => setForm(f => ({ ...f, gabarito: e.target.value }))} />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">Comentário</label>
          <textarea rows={2} className={`${field} resize-y`} value={form.comentario} onChange={(e) => setForm(f => ({ ...f, comentario: e.target.value }))} />
        </div>
      </div>

      <div className="flex justify-end gap-3 pt-4 border-t border-zinc-100 dark:border-zinc-800/50 mt-4">
        <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-800 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors">Cancelar</button>
        <button onClick={handleSubmit} disabled={isPending || !form.enunciado || !form.gabarito}
          className="flex items-center gap-2 px-5 py-2 text-sm font-semibold text-white bg-violet-600 hover:bg-violet-700 rounded-lg transition-colors disabled:opacity-50 shadow-sm">
          {isPending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          Inserir Questão
        </button>
      </div>
    </ModalShell>
  );
};

// ─── Ingest Modal ─────────────────────────────────────────────────────────────

const IngestModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { mutate: ingest, isPending, isSuccess, data: result, isError, reset } = useIngestQuestoes();
  const [texto, setTexto] = useState('');

  if (isSuccess && result) {
    return (
      <ModalShell title="⚡ Ingestão Inteligente via IA" onClose={onClose}>
        <div className="flex flex-col items-center gap-4 py-6 text-center">
          <CheckCircle2 size={48} className="text-emerald-500" />
          <div>
            <p className="text-lg font-bold text-zinc-900 dark:text-zinc-100">{result.criadas} questão{result.criadas !== 1 ? 'ões' : ''} inserida{result.criadas !== 1 ? 's' : ''}!</p>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">O banco foi atualizado com sucesso.</p>
          </div>
          <div className="flex gap-3">
            <button onClick={reset} className="px-4 py-2 text-sm font-medium border border-zinc-200 dark:border-zinc-800 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors text-zinc-600 dark:text-zinc-400">
              Inserir mais
            </button>
            <button onClick={onClose} className="px-5 py-2 bg-violet-600 text-white text-sm font-semibold rounded-lg hover:bg-violet-700 transition-colors">
              Fechar
            </button>
          </div>
        </div>
      </ModalShell>
    );
  }

  return (
    <ModalShell title="⚡ Ingestão Inteligente via IA" onClose={onClose} maxW="max-w-2xl">
      <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4">
        Cole o texto com uma ou mais questões (Markdown, PDF copiado, etc.). O Gemini irá parsear e estruturar automaticamente.
      </p>

      <textarea
        id="hub-ingest-textarea"
        rows={12}
        className="w-full border border-zinc-200 dark:border-zinc-800 rounded-xl px-4 py-3 text-sm text-zinc-800 dark:text-zinc-200 bg-zinc-50 dark:bg-zinc-950 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent transition resize-y font-mono"
        placeholder={"Exemplo:\n\nQuestão 1 (CESPE/2023 - Analista MPT)\nÉ vedado ao empregador reter a carteira de trabalho do empregado.\n\n( ) Certo  ( ) Errado\n\nGabarito: Certo\nComentário: Art. 29 da CLT..."}
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
      />

      {isError && (
        <div className="flex items-center gap-2 text-red-600 text-sm mt-2">
          <AlertCircle size={14} /> Falha ao processar. Verifique o texto e tente novamente.
        </div>
      )}

      <div className="flex justify-end gap-3 pt-4 border-t border-zinc-100 dark:border-zinc-800/50 mt-4">
        <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-800 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors">Cancelar</button>
        <button onClick={() => ingest({ texto, formato: 'markdown' })} disabled={isPending || texto.trim().length < 20}
          className="flex items-center gap-2 px-5 py-2 text-sm font-semibold text-white bg-amber-500 hover:bg-amber-600 rounded-lg transition-colors disabled:opacity-50 shadow-sm">
          {isPending ? <><Loader2 size={14} className="animate-spin" /> Processando...</> : <><Zap size={14} /> Processar com IA</>}
        </button>
      </div>
    </ModalShell>
  );
};

// ─── Modal Shell ──────────────────────────────────────────────────────────────

const ModalShell: React.FC<{
  title: string;
  onClose: () => void;
  maxW?: string;
  children: React.ReactNode;
}> = ({ title, onClose, maxW = 'max-w-lg', children }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/50 backdrop-blur-sm p-4" role="dialog" aria-modal>
    <div className={cn('bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl w-full flex flex-col', maxW)}>
      <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100 dark:border-zinc-800/50 shrink-0">
        <h3 className="font-bold text-zinc-900 dark:text-zinc-100 text-base">{title}</h3>
        <button onClick={onClose} className="p-1.5 text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"><X size={16} /></button>
      </div>
      <div className="p-6">{children}</div>
    </div>
  </div>
);

// ─── Shared loading / error blocks ───────────────────────────────────────────

const HubLoadingBlock: React.FC<{ text: string }> = ({ text }) => (
  <div className="flex flex-col items-center justify-center py-20 gap-3 text-zinc-400 dark:text-zinc-500">
    <Loader2 size={32} className="animate-spin text-violet-400" />
    <p className="text-sm font-medium">{text}</p>
  </div>
);

const HubErrorBlock: React.FC<{ message: string; onRetry: () => void }> = ({ message, onRetry }) => (
  <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
    <AlertCircle size={36} className="text-red-400" />
    <p className="text-zinc-700 dark:text-zinc-300 font-medium">{message}</p>
    <button onClick={onRetry} className="flex items-center gap-2 px-4 py-2 bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors text-sm font-medium">
      <RotateCcw size={14} /> Tentar novamente
    </button>
  </div>
);
