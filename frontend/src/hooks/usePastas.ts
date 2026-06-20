import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import { Pasta } from '../types'

// ── Tree ────────────────────────────────────────────────────────────────────
export const usePastasTree = () => {
  return useQuery({
    queryKey: ['pastas', 'tree'],
    queryFn: async () => {
      try {
        const response = await api.get<Pasta>('/pastas/tree')
        localStorage.setItem('tao_pastas_tree', JSON.stringify(response.data))
        return response.data
      } catch (error) {
        const cache = localStorage.getItem('tao_pastas_tree')
        if (cache) return JSON.parse(cache)
        throw error
      }
    },
  })
}

// ── Create ──────────────────────────────────────────────────────────────────
export const useCreatePasta = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: {
      nome: string
      parent_id?: number | null
      nivel?: number
      ordem?: number
    }) => {
      const response = await api.post<Pasta>('/pastas/', {
        nome: payload.nome,
        parent_id: payload.parent_id ?? null,
        nivel: payload.nivel ?? 0,
        ordem: payload.ordem ?? 0,
      })
      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pastas'] })
    },
  })
}

// ── Rename ───────────────────────────────────────────────────────────────────
export const useRenamePasta = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, nome }: { id: number; nome: string }) => {
      const response = await api.patch<Pasta>(`/pastas/${id}`, { nome })
      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pastas'] })
    },
  })
}

// Helper to recursively move a folder within the tree structure in client-side cache
function movePastaInTree(tree: Pasta[] | Pasta, id: number, parentId: number | null, nivel: number, ordem?: number): Pasta[] | Pasta {
  let foundNode: Pasta | null = null

  function removeNode(nodes: Pasta[]): Pasta[] {
    const idx = nodes.findIndex(n => n.id === id)
    if (idx !== -1) {
      foundNode = nodes[idx]
      return nodes.filter(n => n.id !== id)
    }
    return nodes.map(n => {
      if (n.children && n.children.length > 0) {
        return { ...n, children: removeNode(n.children) }
      }
      return n
    })
  }

  function insertNode(nodes: Pasta[]): Pasta[] {
    if (parentId === null) {
      if (foundNode) {
        const newNode = { ...foundNode, parent_id: null, nivel, ...(ordem !== undefined ? { ordem } : {}) }
        const nextNodes = [...nodes, newNode]
        nextNodes.sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0))
        return nextNodes
      }
      return nodes
    }

    return nodes.map(n => {
      if (n.id === parentId) {
        const children = n.children ? [...n.children] : []
        if (foundNode) {
          const newNode = { ...foundNode, parent_id: parentId, nivel, ...(ordem !== undefined ? { ordem } : {}) }
          const nextChildren = [...children.filter(c => c.id !== id), newNode]
          nextChildren.sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0))
          return { ...n, children: nextChildren }
        }
      }
      if (n.children && n.children.length > 0) {
        return { ...n, children: insertNode(n.children) }
      }
      return n
    })
  }

  let nodesList = Array.isArray(tree) ? [...tree] : [tree]
  nodesList = removeNode(nodesList)
  nodesList = insertNode(nodesList)

  return Array.isArray(tree) ? nodesList : nodesList[0]
}

// ── Move (re-parent) ─────────────────────────────────────────────────────────
export const useMovePasta = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      parent_id,
      nivel,
      ordem,
    }: {
      id: number
      parent_id: number | null
      nivel: number
      ordem?: number
    }) => {
      const response = await api.patch<Pasta>(`/pastas/${id}`, {
        parent_id,
        nivel,
        ...(ordem !== undefined ? { ordem } : {}),
      })
      return response.data
    },
    onMutate: async ({ id, parent_id, nivel, ordem }) => {
      await queryClient.cancelQueries({ queryKey: ['pastas', 'tree'] })
      const previousTree = queryClient.getQueryData<Pasta[] | Pasta>(['pastas', 'tree'])

      if (previousTree) {
        const newTree = movePastaInTree(previousTree, id, parent_id, nivel, ordem)
        queryClient.setQueryData(['pastas', 'tree'], newTree)
      }

      return { previousTree }
    },
    onError: (err, _variables, context) => {
      console.error('API Error moving folder:', err)
      if (context?.previousTree) {
        queryClient.setQueryData(['pastas', 'tree'], context.previousTree)
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pastas'] })
    },
  })
}

// ── Delete ──────────────────────────────────────────────────────────────────
export const useDeletePasta = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => {
      await api.delete(`/pastas/${id}`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pastas'] })
      queryClient.invalidateQueries({ queryKey: ['documentos'] })
    },
  })
}
