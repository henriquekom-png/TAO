"""
vector_store/chroma_client.py
Cliente ChromaDB persistente para o TAO.
- Instância única por sessão via @st.cache_resource.
- Coleção 'tao_materiais': embeddings de material de apoio (PDFs, DOCX, TXT).
- Coleção 'tao_blocos': embeddings de blocos do documento (Sprint 7).
"""

from pathlib import Path

BASE_DIR   = Path(__file__).resolve().parent.parent
CHROMA_DIR = BASE_DIR / "vector_store" / "chroma_data"

# ── Verificação de dependência ────────────────────────────────────────────────
_CHROMADB_OK = False
try:
    import chromadb  # noqa: F401
    _CHROMADB_OK = True
except ImportError:
    pass


def deps_ok() -> bool:
    """Retorna True se chromadb estiver instalado."""
    return _CHROMADB_OK


def get_chroma_client():
    """
    Retorna cliente ChromaDB persistente em disco.
    Usa cache do Streamlit quando disponível; funciona também fora do contexto
    Streamlit (ex.: scripts utilitários) retornando o cliente diretamente.
    """
    if not _CHROMADB_OK:
        return None
    CHROMA_DIR.mkdir(parents=True, exist_ok=True)

    try:
        import streamlit as st

        @st.cache_resource(show_spinner=False)
        def _cached_client():
            import chromadb as _chroma
            return _chroma.PersistentClient(path=str(CHROMA_DIR))

        return _cached_client()
    except Exception:
        import chromadb as _chroma
        return _chroma.PersistentClient(path=str(CHROMA_DIR))


def get_collection(name: str = "tao_materiais"):
    """
    Obtém ou cria uma coleção ChromaDB pelo nome.
    Retorna None se chromadb não estiver disponível.
    """
    client = get_chroma_client()
    if client is None:
        return None
    return client.get_or_create_collection(
        name=name,
        metadata={"hnsw:space": "cosine"},
    )


def search(
    query_embedding: list[float],
    n_results: int = 5,
    collection_name: str = "tao_materiais",
    where: dict | None = None,
) -> list[dict]:
    """
    Busca vetorial na coleção.
    Retorna lista de dicts com 'document', 'metadata' e 'distance'.
    """
    col = get_collection(collection_name)
    if col is None:
        return []
    kwargs: dict = {"query_embeddings": [query_embedding], "n_results": n_results}
    if where:
        kwargs["where"] = where
    try:
        res = col.query(**kwargs)
        results = []
        for i, doc in enumerate(res["documents"][0]):
            results.append({
                "document": doc,
                "metadata": res["metadatas"][0][i],
                "distance": res["distances"][0][i],
            })
        return results
    except Exception:
        return []
