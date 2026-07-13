import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { db } from '../lib/db';

export interface PortalNestedAnotacao {
  id: number;
  tipo: string;
  conteudo: string;
  ordem: number;
}

export interface ResolvedPortal {
  kind: 'anotacao' | 'bloco';
  id: number;
  conteudo: string;
  bloco_id: number;
  documento_id: number;
  pasta_id: number;
  documento_titulo: string;
  identificador: string | null;
  pasta_path: number[];
  anotacoes: PortalNestedAnotacao[];
  found: boolean;
}

export interface PortalNavigationTarget {
  pastaPath: number[];
  docId: number;
  blocoId: number;
}

export const useResolvePortals = (ids: string[]) => {
  const sortedKey = [...ids].sort().join(',');

  return useQuery({
    queryKey: ['portals', 'resolve', sortedKey],
    queryFn: async () => {
      try {
        const response = await api.post<{ resolved: Record<string, ResolvedPortal> }>(
          '/nodes/resolve-portals',
          { ids }
        );
        const resolved = response.data.resolved;
        // Save each resolved portal individually to IndexedDB
        const entries = Object.entries(resolved).map(([id, data]) => ({ id, data }));
        if (entries.length > 0) {
          await db.portals.bulkPut(entries);
        }
        return resolved;
      } catch (error) {
        // Attempt recovery from IndexedDB
        const result: Record<string, ResolvedPortal> = {};
        for (const id of ids) {
          const cached = await db.portals.get(id);
          if (cached) result[id] = cached.data as ResolvedPortal;
        }
        if (Object.keys(result).length > 0) return result;
        throw error;
      }
    },
    enabled: ids.length > 0,
    staleTime: 30_000,
  });
};

export function portalToNavTarget(portal: ResolvedPortal): PortalNavigationTarget {
  return {
    pastaPath: portal.pasta_path,
    docId: portal.documento_id,
    blocoId: portal.bloco_id,
  };
}
