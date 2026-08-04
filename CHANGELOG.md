# Changelog

Todos los cambios notables de **Frida Code** se documentan aquí.
El formato se basa en [Keep a Changelog](https://keepachangelog.com/es/1.1.0/)
y el proyecto se adhiere a [SemVer](https://semver.org/lang/es/).

VS Code muestra este archivo en la pestaña **Changelog** de los detalles de la
extensión. Las versiones se distribuyen como `.vsix` adjuntos a cada
[GitHub Release](https://github.com/efuentesp/frida-code-vsix/releases); dentro de
Frida usa `/version` (qué tienes) y `/update` (¿hay una nueva?).

## [Unreleased]

### Añadido

### Cambiado

### Corregido

## [0.9.0] - 2026-08-04
### Añadido

- **usage** — Artefactos por tipo de archivo (KLOCs + tokens) con familia en hover

## [0.8.1] - 2026-08-04
### Corregido

- **usage** — Top sesiones trunca nombres (…) + grid del dashboard a 50/50 real

## [0.8.0] - 2026-08-04
### Añadido

- **usage** — Top herramientas por tokens (atribución por-mensaje) + tooltip de llamadas
- **usage** — Top sesiones muestra el primer prompt (firstMessage) en vez del filename
- **usage** — filtro Este proyecto/Todas en el tab Uso (paridad con sesiones)

### Corregido

- **usage** — Top sesiones prioriza el name renombrado (name||firstMessage)
- **usage** — el BarChart vertical muestra día (MM-DD), valor y tooltip

### Interno

- **usage** — corrige indentación del linter (biome) en el tab Uso

## [0.7.0] - 2026-08-04

### Añadido

- **Dashboard de uso + export `frida-usage-report/v1`.** Nuevo tab "Uso" en Configuración con 6 KPIs (tokens, costo, sesiones, turnos, cache hit %, tiempo activo) y 6 gráficas SVG/CSS (tokens/costo por día, uso por modelo, top herramientas, artefactos por lenguaje, actividad por hora/día, top sesiones) sobre el histórico de sesiones JSONL. Comando `Frida: Exportar reporte de uso` que genera un JSON versionado (opt-in inline para incluir identidad) pensado para que una app concentradora externa lo agregue por usuario/proyecto/empresa. Indexer que modela `session-stats.ts` (caché por mtime), atribuye el uso al modelo activo y mide `assistedKloc` (líneas escritas/editadas por Frida).
- **Política de versionado automático.** Nuevo `npm run release`
  (`scripts/release.mjs`) que determina el bump SemVer desde los commits
  Conventional Commits (`feat`→minor, `fix`→patch, `BREAKING`→major), actualiza
  `package.json` + `CHANGELOG.md` y commitea `chore(release):`. Aborta si solo
  hay cambios que no publican (`docs`/`chore`/…). Documentación en
  [docs/versioning.md](docs/versioning.md), con disclosure en `AGENTS.md`.

### Cambiado

- **ask_user_question con selección por teclado.** El cuestionario migra de Remote
  React (ADR-0012) a un componente nativo del webview (`QuestionsPanel`, ADR-0027),
  con el mismo patrón que los permisos (`ApprovalCard`). Ahora se puede navegar y
  responder por teclado: ↑↓ navega opciones, ⏎/Espacio confirma, 1-9 selección
  directa, ←/→ cambia de pregunta, Tab va al texto libre, Shift+⏎ envía, Esc
  cancela (por niveles). Remote React se mantiene para los widgets de pie
  (subagentes/workflow/git-sync/todo).

### Corregido

## [0.6.0] - 2026-08-03

### Añadido

- **Estadísticas de sesión en el header (tiempo + tokens).** El header ahora
  muestra siempre `⏱ <duración> · ↑<in> ↓<out>` a la derecha de la versión: el
  **tiempo invertido** (primer→último mensaje) y los **tokens acumulados** de la
  sesión, para fines estadísticos. La duración y los tokens se reconstruyen del
  **JSONL de la sesión en disco** (fuente de verdad: guarda todo el histórico,
  incluido el evento `compaction`), combinados con el estado en memoria con
  `min`/`max` para ser robustos en cualquier caso (turno nuevo antes del flush,
  reload de sesión compactada). Así **no se pierden al recargar** la sesión ni
  tras una compactación, y **se acumulan** con cada turno. Nuevo módulo
  `src/session-stats.ts` (`readSessionStats`) con caché por mtime.

- **`frida-git-sync`** — porte nativo de `@jachy/pi-git-sync` (v0.6.2) que
  sincroniza el agentDir de frida (`~/.frida`) entre máquinas vía un **repo Git
  privado**. Compara *three-way* (baseline → local → remoto), rebase no
  destructivo, rama de recuperación por dispositivo, secret-scanning antes de
  push, backups pre-apply con rollback y resolución de conflictos interactiva
  (agente / local / remoto / abortar). Comandos `/fridasync` (sync),
  `/fridasync status` y `/fridasync diff`. Panel persistente en el footer con
  progreso (fase + elapsed) y botón **Cancel** que aborta la operación git en
  curso. Ver [ADR-0026](./docs/adr/0026-frida-git-sync-porter-pi-git-sync.md).

- **Paneles del footer colapsables.** Los paneles persistentes (Todo, Subagentes,
  Workflow y el banner de frida-pipeline) y las tarjetas de aprobación
  (`ApprovalCard`) ahora se colapsan con un clic en su cabecera (chevron ▼/▶),
  para liberar espacio vertical cuando se acumulan varios a la vez. Arrancan
  expandidos y recuerdan la decisión del usuario durante la sesión (estado local,
  no persiste). Componente compartido `CollapsiblePanel` (Remote React)
  reutilizado por los cuatro paneles; las `ApprovalCard` (webview nativo)
  gestionan su propio colapso.

### Cambiado

- **`frida-subagents` — panel de subagentes con progreso en vivo.** El widget
  del footer ahora muestra, por cada agente, **stats y actividad en tiempo
  real** (paridad con el panel "above editor" de `pi-subagents`): `↻turnos≤max`,
  `N tools`, `N.Nk tok` y `elapsed`, más una **activity line** (`⎿ reading 3
  files…`, `editing`, `thinking…`) con lo que hace el subagente ahora. Antes el
  widget solo mostraba tipo + descripción + elapsed, y el progreso en vivo sólo
  llegaba a la tarjeta inline del tool `Agent` (foreground). Ahora **foreground
  y background** reflejan su progreso en el panel.

- **Recuadro de comando acotado y numerado en las aprobaciones.** Cuando un
  comando bash trae muchas líneas, la tarjeta de aprobación ya no crece hasta
  empujar los botones Accept/Reject fuera de pantalla: el recuadro se limita a
  **10 líneas con scroll vertical** propio, **numera cada línea** (guía visual,
  sin zebra) y muestra un contador **"⌄ N líneas más"** cuando hay contenido
  oculto, para no aprobar a ciegas.

- **Lista de sesiones: stats por sesión + filtro por proyecto.** La ventana
  "Sesiones anteriores" ahora muestra por cada sesión, en una segunda línea,
  el **tiempo total** (primer→último mensaje) y los **tokens acumulados**
  (`⏱ 1h 23m  ↑12k ↓8k`), leídos del JSONL en disco (`readSessionStats`, con
  caché por mtime). Además, un toggle **[Este proyecto | Todas]** en la cabecera
  filtra por el `cwd` del workspace (`SessionManager.list(cwd, …)` del SDK);
  arranca en "Este proyecto" y recuerda la elección durante la sesión. En modo
  "Todas", cada fila etiqueta a qué proyecto (`📁 <basename>`) pertenece. Antes
  la lista era global (todos los proyectos mezclados) sin stats.

### Corregido

- **`frida-subagents` — limpieza de worktrees (`isolation: worktree`).** El
  `cleanupWorktree` del porte original **no eliminaba el worktree** tras
  completar el agente, así que cada ejecución con aislamiento dejaba un
  directorio huérfano en `~/.frida/worktrees/`. Ahora se alinea con el
  comportamiento de `pi-subagents`:
  - `cleanupWorktree` **siempre elimina el worktree** (con cambios o sin ellos);
    el branch `pi-agent-<id>` persiste solo si hubo cambios, para revisión/merge.
  - El auto-commit usa la **descripción del agente** (`pi-agent: <desc>`) en vez
    del mensaje genérico `"auto-commit"`, y **sufijo anti-colisión** (`-<timestamp>`)
    si el branch ya existe (no sobreescribe trabajo previo).
  - Creación del worktree en modo **detached** (`--detach`) en vez de `-b`, para
    no dejar branches colgando cuando el agente no modifica nada.
  - **Manejo de subdirectorio** (`workPath`): un agente lanzado desde un cwd
    profundo de un monorepo ahora trabaja en el subdirectorio equivalente dentro
    de la copia, no en la raíz del repo.
  - **Crash recovery**: se trackean los repos base y se hace `git worktree prune`
    al iniciar/cerrar sesión (`pruneAllWorktrees` en `newSession`), equivalente al
    `session_shutdown` de `pi-subagents` que faltaba (el SDK de Pi en Frida no
    emite ese evento). Antes, un agente worktree interrumpido dejaba el worktree
    para siempre.
  - El cleanup ahora ocurre también en sub-agentes **background** (encadenado al
    promise) y en el path de **error/abort** (`finally`), no solo en foreground
    exitoso.

## [0.5.0] - 2025-08-02

### Añadido

- **`frida-multi-skills`** — invoca skills desde **cualquier parte del prompt**
  con la sintaxis `$skill_name` y combina **varias en un solo mensaje** (porte
  de [`pi-multi-skills`](https://github.com/QuangThai/pi-multi-skills) v1.1.3).
  La expansión produce el mismo bloque `<skill>` que `/skill:xxx`, así el modelo
  lo procesa idéntico; la diferencia es ergonómica (posición libre + multi).
  Incluye autocomplete `$` en el composer y comandos `/skills` +
  `/skills-search`, que abren un **overlay navegable** (búsqueda en vivo + botón
  "insertar" que manda `$name` al composer) en vez de una toast efímera. Ver [ADR-0024](./docs/adr/0024-frida-multi-skills-porter-pi-multi-skills.md).

- **`frida-pix-skills`** — carga **skills on-demand** con el tool `read_skills`
  (patrón "el agente se auto-promptea"), interpola directivas `` !`cmd` `` con
  estado vivo del repo al leerlas y da acceso al ecosistema **Skills.sh**
  (porte de [`@xynogen/pix-skills`](https://github.com/xynogen/pix-mono/tree/main/packages/pix-skills)
  v0.7.4). Sin bundle propio: opera sobre skills existentes, no añade nuevas →
  no colisiona con `frida-pipeline`. Gate de directivas → `frida-permission-system`.
  Ver [ADR-0025](./docs/adr/0025-frida-pix-skills-porter-pix-skills.md).

- **`frida-supi-web`** — porte nativo de
  [`@mrclrchtr/supi-web`](https://www.npmjs.com/package/@mrclrchtr/supi-web) que
  aporta tres tools web que Frida **no incluía** (supi-web vive en `~/.pi`, no en
  el `agentDir` de Frida `~/.frida`). Mismo patrón de porte nativo que
  `frida-agent-browser` (misma `ExtensionAPI` de Pi, **sin** renderers Ink, que
  el webview ignora). Tres tools para el modelo:
  - **`web_fetch_md`** — descarga una URL pública `http(s)` y la devuelve como
    **Markdown limpio** (negociación de contenido en cascada: Markdown nativo
    vía HEAD → sniff del content-type → URL sibling `.md` → HTML→Markdown con
    Readability + Turndown + GFM). Soporta `output_mode` `auto`/`inline`/`file`,
    `abs_links` y `timeout_ms`; trunca a 2000 líneas/50 KB y vuelca el resto a
    un temp.
  - **`web_docs_search`** / **`web_docs_fetch`** — búsqueda y fetch de
    documentación de librerías vía **Context7**. La API key se gestiona con
    **`/login context7`** (SecretStorage, como los proveedores de modelos), con
    fallback a `CONTEXT7_API_KEY` del entorno.
  - **Rendering en el webview** — a diferencia del referencia (UI colapsada en
    el TUI de Pi), estas tools delegan en el `ToolCard` genérico, que ahora las
    muestra como **Markdown** (no `<pre>`) con iconos `Globe`/`Library`/`BookOpen`
    y el argumento principal (URL / `library_id`) en la cabecera.
  Sin dependencia del paquete npm en runtime: la lógica de
  fetch/conversión/Context7 es un porte. Documentación:
  [`docs/tools/frida-supi-web.md`](./docs/tools/frida-supi-web.md).

### Cambiado

- **`/login context7`** / **`/logout context7`** — gestionan la API key de
  Context7 en SecretStorage (`frida.context7Key`), inyectada en memoria a las
  tools `web_docs_*` vía un getter síncrono (`getContext7Key`) que recorre
  `CreateFridaSessionOptions` → `createFridaSupiWeb({ getKey })` → cliente REST.
  Patrón ADR-0017 aplicado a un servicio **no-LLM** (Context7 no pertenece a
  `API_KEY_PROVIDERS`). Fallback a `CONTEXT7_API_KEY` del entorno para sesiones
  hijas offline / CI.
- **`tsconfig.json`** — añadido `DOM` + `DOM.Iterable` al `lib` del host
  (necesario para los tipos de `jsdom` y la iteración de `NodeListOf` en
  `querySelectorAll`). No rompe código existente de `src/` (verificado).
- **`src/pi-session.ts`** — montaje de `frida-supi-web` junto al resto de tools
  nativas (tras `frida-agent-browser`).
- **`webview/components/ToolCard.tsx`** — `TOOL_INFO` + caso Markdown para las
  tres tools web.
- **`esbuild.js`** — `jsdom` añadido a `external`. **Fix crítico:** jsdom, al
  importarse, lee `default-stylesheet.css` con `path.resolve(__dirname, "../../../browser/...")`
  asumiendo su estructura interna; si se bundlea, `__dirname` = `dist/` y la ruta
  se rompe → `ENOENT` que tiraba `activate()`. Como `external`, jsdom se resuelve
  desde `node_modules` en runtime (estructura intacta); además `extension.js`
  baja ~12 MB (30 → 18 MB).

### Dependencias

- `jsdom@^30`, `@mozilla/readability@^0.6`, `turndown@^7`,
  `turndown-plugin-gfm@^1` (dep runtime) — conversión HTML→Markdown.
- `@types/jsdom`, `@types/turndown` (devDeps).

### Limitaciones

- **Sin setting de toggle** (`frida.supiWeb.enabled`); siempre activa. Main only
  (las sesiones hijas de workflow no la cargan, igual que `frida-agent-browser`).

## [0.4.0] - 2025-07-31

### Añadido

- **`frida-mcp-adapter`** — integración MCP (Model Context Protocol) que da
  acceso al ecosistema de servidores MCP sin quemar contexto (ADR-0023). Un
  único tool proxy `mcp({})` (~200 tokens) reemplaza cientos de definiciones
  de herramientas. Wrapper delgado sobre [`pi-mcp-adapter`](https://github.com/nicobailon/pi-mcp-adapter)
  v2.17.0.

- **Tool proxy `mcp({})`** con 10 modos: status, list, search, describe,
  call, connect, instructions, auth-start, auth-complete, ui-messages. El
  agente descubre y ejecuta herramientas on-demand.

- **Lifecycle de servidores** — lazy (default), eager, keep-alive,
  lazy-keep-alive. Idle timeout configurable (10 min default). Health checks
  y auto-reconnect.

- **Config jerárquica** — lee `.mcp.json` (estándar compartido con Claude,
  Cursor, Windsurf), `~/.config/mcp/mcp.json`, y overrides de Frida
  (`~/.frida/mcp.json`, `.frida/mcp.json`). Imports de configs de otros
  agentes (Cursor, Claude Code, Codex, Windsurf, VS Code, OpenCode).

- **OAuth 2.1 completo** — PKCE, dynamic client registration, callback server
  HTTP, tokens persistidos en el keyring nativo del SO (macOS Keychain). Soporta
  headless/SSH via `mcp({ action: "auth-start" })`.

- **Direct tools** — registrar tools MCP específicos como first-class tools
  del agente (visibles en la tool list).

- **Metadata cache** — caché persistente en disco para que search/list/
  describe funcionen sin conexiones activas.

- **Output guard** — protege el contexto de responses oversized (50 KiB /
  2000 líneas inline, resto a temp file). Kill switch `MCP_OUTPUT_GUARD=0`.

- **Slash commands `/mcp` y `/mcp-auth`** — panel interactivo de status,
  reconexión, OAuth, setup guiado.

- **MCP prompts como slash commands** — `/mcp__<server>__<prompt>`.

- **`app-bridge.bundle.js`** copiado a `dist/` para MCP UI integration
  (iframes interactivos en browser).

### Cambiado

- **`PI_CODING_AGENT_DIR`** se setea a `~/.frida/` antes de inicializar el
  adapter, redirigiendo metadata cache, OAuth legacy y override global a
  Frida.

- **esbuild.js** — añadido `@napi-rs/keyring` + `@napi-rs/keyring-*` a
  `external`; plugin `stubSamplingHandler` (sampling handler stubbeado por
  incompatibilidad de API `complete` en pi-ai v0.81+); shim
  `import.meta.dirname`; copy step para `app-bridge.bundle.js`.

- **`tsconfig.json`** — `allowImportingTsExtensions: true` (pi-mcp-adapter
  importa con extensión `.ts`).

### Dependencias

- `pi-mcp-adapter@2.17.0` (devDep) — wrapper del upstream.
- `@modelcontextprotocol/sdk@1.30.0` (transitiva) — SDK de MCP, bundleado.
- `@modelcontextprotocol/ext-apps@1.7.5` (transitiva) — MCP UI ext-apps.
- `@napi-rs/keyring@1.3.0` (dep runtime) — keyring nativo del SO.
- `recheck`, `smol-toml`, `ajv-formats` (transitivas) — bundleadas.

### Limitaciones

- **Sampling deshabilitado** — `pi-ai` v0.81+ removió la función `complete`
  que el sampling handler usa. El handler se stubbeó como no-op. La mayoría
  de servidores MCP no usan sampling.
- **Keyring en Linux/Windows** — sólo `@napi-rs/keyring-darwin-arm64` se
  incluye en el VSIX. En otras plataformas, OAuth no persiste (el proxy tool
  y direct tools funcionan normalmente).

### Interno

- 28 tests nuevos (wrapper, keyring, integration). Total: 808 tests.
- ADR-0023 documentando las 7 decisiones firmadas (D1–D7).
- Documentación: `docs/tools/frida-mcp-adapter.md`.

## [0.3.0] - 2025-07-31

### Corregido

- **Error "Failed to load extension: Invalid URL"** al cargar extensiones
  externas desde `~/.frida/extensions/` o `.frida/extensions/`. El shim de
  `import.meta.resolve` en el bundle CJS devolvía el specifier tal cual
  (ej. `"@earendil-works/pi-ai/compat"`) cuando `require.resolve` fallaba, y
  `fileURLToPath()` de un bare specifier → TypeError. Ahora el shim devuelve
  `__import_meta_url` (el propio bundle) como fallback.
- **Añadido `dist/sdk-passthrough.js`** — re-exporta la API pública del SDK
  (`defineTool`, `ExtensionAPI`, etc.) para que las extensiones externas
  cargadas vía jiti puedan resolver `@earendil-works/pi-coding-agent`.
- **Plugin `fixExtensionLoader`** en `esbuild.js` — parchea `loader.js` del SDK
  durante el build para que `getAliases()` no calcule rutas inexistentes en el
  bundle CJS.

### Añadido

- **`frida-subagents`** — sub-agentes autónomos estilo Claude Code sobre Pi
  Agent (ADR-0022). Cero dependencias npm nuevas; extiende `frida-pipeline`
  con spawning de agentes hijos via 3 tools (`Agent`, `get_subagent_result`,
  `steer_subagent`).

- **3 tools de modelo:**
  - **`Agent`** — lanza un sub-agente (foreground síncrono o background
    asíncrono). Soporta `subagent_type`, `prompt`, `description`,
    `run_in_background`, `resume`, `max_turns`, `model`, `thinking`,
    `inherit_context`, `isolation: worktree`.
  - **`get_subagent_result`** — obtiene el resultado de un agente background
    (con `wait: true` bloquea hasta completar; `verbose` trae la
    conversación).
  - **`steer_subagent`** — inyecta un mensaje de steering a un agente en
    corrido para redirigirlo.

- **Registry de tipos de agente:**
  - 3 built-in: `general-purpose`, `Explore`, `Plan`.
  - **Agentes personalizados** desde `.frida/agents/*.md` y
    `~/.frida/global/agents/*.md` con frontmatter YAML (name, description,
    model, tools, promptMode, etc.). `safeParseFrontmatter` con fallback si
    el YAML parser estricto falla.
  - **Tool scoping** — cada agente restringe las tools disponibles via
    `allowedToolNames`.
  - **Override de system prompt** — `promptMode: replace` o `append`.

- **Lifecycle completo (Fase 2-4):**
  - **Cola de concurrencia** — máximo 4 agentes simultáneos (configurable
    via `~/.frida/subagents.json`). `acquireSlot`/`releaseSlot` con queue.
  - **Group join** — modo `smart` (si todos completed), `async` (fire &
    forget), o `group` (espera con timeout de 30s).
  - **Notificaciones** — `ctx.ui.notify` al completar/error/abortar.
  - **Graceful max_turns** — steering "wrap up" al llegar al límite, grace
    de 5 turnos antes de hard-abortar.
  - **Settings** — `~/.frida/subagents.json` (global) con override por
    proyecto. Schema TypeBox.
  - **`/agents`** — comando slash que muestra agentes corriendo, tipos
    disponibles y settings.

- **Aislamiento + memoria + skills (Fase 5):**
  - **`isolation: worktree`** — crea un git worktree con branch
    `pi-agent-<id>`, commitea cambios al completar (`cleanupWorktree`).
  - **`memory: project|local|user`** — directorio persistente
    `.frida/agent-memory/<name>/MEMORY.md`. Inyecta contenido al system
    prompt; read-only si el agente no tiene tools de escritura.
  - **`skills`** — precarga SKILL.md desde `~/.frida/skills/` al system
    prompt (proyecto tiene prioridad sobre global).

- **UI widget React fridaWeb (Fase 6):**
  - **Widget persistente en el footer** — muestra agentes corriendo con
    icono de estado (● ○ ✓ ✗ ■), tipo, descripción y tiempo transcurrido.
  - **Auto-prune** — elimina agentes completados tras 10s del widget.
  - **Store reactivo** — `useSyncExternalStore` sobre `agentWidgetStore`;
    auto-hide cuando no hay agentes.

### Cambiado

- **`/agents`** ahora es async y monta el widget del webview la primera vez
  que se invoca.

## [0.2.0] - 2025-07-31

### Añadido

- **`frida-pipeline`** — orquestador nativo que ata las 5 extensiones existentes
  y aporta paridad funcional con `rpiv-pi` (ADR-0021). Cero dependencias npm
  nuevas; mismo patrón de porte nativo que frida-workflow (ADR-0020).

- **Hooks invisibles de sesión:**
  - **Guidance recursiva** — inyecta `AGENTS.md` > `CLAUDE.md` >
    `.frida/guidance/<sub>/architecture.md` al tocar archivos (`tool_call`).
  - **Git-context** — branch + commit + user inyectado en `session_start`,
    `session_compact` y `before_agent_start` (con dedup por firma).
  - **Pipeline pointer** — índice de skills inyectado en cada inicio de sesión
    (`frida-pipeline-index`).
  - **Skill-bracket** — override de modelo/thinking por skill via
    `~/.frida/models.json`. El hook `input` detecta `/skill:<name>` y aplica
    el override; `agent_end` lo restaura.

- **27 skills** en español de México, distribuidas en 4 lotes:
  - Descubrimiento: `discover`, `research`, `explore`
  - Diseño: `design`, `design-slice`, `design-review`, `slice`
  - Planificación: `plan`, `blueprint`, `synthesize`, `elaborate`, `revise`
  - Ejecución: `implement`, `validate`, `grade`, `amend`, `commit`
  - Revisión: `code-review`, `architecture-review`, `pr-triage`
  - Utilidades: `create-handoff`, `resume-handoff`, `changelog`
  - Anotación: `annotate-guidance`, `annotate-inline`, `migrate-to-guidance`
  - Frontend: `frontend-design`

- **15 subagentes** sincronizados al agentDir global (`~/.frida/global/agents/`)
  con tracking sha256 para detectar drift. `/frida-update-agents` fuerza
  re-sincronización.

- **3 workflows built-in:**
  - `/wf build "<feature>"` — pipeline completo (7 stages)
  - `/wf vet` — revisión enfocada (2 stages)
  - `/wf polish` — pulido estructural (4 stages)

- **3 slash commands nuevos:**
  - `/pipeline` — estado del orquestador + banner persistente
  - `/frida-models` — editor de overrides de modelo por skill
  - `/frida-update-agents` — re-sincroniza los 15 agentes

- **ADR-0021** documentando las 7 decisiones firmadas (D1–D7).

- **Documentación:** `docs/tools/frida-pipeline.md`, `docs/adr/0021-*.md`,
  análisis de descubrimiento en `.rpiv/artifacts/discover/`.

### Interno

- `src/tools/frida-pipeline/` — 16 módulos TS (guidance, git-context,
  session-hooks, skill-bracket, models-config, session-capture, agents-sync,
  skills-sync, pipeline-pointer, workflows, banner, panel, siblings, etc).
- Skills y agentes se sincronizan a `~/.frida/` al iniciar sesión (once-per-process).
- `customType` con prefijo `frida-*` para coexistir con `rpiv-pi` sin colisión.
- Artefactos en `.frida/artifacts/` (no `.rpiv/`).
- 175 tests nuevos (frida-pipeline: 46 archivos, 679 tests totales).

## [0.1.0] - 2026-07-30

### Añadido

- **Vista lateral en la barra de actividad.** Frida Code abre en el sidebar (con el
  icono lila del favicon) en vez de como tab de editor. Es arrastrable al sidebar
  secundario (como Copilot).
- **Badge de versión** `vX.Y.Z` en el sub-header + comando **`/version`**.
- **Comando `/update`**: consulta la última release en GitHub y avisa si hay versión
  nueva (soporta `GITHUB_TOKEN` para repos privados).
- **`CHANGELOG.md`** (esta pestaña).
- Banner del **código de dispositivo OAuth** (login de Copilot) visible en el chat
  principal, no solo en onboarding/model-panel.
- Diálogo de `ask_user_question`: tabs, filas de opción (radio/checkbox) y pestañas
  por pregunta.

### Cambiado

- **`media/frida-logo.png`** regenerado desde `favicon.svg` (coincide con el favicon
  y el icono de la barra de actividad).
- **Modelo de distribución:** el `.vsix` ya **no** se versiona en el repo
  (`*.vsix` en `.gitignore`); se regenera con `npm run package` y se distribuye por
  GitHub Releases.
- Toasts rediseñados (niveles info/warning/error/success, iconos, errores
  persistentes); razonamiento y ToolCards con estilo de tarjeta.

### Corregido

- **Login de GitHub Copilot:** `ERR_MODULE_NOT_FOUND` del OAuth — los flujos OAuth
  ahora se bundle estáticamente (`registerBunOAuthFlows` de pi-ai).
- **Persistencia de provider/model** entre recargas (z.ai / Copilot).
- **Errores de login vacíos** serializados correctamente (`describeLoginError`).
- Errores terminales del provider visibles (401 silencioso del gateway).

### Interno

- `package.json`: campo `repository`, `viewsContainers`/`views` (vista lateral),
  flag `--allow-missing-repository` en el script `package`.

## [0.0.1] - 2026-07-21

PoC inicial: Pi SDK + Softtek DevEngine Gateway, gates de aprobación tipo Claude
Code, webview React, y las herramientas frida-workflow, frida-agent-browser,
frida-permission-system, frida-context, todo y ask-user-question-web.
