# `frida-agent-browser` (tools `agent_browser` + `agent_browser_web_search`)

Automatización de **navegador real** y **búsqueda web viva** para el agente. Porte nativo
del diseño de `pi-agent-browser-native`, que envuelve el binario upstream `agent-browser`
(Vercel Labs). Dos tools:

- **`agent_browser`** — conduce un navegador real (Chromium): leer docs vivos, abrir
  páginas, snapshots con `@refs`, clicks/fills, capturas, flujos autenticados, y **apps
  Electron de escritorio**.
- **`agent_browser_web_search`** — búsqueda web (Exa/Brave) para descubrir URLs sin
  chocar con anti-bot/CAPTCHA. Sólo aparece si hay credencial configurada.

> ⚠️ **El binario `agent-browser` no se empaqueta.** Se resuelve desde `PATH`. Si no está
> instalado, `agent_browser` responde `failureCategory: missing-binary` con instrucciones
> (no crashea). Ver [Instalación](#instalación).

## ¿Cuándo usarla?

- Leer docs/APIs vivas que cambian, o contenido dinámico (React, dashboards).
- Navegar flujos autenticados o verificar visualmente (screenshots/downloads).
- Multi-pasos de QA (`qa`) o flujos cortos (`job`).
- **Automatizar apps Electron de escritorio** (`electron`).
- **Descubrir URLs** rápidamente (`agent_browser_web_search`) en vez de llenar formularios
  de buscadores públicos (anti-bot).

**No** para: conducir buscadores públicos para discovery (usa web_search), ni recetas
reutilizables (no hay capa de recipes por diseño).

## Conceptos

- **Sesión implícita:** el tool reutiliza un navegador entre llamadas (mismo `--session`).
  No se relanza en cada call → estado persistente + eficiencia. `sessionMode:"fresh"`
  lanza uno nuevo (para flags launch-scoped como `--profile`/`--restore`).
- **`@refs`:** cada `snapshot -i` devuelve elementos interactivos etiquetados `@e1`,
  `@e2`… que usas en el siguiente click/fill. **Re-snapshotea** tras navegación/scroll.
- **`--json`:** el wrapper lo inyecta — **no** lo pases en `args`.
- **Stale-ref guard:** el wrapper **rehúsa** un `@ref` de mutación si la página navegó o el
  ref no estaba en el último snapshot (anti-misclick silencioso).
- **artifactVerification:** tras un screenshot/download, el wrapper verifica en disco que
  el archivo se guardó (PASS/FAIL confiable).
- **allowed-domains:** `--allowed-domains` confina la navegación (defense-in-depth).

## Configuración (opcional)

Config por capas (merge: global → proyecto → override):

- Global: `~/.frida/config/frida-agent-browser/config.json`
- Proyecto: `<cwd>/.frida/config/frida-agent-browser/config.json`
- Override: `PI_AGENT_BROWSER_CONFIG=/path/config.json`

```jsonc
{
  "version": 1,
  "browser": {
    "executablePath": "/path/to/chrome",                          // advisory: guidance --executable-path
    "defaultProfile": { "name": "Default", "policy": "always" }   // advisory: guidance --profile
  },
  "webSearch": {                        // habilita agent_browser_web_search
    "enabled": true,                    // default true salvo false explícito
    "preferredProvider": "exa",         // "exa" | "brave"
    "exaApiKey": "sk-...",              // literal | $ENV | ${ENV} | !command (lazy)
    "braveApiKey": "..."
  }
}
```

Los defaults de browser son **advisory** (generan guidance en el system prompt; **no** se
auto-inyectan). Las keys de webSearch aceptan literal, `$ENV`/`${ENV}` (interpolación) o
`!command` (resolución lazy vía secret manager). Fallback a `EXA_API_KEY`/`BRAVE_API_KEY`.

## Tool `agent_browser` — input-modes (uno por llamada, exclusión mutua)

| Modo | Cuándo |
| --- | --- |
| `args` | Argumentos CLI exactos de `agent-browser` (sin el binario, sin `--json`). El más flexible. |
| `semanticAction` | Click/fill/select por locator estable (`role`/`text`/`label`/`placeholder`/`alt`/`title`/`testid`) o `selector`/`@ref`. Sobrevive al churn de refs. |
| `job` | Flujo multi-paso → se compila a `batch [--bail]` con los pasos en `stdin`. |
| `qa` | Preset QA fail-fast: abre URL (o `attached:true`), verifica `expectedText`/`expectedSelector`, revisa console/errors/network, screenshot. |
| `electron` | Apps Electron de escritorio: `list`/`launch`/`status`/`cleanup`/`probe`. |

Campos comunes: `stdin` (sólo batch/eval/auth), `outputPath` (vuelca resultado a archivo),
`timeoutMs`, `sessionMode` (`"auto"` reutiliza, `"fresh"` lanza nuevo).

### Ejemplos `agent_browser`

```jsonc
// Receta: open → snapshot → click @ref → re-snapshot
{ "args": ["open", "https://example.com/"] }
{ "args": ["snapshot", "-i"] }
{ "args": ["click", "@e1"] }
{ "args": ["snapshot", "-i"] }   // tras navegar/cambiar el DOM

// semanticAction (locator estable)
{ "semanticAction": { "action": "click", "locator": "text", "value": "Close" } }
{ "semanticAction": { "action": "fill", "locator": "label", "value": "Email", "text": "a@b.com" } }

// job (multi-paso)
{ "job": { "steps": [
  { "action": "open", "url": "https://example.com/" },
  { "action": "assertText", "text": "Example Domain" },
  { "action": "screenshot", "path": ".dogfood/example.png" }
] } }

// qa (verifica texto)
{ "qa": { "url": "https://example.com/", "expectedText": "Example Domain" } }

// screenshot con verificación de artefacto
{ "args": ["screenshot", ".dogfood/page.png"] }
// → "Saved image: …/page.png (verified, 3742 bytes)" + details.artifactVerification
```

## `electron` — apps de escritorio

Automatiza apps Electron (VS Code, Slack, Obsidian…) con un perfil **aislado**
wrapper-owned + CDP.

```jsonc
{ "electron": { "action": "list", "query": "code", "maxResults": 10 } }   // descubre apps
{ "electron": { "action": "launch", "appName": "Obsidian", "handoff": "snapshot" } }  // lanza + conecta
{ "electron": { "action": "status", "all": true } }    // launches activos
{ "electron": { "action": "probe" } }                  // salud CDP del launch activo
{ "electron": { "action": "cleanup", "all": true } }   // mata + borra profile (también al apagar)
```

`launch` requiere **exactamente uno** de `appPath`/`appName`/`bundleId`/`executablePath`.
`appArgs` no puede incluir flags wrapper-owned (`--user-data-dir`, `--remote-debugging-port`…).
Tras launch, conecta con `agent_browser: { args: ["connect", "<port>"] }` si no se auto-conectó.

## Tool `agent_browser_web_search`

Búsqueda viva (Exa/Brave). **Sólo se registra si hay credencial** (config o env).

```jsonc
{ "query": "latest node.js LTS release notes", "count": 5 }
{ "query": "rust async runtime comparison", "provider": "brave", "freshness": "pm" }
```

Campos: `query`, `provider` (`auto`/`exa`/`brave`), `count` (1–10), `offset`, `country`,
`searchType` (Exa: `auto`/`deep`/…), `freshness` (`pd`/`pw`/`pm`/`py`). Devuelve resultados
compactos (title/URL/source/age/summary). En HTTP 429 → error (rate limit). **Cita las URLs**
en la respuesta.

## Seguridad y políticas

- **Stale-ref guard:** `click @e99` (ref desconocido) o un `@ref` tras navegación →
  bloqueado **antes de spawn** (`stale-ref` + nextAction `refresh-interactive-refs`).
- **artifactVerification:** screenshots/downloads verificados en disco (`details.artifactVerification.verified`).
- **Launch-scoped fail-clear:** `--profile`/`--restore`/… sobre una sesión activa sin
  `sessionMode:"fresh"` → `policy-blocked` + hint (en vez de ignorar el flag).
- **Sessionless:** `--help`, `auth`, `profiles`, `skills list`, `doctor`, `device list`…
  **no vinculan** sesión; `--help`/`--version` devuelven texto plano (sin `--json`).
- **allowed-domains:** si la navegación aterriza fuera del allowlist → `policy-blocked`.
- **bash-guard:** bloquea invocar `agent-browser` por bash (fuerza el tool nativo).

## Instalación

1. Instala el binario upstream **`agent-browser`** (Vercel):
   - <https://agent-browser.dev/>
   - <https://github.com/vercel-labs/agent-browser>
2. Verifica: `agent-browser --version` en una terminal.
3. **Recarga Frida** (Command Palette → `Developer: Reload Window`).

Si falta, `agent_browser` responde con un error graceful que incluye estas instrucciones.

## Integración con Frida

- **Built-in** en `src/tools/frida-agent-browser/`, registrada en `extensionFactories` de la
  sesión **principal** (no en hijas de workflow).
- **System prompt:** `before_agent_start` inyecta la regla "prefiere `agent_browser` sobre
  `agent-browser` por bash" + guidance advisory de config.
- **Hooks:** `tool_call` (bash-guard), `session_shutdown` (cierra sesión upstream + limpia
  launches Electron).
- Web search se **auto-registra** si hay credencial (config/env).

## Arquitectura / Internals

```
agente → agent_browser
  → resolveAgentBrowserInput (modo: args/semanticAction/job/qa/electron)
  → [electron] → host (list/launch/status/cleanup/probe) → registry
  → [otros]   → command-policy (sessionless? plain-text?)
                → stale-ref guard (pre-spawn)
                → ensureArtifactParentDirs
                → spawn("agent-browser", [--session?, …args, --json])
                → ENOENT → missing-binary | parse JSON → presentation
                → artifactVerification + allowed-domains check
```

Módulos (`src/tools/frida-agent-browser/`): `constants`, `prompt`, `schema`, `compile`,
`session`, `run`, `ref-guard`, `command-policy`, `navigation-policy`, `index`;
`results/{envelope,categories,snapshot,next-actions,artifacts,presentation}`;
`config/{policy,load}`; `web-search/{schema,providers,credentials,tool}`;
`electron/{cdp,discovery,launch,cleanup,registry,compile,schema,host}`.

## Alcance vs. el referencia (`pi-agent-browser-native`)

Cubre: input-modes `args`/`semanticAction`/`job`/`qa`/`electron`, sesión implícita,
bash-guard, system-prompt, **presentation** (snapshots `@refs` + categorías + nextActions),
**stale-ref guard**, **config** (perfiles/executable/search-keys), **artifactVerification**,
**web_search** (Exa/Brave), **command-policy** (sessionless + fail-clear), **electron**
(list/launch/status/cleanup/probe), **allowed-domains**.

**No portado** (bajo ROI): branch-restore (Pi-`session_tree`-específico),
`sourceLookup`/`networkSourceLookup` (experimental), render TUI Ink (Frida es webview).

## Ver también

- [Roadmap de fases](../frida-agent-browser-roadmap.md) — las 8 fases (todas ✅).
- [ADR-0020](../adr/0020-frida-workflow-porte-nativo.md) — patrón de portes nativos.
- [Extensiones](./extensions.md) — cómo crear tools propios.
- Upstream: <https://agent-browser.dev/> · <https://github.com/vercel-labs/agent-browser>

## Estado y madurez

✅ **Fases 1–8 implementadas** (porte completo). **204 tests del módulo** + smoke E2E real
contra `agent-browser` 0.33.1 (snapshots, stale-ref, artifact-saved, electron list de apps
reales, allowed-domains). typecheck/build en verde. web_search sin API key real en smoke
(necesita credencial Exa/Brave).
