import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { api } from '../api/client'
import { Documento } from '../types'
import { db } from '../lib/db'

export const useDocumento = (documentId: number | null) => {
  return useQuery({
    queryKey: ['documento', documentId],
    queryFn: async () => {
      try {
        const response = await api.get<Documento>(`/documentos/${documentId}`)
        await db.documentos.put(response.data)
        return response.data
      } catch (error) {
        if (!documentId) throw error
        const doc = await db.documentos.get(String(documentId))
        if (doc) return doc
        // Also try number in case types are mixed
        const docNum = await db.documentos.get(documentId as any)
        if (docNum) return docNum
        throw error
      }
    },
    enabled: !!documentId,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  })
}

export const useDocumentosByPasta = (pastaId: number | null, enabled: boolean = true) => {
  return useQuery({
    queryKey: ['documentos', 'pasta', pastaId],
    queryFn: async () => {
      try {
        const response = await api.get<Documento[]>(`/documentos/pasta/${pastaId}`)
        await db.documentos.bulkPut(response.data)
        return response.data
      } catch (error) {
        if (!pastaId) throw error
        let docs = await db.documentos.where('pasta_id').equals(pastaId).toArray()
        if (docs.length === 0) {
           docs = await db.documentos.where('pasta_id').equals(String(pastaId)).toArray()
        }
        if (docs.length > 0) return docs
        throw error
      }
    },
    enabled: !!pastaId && enabled,
  })
}

export const useCreateDocumento = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: {
      titulo: string
      pasta_id: number
      descricao?: string
      ordem?: number
    }) => {
      const response = await api.post<Documento>('/documentos/', {
        titulo: payload.titulo,
        pasta_id: payload.pasta_id,
        descricao: payload.descricao ?? null,
        ordem: payload.ordem ?? 0,
      })
      return response.data
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['documentos', 'pasta', data.pasta_id] })
      queryClient.invalidateQueries({ queryKey: ['pastas'] })
    },
  })
}

// ── Rename ──────────────────────────────────────────────────────────────────
export const useRenameDocumento = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, titulo }: { id: number; titulo: string }) => {
      const response = await api.patch<Documento>(`/documentos/${id}`, { titulo })
      return response.data
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['documentos', 'pasta', data.pasta_id] })
      queryClient.invalidateQueries({ queryKey: ['documento', data.id] })
    },
  })
}

// ── Move to another pasta ────────────────────────────────────────────────────
export const useMoveDocumento = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      pasta_id,
      ordem,
      source_pasta_id,
    }: {
      id: number
      pasta_id: number
      ordem?: number
      source_pasta_id?: number
    }) => {
      const response = await api.patch<Documento>(`/documentos/${id}`, {
        pasta_id,
        ...(ordem !== undefined ? { ordem } : {}),
      })
      return { doc: response.data, source_pasta_id }
    },
    onMutate: async ({ id, pasta_id, ordem, source_pasta_id }) => {
      await queryClient.cancelQueries({ queryKey: ['documentos', 'pasta', source_pasta_id] })
      if (pasta_id !== source_pasta_id) {
        await queryClient.cancelQueries({ queryKey: ['documentos', 'pasta', pasta_id] })
      }

      const previousSourceDocs = queryClient.getQueryData<Documento[]>(['documentos', 'pasta', source_pasta_id])
      const previousTargetDocs = pasta_id !== source_pasta_id
        ? queryClient.getQueryData<Documento[]>(['documentos', 'pasta', pasta_id])
        : previousSourceDocs

      if (previousSourceDocs) {
        const movedDoc = previousSourceDocs.find(d => d.id === id) || ({
          id,
          pasta_id,
          titulo: 'Carregando...',
          descricao: null,
          ordem: ordem ?? 0,
          criado_em: new Date().toISOString(),
          atualizado_em: new Date().toISOString(),
        } as Documento)

        const updatedMovedDoc = { ...movedDoc, pasta_id, ordem: ordem ?? movedDoc.ordem }

        if (source_pasta_id && source_pasta_id !== pasta_id) {
          queryClient.setQueryData(
            ['documentos', 'pasta', source_pasta_id],
            previousSourceDocs.filter(d => d.id !== id)
          )
          if (previousTargetDocs) {
            const nextDocs = [...previousTargetDocs.filter(d => d.id !== id), updatedMovedDoc]
            nextDocs.sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0))
            queryClient.setQueryData(['documentos', 'pasta', pasta_id], nextDocs)
          }
        } else {
          const nextDocs = previousSourceDocs.map(d => d.id === id ? updatedMovedDoc : d)
          nextDocs.sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0))
          queryClient.setQueryData(['documentos', 'pasta', source_pasta_id], nextDocs)
        }
      }

      return { previousSourceDocs, previousTargetDocs, source_pasta_id, pasta_id }
    },
    onError: (err, _variables, context) => {
      console.error('API Error moving document:', err)
      if (context) {
        if (context.source_pasta_id && context.previousSourceDocs) {
          queryClient.setQueryData(['documentos', 'pasta', context.source_pasta_id], context.previousSourceDocs)
        }
        if (context.pasta_id && context.previousTargetDocs) {
          queryClient.setQueryData(['documentos', 'pasta', context.pasta_id], context.previousTargetDocs)
        }
      }
    },
    onSuccess: ({ doc, source_pasta_id }) => {
      queryClient.invalidateQueries({ queryKey: ['documentos', 'pasta', doc.pasta_id] })
      if (source_pasta_id && source_pasta_id !== doc.pasta_id) {
        queryClient.invalidateQueries({ queryKey: ['documentos', 'pasta', source_pasta_id] })
      }
      queryClient.invalidateQueries({ queryKey: ['pastas'] })
      queryClient.setQueryData(['documento', doc.id], (old: Documento | undefined) =>
        old ? { ...old, pasta_id: doc.pasta_id, ordem: doc.ordem } : old
      )
    },
  })
}

// ── Reorder within the same pasta ────────────────────────────────────────────
export const useReorderDocumento = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ordem, pasta_id }: { id: number; ordem: number; pasta_id: number }) => {
      const response = await api.patch<Documento>(`/documentos/${id}`, { ordem })
      return { doc: response.data, pasta_id }
    },
    onMutate: async ({ id, ordem, pasta_id }) => {
      await queryClient.cancelQueries({ queryKey: ['documentos', 'pasta', pasta_id] })
      const previousDocs = queryClient.getQueryData<Documento[]>(['documentos', 'pasta', pasta_id])

      if (previousDocs) {
        const nextDocs = previousDocs.map(d => d.id === id ? { ...d, ordem } : d)
        nextDocs.sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0))
        queryClient.setQueryData(['documentos', 'pasta', pasta_id], nextDocs)
      }

      return { previousDocs, pasta_id }
    },
    onError: (err, _variables, context) => {
      console.error('API Error reordering document:', err)
      if (context?.previousDocs && context?.pasta_id) {
        queryClient.setQueryData(['documentos', 'pasta', context.pasta_id], context.previousDocs)
      }
    },
    onSuccess: ({ pasta_id }) => {
      queryClient.invalidateQueries({ queryKey: ['documentos', 'pasta', pasta_id] })
      queryClient.invalidateQueries({ queryKey: ['pastas'] })
    },
  })
}

