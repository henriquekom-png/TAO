import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import { Bloco } from '../types'

// ── Update (partial PATCH) ──────────────────────────────────────────────────
export const useUpdateBloco = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<Bloco> }) => {
      const response = await api.patch<Bloco>(`/blocos/${id}`, data)
      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documento'] })
    },
  })
}

// ── FSRS review ─────────────────────────────────────────────────────────────
export const useReviewBloco = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, grade }: { id: number; grade: string | number }) => {
      const response = await api.post(`/review/${id}`, { grade })
      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dueBlocos'] })
      queryClient.invalidateQueries({ queryKey: ['documento'] })
    }
  })
}

// ── Drag-and-drop reorder ───────────────────────────────────────────────────
export const useReorderBlocos = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (items: { id: number; ordem: number }[]) => {
      await api.post('/blocos/reorder', items)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documento'] })
    }
  })
}

// ── Delete ──────────────────────────────────────────────────────────────────
export const useDeleteBloco = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => {
      await api.delete(`/blocos/${id}`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documento'] })
    }
  })
}

// ── Create single bloco ─────────────────────────────────────────────────────
export const useCreateBloco = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: {
      documento_id: number
      conteudo?: string
      ordem: number
      tipo?: string
    }) => {
      // 1. Shift all blocos at or after the target ordem up by 1
      await api.post('/blocos/shift-ordem', {
        documento_id: payload.documento_id,
        from_ordem: payload.ordem,
      })
      // 2. Insert the new bloco at that now-vacant slot
      const response = await api.post<Bloco>('/blocos/', {
        documento_id: payload.documento_id,
        conteudo: payload.conteudo ?? '',
        ordem: payload.ordem,
        tipo: payload.tipo ?? 'texto_livre',
        importancia: 'normal',
        cor_fonte: 'preto',
        alinhamento: 'justificado',
        revisado: false,
      })
      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documento'] })
    }
  })
}

// ── Bulk create from importer ───────────────────────────────────────────────
export const useBulkCreateBlocos = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (items: {
      documento_id: number
      conteudo: string
      ordem: number
      tipo?: string
    }[]) => {
      const response = await api.post<Bloco[]>('/blocos/bulk', items)
      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documento'] })
    }
  })
}
