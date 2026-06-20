// Base Types mirroring backend Pydantic models

export interface Pasta {
  id: number;
  nome: string;
  parent_id: number | null;
  nivel: number;
  ordem: number;
  criado_em: string;
  children?: Pasta[];
}

export interface Documento {
  id: number;
  pasta_id: number;
  titulo: string;
  descricao: string | null;
  ordem: number;
  criado_em: string;
  atualizado_em: string;
  blocos?: Bloco[];
}

export type TipoBloco = 'texto' | 'questao' | 'imagem' | 'video' | 'pdf' | 'audio' | 'vazio';
export type Importancia = 'normal' | 'importante' | 'vital';
export type CorFonte = 'padrao' | 'vermelho' | 'verde' | 'azul' | 'destaque';
export type Alinhamento = 'esquerda' | 'centro' | 'direita' | 'justificado';

export interface Bloco {
  id: number;
  documento_id: number;
  tipo: TipoBloco;
  identificador: string | null;
  conteudo: string;
  ordem: number;
  importancia: Importancia;
  cor_fonte: CorFonte;
  alinhamento: Alinhamento;
  revisado: boolean;
  last_review: string | null;
  next_review: string | null;
  stability: number;
  difficulty: number;
  reps: number;
  lapses: number;
  chroma_synced: boolean;
  chroma_id: string | null;
  criado_em: string;
  atualizado_em: string;
}

export type TipoQuestao = 'multipla_escolha' | 'certo_errado' | 'combinacao_itens';
export type DificuldadeQuestao = 'facil' | 'media' | 'dificil';

export interface QuestaoItem {
  id: number;
  questao_id: number;
  numero: string;
  enunciado: string;
  correto: boolean | null;
  ordem: number;
}

export interface Questao {
  id: number;
  banca: string | null;
  ano: number | null;
  cargo: string | null;
  materia: string;
  tipo: TipoQuestao;
  enunciado: string;
  alternativa_a: string | null;
  alternativa_b: string | null;
  alternativa_c: string | null;
  alternativa_d: string | null;
  alternativa_e: string | null;
  gabarito: string;
  comentario: string | null;
  dificuldade: DificuldadeQuestao;
  bloco_origem_id: number | null;
  criado_em: string;
  /** Populated by GET /api/v1/quiz/session for tipo='combinacao_itens' */
  itens?: QuestaoItem[];
}

export interface QuizSessionParams {
  materia?: string;
  banca?: string;
  ano?: number;
  cargo?: string;
  dificuldade?: DificuldadeQuestao;
  limit?: number;
}

export interface QuizScore {
  acertos: number;
  total: number;
}

export interface DueBloco {
  id: number;
  documento_id: number;
  identificador: string | null;
  conteudo: string;
  importancia: Importancia;
  next_review: string | null;
  urgency: string;
}

export interface ChatMessage {
  role: 'user' | 'model' | 'assistant';
  content: string;
}

export interface SourceChunk {
  fonte: string;
  conteudo: string;
  score: number;
}

export interface ChatResponse {
  answer: string;
  sources: SourceChunk[];
  model: string;
}

export interface ChatStatus {
  materiais_chunks: number;
  blocos_chunks: number;
  gemini_model: string;
}

export interface Anotacao {
  id: number;
  bloco_id: number;
  tipo: 'texto' | 'tabela' | 'fluxograma' | 'portal';
  conteudo: string;
  ordem: number;
  criado_em: string;
  atualizado_em: string;
}
