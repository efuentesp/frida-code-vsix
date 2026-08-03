# ADR-0026: Portear pi-git-sync como frida-git-sync

**Estado**: Propuesto
**Fecha**: 2025-08-03
**Autor**: Edgar F. Fuentes Perea

## Contexto

Frida no tiene forma de mantener la **misma configuración en varias máquinas**.
El agentDir (`~/.frida`) contiene `settings.json`, `extensions/`, `skills/`,
`global/agents/`, `AGENTS.md`, `keybindings.json`, etc. — todo estado que se
diverge entre equipos y se pierde ante un cambio de máquina.

`@jachy/pi-git-sync` (v0.6.2, MIT) resuelve esto para Pi: sincroniza el agentDir
vía un **repo Git privado** con un modelo three-way (baseline → local → remoto),
rebase no destructivo, rama de recuperación por dispositivo, secret-scanning
antes de push, backups pre-apply con rollback, y resolución de conflictos
(asistente / local / remoto / abortar).

### Por qué un porte y no instalar pi-git-sync como extensión externa

`pi-git-sync` depende del **TUI de Pi** (`@earendil-works/pi-tui` para
`matchesKey`/`SelectItem`, y `ctx.ui.setStatus`/`ctx.ui.custom` que son
**no-op** en frida) y asume el agentDir de Pi (`~/.pi/agent` vía
`PI_CODING_AGENT_DIR`). Frida usa un **webview** (no el TUI) y su agentDir propio
es `~/.frida` (ADR-0010). Instalarlo tal cual dejaría la UI de progreso/diff
rota (setStatus/custom no muestran nada) y sincronizaría `~/.pi` en vez de
`~/.frida`.

Como ya ocurrió con `frida-pipeline` (ADR-0021), `frida-subagents` (ADR-0022),
`frida-mcp-adapter` (ADR-0023), `frida-multi-skills` (ADR-0024) y
`frida-pix-skills` (ADR-0025), el patrón correcto es un **porte nativo embebido**.

## Decisiones del usuario

Se eligieron (todas las recomendadas en la propuesta de diseño):

- **D1: Capa git** → enrutar por `pi.exec` (no spawn directo).
- **D2: Paquetes** → porteo completo (no MVP).
- **D3: UI** → comando `/fridasync` **+ panel `fridaWeb`** en el footer con botón Cancel.
- **D4: Alcance** → porte completo (las 4 capas del upstream).

## Decisiones

### D1: Capa git por `pi.exec` vía inyección (`setGitExecutor`)

`pi-git-sync` trae su propio spawner (`runGitProcess`) con kill del **árbol de
procesos** (para SSH), límite de output (20 MB) y cancelación por `AbortSignal`.
Frida prefiere enrutar el shell por `pi.exec` (ADR-0021 §R9), que soporta
`{ signal, timeout, cwd }` y reporta `killed`.

Para conciliar ambos **sin tocar las ~40 operaciones de alto nivel** de `git.ts`
(`gitStatus`, `gitRebase`, `gitPush`, etc.) ni a `commands.ts` (que las llama),
se añadió **inyección a nivel módulo**:

```ts
export interface GitExecutorRequest { dir; gitArgs; timeoutMilliseconds; abortSignal }
export type GitExecutor = (request: GitExecutorRequest) => Promise<GitCommandOutput>;
export function setGitExecutor(executor): void;
```

`runGitProcess` invoca al override si está seteado; si no, usa el spawner nativo
(fallback, útil para tests). La factory `createFridaGitSync` instala un adapter
que llama `pi.exec("git", …)` y, en fallo, rechaza con un objeto con la forma
interna `GitProcessFailure` (`{ code, killed, message, stdout, stderr }`) para
que `gitExec` lo siga mapeando a `GitCommandError`.

> **Nota de robustez**: `pi.exec` mata el proceso git pero **no garantiza** matar
> el árbol SSH. Se mitiga con `GIT_SSH_COMMAND` (StrictHostKeyChecking) y el
> timeout/watchdog de `operation-runner`. El fallback a spawn propio permanece
> disponible para entornos que lo necesiten.

### D2: Sub-sistema de paquetes **sin cambios** (CLI `pi` en PATH)

El diseño original proponía reemplazar `pi install/remove` (vía `execFile`) por
`handlePackageCommand` del SDK. En la implementación se descubrió que
`handlePackageCommand` **no es API pública** del barrel del SDK (existe en
`dist/package-manager-cli.js` pero no se exporta). En cambio, el **CLI `pi` está
en PATH** (`~/.nvm/.../bin/pi`) y opera sobre el mismo SDK embebido. Conclusión:
`packages.ts` funciona **tal cual** — `isPiCliAvailable` + `pi install/remove`
(con `PI_CODING_AGENT_DIR=~/.frida`) instalan en el agentDir correcto. Si el CLI
no está, `executePackagePlan` reporta el error con instrucciones manuales
(comportamiento del upstream). **Cero ediciones** en `packages.ts`.

### D3: UI webview + panel `fridaWebMount` con Cancel

| Hook del upstream | En frida |
| --- | --- |
| `ctx.ui.setStatus` (footer TUI) | **no-op** → panel `fridaWebMount` en el footer |
| `ctx.ui.notify` / `confirm` / `input` / `select` | **directo** (diálogos/toast del webview) |
| `ctx.ui.custom` (render diff) | `notify` truncado (diff puede ser largo) |
| `matchesKey`/Esc (cancel, pi-tui) | **botón Cancel** del panel → `host.onCancel` |
| `getArgumentCompletions` (SelectItem) | descartado (subcomandos triviales) |

El patrón replica `frida-subagents`: **store** reactivo (`syncWidgetStore` con
`subscribe`/`getSnapshot` para `useSyncExternalStore`) + **widget** React
(`GitSyncWidget.tsx`, elementos `<fbox>`/`<ftext>`/`<fbutton>`) + **wiring**
(`wireGitSyncWidget`, idempotente, llamado por el host). El cancel manual se
conecta así: `operation-runner` invoca `host.onCancel(cancel)` → el handler lo
registra en `syncWidgetStore.setCancellable(cancel)` → el botón Cancel del panel
invoca `syncWidgetStore.cancel()` → el runner aborta → `pi.exec` cancela el git
vía `signal`.

### D4: agentDir `~/.frida` y paths

- La factory setea `process.env.PI_CODING_AGENT_DIR = ~/.frida` (si no estaba),
  de modo que `getAgentDir()` del upstream opera sobre el agentDir correcto sin
  tocar cada call-site.
- `defaultPath` del repo: `join(agentDir, "config-repo")` → `~/.frida/config-repo`
  (el upstream usaba `join(agentDir, "..", "config-repo")` porque su agentDir era
  `~/.pi/agent`; el de frida es directamente `~/.frida`).
- Fallback de `getAgentDir()` corregido a `~/.frida` (robustez si la factory no
  seteó el env).
- Scaffold del repo: `settings.json` vacío `{}` (sin auto-bundle del upstream);
  `hasScaffoldSettingsPlaceholder` detecta `{}` en vez de
  `{packages:["npm:@jachy/pi-git-sync"]}`.
- Eliminado el check de `validate.ts` que **exigía** `pi-git-sync` en `packages`
  (frida-git-sync es interno/bundle, no un paquete instalable).

## Módulos porteados

| Upstream (`@jachy/pi-git-sync/src/`) | `src/tools/frida-git-sync/` | Tratamiento |
| --- | --- | --- |
| `system/git.ts` | `src/system/git.ts` | + `GitExecutor`/`setGitExecutor`/`GitExecutorRequest` (inyección D1) |
| `system/{lock,security,backup,state,path-safety,conflict-resolution,operation-context}.ts` | igual | **Literal** (solo primitivas Node) |
| `system/packages.ts` | igual | **Literal** (D2: CLI pi en PATH) |
| `sync/{config,inventory,capture,materialize,validate,glob,settings-portability}.ts` | igual | **Literal**; `validate.ts` sin el check de pi-git-sync |
| `orchestration/{commands,setup-flow,pull-flow,push-flow,conflict-flow,apply-transaction,phases,operation-result,operation-context}.ts` | igual | **Literal**; `commands.ts` (defaultPath + fallback + scaffold placeholder), `setup-flow.ts` (scaffold `{}`) |
| `extension/operation-runner.ts` | `src/extension/operation-runner.ts` | **Literal** (genérico vía `host`) |
| `extension/ui.ts` | `src/extension/ui.ts` | **Literal** (formato ANSI puro) |
| `index.ts` (entrada upstream) | `index.ts` | **Reescrito**: factory `createFridaGitSync` (adapter pi.exec, `/fridasync`, UI webview, integración del widget) |
| — | `constants.ts`, `store.ts`, `GitSyncWidget.tsx`, `panel.ts` | **Nuevos** (paths, store reactivo, widget React, wiring) |

Imports normalizados a **sin extensión `.ts`** (consistencia con los `frida-*`
existentes; el upstream los llevaba explícitos).

## Comandos aportados al usuario

| Comando | Función |
| --- | --- |
| `/fridasync` | Setup (pide URL del repo) o sync bidireccional completa (pull + push) |
| `/fridasync status` | Estado detallado de Git + comparación three-way |
| `/fridasync diff` | Preview de cambios pendientes |
| `frida-git-sync:clear-repo` | (debug) Borra el contenido del repo local y remoto |

## Plan de implementación

### Fase 1: Árbol porteado + adaptaciones de acoplamiento

- [x] Copia fiel de `system/`+`sync/`+`orchestration/`+`extension/` (28 archivos).
- [x] Imports `.ts` → sin extensión.
- [x] `git.ts`: inyección `setGitExecutor` + `GitExecutorRequest`.
- [x] `commands.ts`: `defaultPath`, fallback `getAgentDir`, `hasScaffoldSettingsPlaceholder`.
- [x] `setup-flow.ts` (scaffold `{}`), `validate.ts` (sin check de paquete), strings `pi-git-sync:` → `frida-git-sync:`.

### Fase 2: Factory + integración

- [x] `constants.ts` (paths `~/.frida`).
- [x] `index.ts` — `createFridaGitSync`: adapter `pi.exec`, `PI_CODING_AGENT_DIR`, `/fridasync`, UI webview.
- [x] Registro en `pi-session.ts` (`extensionFactories`, tras `frida-mcp-adapter`).

### Fase 3: Panel fridaWeb + cancelación

- [x] `store.ts` (syncWidgetStore reactivo + `scheduleIdleHide`).
- [x] `GitSyncWidget.tsx` (Remote React, spinner + elapsed + Cancel).
- [x] `panel.ts` (`wireGitSyncWidget`, footer idempotente).
- [x] `index.ts`: `runSyncOperation` envuelto por `handleFridaSync` (start/done/finally); `host.onCancel` → store.
- [x] `extension.ts`: monta el widget al crear la sesión.

### Fase 4 (pendiente): Tests + docs

- [ ] Portear los tests del upstream (glob, ui, config, state, conflict) + tests de integración git real.
- [ ] `docs/tools/frida-git-sync.md`.
- [ ] README (tabla Herramientas) + CHANGELOG `[Unreleased]`.

## Riesgos y mitigaciones

| Riesgo | Probabilidad | Mitigación |
| --- | --- | --- |
| `pi.exec` no mate el árbol SSH (proceso colgando tras cancel/timeout) | Media | `GIT_SSH_COMMAND` + watchdog de `operation-runner`; el spawner nativo queda como fallback vía `setGitExecutor(undefined)` |
| CLI `pi` ausente en una instalación de frida-code sin nvm | Baja | `isPiCliAvailable` lo detecta y `executePackagePlan` reporta instrucciones manuales; la sync de archivos (no paquetes) sigue funcionando |
| `commands.ts` (2030 líneas) porteado tal cual con acoplamientos sutiles a `~/.pi` no detectados | Media | `PI_CODING_AGENT_DIR` cubre la mayoría; revisión manual pendiente (Fase 4) |
| El estado `.pi-sync` migra de una instalación previa de `pi-git-sync` en `~/.pi` | Baja | `relocateStateIfConfigured` del upstream maneja la migración; al usar `~/.frida` empieza limpio |
| Conflicto del rebase requiere merge manual y el usuario no tiene UI rica | Baja | Las 4 opciones (ask_agent / abort / use_local / use_remote) operan vía `select`+`confirm` del webview |
| `duplicate-function-arg` (pi-lens) dispara falsamente durante el porte | — | **Lección**: es síntoma de un error de tipo real en el archivo; al corregir el error subyacente, los falsos positivos desaparecen |

## Lecciones del porte

1. **`duplicate-function-arg` de pi-lens es no determinista y se manifiesta como
   síntoma de errores de tipo reales**. Durante el porte, 16 falsos positivos
   sobre handlers `(event, ctx)` desaparecieron al corregir el único error real
   (`cancellationNoticeDelayMs` faltante). Ante un brote de estos avisos, buscar
   primero el error de tipo subyacente, no suprimir la regla.
2. **Verificar la disponibilidad real de la API del SDK antes de diseñar la
   adaptación**: `handlePackageCommand` parecía la vía limpia para los paquetes,
   pero al no ser export pública, el porte se simplificó a "dejarlo tal cual"
   (CLI en PATH). Una verificación temprana (D2) habría ahorrado el diseño.
3. **Inyección por setter a nivel módulo** preserva la API pública y permite
   portear ~10K líneas tocando solo el seam de acoplamiento (`git.ts`) — patrón
   reutilizable para futuros portes de extensiones con primitivas de shell.
