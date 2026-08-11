# Extensión `frida-knowledge-base`: KB OKF para el agente + Foam para el humano

**Estado:** aceptado (#29). *Revisado: arquitectura en dos capas (humano = Foam, agente = #29).*

## Contexto

El análisis y diseño de los proyectos de desarrollo vive **disperso** en Word, Excel, PowerPoint,
mockups y diagramas, con **referencias débiles** (por nombre, no absolutas) e incrustaciones — lo que
dificulta que los agentes de IA los consuman. Se busca una **"segunda memoria"** estilo Obsidian /
wiki-llm / **OKF** (Open Knowledge Format): markdown con **referencias duras** y grafo, consultable
por IA. Además, la meta es **documentar nativamente en markdown** (adiós Office).

Hay **dos audiencias** para la KB, con necesidades distintas:

- **El analista (humano)** quiere *ver* el grafo de dependencias (tipo Obsidian), navegar backlinks,
  autorar con plantillas, detectar huérfanos.
- **El agente (IA)** quiere leer/escribir/mantener la KB (OKF + *provenance*), consultarla
  (`/wiki-query`, `kb_search`/`kb_neighbors`), y exponerla vía MCP a otros clientes.

[`@zosmaai/pi-llm-wiki`](https://github.com/zosmaai/pi-llm-wiki) es el mejor núcleo de KB de proyecto
(auto-mantenida, OKF v0.2, Obsidian-compatible, MCP). Y **[Foam](https://github.com/foambubble/foam)**
(`foam.foam`, activo en 2026) entrega *exactamente* la experiencia Obsidian dentro de VS Code: **graph
visualization**, **backlinks panel**, **wikilinks** `[[...]]` + autocompletado + diagnóstico,
**sync links on rename**, **templates**, **tag explorer**, **orphans/placeholders**, **link preview**.
Para diagramas, **`bierner.markdown-mermaid`** renderiza mermaid en el preview nativo.

## Decisión

**D1 — `frida-knowledge-base` (#29) porta el núcleo de `pi-llm-wiki` para la CAPA AGENTE.** KB en
markdown con **OKF v0.2** (frontmatter canónico, links markdown estándar, citas de fuente estables),
**Obsidian-compatible** (`[[wikilinks]]`), páginas interlinked que *compound* turn a turn. Módulo:
`src/tools/frida-knowledge-base/`.

**D2 — Auto-mantenida (patrón Karpathy).** El agente destila fuentes → páginas OKF interlinked;
comandos `/wiki-init`, `/wiki-ingest` (markdown/texto/PDF/URL), `/wiki-query`.

**D3 — La CAPA HUMANA la provee Foam, no el webview de Frida.** Frida declara **Foam
(`foam.foam`) + `bierner.markdown-mermaid` como `extensionDependencies`** en su `package.json`.
Grafo *force-directed*, backlinks, autocompletado/diagnóstico de wikilinks, sync al renombrar,
plantillas, tags y orphans → **todo Foam**. Mermaid → `bierner.markdown-mermaid` en el preview
nativo. **#29 NO construye ninguna de esas UIs.**

**D4 — Compatibilidad Foam del vault (requisito de #29).** El vault usa `[[wikilinks]]` + frontmatter
que Foam entiende, de modo que el grafo de Foam visualiza la misma KB que el agente lee/escribe. #29
garantiza este contrato de formato.

**D5 — Referencias duras + aristas tipadas (backend del grafo).** `[[wikilinks]]` + citas de fuente
(*provenance*) + aristas tipadas en frontmatter OKF (`depends_on`/`implements`/`derives_from`) →
reemplazan las **matrices de trazabilidad en Excel**. El agente explora las aristas tipadas vía
`kb_neighbors`; el humano **ve** las conexiones en el grafo de Foam (genéricas) y la **semántica
tipada** la explota el agente vía #29.

**D6 — Consulta + inyección + multi-cliente.** `/wiki-query` + **superficie MCP** (la KB sirve a
Claude Code/Cursor/Windsurf). *Sinergia* con **#25 `frida-codebase-index`** (semántica sobre la KB) y
**#21 `frida-hermes-memory`** (la KB alimenta la memoria del agente).

**D7 — Ingest ligera incluida; Office pesado en `frida-doc-converter` (#30).** Markdown/texto/PDF/URL
vía `markitdown-ts`. Office (Word/Excel/PPT) → **#30** (ADR-0041, dependiente de #29), acotado a
**migración one-time** + exportación ocasional (la meta es markdown-native).

**D8 — Cero conflicto.** Superficie nueva (comandos `/wiki-*` + store de KB). Ortogonal a
`frida-context` y al sistema de skills. Foam opera sobre los mismos archivos markdown.

## Alternativas consideradas

- **A — Construir el grafo/backlinks/mermaid en el webview de Frida.** **Descartado**: reinventaría
  lo que **Foam ya hace** (maduro y activo). Mejor declararlo `extensionDependencies` y enfocar #29 en
  la capa agente.
- **B — Instalar `pi-llm-wiki` directo en `~/.frida` (ADR-0005).** Viable como PoC, pero sin
  integración VS Code (Foam) ni control del contrato de formato del vault.
- **C — `pi-knowledge` o `pi-para` como núcleo.** `pi-knowledge` es RAG orientado a código; `pi-para`
  es wiki personal PARA. `pi-llm-wiki` es el mejor núcleo de KB de **proyecto** (OKF + MCP).
- **D — `@reddb-io/red-skills-brain` (grafo).** Descartado: depende del daemon `redskilled`
  (overkill, no portable a Frida).

## Consecuencias

**Positivas**

- **Scope de #29 reducido**: nada de grafo/backlinks/mermaid webview que construir.
- **Leverage Foam** (maduro, activo) para toda la UX humana; el analista trabaja como en Obsidian.
- **OKF portable** (no es un export cerrado); conocimiento *compounding* turn a turn.
- Sinergias con **#25** (semántica) y **#21** (memoria).

**Negativas**

- **Dependencia de Foam** (`extensionDependencies`): si Foam cambia su formato de wikilinks/frontmatter,
  #29 debe seguir el contrato.
- Porte del engine agente (OKF, ingest ligera, índices, `/wiki-query`, MCP, aristas tipadas).
- **Aristas tipadas**: Foam muestra enlaces genéricos (no colorea por tipo); la semántica tipada es
  explotable por el agente, no por la vista Foam.
- Decidir ubicación del vault (¿repo del proyecto? ¿`~/.frida/kb`?) y su versionado.

## Referencias

- Issue **#29**.
- Capa humana (VS Code): **[Foam](https://github.com/foambubble/foam)** (`foam.foam`) ·
  **`bierner.markdown-mermaid`** — declaradas `extensionDependencies`.
- Capa agente (upstream): <https://github.com/zosmaai/pi-llm-wiki> · OKF v0.2.
- Complementario: `@d1g1tlprim8/pi-okf-wiki` (integridad de grafo / ledger).
- **#30 `frida-doc-converter`** (ADR-0041) — ingest Office (migración), **dependiente de #29**.
- Sinergia: **#25** `frida-codebase-index` (ADR-0036), **#21** `frida-hermes-memory` (ADR-0032).
