# cc-plugins — factibilidad: wrapper de `@nklisch/pi-plugins` vs porte nativo del diseño

**Tipo:** nota de investigación (sustenta la decisión de arquitectura del issue #49).
**Fecha:** 2026-08-15.
**Pregunta:** ¿Cómo instala frida plugins de Claude Code sin empezar de 0 — envolviendo
`@nklisch/pi-plugins` (wrapper) o portando su diseño (readers + contrato de conversión)
a una extensión nativa de frida?
**Fuentes:** [`@nklisch/pi-plugins@0.3.5`](https://github.com/nklisch/pi-extensions/tree/main/packages/pi-plugins)
(npm, MIT; probe empírico en [`cc-plugins-jiti-probe.mjs`](cc-plugins-jiti-probe.mjs)) ·
[COMPATIBILITY.md](https://github.com/nklisch/pi-extensions/blob/main/packages/pi-plugins/docs/COMPATIBILITY.md)
upstream · [docs de plugins de Claude Code](https://code.claude.com/docs/en/plugins).

## TL;DR — veredicto

**Tres rondas; se recomienda el porte nativo del diseño** (referencias: `@nklisch/pi-plugins` para readers + contrato, `pi-claude-marketplace` para arquitectura runtime — ver Ronda 3). El probe
cargó el upstream completo con el mecanismo wrapper (jiti + aliases + fake
ExtensionAPI), arrancó el Plugin Host (layout íntegro en `<agentDir>/plugin-host/`,
sqlite operativo, `/plugins list` respondiendo) y hasta materializó un marketplace
real de GitHub (`nklisch/skills`). Pero el costo runtime es alto y el beneficio real
resulta ser **el diseño, no el runtime**: los readers de formato y el contrato
COMPATIBILITY.md son la parte valiosa; el host transaccional duplica infraestructura
que frida ya es. El porte nativo elimina además los riesgos de versiones de Node y de
drift de receipts que el wrapper arrastra.

## Ronda 1 — probe empírico del wrapper (script anexo)

Mecanismo probado (idéntico al patrón hermes-memory/knowledge-base):

```text
npm install @nklisch/pi-plugins --prefix <dir> --legacy-peer-deps
jiti(entry, { alias }) + PI_CODING_AGENT_DIR=<agentDir> → factory(pi)
```

### Mapa de aliases jiti (hallazgo reutilizable)

El SDK shipeado importa **8 specs** de los peers (enumeradas escaneando
`dist/**/*.js` del SDK y del upstream); un alias archivo-a-archivo rompe los
subpaths (`<alias>/compat` no existe), así que el mapa es por subpath exacto:

| Spec | Destino en el VSIX |
| --- | --- |
| `@earendil-works/pi-coding-agent` | top-level `pi-coding-agent/dist/index.js` |
| `@earendil-works/pi-tui` | nested `pi-tui/dist/index.js` |
| `@earendil-works/pi-ai` | nested `pi-ai/dist/index.js` |
| `@earendil-works/pi-ai/compat` | nested `pi-ai/dist/compat.js` |
| `@earendil-works/pi-ai/oauth` | nested `pi-ai/dist/oauth.js` |
| `@earendil-works/pi-ai/bedrock-provider` | nested `pi-ai/dist/bedrock-provider.js` |
| `@earendil-works/pi-ai/bun-oauth` | nested `pi-ai/dist/bun-oauth.js` |
| `@earendil-works/pi-ai/providers/all` | nested `pi-ai/dist/providers/all.js` |

Las 8 existen ✅. Este mapa aplica a **cualquier** futuro wrapper que cargue el
mismo grafo de peers.

### Resultados del probe (secuencia de hallazgos)

1. **Factory carga limpia**: registra comando `/plugins`, tool `mcp` y 10 eventos
   (`session_start/shutdown`, `before_agent_start`, `resources_discover`, `input`,
   `tool_call/result`, `session_before_compact/compact`, `agent_settled`).
2. **`node:sqlite` funciona** en Node 25 (warning experimental) — 6 módulos lo
   importan estáticamente; es la razón del `engines: node>=24` del upstream.
3. **Extension host de VS Code 1.132 = Node 24.18.0** (Electron 42.7.1) → el riesgo
   de versiones **no aplica en el host actual**, pero sí para cualquier usuario con
   VS Code más viejo.
4. Fricciones de fake/entorno encontradas y resueltas en el probe (cada una, una
   potencial trampa en producción): el ctx exige `sessionManager.getSessionId()`
   estable + `isProjectTrusted(): boolean` (binding estricto de sesión);
   `pi.getCommands()`; `ctx.signal` debe ser AbortSignal real o undefined; y el
   **layout rechaza symlinks en el path** del host root (en macOS,
   `~` → `/Users` está bien pero `/var` → `/private/var` revienta — frida debe
   pasar `realpathSync(agentDir)`).
5. **El Plugin Host arrancó completo**: `plugin-host/{state,stores,recovery,locks,
   configuration,staging}/v1` + 5 bases sqlite; `/plugins list` responde tras ~0.5s
   de arranque async.
6. **E2E de red**: `/plugins marketplace add nklisch/skills` clonó y materializó el
   marketplace bajo `stores/v1/marketplaces/<sha>/` ✅.

Superficie de API consumida (proxy-contada): `registerCommand/registerTool/on/
getCommands/mode/hasUI/cwd` + en runtime `sendMessage`, `setSessionName`,
`registerMessageRenderer`, `appendEntry` — **toda existe** en el ExtensionAPI del
SDK 0.84.2 ✅. En frida real, `registerMessageRenderer`/`appendEntry` requieren que
la sesión sea la principal (main only).

### Por qué el wrapper es frágil a pesar de funcionar

- **`node>=24`** acoplado a `node:sqlite` experimental: funciona en VS Code 1.132
  (Node 24.18) pero rompe en hosts más viejos y queda a merced de cambios en la API
  experimental.
- **Binding estricto de sesión + symlink-phobia + arranque async**: el host está
  diseñado para la TUI de pi, no para el ciclo de vida del extension host (recargas,
  sesiones hijas de workflow, workspaces multi-root).
- **Receipt checks contra sus forks** (`@nklisch/pi-mcp-adapter`,
  `@nklisch/pi-subagents` pinneados): con SDK 0.84.2 las capacidades MCP/subagentes
  de plugins pueden degradar silenciosamente; el contrato dice explícitamente que
  "Package, API, runtime-range drift makes the affected capability unavailable".
- **13 MB / 417 módulos** de runtime que duplican lo que frida ya tiene (loader de
  skills, dispatcher de prompts, subagents, mcp-adapter, permission gates).

## Ronda 2 — porte nativo del diseño (recomendado)

**Frida ya es el host.** Lo que falta es la capa de lectura + conversión de formato
Claude → artefactos nativos frida. El upstream demuestra (y documenta en
COMPATIBILITY.md) exactamente qué se puede convertir fielmente.

### Qué se copia del upstream (MIT, atribución en el doc)

| Parte | Uso |
| --- | --- |
| `dist/formats/claude/{manifest,marketplace,mcp,hook,state,user-config}-reader` | **Diseño de los readers** (parsing puro, nunca ejecutan) |
| `COMPATIBILITY.md` | **Especificación del contrato**: tabla evento Claude↔pi, matcher de tools, placeholders de entorno, verdicts (Supported/Metadata-only/Incompatible) |
| Verdicts por componente | Semántica de degradación suave ("instala, salta lo no soportado, repórtalo antes de activar") |

### Qué NO se portea

Host transaccional (sqlite/journals/leases/receipts — estado frida en JSON +
receipt idempotente), manager TUI, forks bundled de mcp/subagents, `/plugins`
upstream completo.

### Tabla de conversión (el corazón del porte)

| Componente Claude | Destino frida | Conversión |
| --- | --- | --- |
| `skills/<n>/SKILL.md` | Skills pi — **casi 1:1** (estándar Agent Skills compartido) | Copiar a `~/.frida/skills/plugins/<plugin>/<skill>/` (dirs que el loader ya escanea); namespacing por subdirectorio o frontmatter (decisión de diseño del ADR) |
| `commands/*.md` | Prompts pi materializados (patrón probado en frida-knowledge-base) | Frontmatter compatible; `$ARGUMENTS` idéntico; nombre `<plugin>-<cmd>` (los `:` no son seguros en nombres de archivo) |
| `.mcp.json` | `frida-mcp-adapter` (mismo estándar `{mcpServers}`) | Extraer, renombrar server a `<plugin>-<name>`, **sustituir placeholders** (`${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PROJECT_DIR}`, `${user_config:*}`) con el root instalado, fusionar al config con procedencia; enable/disable = entradas |
| `agents/*.md` | `frida-subagents` (`custom-agents.ts`) | Frontmatter → formato propio + **remapear tools** (Bash→bash, Read→read, Glob→find, Grep→grep, Edit→edit — mapa documentado en COMPATIBILITY.md) |
| `hooks/hooks.json` | Eventos pi + **approval gates de frida** | El más sensible (shell commands en eventos). El upstream solo soporta `type: "command"`; MVP: metadata-only u opt-in explícito por evento |
| `marketplace.json` | Reader propio (~100 líneas, diseño upstream) | GitHub shorthand + clone a `~/.frida/plugins/<plugin>@<rev>` (revisión inmutable) |
| `.lsp.json`, `monitors/`, `bin/`, `settings.json` | — | Metadata-only documentado (idéntico veredicto upstream: "Retained; not activated") |

Nota: el upstream retiene agents Claude pero **no los activa** ("Retained; not
activated" en COMPATIBILITY.md) — el porte frida puede activarlos vía
`frida-subagents`, que es valor agregado sobre el upstream.

### Trade-offs del porte

**Gana**: sin requisito Node 24 (nada de `node:sqlite`); sin drift de receipts;
estado y UX de confianza nativos de VS Code (notificaciones + gates, no prompts de
terminal); superficie mínima (~readers + convertidores + installer, no 13 MB).

**Pierde**: transaccionalidad pesada (innecesaria para install = clone + convertir +
receipt JSON idempotente); costo de seguir la evolución del formato Claude (mitigado:
readers chicos, formato estable, y el upstream como referencia viva de qué cambia).

## Ronda 3 — `pi-claude-marketplace@0.15.0` (acolomba, MIT) — segunda referencia

Detectada tras el ADR inicial; disección completa cambia varias decisiones.

**Qué es**: exactamente el use case de #49, ya implementado para pi — instala plugins
Claude (commands, skills, agents vía pi-subagents, hooks parcial, MCP vía
pi-mcp-adapter) desde marketplaces GitHub/GitLab/locales, con `/claude:plugin`
(install/update/reinstall/uninstall/list/info/fetch), bootstrap del oficial,
`import` desde settings de Claude Code, scopes user/project, y config declarativa
compartible. Muy activo (37 versiones; publish hace horas), CI+SonarCloud, código
 superdocumentado (bridges/domain/orchestrators/persistence/platform/transaction).

**Por qué es mejor referencia que nklisch para frida**: `node>=20.19` (sin sqlite,
sin Node 24), 2.6 MB vs 13 MB, deps puras (`isomorphic-git` → **sin binario git**
+ Device Flow GitHub; `proper-lockfile`; `write-file-atomic`), peers en nuestro
namespace `@earendil-works`.

**Patrones clave adoptables** (ver ADR-0057 revisado):

1. **`resources_discover` + root aislado**: materializan en su propio
   `<agentDir>/pi-claude-marketplace/resources/{skills,prompts}/` y exponen
   `skillPaths`/`promptPaths` vía el evento `resources_discover` del SDK — el
   resource loader los carga como recursos de extensión. Cero contaminación de
   dirs del usuario; enable/disable = no devolver paths; uninstall = borrar root.
2. **Config declarativa**: `claude-plugins.json` (+ `.local.json` override) por
   scope es la fuente de verdad; un *reconcile* al cargar la aplica
   (instalaciones automáticas y repetibles; commit del archivo = equipo sincronizado).
3. **Nombres**: elisión de prefijo (`acme` + `acme-foo` → `acme:foo`); skills en
   forma hyphen `/skill:acme-foo` con **reescritura de frontmatter por manipulación
   de strings** (sin eval YAML — mitigación de inyección de contenido no confiable).
4. **MCP sin renombrar**: chequean colisión contra los 4 slots de config
   (`~/.config/mcp/mcp.json`, agentDir `mcp.json`, `<cwd>/.mcp.json`,
   `<cwd>/.pi/mcp.json`) ANTES de instalar; **fallan si el nombre ya existe** —
   preserva las referencias por nombre que skills/commands hacen a los servers.
5. **Atomicidad por staging + rename** (mismo FS), phase-ledger + rollback ligeros.
6. Extras que validan fase 2: `--map-model` (sonnet/opus → modelos pi para agents),
   PATH de `bin/` de plugins (`recomputePluginPath`), hooks con dispatcher propio
   (7 eventos), fetch lazy de plugins remotos.

**Por qué NO envolverlo directo**: materializa prompts como archivos con `:` literal
en el nombre — *"POSIX targets allow this; **Windows is explicitly not targeted**"* —
y frida sí soporta Windows (NTFS prohíbe `:` en filenames). Además su peer
`pi-subagents` no es el que frida shipea (tenemos `frida-subagents` propio), y su
UI es TUI. El porte nativo queda confirmado, ahora con su arquitectura como plano.

## Relación con #16 y el PRD del marketplace

- **#16 `frida-plugins`** define el formato de *salida* de frida (híbrido
  pi-package + `.frida-plugin/`). Este porte define la *entrada* Claude Code. Ambos
  comparten infraestructura de instalación/namespacing.
- **PRD marketplace curado**: el marketplace necesita justamente un instalador de
  artefactos multi-formato; los readers de este porte son la base del adaptador
  "plugin Claude" de ese pipeline.

## Próximos pasos

1. ADR-0057: porte nativo — decisiones de namespacing de skills, formato del receipt
   JSON, scope del MVP (skills+commands+MCP primero; agents y hooks después).
2. PoC de conversión end-to-end con un plugin real de
   `anthropics/claude-plugins-official`.
