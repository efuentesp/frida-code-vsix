# Extensión `frida-knowledge-base`: base de conocimiento OKF/Obsidian (porte de `@zosmaai/pi-llm-wiki`)

**Estado:** aceptado (#29).

## Contexto

El análisis y diseño de los proyectos de desarrollo vive **disperso** en Word, Excel, PowerPoint,
mockups y diagramas, con **referencias débiles** (por nombre, no absolutas) y documentos que incrustan
otros documentos — lo que dificulta que los agentes de IA los consuman para generar código, pruebas y
documentación. Se busca una **"segunda memoria"** estilo Obsidian / wiki-llm / **OKF** (Open Knowledge
Format): documentación en markdown con **referencias duras** y grafo, consultable por IA.

[`@zosmaai/pi-llm-wiki`](https://github.com/zosmaai/pi-llm-wiki) es el núcleo ideal: KB
**auto-mantenida** (patrón *LLM Wiki* de Karpathy), **Obsidian-compatible**, con **OKF v0.2 nativo**,
páginas interlinked, ingest de fuentes (URLs/PDFs/markdown/JSON/XML), `/wiki-query` y **superficie
MCP** (la KB sirve también a Claude Code/Cursor/Windsurf, no sólo al host). El catálogo confirmó que
es el mejor núcleo de KB de proyecto frente a `pi-knowledge` (más RAG-código) o `pi-para` (PARA
personal); `@d1g1tlprim8/pi-okf-wiki` aporta ideas complementarias de integridad de grafo.

## Decisión

**D1 — Extensión nativa `frida-knowledge-base` que porta el núcleo de `pi-llm-wiki`.** KB en markdown
con **OKF v0.2** (frontmatter canónico, links markdown estándar, citas de fuente estables),
**Obsidian-compatible** (`[[wikilinks]]`), páginas interlinked que *compound* turn a turn. Módulo:
`src/tools/frida-knowledge-base/`.

**D2 — Auto-mantenida (patrón Karpathy).** El agente destila fuentes → páginas OKF interlinked; el
conocimiento se acumula y se mantiene solo. Comandos `/wiki-init`, `/wiki-ingest` (fuentes
markdown/texto/PDF/URL), `/wiki-query`.

**D3 — Referencias duras + integridad de grafo.** `[[wikilinks]]` + backlinks + índices deterministas

+ citas de fuente (*provenance*). Inspiración de `@d1g1tlprim8/pi-okf-wiki`: detección de huérfanos,
generación de backlinks, actualización segura de wikilinks al mover archivos, y `log.md` como ledger.

**D4 — Consulta + inyección + multi-cliente.** `/wiki-query` expone la KB al agente; **superficie
MCP** para que sirva a otros clientes. *Sinergia* con **#25 `frida-codebase-index`** (búsqueda
semántica embeddings+BM25 sobre la KB markdown) y **#21 `frida-hermes-memory`** (la KB del proyecto
alimenta la memoria del agente con hechos verificados).

**D5 — Ingest ligera incluida; Office pesado en `frida-doc-converter` (#30).** La KB ingiere
markdown/texto/PDF/URL (`markitdown-ts` para PDF). La conversión **pesada** de Office
(Word/Excel/PPT, bidireccional) es una extensión separada dependiente (**#30**, ADR-0041) — evita
acoplar el núcleo a dependencias de conversión.

**D6 — Cero conflicto.** Nueva superficie (comandos `/wiki-*` + store de KB). Ortogonal a
`frida-context` (contexto del *modelo*) y al sistema de skills de Frida.

## Alternativas consideradas

+ **A — Instalar `pi-llm-wiki` directo en `~/.frida` (ADR-0005).** Viable como PoC rápido, pero sin
  integración VS Code/webview (árbol de la KB, hover de backlinks, panel de grafo, estado de
  indexación). Un porte nativo da mejor UX y control.
+ **B — `pi-knowledge` o `pi-para` como núcleo.** `pi-knowledge` es más RAG orientado a código;
  `pi-para` es una wiki personal PARA. `pi-llm-wiki` es el mejor núcleo de KB de **proyecto**
  (Obsidian-compatible + OKF + MCP multi-client).
+ **C — `@reddb-io/red-skills-brain` (grafo).** Descartado: depende del daemon `redskilled`
  (overkill, no portable a Frida).

## Consecuencias

**Positivas**

+ Consolida análisis/diseño en una **KB markdown con referencias duras**, consultable por IA y
  multi-client (MCP).
+ **OKF portable** (no es un export cerrado); el conocimiento *compounding* turn a turn.
+ Sinergias con **#25** (semántica) y **#21** (memoria del agente).

**Negativas**

+ Porte del engine wiki (OKF, ingest ligera, índices, `/wiki-query`, superficie MCP).
+ Integración webview (árbol KB / hover backlinks / panel de grafo / estado de indexación).
+ Decidir ubicación del vault (¿dentro del repo del proyecto? ¿`~/.frida/kb`?) y su versionado.

## Referencias

+ Issue **#29**.
+ Upstream: <https://github.com/zosmaai/pi-llm-wiki> · OKF v0.2.
+ Complementario: `@d1g1tlprim8/pi-okf-wiki` (integridad de grafo / ledger).
+ **#30 `frida-doc-converter`** (ADR-0041) — ingest Office pesado, **dependiente de este issue**.
+ Sinergia: **#25** `frida-codebase-index` (ADR-0036), **#21** `frida-hermes-memory` (ADR-0032).
