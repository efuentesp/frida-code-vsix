---
date: 2026-08-14T23:26:53-0600
author: Edgar F. Fuentes Perea
commit: f0edeae
branch: main
repository: frida-code
topic: "frida-codebase-index: investigación del upstream open-codebase-index (issue #25, ADR-0036)"
tags: [research, codebase-index, semantic-search, call-graph, embeddings, issue-25]
status: ready
last_updated: 2026-08-14T23:33:43-0600
last_updated_by: Edgar F. Fuentes Perea
last_updated_note: "Enmienda §I durante /skill:design: documentar el entry pi (dist/pi-extension.js) verificado del tarball npm 0.23.0 — cerró el hueco de trazabilidad marcado por slice-verifier"
---

# Research: frida-codebase-index (porte de open-codebase-index)

## Summary

Investigación del upstream [`open-codebase-index`](https://github.com/Helweg/open-codebase-index) (antes `opencode-codebase-index`) de Kenneth Helweg (MIT, ⭐165) para el porte como extensión nativa `frida-codebase-index` (issue #25, ADR-0036 aceptado). El upstream es **mucho más maduro y amplio de lo que el ADR registra**: no son 3-4 tools sino **16 tools en su variante Pi** (13 portables + 3 aliases de knowledge-base), incluye herramientas que el ADR no menciona (`code_communities`, `pr_impact`, `find_similar`, `index_metrics`, `index_health_check`).

**Hallazgo más importante para la estrategia de porte:** el upstream **YA es una extensión Pi nativa** — `pi install npm:open-codebase-index` funciona hoy (peerDeps `@earendil-works/pi-coding-agent`, que Frida ya usa), registra tools nativas + skill `codebase-search`, y usa storage `.codebase-index/`. Frida embebe un `ModelRuntime`/loader de extensiones pi propio (agentDir `~/.frida`), así que la decisión de diseño no es "porte desde cero" sino **"empaquetar/delegar vs. envolver"** la extensión Pi existente.

**Riesgo principal identificado:** el paquete npm trae los **5 prebuilds nativos NAPI de todas las plataformas adentro** (darwin-arm64/x64, linux-arm64-gnu/x64-gnu, win32-x64) → **256 MB descomprimido**. Bundlearlo en el `.vsix` (hoy 51 MB) lo quintuplicaría; el diseño debe elegir podar por plataforma, instalar-on-demand en `globalStorage`, o descargar en primera ejecución.

**Degradación sin embeddings (la pregunta que quedó abierta tras la conversación con el usuario):** PARCIALMENTE confirmada. En **búsqueda** hay fallback BM25 explícito (CHANGELOG: *"Keep `codebase_search` y `codebase_peek` operational through BM25 keyword fallback when query embedding generation is temporarily unavailable"*). Pero la **indexación** requiere un provider: `detector.ts:116` lanza *"No embedding-capable provider found"* si no detecta ninguno (orden `auto`: Ollama → OpenAI → Google). Es decir, sin Ollama/key NO hay índice, y por tanto tampoco call-graph (ver §G y Open Questions).

## A. Tools API

Fuente: [docs/tools.md](https://github.com/Helweg/open-codebase-index/blob/main/docs/tools.md) + [README](https://github.com/Helweg/open-codebase-index#readme).

**Núcleo portable (13 tools, disponibles en MCP + plugin OpenCode + Pi):**

| Tool | Qué hace | Notas |
| --- | --- | --- |
| `codebase_context` | Entry point recomendado: paquete de evidencia acotado, deduplicado, diverso por archivo; enruta también definiciones y rutas from/to | `tokenBudget` 128–4000; `diagnostic: true` para troubleshooting |
| `codebase_peek` | Ubicaciones probables + metadata SIN cuerpos de código (low-token) | Para elegir archivos antes de leer |
| `codebase_search` | Búsqueda semántica/híbrida completa con código fuente | Filtros de archivo/directorio, líneas de contexto |
| `implementation_lookup` | Definición autoritativa; prefiere implementación sobre tests/docs/fixtures | |
| `find_similar` | Código análogo a un snippet dado | Duplicados, refactoring |
| `call_graph` | Callers/callees directos de un símbolo | Disambiguación por file-path si hay nombres duplicados |
| `call_graph_path` | Ruta de llamada más corta entre dos símbolos | |
| `index_codebase` | Crea/actualiza el índice | Incremental por defecto; `force:true` rebuild total; `estimateOnly` |
| `index_status` | Readiness, chunks, compatibilidad, provider/modelo actual | |
| `index_health_check` | Limpia referencias huérfanas, reporta salud | |
| `index_metrics` | Métricas operativas + agregados de efectividad privacy-safe | |
| `index_logs` | Logs debug recientes en memoria | |
| `pr_impact` | Blast radius de un branch/PR: símbolos afectados, dependencias transitivas, comunidades, hubs, riesgo de merge | |

**Adicionales:** `code_communities` (comunidades del call graph + hubs + coupling — params `branch`, `minSize`, `limit`, `hubThreshold`, `minCoupling`, `couplingLimit`).

**Variante Pi (16 tools):** las 13 portables + aliases host `knowledge_base_list`/`knowledge_base_add`/`knowledge_base_remove`. La variante OpenCode añade 4 propias (`add_knowledge_base`, `list_knowledge_bases`, `remove_knowledge_base`, `index_visualize`) + slash commands (`/status`, `/index`) — no disponibles en Pi. El MCP server expone además 5 prompts (`search`, `find`, `definition`, `index`, `status`).

El renombrado del ADR-0036 D1 (`semantic_search` etc.) es decisión nuestra sobre nombres; los canónicos upstream son los de la tabla.

## B. Licencia

**MIT** © 2026 Kenneth Helweg — [LICENSE](https://github.com/Helweg/open-codebase-index/blob/main/LICENSE). Porte y bundling permitidos. (Página npm [open-codebase-index](https://www.npmjs.com/package/open-codebase-index).)

## C. Módulo nativo NAPI

- Rust vía napi-rs (`@napi-rs/cli` en devDeps; `native/src/parser.rs`, `chunker.rs`, etc. — [ARCHITECTURE.md](https://github.com/Helweg/open-codebase-index/blob/main/ARCHITECTURE.md)).
- El módulo (`codebase-index-native`) hace: tree-sitter parsing, usearch vectors, SQLite, BM25, xxhash, extracción de llamadas.
- **Distribución:** los **5 prebuilds van dentro del paquete** (`package/native/codebase-index-native.{darwin-arm64,darwin-x64,linux-arm64-gnu,linux-x64-gnu,win32-x64-msvc}.node` — verificado listando el tarball npm 0.23.0). NO usa `optionalDependencies` por plataforma.
- Sin prebuild para una plataforma → "Native Module Build Failures" ([TROUBLESHOOTING.md](https://github.com/Helweg/open-codebase-index/blob/main/TROUBLESHOOTING.md) §265): requiere Rust toolchain (`npm run build:native`) — no viable para usuarios finales.
- `engines: node >=20` ([package.json](https://github.com/Helweg/open-codebase-index/blob/main/package.json)). VS Code extension host moderno lo cumple.

## D. Storage

Fuente: [ARCHITECTURE.md](https://github.com/Helweg/open-codebase-index/blob/main/ARCHITECTURE.md) + [installation.md](https://github.com/Helweg/open-codebase-index/blob/main/docs/installation.md).

- Por proyecto, dentro del repo: `.codebase-index/index/` para Pi (OpenCode usa `.opencode/`, Claude `.claude/`).
- Contenido: SQLite (metadata, chunks, embeddings por hash, catálogo de branches), artefactos usearch (vectores), BM25 inverted index, file-state (`file-hashes.<branch-hash>.json`, `failed-batches.<branch-hash>.json`).
- **Branch-aware:** catálogos por branch; al cambiar de branch se reusa contenido no modificado y los resultados se scopean al branch activo. Worktrees vinculados comparten el índice del checkout principal salvo config local propia (índice aislado).
- Config por proyecto: `.codebase-index/config.json` (en Pi).

## E. Indexación

Fuente: [ARCHITECTURE.md](https://github.com/Helweg/open-codebase-index/blob/main/ARCHITECTURE.md) §Indexing Flow.

1. **COLLECT** — discovery respeta `.gitignore`.
2. **DELTA** — compara hashes (xxhash) contra los guardados; solo procesa nuevo/modificado.
3. **BATCH** — límites de working set: 64 archivos u 8 MiB por lote (un archivo >8 MiB va solo).
4. **PARSE** — tree-sitter: funciones, clases, métodos, interfaces + JSDoc/docstrings adjuntos.
5. **CHUNK** — chunking semántico con overlap, preservando fronteras estructurales.
6. **EMBED** — vectores via provider, deduplicados por content-hash (mismo código = mismo embedding, reuso entre branches).
7. **STORE** — una transacción coordinada de escritura SQLite (una corrida interrumpida no expone filas parciales); publicación de usearch/BM25/hashes/branch-catalog en el boundary final (NO es una transacción atómica cross-storage).

- Watcher con `chokidar`; auto-index configurable (`autoIndex:false` default, `watchFiles:true`, `requireProjectMarker:true` — sin `.git`/`package.json`/etc. el watching se desactiva con warning).
- Batchs fallidos de embeddings se persisten como JSONL versionado y se reintentan en la próxima corrida ([TROUBLESHOOTING.md](https://github.com/Helweg/open-codebase-index/blob/main/TROUBLESHOOTING.md) §198).

## F. Embeddings

Fuente: [README §Embedding providers](https://github.com/Helweg/open-codebase-index#embedding-providers) + [docs/configuration.md](https://github.com/Helweg/open-codebase-index/blob/main/docs/configuration.md) + `src/embeddings/detector.ts`.

- Providers: **Ollama, GitHub Copilot, OpenAI, Google, custom** (endpoint OpenAI-compatible).
- `embeddingProvider: "auto"` intenta en orden: **Ollama → OpenAI → Google** (`autoDetectProviders`, detector.ts:96).
- Ollama default del README: `ollama pull nomic-embed-text` (catálogo de modelos en `EMBEDDING_MODELS`; modelo por provider via `getDefaultModelForProvider`).
- Credenciales: para OpenAI/Google lee auth del host (en OpenCode, `authData["openai"]` tipo `api` con key); Ollama no requiere key (localhost).
- Reranking externo opcional: Cohere, Jina, custom (`rerankTopN`, fusion `rrf`); el filtrado local aplica ANTES de mandar candidatos externos (privacidad).
- Cambiar provider/modelo/dimensiones puede invalidar el índice → `index_status` lo reporta y `force:true` rebuild.

## G. Degradación sin embeddings

- **Búsqueda:** CONFIRMADO fallback BM25 — CHANGELOG: *"Embedding-provider outages: Keep `codebase_search` and `codebase_peek` operational through BM25 keyword fallback when query embedding generation is temporarily unavailable, with full keyword weighting and actionable diagnostics"* ([CHANGELOG.md](https://github.com/Helweg/open-codebase-index/blob/main/CHANGELOG.md) §"Embedding-provider outages").
- **Indexación:** REQUIERE provider — si `auto` no detecta ninguno, `detector.ts:116` lanza: *"No embedding-capable provider found. Please authenticate with OpenCode using one of: ollama, openai, google"* (mensaje orientado a OpenCode; en Pi el fix es Ollama local o endpoint custom). Sin índice no hay nada que buscar.
- **Call graph:** NO verificado que el índice se pueda construir solo con parsing (símbolos/call edges) sin vectores. Los símbolos se extraen en PARSE, pero el pipeline EMBED-STORE se asume completo; los batchs fallidos de embedding dejan huecos que se reintentan. → ver Open Questions.
- Implicación para Frida: sin Ollama/key, `semantic_search` no funciona (no hay índice); la propuesta que le hice al usuario ("call_graph sin embeddings funciona") NO está garantizada por el upstream — el diseño debe decidir: exigir provider para indexar (comportamiento upstream) o descubrir si se puede indexar symbol-only (investigación adicional / parche local).

## H. Lenguajes (parser nativo tree-sitter)

Fuente: [README](https://github.com/Helweg/open-codebase-index#readme) §Highlights.

TypeScript/TSX, JavaScript/JSX, Python, Rust, Swift, Go, Java, C#, Ruby, C/C++, Metal, PHP, Apex, Bash, Zig, GDScript, MATLAB, JSON, TOML, YAML, Markdown, HTML — con **text fallback** para el resto. (24 entradas contando pares TS/TSX y JS/JSX como dos.)

## I. Integración host

- **Entry de la extensión Pi (verificado del tarball npm 0.23.0, `package/package.json`):** `"pi": { "extensions": ["./dist/pi-extension.js"], "skills": ["./skills"] }` — el `main` es `dist/index.js` (OpenCode/CLI), pero la variante Pi carga `dist/pi-extension.js`. Igual que pi-lens declara su propio entry en `pi.extensions`, pero con nombre distinto — verificar SIEMPRE contra el manifest del paquete, no asumir por analogía.

- La capa TS es **host-agnóstica** (descripción npm: *"Host-neutral semantic codebase search"*) con adaptadores por host: plugin OpenCode (`@opencode-ai/plugin`), **paquete Pi** (peerDeps `@earendil-works/pi-coding-agent` — registra tools nativas + skill `codebase-search`), servidor **MCP** (`@modelcontextprotocol/sdk`, `open-codebase-index-mcp`), CLI con `--host opencode|codex|claude|pi|jcode`.
- En Pi: `pi install npm:open-codebase-index`; storage `.codebase-index/` ([installation.md §Pi](https://github.com/Helweg/open-codebase-index/blob/main/docs/installation.md)).
- Knowledge bases (indexar directorios extra): OpenCode y Pi; aliases `knowledge_base_*` en Pi.

## J. Dependencias

Fuente: [package.json](https://github.com/Helweg/open-codebase-index/blob/main/package.json) (repo y npm 0.23.0).

- `dependencies`: `@modelcontextprotocol/sdk ^1.29`, `@opencode-ai/plugin ^1.0` (solo usado por el adapter OpenCode), `chokidar ^5`, `ignore ^7`, `p-queue ^9`, `p-retry ^7`, `tiktoken ^1`, `typebox ^1.3`, `unicode-case-folding 1.1.1`, `zod ^4`.
- `peerDependencies`: `@earendil-works/pi-coding-agent`, `@opencode-ai/plugin` (ambas opcionales en la práctica según host).
- `optionalDependencies`: **ninguna** (los 5 natives van bundled — §C).
- `engines: node >=20`. Sin restricciones `cpu`/`os`.
- Paquete npm **0.23.0** (2026-08-11), **256 MB** unpacked.

## K. Estado del proyecto

- v0.23.0 publicada 2026-08-11; último push al repo **2026-08-14** (activo, desarrollo diario). 1 issue abierto, 165 estrellas. CI con workflows (`ci.yml`). Docs exhaustivas (9+ docs, troubleshooting, evaluación reproducible, benchmarking cross-repo). [Repo](https://github.com/Helweg/open-codebase-index).
- Rename en curso: `opencode-codebase-index` → `open-codebase-index` (alias legacy mantenidos; plan documentado en [docs/rename-to-open-codebase-index.md](https://github.com/Helweg/open-codebase-index/blob/main/docs/rename-to-open-codebase-index.md)).

## L. Riesgos de porte a Frida

1. **Tamaño del vsix (bloqueador de diseño):** 256 MB descomprimido con 5 natives bundled. El `.vsix` actual pesa 51 MB. Opciones: (a) depender del paquete y podar natives no-usados pre-empaquetado (vsce incluye node_modules tal cual; requiere script de poda + perder multi-plataforma en un solo vsix), (b) **instalación on-demand** en `globalStorage` del host en primera ejecución (descarga solo el native de la plataforma actual), (c) empaquetar tal cual (~+200 MB). Frida hoy ya maneja downloads pesados (agent-browser chromium).
2. **Frida ya embebe el runtime de pi** (`ModelRuntime` + loader de extensiones con agentDir `~/.frida`): la vía más corta es **usar la extensión Pi upstream tal cual** (discovery/local install en `~/.frida/extensions` o bundling) y añadir solo la capa host: settings (provider), comando de indexación/status, y quizá renombrar/exponear tools (ADR D1) — el renaming obligaría a un wrapper propio.
3. **tiktoken** (WASM) y `chokidar` corren bien en extension host; el native `.node` se `require` directo — verificar que `vsce` no lo firme/marque y que el packaging no lo corrompa (Electron/VS Code no firma binaries de extensiones).
4. **Storage en el repo** (`.codebase-index/` dentro del workspace): decidir gitignore automático en Frida (como hace con otros artefactos) para no ensuciar el tree del usuario.
5. **Degradación:** sin Ollama/key no hay índice (§G) — la UX de Frida debe detectarlo temprano (probe `ollama` en localhost:11434, settings del provider) y guiar al usuario, no dejar que las tools fallen opacas.
6. **Frecuencia de releases upstream** (diaria): fijar versión en lockfile del wrapper y actualizar deliberadamente.
7. **Rename en curso** del paquete: anclar a `open-codebase-index` (nuevo nombre) para no heredar el alias legacy.

## Open Questions

1. **¿Se puede indexar sin embeddings (symbol/call-graph only)?** No verificado. El pipeline asume EMBED→STORE; `detector.ts` falla sin provider. Requiere leer `src/indexer/index.ts` a fondo o probar empíricamente con `embeddingProvider` inválido. Impacta directamente la promesa de degradación del diseño de Frida.
2. **¿El native module funciona dentro del extension host de VS Code?** (Electron ABI vs Node ABI del host de la extensión — VS Code usa Node ≥20 real en extension host desde 1.8x, debería sí, pero no está probado en ningún doc del upstream que mencione VS Code). Validar empíricamente en el PoC.
3. **¿La variante Pi expone registro de settings propio** (config `.codebase-index/config.json`) y puede Frida escribirla desde su Settings UI sin conflicto con otras hosts? Formato documentado (§D), pero la interacción multi-host no está.
4. **Peso real del native individual** por plataforma (el tarball completo son 256 MB; un solo `.node` pesará mucho menos — medir en el PoC para dimensionar la descarga on-demand).

## References

- Upstream: <https://github.com/Helweg/open-codebase-index>
- README: <https://github.com/Helweg/open-codebase-index#readme>
- Architecture: <https://github.com/Helweg/open-codebase-index/blob/main/ARCHITECTURE.md>
- Tools: <https://github.com/Helweg/open-codebase-index/blob/main/docs/tools.md>
- Installation (§Pi): <https://github.com/Helweg/open-codebase-index/blob/main/docs/installation.md>
- Configuration: <https://github.com/Helweg/open-codebase-index/blob/main/docs/configuration.md>
- Troubleshooting: <https://github.com/Helweg/open-codebase-index/blob/main/TROUBLESHOOTING.md>
- CHANGELOG (fallback BM25): <https://github.com/Helweg/open-codebase-index/blob/main/CHANGELOG.md>
- LICENSE (MIT): <https://github.com/Helweg/open-codebase-index/blob/main/LICENSE>
- npm: <https://www.npmjs.com/package/open-codebase-index> (tarball 0.23.0 inspeccionado)
- Issue #25: <https://github.com/efuentesp/frida-code-vsix/issues/25>
- ADR-0036: `docs/adr/0036-frida-codebase-index-busqueda-semantica-call-graph.md` (repo local)
