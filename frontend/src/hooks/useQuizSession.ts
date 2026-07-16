/**
 * useQuizSession
 * ==============
 * Custom hook that manages the complete state machine for a quiz session.
 *
 * State:
 *   questionsArray    – questions fetched from GET /api/v1/quiz/session
 *   currentIndex      – index of the question currently being displayed
 *   visitedHistory    – stack of previously-visited indices (enables "go back")
 *   answeredQuestions – per-question answer state (preserved when navigating back)
 *   selectedAnswer    – the answer chosen by the user (string | null)
 *   itemAnswers       – Record<itemId, boolean> for combinacao_itens judgment
 *   isSubmitted       – true after the user has confirmed their answer
 *   score             – { acertos, total } accumulated over the session
 *   isLoading         – true while fetching session questions
 *   isFinished        – true when the user has answered all questions
 *   error             – error message if the fetch failed
 *
 * Actions:
 *   startSession(params)          – fetch questions and reset state
 *   initSessionWithQuestions(qs)  – initialize from a pre-loaded list
 *   selectAnswer(answer)          – set selectedAnswer (blocked after isSubmitted)
 *   toggleItemAnswer(id, value)   – set a V/F verdict for a combinacao_itens item
 *   submitAnswer()                – validate, update score, fire-and-forget POST /results
 *   nextQuestion()                – advance index or set isFinished (saves history)
 *   skipQuestion()                – skip current (unanswered) question (saves history)
 *   goToPrevious()                – go back to the last visited question
 *   resetSession()                – wipe all state (go back to setup screen)
 *   markQuestionAsSaved(oldId, q) – replace an unsaved question with its saved version
 *   updateQuestionInSession(q)    – replace a question after editing (keeps same ID)
 */

import { useCallback, useState } from 'react';
import { api } from '../api/client';
import type { Questao, QuizScore, QuizSessionParams } from '../types';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Snapshot of the answer state for a single question. */
interface PerQuestionState {
  selectedAnswer: string | null;
  itemAnswers: Record<number, boolean>;
  isSubmitted: boolean;
}

interface QuizSessionState {
  questionsArray: Questao[];
  currentIndex: number;
  /** Stack of previously-visited indices — enables "go back". */
  visitedHistory: number[];
  /** Saved answer state per question index, so navigation back restores it. */
  answeredQuestions: Record<number, PerQuestionState>;
  selectedAnswer: string | null;
  /** For combinacao_itens: maps item.id → user's boolean verdict */
  itemAnswers: Record<number, boolean>;
  isSubmitted: boolean;
  score: QuizScore;
  isLoading: boolean;
  isFinished: boolean;
  error: string | null;
}

interface QuizSessionActions {
  startSession: (params: QuizSessionParams) => Promise<void>;
  initSessionWithQuestions: (questions: Questao[]) => void;
  selectAnswer: (answer: string) => void;
  toggleItemAnswer: (itemId: number, value: boolean) => void;
  submitAnswer: () => void;
  nextQuestion: () => void;
  skipQuestion: () => void;
  goToPrevious: () => void;
  resetSession: () => void;
  markQuestionAsSaved: (oldId: number | string, savedQuestion: Questao) => void;
  updateQuestionInSession: (updatedQuestion: Questao) => void;
}

export type UseQuizSessionReturn = QuizSessionState & QuizSessionActions;

// ─── Initial state ────────────────────────────────────────────────────────────

const INITIAL_STATE: QuizSessionState = {
  questionsArray: [],
  currentIndex: 0,
  visitedHistory: [],
  answeredQuestions: {},
  selectedAnswer: null,
  itemAnswers: {},
  isSubmitted: false,
  score: { acertos: 0, total: 0 },
  isLoading: false,
  isFinished: false,
  error: null,
};

// ─── Gabarito validation helpers ──────────────────────────────────────────────

/**
 * Returns true if the user answered correctly for the current question type.
 *
 * - multipla_escolha: selectedAnswer must match gabarito letter (case-insensitive)
 * - certo_errado:     selectedAnswer must match gabarito (case-insensitive)
 * - combinacao_itens: each item's user verdict (itemAnswers[id]) must match item.correto
 *                     The gabarito field is used as a display label only in this case.
 */
function evaluateAnswer(
  question: Questao,
  selectedAnswer: string | null,
  itemAnswers: Record<number, boolean>,
): boolean {
  if (question.tipo === 'combinacao_itens') {
    const itens = question.itens ?? [];
    if (itens.length === 0) return false;
    return itens.every((item) => {
      if (item.correto === null) return true; // ungabarited item — skip
      return itemAnswers[item.id] === item.correto;
    });
  }
  // multipla_escolha | certo_errado
  if (!selectedAnswer) return false;
  return selectedAnswer.trim().toUpperCase() === question.gabarito.trim().toUpperCase();
}

// ─── Helper: capture current answer state ────────────────────────────────────

function captureCurrentState(prev: QuizSessionState): PerQuestionState {
  return {
    selectedAnswer: prev.selectedAnswer,
    itemAnswers: prev.itemAnswers,
    isSubmitted: prev.isSubmitted,
  };
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useQuizSession(): UseQuizSessionReturn {
  const [state, setState] = useState<QuizSessionState>(INITIAL_STATE);

  // ── startSession ────────────────────────────────────────────────────────────
  const startSession = useCallback(async (params: QuizSessionParams) => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    try {
      const searchParams = new URLSearchParams();
      if (params.materia)    searchParams.set('materia',    params.materia);
      if (params.banca)      searchParams.set('banca',      params.banca);
      if (params.ano)        searchParams.set('ano',        String(params.ano));
      if (params.cargo)      searchParams.set('cargo',      params.cargo);
      if (params.dificuldade) searchParams.set('dificuldade', params.dificuldade);
      if (params.limit)      searchParams.set('limit',      String(params.limit));

      const res = await api.get<Questao[]>(`/quiz/session?${searchParams.toString()}`);
      const questions = res.data;

      if (!questions.length) {
        setState((prev) => ({
          ...prev,
          isLoading: false,
          error: 'Nenhuma questão encontrada com os filtros selecionados.',
        }));
        return;
      }

      setState({
        ...INITIAL_STATE,
        questionsArray: questions,
        isLoading: false,
      });
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Erro ao carregar questões. Tente novamente.';
      setState((prev) => ({ ...prev, isLoading: false, error: message }));
    }
  }, []);

  // ── initSessionWithQuestions ────────────────────────────────────────────────
  const initSessionWithQuestions = useCallback((questions: Questao[]) => {
    setState({
      ...INITIAL_STATE,
      questionsArray: questions,
      isLoading: false,
    });
  }, []);

  // ── selectAnswer ────────────────────────────────────────────────────────────
  const selectAnswer = useCallback((answer: string) => {
    setState((prev) => {
      if (prev.isSubmitted) return prev;
      return { ...prev, selectedAnswer: answer };
    });
  }, []);

  // ── toggleItemAnswer ────────────────────────────────────────────────────────
  const toggleItemAnswer = useCallback((itemId: number, value: boolean) => {
    setState((prev) => {
      if (prev.isSubmitted) return prev;
      return {
        ...prev,
        itemAnswers: { ...prev.itemAnswers, [itemId]: value },
      };
    });
  }, []);

  // ── submitAnswer ────────────────────────────────────────────────────────────
  const submitAnswer = useCallback(() => {
    setState((prev) => {
      if (prev.isSubmitted) return prev;

      const question = prev.questionsArray[prev.currentIndex];
      if (!question) return prev;

      const acertou = evaluateAnswer(question, prev.selectedAnswer, prev.itemAnswers);

      // Fire-and-forget: record result asynchronously without blocking UI
      api
        .post('/quiz/results', { questao_id: question.id, acertou })
        .catch((err) => console.warn('[useQuizSession] Failed to record result:', err));

      return {
        ...prev,
        isSubmitted: true,
        score: {
          acertos: prev.score.acertos + (acertou ? 1 : 0),
          total: prev.score.total + 1,
        },
      };
    });
  }, []);

  // ── nextQuestion ────────────────────────────────────────────────────────────
  const nextQuestion = useCallback(() => {
    setState((prev) => {
      const nextIndex = prev.currentIndex + 1;
      const isFinished = nextIndex >= prev.questionsArray.length;

      // Save the current question's answer state before moving away
      const answeredQuestions: Record<number, PerQuestionState> = {
        ...prev.answeredQuestions,
        [prev.currentIndex]: captureCurrentState(prev),
      };

      if (isFinished) {
        return { ...prev, answeredQuestions, isFinished: true };
      }

      // Load the next question's saved state (if it was previously visited)
      const nextState = prev.answeredQuestions[nextIndex] ?? {
        selectedAnswer: null,
        itemAnswers: {},
        isSubmitted: false,
      };

      return {
        ...prev,
        visitedHistory: [...prev.visitedHistory, prev.currentIndex],
        answeredQuestions,
        currentIndex: nextIndex,
        selectedAnswer: nextState.selectedAnswer,
        itemAnswers: nextState.itemAnswers,
        isSubmitted: nextState.isSubmitted,
      };
    });
  }, []);

  // ── skipQuestion ────────────────────────────────────────────────────────────
  // No longer removes the question from the array. Instead, simply advances
  // the index and records the history so the user can come back.
  const skipQuestion = useCallback(() => {
    setState((prev) => {
      // Can only skip unanswered questions
      if (prev.isSubmitted) return prev;

      const nextIndex = prev.currentIndex + 1;
      const isFinished = nextIndex >= prev.questionsArray.length;

      if (isFinished) {
        return {
          ...prev,
          visitedHistory: [...prev.visitedHistory, prev.currentIndex],
          isFinished: true,
        };
      }

      // Load the next question's saved state (if it was previously visited)
      const nextState = prev.answeredQuestions[nextIndex] ?? {
        selectedAnswer: null,
        itemAnswers: {},
        isSubmitted: false,
      };

      return {
        ...prev,
        visitedHistory: [...prev.visitedHistory, prev.currentIndex],
        currentIndex: nextIndex,
        selectedAnswer: nextState.selectedAnswer,
        itemAnswers: nextState.itemAnswers,
        isSubmitted: nextState.isSubmitted,
      };
    });
  }, []);

  // ── goToPrevious ─────────────────────────────────────────────────────────
  const goToPrevious = useCallback(() => {
    setState((prev) => {
      if (prev.visitedHistory.length === 0) return prev;

      const history = [...prev.visitedHistory];
      const prevIndex = history.pop()!;

      // Save current question's state before leaving
      const answeredQuestions: Record<number, PerQuestionState> = {
        ...prev.answeredQuestions,
        [prev.currentIndex]: captureCurrentState(prev),
      };

      // Restore the previous question's saved state
      const restoredState = answeredQuestions[prevIndex] ?? {
        selectedAnswer: null,
        itemAnswers: {},
        isSubmitted: false,
      };

      return {
        ...prev,
        visitedHistory: history,
        answeredQuestions,
        currentIndex: prevIndex,
        isFinished: false,
        selectedAnswer: restoredState.selectedAnswer,
        itemAnswers: restoredState.itemAnswers,
        isSubmitted: restoredState.isSubmitted,
      };
    });
  }, []);

  // ── resetSession ────────────────────────────────────────────────────────────
  const resetSession = useCallback(() => {
    setState(INITIAL_STATE);
  }, []);

  // ── markQuestionAsSaved ───────────────────────────────────────────────────
  const markQuestionAsSaved = useCallback((oldId: number | string, savedQuestion: Questao) => {
    setState((prev) => {
      const newQuestionsArray = prev.questionsArray.map((q) =>
        String(q.id) === String(oldId) ? savedQuestion : q
      );
      return { ...prev, questionsArray: newQuestionsArray };
    });
  }, []);

  // ── updateQuestionInSession ───────────────────────────────────────────────
  // Replaces a question in the session after it has been edited (keeps same ID).
  const updateQuestionInSession = useCallback((updatedQuestion: Questao) => {
    setState((prev) => {
      const newQuestionsArray = prev.questionsArray.map((q) =>
        String(q.id) === String(updatedQuestion.id) ? updatedQuestion : q
      );
      return { ...prev, questionsArray: newQuestionsArray };
    });
  }, []);

  return {
    ...state,
    startSession,
    initSessionWithQuestions,
    selectAnswer,
    toggleItemAnswer,
    submitAnswer,
    nextQuestion,
    skipQuestion,
    goToPrevious,
    resetSession,
    markQuestionAsSaved,
    updateQuestionInSession,
  };
}
