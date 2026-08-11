# Extensión `frida-codebase-index`: búsqueda semántica + call graph (porte de `opencode-codebase-index`)

**Estado:** aceptado (#25).

## Contexto

Frida navega el código con `symbol_search` (BM25) y `grep` — **lexical**. En proyectos grandes,
encontrar *"dónde se valida la sesión"* (por **significado**) o *"quién llama a `sendUserMessage`"*
(por **grafo de llamadas**) no es bien servido por búsqueda de subcadenas ni por BM25 puro.

[`opencode-codebase-index`](https://pi.dev/packages/opencode-codebase-index) es un índice semántico
**local** que combina **embeddings + BM25 + symbol lookup + call graph** detrás de tools
agent-friendly: `codebase_context`/`codebase_peek` (descubrimiento low-token),
`implementation_lookup`, `call_graph`, `call_graph_path`. Indexación incremental **branch-aware**
con file watching y content-hash reuse. Storage: SQLite + usearch vectors + BM25 invertido.
Múltiples providers de embeddings (Ollama, Copilot, OpenAI, Google, custom). Parseo nativo de 24+
lenguajes.

## Decisión

**D1 — Extensión nativa `frida-codebase-index`.** Porta el índice semántico como tools agent-facing:
`semantic_search`, `call_graph`, `implementation_lookup` (nombres a afinar).

**D2 — Indexación local incremental.** Branch-aware, file watching, content-hash reuse. Storage local
(SQLite + usearch + BM25). Sin dependencia cloud obligatoria.

**D3 — Embeddings configurables, local-first.** Preferir **Ollama** local (zero-cloud) por defecto;
fallback a OpenAI/Copilot/Google. Política de privacidad documentada (qué sale del equipo).

**D4 — Complementa (no reemplaza) `symbol_search`/`grep`.** BM25 lexical y semántico coexisten;
el agente elige según la consulta. Distinto de `frida-context` (contexto del *modelo*, no del
*codebase*). *Sinergia* con #21 (`frida-hermes-memory`): el call-graph puede alimentar memoria
estructurada.

**D5 — Cero conflicto.** Nueva capacidad de navegación.

## Alternativas consideradas

- **A — Sólo mejorar BM25 de `symbol_search`.** Descartado: no captura significado ni grafo de
  llamadas.
- **B — Servicio cloud de indexación.** Descartado por privacidad y latencia; local-first.
- **C — `ctags`/LSP para call-graph.** Parcial: no da semántica de significado; LSP es por-lenguaje y
  pesado de coordinar (Frida ya consume pi-lens para diagnósticos, distinto eje).

## Consecuencias

**Positivas**

- **Encontrar por significado** en proyectos grandes — menos lecturas a ciegas.
- **Call graph** para mapear dependencias y *blast radius* de cambios.

**Negativas**

- Infraestructura: indexación inicial (coste), almacenamiento de vectors, config de provider.
- Mantenimiento del parser multi-lenguaje y del upstream.
- Decidir política de re-indexación (watch vs. on-demand).

## Referencias

- Issue **#25**.
- Upstream: <https://pi.dev/packages/opencode-codebase-index> · <https://github.com/Helweg/open-codebase-index>
- Complementa: `symbol_search` (pi estándar) — lexical vs. semántico.
- Sinergia: #21 (`frida-hermes-memory`, ADR-0032).
