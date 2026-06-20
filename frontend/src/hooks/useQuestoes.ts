/**
 * useQuestoes.ts
 * ==============
 * Data-fetching hooks for the Banco de Questões management dashboard.
 *
 * Exports:
 *   useQuestoesPaginated  — paginated list with filters + search
 *   usePatchQuestao       — PATCH /{id} mutation
 *   useIngestQuestoes     — POST /ingest mutation (AI bulk ingestion)
 *   useCreateQuestao      — POST / mutation (manual creation)
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Questao, TipoQuestao, DificuldadeQuestao } from '../types';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface QuestoesFiltros {
  page?:        number;
  limit?:       number;
  materia?:     string;
  banca?:       string;
  tipo?:        TipoQuestao | '';
  dificuldade?: DificuldadeQuestao | '';
  search?:      string;
}

export interface PaginatedQuestoes {
  total: number;
  page:  number;
  limit: number;
  data:  Questao[];
}

export interface QuestaoItemInline {
  numero: string;
  enunciado: string;
  correto: boolean | null;
}

export interface QuestaoUpdatePayload {
  banca?:         string | null;
  ano?:           number | null;
  cargo?:         string | null;
  materia?:       string;
  tipo?:          TipoQuestao;
  enunciado?:     string;
  alternativa_a?: string | null;
  alternativa_b?: string | null;
  alternativa_c?: string | null;
  alternativa_d?: string | null;
  alternativa_e?: string | null;
  gabarito?:      string;
  comentario?:    string | null;
  dificuldade?:   DificuldadeQuestao;
  itens?:         QuestaoItemInline[];
}

export interface QuestaoCreatePayload extends QuestaoUpdatePayload {
  enunciado: string;
  gabarito:  string;
  tipo:      TipoQuestao;
}

export interface IngestPayload {
  texto:   string;
  formato: 'markdown' | 'json';
}

export interface IngestResult {
  criadas:  number;
  questoes: Questao[];
}

export interface GenerateFromDocumentPayload {
  documento_id: number;
  quantidade?:  number;
  dificuldade?: string;
}

export interface GeneratedQuestionsResult {
  criadas:  number;
  questoes: Questao[]; // This can be QuestaoComItens depending on the type
}

// ─── Query key factory ────────────────────────────────────────────────────────

export const questoesKeys = {
  all:      ['questoes'] as const,
  list:     (f: QuestoesFiltros) => ['questoes', 'list', f] as const,
  detail:   (id: string | number)         => ['questoes', 'detail', String(id)] as const,
};

// ─── useQuestoesPaginated ─────────────────────────────────────────────────────

export function useQuestoesPaginated(filtros: QuestoesFiltros = {}) {
  const params = new URLSearchParams();

  if (filtros.page)        params.set('page',        String(filtros.page));
  if (filtros.limit)       params.set('limit',       String(filtros.limit));
  if (filtros.materia)     params.set('materia',     filtros.materia);
  if (filtros.banca)       params.set('banca',       filtros.banca);
  if (filtros.tipo)        params.set('tipo',        filtros.tipo);
  if (filtros.dificuldade) params.set('dificuldade', filtros.dificuldade);
  if (filtros.search)      params.set('search',      filtros.search);

  return useQuery<PaginatedQuestoes>({
    queryKey: questoesKeys.list(filtros),
    queryFn:  () =>
      api.get<PaginatedQuestoes>(`/questoes?${params.toString()}`).then((r) => r.data),
    placeholderData: (prev) => prev, // keep previous data while refetching (smooth pagination)
  });
}

// ─── useQuestaoDetail ─────────────────────────────────────────────────────────

export function useQuestaoDetail(id: number | string | null) {
  return useQuery<Questao>({
    queryKey: questoesKeys.detail(id ?? ''),
    queryFn:  () => api.get<Questao>(`/questoes/${id}`).then((r) => r.data),
    enabled:  !!id,
  });
}

// ─── usePatchQuestao ──────────────────────────────────────────────────────────

export function usePatchQuestao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: QuestaoUpdatePayload }) =>
      api.patch<Questao>(`/questoes/${id}`, payload).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: questoesKeys.all });
    },
  });
}

// ─── useCreateQuestao ─────────────────────────────────────────────────────────

export function useCreateQuestao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: QuestaoCreatePayload) =>
      api.post<Questao>('/questoes/ingest', {
        // Wrap in the IngestPayload format — serialize to JSON for the AI to handle
        texto:   JSON.stringify(payload),
        formato: 'json',
      }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: questoesKeys.all });
    },
  });
}

// ─── useIngestQuestoes ────────────────────────────────────────────────────────

export function useIngestQuestoes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: IngestPayload) =>
      api.post<IngestResult>('/questoes/ingest', payload).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: questoesKeys.all });
    },
  });
}

// ─── useGenerateFromDocument ──────────────────────────────────────────────────

export function useGenerateFromDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: GenerateFromDocumentPayload) =>
      api.post<GeneratedQuestionsResult>('/questoes/generate-from-document', payload).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: questoesKeys.all });
    },
  });
}
