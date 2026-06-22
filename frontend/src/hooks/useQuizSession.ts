/**
 * useQuizSession
 * ==============
 * Custom hook that manages the complete state machine for a quiz session.
 *
 * State:
 *   questionsArray   – questions fetched from GET /api/v1/quiz/session
 *   currentIndex     – index of the question currently being displayed
 *   selectedAnswer   – the answer chosen by the user (string | null)
 *   itemAnswers      – Record<itemId, boolean> for combinacao_itens judgment
 *   isSubmitted      – true after the user has confirmed their answer
 *   score            – { acertos, total } accumulated over the session
 *   isLoading        – true while fetching session questions
 *   isFinished       – true when the user has answered all questions
 *   error            – error message if the fetch failed
 *
 * Actions:
 *   startSession(params)          – fetch questions and reset state
 *   selectAnswer(answer)          – set selectedAnswer (blocked after isSubmitted)
 *   toggleItemAnswer(id, value)   – set a V/F verdict for a combinacao_itens item
 *   submitAnswer()                – validate, update score, fire-and-forget POST /results
 *   nextQuestion()                – advance index or set isFinished
 *   resetSession()                – wipe all state (go back to setup screen)
 */

import { useCallback, useState } from 'react';
import { api } from '../api/client';
import type { Questao, QuizScore, QuizSessionParams } from '../types';

// ─── Types ───────────────────────────────────────────────────────────────────

interface QuizSessionState {
  questionsArray: Questao[];
  currentIndex: number;
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
  resetSession: () => void;
  markQuestionAsSaved: (oldId: number | string, savedQuestion: Questao) => void;
}

export type UseQuizSessionReturn = QuizSessionState & QuizSessionActions;

// ─── Initial state ────────────────────────────────────────────────────────────

const INITIAL_STATE: QuizSessionState = {
  questionsArray: [],
  currentIndex: 0,
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
      if (nextIndex >= prev.questionsArray.length) {
        return { ...prev, isFinished: true };
      }
      return {
        ...prev,
        currentIndex: nextIndex,
        selectedAnswer: null,
        itemAnswers: {},
        isSubmitted: false,
      };
    });
  }, []);

  // ── skipQuestion ────────────────────────────────────────────────────────────
  const skipQuestion = useCallback(() => {
    setState((prev) => {
      if (prev.isSubmitted) return prev;

      const newQuestionsArray = prev.questionsArray.filter((_, idx) => idx !== prev.currentIndex);
      
      if (prev.currentIndex >= newQuestionsArray.length) {
        return {
           ...prev,
           questionsArray: newQuestionsArray,
           isFinished: true,
        };
      }

      return {
        ...prev,
        questionsArray: newQuestionsArray,
        selectedAnswer: null,
        itemAnswers: {},
        isSubmitted: false,
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

  return {
    ...state,
    startSession,
    initSessionWithQuestions,
    selectAnswer,
    toggleItemAnswer,
    submitAnswer,
    nextQuestion,
    skipQuestion,
    resetSession,
    markQuestionAsSaved,
  };
}
