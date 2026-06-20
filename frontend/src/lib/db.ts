import Dexie, { Table } from 'dexie';
import { Documento, Pasta, Anotacao, Questao, Bloco } from '../types';

export class TaoDatabase extends Dexie {
  pastas!: Table<Pasta, string>;
  documentos!: Table<Documento, string>;
  blocos!: Table<Bloco, string>;
  anotacoes!: Table<Anotacao, string>;
  questoes!: Table<Questao, string>;

  constructor() {
    super('TaoPwaDB');
    this.version(1).stores({
      pastas: 'id',
      documentos: 'id, pasta_id',
      blocos: 'id, documento_id',
      anotacoes: 'id, bloco_id',
      questoes: 'id, materia, banca'
    });
  }
}

export const db = new TaoDatabase();
