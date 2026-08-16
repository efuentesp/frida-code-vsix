# `frida-knowledge-base` (KB OKF del proyecto — capa agente + Foam capa humana)

Base de conocimiento de proyecto **auto-mantenida** (patrón Karpathy): markdown con
**OKF v0.2**, **Obsidian-compatible**, con referencias duras y grafo consultable por el
agente. Wrapper del paquete upstream
[`@zosmaai/pi-llm-wiki`](https://github.com/zosmaai/pi-llm-wiki) (MIT) instalado
**on-demand** en `~/.frida/npm` — mismo patrón que `frida-codebase-index` /
`frida-hermes-memory` (ADR-0040).

## Arquitectura en dos capas (ADR-0040)

| Capa | Quién | Qué |
| --- | --- | --- |
| **Agente** | `frida-knowledge-base` (este módulo) | 11 tools `wiki_*`, recall layering, guardrails, `/wiki-*`, `kb_search`/`kb_neighbors`, skill `llm-wiki`, MCP |
| **Humana** | **Foam** (`foam.foam`) + `bierner.markdown-mermaid` — `extensionDependencies` del VSIX | Grafo force-directed, backlinks, autocompletado de `[[wikilinks]]`, sync al renombrar, plantillas, tags, orphans. Mermaid en el preview nativo |
| **Compartida** | Vault markdown `<proyecto>/.llm-wiki/` | Ambos operan sobre los mismos archivos |

## Qué aporta la capa agente

- **Vault OKF v0.2**: `.llm-wiki/wiki/` con `index.md`, `log.md`, `sources/`,
  `concepts/`, `entities/`, `syntheses/`, `analyses/`; raw inmutable en
  `.llm-wiki/raw/`; metadata proyectada en `.llm-wiki/meta/`.
- **Recall automático**: hook `before_agent_start` busca en el vault (proyecto +
  personal `~/.llm-wiki/`) e inyecta conocimiento relevante al system prompt.
- **Ingest**: `/wiki-ingest <fuente>` (markdown/texto/PDF/URL) destila la fuente en
  páginas interlinked con citas de procedencia.
- **Guardrails**: bloquea ediciones directas a `raw/**` y `meta/**`; reconstruye
  metadata tras editar `wiki/**`.
- **Búsqueda híbrida**: léxica siempre; semántica (embeddings OpenAI-compatible,
  endpoint configurable en la config del vault) si hay credencial.

## Comandos, tools y skill

- **Comandos** `/wiki-*` (12): `wiki-init`, `wiki-ingest`, `wiki-query`, `wiki-lint`,
  `wiki-status`, `wiki-record`, `wiki-req`, `wiki-retro`, `wiki-run`, `wiki-skills`,
  `wiki-digest`, `wiki-discover`. El wrapper los **materializa como symlinks** en
  `~/.frida/prompts/wiki/` — los despacha el SDK nativo (mismo canal que
  `/worktree`, con expansión `$ARGUMENTS`).
- **Tools upstream** (11): `wiki_bootstrap`, `wiki_capture_source`, `wiki_ingest`,
  `wiki_search`, `wiki_recall`, `wiki_retro`, `wiki_ensure_page`, `wiki_lint`,
  `wiki_log_event`, `wiki_rebuild_meta`, `wiki_reindex_embeddings`, `wiki_status`,
  `wiki_watch`.
- **Aliases frida** (registrados por el wrapper, delegan en lib del upstream):
  - `kb_search` — búsqueda híbrida (alias del issue #29; ≈ `wiki_search`).
  - `kb_neighbors` — vecinos de una página en el grafo: out-edges e in-edges con el
    `type` OKF del destino.
- **Skill** `llm-wiki`: symlink en `~/.frida/skills/llm-wiki` (descubrible por el
  agente).

### Sobre las "aristas tipadas"

El issue #29 mencionaba aristas tipadas en frontmatter
(`depends_on`/`implements`/`derives_from`). **OKF v0.2 real** usa links markdown
comunes como aristas del grafo + `type` por página
(`source`/`entity`/`concept`/`synthesis`/`analysis`); no define aristas tipadas en
frontmatter. `kb_neighbors` sigue el modelo real: dirección (out/in) + type del
destino. La jerarquía de directorios aporta el agrupamiento.

## Superficie MCP (otros clientes)

El paquete shipea un servidor MCP standalone. Para que otro cliente (p. ej.
Claude Code) lea la misma KB, agrégalo a su config MCP con la ruta del paquete
instalado por frida:

```json
{
 "mcpServers": {
  "llm-wiki": {
   "command": "node",
   "args": [
    "~/.frida/npm/node_modules/@zosmaai/pi-llm-wiki/dist/mcp/index.js"
   ]
  }
 }
}
```

(El path absoluto real: `~` expande según el cliente; usa la ruta expandida si no
la resuelve.)

## Instalación y ciclo

1. Primera sesión con el paquete ausente: la tool `kb_search` responde con la guía
   (modo guía D6) y Frida **instala en background** `@zosmaai/pi-llm-wiki@0.11.4` en
   `~/.frida/npm` (JS puro, sin deps nativas) + materializa prompts/skill.
2. Al completar, VS Code notifica: ejecuta `/reload` — aparecen `/wiki-*`, la skill
   y las tools `wiki_*`/`kb_*`.
3. Manual: `npm install @zosmaai/pi-llm-wiki@0.11.4 --prefix "~/.frida/npm" --legacy-peer-deps`.

Config `llm-wiki.*` en `~/.frida/settings.json` (la lee el upstream vía
`getAgentDir()`). Embeddings: opcional (sin credencial funciona en modo léxico).

## Gate

- Setting `frida.knowledgeBase.enabled` (default `true`).
- El vault del proyecto vive en `<proyecto>/.llm-wiki/` — agregarlo a git para que
  la KB sea compartible (o a `.gitignore` si es personal).

## Arquitectura (decisiones clave)

- **Passthrough + materialización**: la factory del upstream corre contra el
  `ExtensionAPI` real (recall en `before_agent_start`, guardrails). Lo que el
  package loader de pi aportaría (prompts/skill) se materializa como symlinks en
  `~/.frida/prompts/wiki/` y `~/.frida/skills/llm-wiki` — el dispatcher nativo del
  SDK se encarga de `/wiki-*` con `$ARGUMENTS` (cero re-implementación).
- **Entry TS vía jiti** + aliases de peer-deps: `@mariozechner/pi-coding-agent` →
  SDK `@earendil-works` que frida shipea (los 2 value-imports del upstream —
  `getAgentDir`, `isToolCallEventType` — existen en nuestra copia); `typebox` y
  subpaths (`typebox/compile`, `typebox/value`) → copia top-level (el SDK shipeado
  los importa en runtime). Los otros peers `@mariozechner/pi-*` son imports
  type-only (borrados en runtime).
- **Aliases kb_***: cargan `lib/recall.ts`, `lib/knowledge-links.ts`, `lib/utils.ts`
  con el MISMO jiti instance (estado compartido con la extensión activa).
- **Main only**: la KB es del proyecto de la sesión main; las hijas de workflow no
  registran el vault.

## Tests

`test/frida-knowledge-base/` — `constants.test.ts` (pin/entry/aliases contra el
node_modules real, incl. subpaths typebox), `installer.test.ts` (idempotencia,
ENOENT, exit≠0, timeout), `wrapper.test.ts` (passthrough con paquete fake cargado
por jiti REAL: alias `@mariozechner` resuelve el SDK real, `PI_CODING_AGENT_DIR`
antes de la carga, materialización de prompts+skill, `kb_search`/`kb_neighbors`
contra un mini-vault OKF con wikilinks y md-links, modo guía + instalación
background inyectada, entry corrupto degrada sin crash).

## Validación e2e (pendiente — criterio del issue #29)

1. Dev Host → sesión nueva en un proyecto → confirmar notificación de instalación +
   `/reload` → `/wiki-init` crea el vault (`.llm-wiki/`).
2. `/wiki-ingest` de un documento/URL → páginas interlinked con provenance.
3. `/wiki-query` y `kb_search` recuperan lo ingerido; `kb_neighbors` muestra
   out/in edges con types.
4. **Foam**: abrir el vault en el explorer → el grafo muestra las páginas y sus
   enlaces (contrato de compatibilidad); backlinks panel funciona.
5. **MCP**: agregar el server a otro cliente y consultar la misma KB.

## Referencias

- Issue [#29](https://github.com/efuentesp/frida-code-vsix/issues/29) · ADR-0040.
- Upstream: `@zosmaai/pi-llm-wiki` (npm, MIT) —
  <https://github.com/zosmaai/pi-llm-wiki>
- Capa humana: [Foam](https://github.com/foambubble/foam) (`foam.foam`) ·
  `bierner.markdown-mermaid` — `extensionDependencies`.
- Derivados: **#30 `frida-doc-converter`** (ingest Office, depende de este issue).
- Patrones reutilizados: `frida-codebase-index` (installer on-demand + guía D6),
  `frida-hermes-memory` (wrapper passthrough + jiti aliases).
