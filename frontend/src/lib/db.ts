import Dexie, { Table } from 'dexie';
import { Documento, Pasta, Anotacao, Questao, Bloco } from '../types';

export interface CacheEntry {
  key: string;
  data: any;
}

export interface PortalCacheEntry {
  id: string;
  data: any;
}

export class TaoDatabase extends Dexie {
  pastas!: Table<Pasta, string>;
  documentos!: Table<Documento, string>;
  blocos!: Table<Bloco, string>;
  anotacoes!: Table<Anotacao, string>;
  questoes!: Table<Questao, string>;
  cache!: Table<CacheEntry, string>;
  portals!: Table<PortalCacheEntry, string>;

  constructor() {
    super('TaoPwaDB');
    this.version(1).stores({
      pastas: 'id',
      documentos: 'id, pasta_id',
      blocos: 'id, documento_id',
      anotacoes: 'id, bloco_id',
      questoes: 'id, materia, banca'
    });
    this.version(2).stores({
      cache: 'key',
      portals: 'id'
    });
  }
}

export const db = new TaoDatabase();
