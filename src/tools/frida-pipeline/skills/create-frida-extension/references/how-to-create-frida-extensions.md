# Cómo crear extensiones frida-*(porte de extensiones pi-*)

> **Fuente de verdad única.** Este documento concentra TODO el conocimiento sobre
> portear extensiones `pi-*` a `frida-*`. No se crean documentos adicionales de
> porte: las decisiones, reglas, acoplamientos, errores y lecciones viven **aquí**.
> Si descubres un error nuevo durante un porte, **documéntalo en la sección
> [Errores y lecciones registradas](#errores-y-lecciones-registradas)**.
>
> **Flujo de consulta obligatorio** al portearte una extensión:
>
> 1. **Lee este documento primero** (especialmente [Reglas canónicas](#reglas-canónicas-de-porte),
>    [Acoplamientos pi→frida](#acoplamientos-pi--frida) y
>    [Errores y lecciones](#errores-y-lecciones-registradas)).
> 2. Si una decisión no está resuelta aquí, **ve al código** (extensiones frida-*
>    existentes como referencia + el ADR correspondiente).
> 3. Al resolver algo nuevo, **actualiza este documento**.

---

## TL;DR — el porte en 30 segundos

1. La extensión pi vive en `node_modules/<autor>/<pi-ext>/` (código propio, sin
   `pi-tui`). Frida la porteas **nativamente** a `src/tools/frida-<nombre>/`.
2. **Cero dependencias npm nuevas**: reusa el SDK de Pi (ya embebido) + Node
   builtins. `nanoid` → `crypto.randomUUID()`.
3. **agentDir `~/.frida`** (no `~/.pi/agent`). UI en **webview** (no TUI de Pi).
4. Copias el árbol del upstream casi literal y **solo adaptas los seams** de
   acoplamiento a Pi (`pi-tui`, `ctx.ui.setStatus/custom`, `getAgentDir`,
   spawn directo de shell, CLI `pi`).
5. Escribes un `index.ts` **factory** `createFrida<Nombre>(): (pi) => void` y la
   registras en `pi-session.ts`.
6. Escribes el **ADR**, la **doc** (`docs/tools/frida-<nombre>.md`) y el
   **CHANGELOG**, y portas/escribes **tests**.

---

## Reglas canónicas de porte

Extraídas de los ADRs 0002, 0004, 0005, 0010, 0011, 0012, 0020–0026. **Cúmplelas
todas** salvo justificación documentada en el ADR.

| # | Regla | ADR |
| --- | --- | --- |
| **R1** | **Porte nativo, no `pi install` del upstream.** El código vive en `src/tools/frida-<nombre>/` como código propio. | 0020, 0021, 0022 |
| **R2** | **Cero dependencias npm nuevas** salvo necesidad demostrada. Reusa el SDK embebido (`defineTool`, `ExtensionAPI`, `createAgentSession`, `DefaultResourceLoader`). | 0020, 0022, 0025 |
| **R3** | **SDK de Pi en proceso, no RPC.** La sesión corre en el extension host de VS Code (mismo proceso). | 0002 |
| **R4** | **agentDir `~/.frida`, no `~/.pi`.** Extensions, skills, auth y models viven en `~/.frida`, desacoplados del CLI `pi`. | 0010 |
| **R5** | **Tools del modelo vía `defineTool` + `pi.registerTool`.** Schema TypeBox. NO son slash commands. | 0022, 0025 |
| **R6** | **UI en webview, no TUI de Pi.** Las factories Ink (`setStatus`, `setFooter`, `custom`, `setWidget`) son **no-op**. UI Rica vía `fridaWeb`/`fridaWebMount` (Remote React) o diálogos (`select`/`input`/`confirm`). | 0011, 0012 |
| **R7** | **Namespace frida.** Paths, customTypes, flags y artefactos usan `.frida/` y prefijo `frida-*`. Permite coexistencia con `~/.pi`. | 0010, 0021, 0022 |
| **R8** | **Hooks de sesión vía `pi.on()`.** Guidance, git-context, inyección de mensajes y lógica pre/post-turno se cablean con event handlers del SDK. | 0021, 0022 |
| **R9** | **Shell vía `pi.exec()`** cuando sea posible, no `child_process` directo. (Excepción justificada: módulos que necesitan kill del árbol de procesos.) | 0021 |
| **R10** | **Depender y pin sin forkear.** Pi se consume como dependency npm con pin exacto. | 0004 |
| **R11** | **Reexportar API pública desde `index.ts`.** El host sólo importa del barrel `index.ts`, nunca de submódulos. | 0021, 0022 |

---

## Anatomía de una extensión frida-*

```
src/tools/frida-<nombre>/
├── index.ts            # FACTORY createFrida<Nombre>() + barrel de re-exports
├── types.ts            # Tipos centrales
├── constants.ts        # Namespace frida (customTypes, flags, paths)
├── <lógica>.ts         # Módulos de negocio (porte del upstream)
└── panel.tsx / store.ts # (Opcional) Widget React fridaWeb + estado reactivo
```

**Contrato del `index.ts`** (firma canónica):

```typescript
export function createFrida<Nombre>(opciones?: {...}): (pi: ExtensionAPI) => void {
  return (pi: ExtensionAPI): void => {
    // 1. Registrar tools del modelo (si los hay): pi.registerTool(defineTool({...}))
    // 2. Registrar hooks de sesión (si los hay): pi.on("session_start", ...)
    // 3. Registrar slash commands (si los hay): pi.registerCommand(...)
  };
}
```

- **Sin opciones**: `createFridaSubagents()` (frida-subagents, frida-pipeline).
- **Con opciones**: `createFridaAgentBrowser({ agentDir })` (frida-agent-browser).

---

## Modelo runtime/UI — qué está disponible

El `ExtensionAPI` de Pi **SÍ está completo** en frida (sesión en proceso). El
`ctx.ui` está **parcialmente** disponible.

### `pi: ExtensionAPI` — todo funciona

| API | Estado | Ejemplo |
| --- | --- | --- |
| `pi.registerTool(defineTool({...}))` | ✅ | tools del modelo |
| `pi.on("session_start" \| "tool_call" \| "before_agent_start" \| "session_shutdown", ...)` | ✅ | hooks |
| `pi.exec(command, args, { signal?, timeout?, cwd? })` → `{ stdout, stderr, code, killed }` | ✅ | shell (R9) |
| `pi.registerCommand(name, { description, handler })` | ✅ | slash commands (Pi despacha) |
| `pi.sendUserMessage(content, { deliverAs?: "steer" \| "followUp" })` | ✅ | inyectar mensaje al agente |
| `pi.sendMessage({ customType, content }, { deliverAs })` | ✅ | mensaje custom |
| `pi.getFlag`, `pi.events`, `pi.getAllTools`, `pi.setActiveTools` | ✅ | |

> **Confirmado**: `pi.registerCommand` **sí despacha** en frida — `extension.ts`
> enumera los commands de cada extensión (`e.commands`) y los expone. Úsalo para
> slash commands autónomos del módulo (sin VS Code APIs).

### `ctx: ExtensionCommandContext` / `ctx.ui` — parcial

| API | Estado | Notas |
| --- | --- | --- |
| `ctx.ui.notify(msg, "info"\|"warning"\|"error")` | ✅ | toast en el webview |
| `ctx.ui.confirm(title, body)` → `Promise<boolean>` | ✅ | diálogo webview |
| `ctx.ui.input(prompt, default)` → `Promise<string\|undefined>` | ✅ | diálogo webview |
| `ctx.ui.select(title, options[])` → `Promise<string>` | ✅ | diálogo webview |
| `ctx.ui.fridaWeb(factory)` / `fridaWebMount(factory, placement)` | ✅ | **extensión propia de Frida** (no del SDK). Remote React. |
| `ctx.mode` | ✅ | `"rpc"` en frida |
| `ctx.hasUI` | ✅ | `true` |
| `ctx.isIdle()`, `ctx.reload()` | ✅ | |
| `ctx.ui.setStatus(key, text)` | ⛔ **no-op** | portear a `fridaWebMount` o `notify` |
| `ctx.ui.custom(factory)` | ⛔ **no-op** | portear a `fridaWeb`/`fridaWebMount` |
| `ctx.ui.setFooter / setHeader / setWidget` | ⛔ **no-op** | TUI-only |
| `ctx.ui.onTerminalInput` | ⛔ | TUI-only (no Esc) — cancelar vía botón del panel |

### Elementos custom React (Remote React / fridaWeb)

Disponibles: `<fbox>` (`flexDirection`, `gap`, `alignItems`, `padding`),
`<ftext>` (`color`, `bold`), `<fbutton>` (`variant`, `onClick`),
`<finput>`. `WebPlacement = "overlay" \| "footer" \| "composer"`.

> **`@earendil-works/pi-tui` NO está disponible en frida.** Cualquier import de
> `matchesKey`, `SelectItem`, `Text`, widgets Ink → **descartar** o reemplazar.

---

## Agent dir y mapeo de rutas pi → frida

El agentDir de frida es **`~/.frida`** (no `~/.pi/agent`).

| pi-* | frida-* | ADR |
| --- | --- | --- |
| `~/.pi/agent/` | `~/.frida/` | 0010 |
| `~/.pi/agent/agents/` | `~/.frida/global/agents/` | 0021, 0022 |
| `~/.pi/agent/skills/` | `~/.frida/skills/` | 0021 |
| `~/.pi/agent/auth.json` / `settings.json` / `models-store.json` | `~/.frida/...` | 0010 |
| `<cwd>/.pi/` | `<cwd>/.frida/` | 0010 |
| `$PI_CODING_AGENT_DIR` | setear `process.env.PI_CODING_AGENT_DIR = ~/.frida` en la factory | 0023 |

**Cómo obtenerlo** (3 patrones equivalentes):

1. `defaultAgentDir()` de `pi-session.ts` (el host).
2. Hardcodear `join(homedir(), ".frida")` (submódulos).
3. Recibirlo como parámetro de la factory: `createFridaX({ agentDir })`.

> **`getAgentDir()` del SDK sigue retornando `~/.pi/agent`.** Frida **no lo usa**:
   pasa los paths explícitamente, o setea `PI_CODING_AGENT_DIR`.

---

## Integración en el host

### 1. Registrar la factory en `pi-session.ts`

En el array `extensionFactories` del `DefaultResourceLoader` (~línea 200–320):

```typescript
import { createFrida<Nombre> } from "./tools/frida-<nombre>";
// ...
{
  name: "frida-<nombre>",
  factory: createFrida<Nombre>(),
},
```

Ordénala tras las extensiones con las que interactúa (ej. tras `frida-subagents`
si registras tools que no deben interferir).

### 2. Slash commands con VS Code APIs → `BUILTIN_COMMANDS` en `extension.ts`

Si el comando necesita APIs de VS Code (webview panel, OutputChannel, QuickPick),
añádelo a `BUILTIN_COMMANDS` (~línea 1637) + caso en `runBuiltinSlash()`
(~línea 1730). Si sólo usa APIs de Pi, `pi.registerCommand` en el factory basta.

### 3. Widget footer → `wireXxxWidget` en `extension.ts`

Si la extensión tiene panel `fridaWebMount` persistente, exporta `wireXxxWidget`
del `index.ts` y el host lo llama con `s.webBridge` al crear la sesión (~línea
638, junto a `wireAgentWidget`).

---

## Patrón deporte probado (recomendado)

Basado en frida-git-sync (ADR-0026), el porte más fiel y menos invasivo:

### Paso 0 — Estudia el upstream

- Lee `package.json` (peerDeps: ¿`pi-tui`?, scripts, `files`).
- Lee el `index.ts`/entrada del upstream: registra tools/commands/hooks, usa
  `ctx.ui.*`, `pi.*`.
- Mapea el árbol de archivos y las **dependencias entre capas** (qué importa qué).
- Identifica los **seams de acoplamiento a Pi**: `pi-tui`, `ctx.ui.setStatus/custom`,
  `getAgentDir`/`PI_CODING_AGENT_DIR`, spawn de shell directo, CLI `pi`, paths
  `~/.pi`.

### Paso 1 — Copia el árbol casi literal

```bash
mkdir -p src/tools/frida-<nombre>
cp -R <upstream>/src src/tools/frida-<nombre>/src   # preserva imports relativos
```

Normaliza imports: quita extensiones `.ts` (consistencia con frida-*):

```bash
find src/tools/frida-<nombre> -name "*.ts" \
  -exec sed -i '' -E 's/from "(\.{1,2}\/[^"]*)\.ts"/from "\1"/g' {} +
```

### Paso 2 — Verifica el typecheck base

```bash
npx tsc --noEmit 2>&1 | grep "frida-<nombre>"
```

Si el upstream `src/` es puro Node (sin `pi-tui`), suele dar **0 errores**.

### Paso 3 — Adapta SOLO los seams de acoplamiento

- **`pi-tui`**: elimina imports (`matchesKey`, `SelectItem`, `Text`).
- **`ctx.ui.setStatus/custom/setFooter`**: son no-op → porta a `notify`/`fridaWeb`.
- **`getAgentDir`/paths `~/.pi`**: setea `PI_CODING_AGENT_DIR=~/.frida` en la
  factory; ajusta `defaultPath` y fallbacks.
- **Spawn de shell directo**: enruta por `pi.exec` vía **inyección por setter**
  (ver [Inyección por setter](#inyección-por-setter-patrón-recomendado)) o
  directamente si el módulo recibe `pi`.
- **CLI `pi`** (`pi install/remove`): suele funcionar tal cual (CLI en PATH);
  verifica antes de "arreglarlo".
- **Strings/messages con el nombre del upstream**: `sed` global seguro (ver lección).

### Paso 4 — Escribe el `index.ts` (factory)

Reemplaza el `index.ts`/entrada del upstream por la factory frida. Registra
tools/hooks/commands, cablea el agentDir, monta el widget si lo hay.

### Paso 5 — Registra en `pi-session.ts` (y `extension.ts` si hay widget/comando VS Code)

### Paso 6 — Documenta y testea

- ADR `docs/adr/00XX-frida-<nombre>-porter-<pi-ext>.md`.
- Doc `docs/tools/frida-<nombre>.md`.
- CHANGELOG `[Unreleased] > ### Añadido`.
- Tests (portea los del upstream si los incluye `files`; si no, escribe tests de
  las capas puras + integración).

---

## Inyección por setter (patrón recomendado)

Para portear módulos con **primitivas de shell propias** (spawn, execFile) **sin
tocar las ~N funciones de alto nivel** que las llaman ni a los callers, añade
inyección a nivel módulo:

```typescript
// En el módulo del upstream (ej. git.ts):
export interface ExecRequest { dir: string; args: string[]; /* ... */ }
export type Executor = (request: ExecRequest) => Promise<Output>;
let executorOverride: Executor | undefined;
export function setExecutor(fn: Executor | undefined): void { executorOverride = fn; }

// En la primitiva interna:
function runProcess(...) {
  if (executorOverride) return executorOverride({ dir, args, ... });
  // ... spawner nativo original (fallback)
}
```

La factory instala el adapter:

```typescript
setExecutor(async (req) => {
  const r = await pi.exec("git", req.args, { cwd: req.dir, signal, timeout });
  if (r.code === 0 && !r.killed) return { stdout: r.stdout.trimEnd(), stderr: r.stderr.trimEnd() };
  throw { code: r.killed ? "ETIMEDOUT" : r.code, killed: r.killed, /* ... */ };
});
```

**Ventaja**: preserva la API pública → `commands.ts` y demás no se tocan. Patrón
usado en frida-git-sync (`setGitExecutor`).

> **Patrón de tipo para evitar el falso positivo `duplicate-function-arg`**: usa
> un **único parámetro objeto** (`Executor = (request: Request) => ...`), no
> múltiples params. Ver [Errores y lecciones](#errores-y-lecciones-registradas).

---

## Patrón widget fridaWeb (footer persistente)

Réplica de frida-subagents (ADR-0022 Fase 6):

1. **`store.ts`**: store reactivo con `subscribe`/`getSnapshot` (para
   `useSyncExternalStore`) + funciones de mutación. Module-level singleton.
2. **`<Nombre>Widget.tsx`**: componente React. `useSyncExternalStore(store.subscribe,
   store.getSnapshot)`. Elementos `<fbox>`/`<ftext>`/`<fbutton>`. Auto-hide en idle.
3. **`panel.ts`**: `wire<Nombre>Widget(webBridge)` — `webBridge.mountPersistent(
   createElement, "footer")`, idempotente.
4. La **lógica de negocio** actualiza el store; el **host** (`extension.ts`) llama
   `wire<Nombre>Widget(s.webBridge)` al crear la sesión.

Para cancelación manual (botón): el operation-runner/host expone `onCancel(cancel)`
→ registras `cancel` en el store → el botón del widget lo invoca.

---

## Decisiones de porte frecuentes (plantilla)

Cuando portes, tendrás que decidir. Usa este checklist; **documenta la decisión
en el ADR**.

- **Shell**: ¿`pi.exec` (R9) o conservar el spawner propio del upstream?
  (Conserva si necesita kill del árbol de procesos; justifica en el ADR.)
- **Paquetes/subprocess externos**: ¿el CLI/binary está en PATH? ¿la API del SDK
  es pública? (Verifica ANTES de diseñar — lección `handlePackageCommand`.)
- **UI Rica**: ¿`notify`-only (mínimo), `fridaWebMount` (panel persistente) o
  `BUILTIN_COMMANDS` (VS Code APIs)?
- **Slash command**: ¿`pi.registerCommand` (autónomo) o `BUILTIN_COMMANDS` (con
  VS Code APIs)?
- **`isolation`/params del modelo**: ¿se expone al modelo o solo via frontmatter/config?

---

## Acoplamientos pi → frida (tabla rápida de qué hacer)

| En el upstream (pi) | En frida |
| --- | --- |
| `import { ... } from "@earendil-works/pi-tui"` | **eliminar** (no disponible) |
| `ctx.ui.setStatus(key, text)` | no-op → `notify` o `fridaWebMount` |
| `ctx.ui.custom(factory)` | no-op → `fridaWeb`/`notify` |
| `ctx.ui.onTerminalInput` + `matchesKey` (Esc) | botón Cancel del panel (`onCancel`) |
| `getArgumentCompletions` + `SelectItem` | descartar o reimpl. trivial |
| `getAgentDir()` / `~/.pi/agent` | `~/.frida` (setea `PI_CODING_AGENT_DIR`) |
| `child_process.spawn/execFile` propio | `pi.exec` (vía setter si hay capa gruesa) |
| `execFile("pi", [...])` | suele funcionar tal cual (CLI en PATH) — verifica |
| `import { nanoid }` | `crypto.randomUUID()` |
| paths/flags `pi-*` / `.pi/` | `frida-*` / `.frida/` |

---

## Errores y lecciones registradas

> **Esta sección crece.** Cada vez que un porte tropiece con algo no obvio,
> regístralo aquí con: **síntoma → causa → solución**, para que no se repita.

### L1 — `duplicate-function-arg` (pi-lens) es SÍNTOMA, no causa

- **Síntoma**: la regla `duplicate-function-arg` de pi-lens dispara falsos
  positivos sobre funciones/tipos con múltiples parámetros (`(a, b) => ...`).
- **Causa**: es **no determinista** y se manifiesta cuando hay un **error de tipo
  real** en el archivo (ej. propiedad requerida faltante, tipo no asignable).
- **Solución**: **busca y corrige el error de tipo subyacente**; los falsos
  positivos desaparecen solos. NO suprimas la regla a lo loco.
  - *Ejemplo (frida-git-sync)*: 16 falsos positivos sobre handlers `(event, ctx)`
    desaparecieron al añadir `cancellationNoticeDelayMs` (campo requerido faltante).
- **Excepción**: si el tipo función SÍ dispara sin error subyacente (raro), usa un
  **único parámetro objeto** (`type F = (req: Req) => ...`) en vez de múltiples
  params — evita el patrón que confunde al tree-sitter runner.

### L2 — Verifica la API del SDK ANTES de diseñar la adaptación

- **Síntoma**: diseñas portear `pi install/remove` por `handlePackageCommand`
  del SDK.
- **Causa**: `handlePackageCommand` existe en `dist/` pero **no se exporta del
  barrel público** → no es importable de forma estable.
- **Solución**: **verifica primero** si la función/binary está disponible (¿export
  del barrel? ¿CLI en PATH?). En frida-git-sync, el CLI `pi` estaba en PATH →
  `packages.ts` funcionó **sin cambios**. Una verificación temprana ahorra diseño.

### L3 — Inyección por setter preserva la API pública

- **Síntoma**: portear la capa shell (`git.ts`, 854 líneas con ~40 funciones)
  parecía requerir reescribir todas las funciones y sus callers.
- **Solución**: inyecta el executor vía `setExecutor` a nivel módulo; la primitiva
  interna lo usa si está seteado. **0 cambios** en la API pública y los callers.
  Permite portear ~10K líneas tocando solo el seam. (Ver [Inyección por setter](#inyección-por-setter-patrón-recomendado).)

### L4 — `cp` del árbol + normalizar imports > reescribir

- Copiar `src/` del upstream preservando la estructura de directorios **mantiene
  los imports relativos** intactos → el porte es casi literal. Solo normaliza
  (quita `.ts`) y adapta los seams. No reescribas desde cero.

### L5 — La factory setea `PI_CODING_AGENT_DIR`

- Muchas funciones del upstream leen `process.env.PI_CODING_AGENT_DIR` o usan
  `getAgentDir()`. En vez de tocar cada call-site, **la factory setea**
  `process.env.PI_CODING_AGENT_DIR = ~/.frida` una vez (si no estaba). Cubre la
  mayoría. Ajusta además `defaultPath` y el fallback explícito.

### L6 — Strings de mensaje con el nombre del paquete

- El upstream tiene mensajes tipo `"pi-<ext>: Already up to date."`. Si tu factory
  antepone `"frida-<ext>: "` cuando el mensaje no empieza con el prefijo, queda
  doble prefijo. **Solución**: `sed` global del patrón seguro `"pi-<ext>: "` →
  `"frida-<ext>: "` (no toca nombres de paquete como `npm:@autor/pi-<ext>` que no
  llevan `:`). Verifica que los nombres de paquete se preserven.

---

## Checklist de portes anteriores (particularidades)

| Porte | ADR | Particularidad destacada |
| --- | --- | --- |
| frida-workflow | 0020 | Porte nativo del runtime de workflows; stages despachan via `/skill:`. |
| frida-pipeline | 0021 | 15 perfiles de agente + skills bundled; sync a `~/.frida/global/agents` y `~/.frida/skills`. |
| frida-subagents | 0022 | 3 tools del modelo (`Agent`, `get_subagent_result`, `steer_subagent`); widget footer (patrón store+fridaWebMount); worktree isolation. |
| frida-mcp-adapter | 0023 | **Excepción R1**: wrapper delgado sobre el upstream (17K líneas inviables de reescribir) como devDependency bundleada. |
| frida-multi-skills | 0024 | Expansión `$skill` multi en el prompt; overlay navegable. |
| frida-pix-skills | 0025 | Tool `read_skills` (auto-prompteo); gate mapeado a frida-permission-system; Skills.sh remoto. |
| frida-git-sync | 0026 | Sync del agentDir vía repo Git; `setGitExecutor` (pi.exec); paquetes sin cambios (CLI en PATH); widget + Cancel; `duplicate-function-arg` como síntoma (L1). |

---

## Reglas de mantenimiento de ESTE documento

1. **Única fuente.** No crees docs de porte adicionales — amplía este.
2. **Ante un error nuevo durante un porte**: añádelo a
   [Errores y lecciones](#errores-y-lecciones-registradas) (síntoma → causa → solución).
3. **Ante una nueva regla o acoplamiento**: añádelo a la sección correspondiente.
4. **Ante un porte nuevo**: añádelo al
   [Checklist de portes anteriores](#checklist-de-portes-anteriores-particularidades).
5. Si dos secciones se contradicen, **reconcilia y deja una sola verdad**.
