import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import { Anotacao } from '../types'

export const useAnotacoesByBloco = (blocoId: string | null) => {
  return useQuery({
    queryKey: ['anotacoes', 'bloco', blocoId],
    queryFn: async () => {
      const response = await api.get<Anotacao[]>(`/anotacoes/bloco/${blocoId}`)
      return response.data
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
    mutationFn: async ({ id, data }: { id: string; data: Partial<Anotacao> }) => {
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
    mutationFn: async ({ id }: { id: string; blocoId: string }) => {
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
    mutationFn: async (items: { id: string; ordem: number }[]) => {
      await api.post('/anotacoes/reorder', items)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['anotacoes'] })
    }
  })
}

