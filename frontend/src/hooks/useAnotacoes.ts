import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import { Anotacao } from '../types'
import { db } from '../lib/db'

export const useAnotacoesByBloco = (blocoId: number | null) => {
  return useQuery({
    queryKey: ['anotacoes', 'bloco', blocoId],
    queryFn: async () => {
      try {
        const response = await api.get<Anotacao[]>(`/anotacoes/bloco/${blocoId}`)
        await db.anotacoes.bulkPut(response.data)
        return response.data
      } catch (error) {
        if (!blocoId) throw error
        let anotacoes = await db.anotacoes.where('bloco_id').equals(blocoId).toArray()
        if (anotacoes.length === 0) {
          anotacoes = await db.anotacoes.where('bloco_id').equals(String(blocoId)).toArray()
        }
        if (anotacoes.length > 0) return anotacoes
        throw error
      }
    },
    enabled: !!blocoId,
  })
}

export const useCreateAnotacao = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (data: Partial<Anotacao>) => {
      const response = await api.post<Anotacao>('/anotacoes/', data)
      return response.data
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['anotacoes', 'bloco', variables.bloco_id] })
    }
  })
}

export const useUpdateAnotacao = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<Anotacao> }) => {
      const response = await api.patch<Anotacao>(`/anotacoes/${id}`, data)
      return response.data
    },
    onSuccess: (data) => {
      queryClient.setQueryData<Anotacao[]>(
        ['anotacoes', 'bloco', data.bloco_id],
        (old) => old ? old.map((a) => a.id === data.id ? { ...a, ...data } : a) : []
      )
      queryClient.invalidateQueries({ queryKey: ['anotacoes', 'bloco', data.bloco_id] })
      queryClient.invalidateQueries({ queryKey: ['portals', 'resolve'] })
    }
  })
}

export const useDeleteAnotacao = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id }: { id: number; blocoId: number }) => {
      await api.delete(`/anotacoes/${id}`)
    },
    onSuccess: (_, variables) => {
      queryClient.setQueryData<Anotacao[]>(
        ['anotacoes', 'bloco', variables.blocoId],
        (old) => old ? old.filter((a) => a.id !== variables.id) : []
      )
      queryClient.invalidateQueries({ queryKey: ['anotacoes', 'bloco', variables.blocoId] })
      queryClient.invalidateQueries({ queryKey: ['portals', 'resolve'] })
    }
  })
}

export const useReorderAnotacoes = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (items: { id: number; ordem: number }[]) => {
      await api.post('/anotacoes/reorder', items)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['anotacoes'] })
    }
  })
}

