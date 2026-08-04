---
date: 2026-08-03T21:38:12-0600
author: Edgar F. Fuentes Perea
commit: c90ad1a
branch: main
repository: frida-code
topic: "Frida Usage Telemetry + Export (dashboard y reporte v1)"
tags: [research, usage, telemetry, dashboard, export, sdlc]
status: ready
last_updated: 2026-08-03T21:38:12-0600
last_updated_by: Edgar F. Fuentes Perea
---

# Research: Frida Usage Telemetry + Export

## Summary

Investigación técnica para diseñar un **dashboard de uso + exportación de telemetría** dentro de la extensión Frida Code. La extensión leerá su propio historial de sesiones (JSONL en `globalStorage/sessions`), agregará métricas (tokens, costo, sesiones, turnos, cache hit, tiempo, artefactos por lenguaje, clasificación SDLC), las mostrará en un nuevo tab **"Uso"** del `SettingsHub` del webview, y exportará un reporte versionado **`frida-usage-report/v1`** para que lo consuma una **aplicación concentradora externa** (fuera del alcance de Frida).

Principio rector (decisión del producto): **Frida solo produce/etiqueta datos; nunca los cruza contra fuentes externas** (tiempo reportado al management, KLOCs de git, defectos de Jira). Ese cruce es responsabilidad del concentrador.

Todas las afirmaciones se verifican contra el código real en `HEAD` (commit `c90ad1a`) y contra sesiones JSONL reales del disco. Las dos preguntas técnicas abiertas que bloqueaban el diseño quedan **resueltas con evidencia** (ver §Open Questions): (1) **`assistedKloc` es factible** porque el contenido escrito vive en los `arguments` de los bloques `toolCall`; (2) **no existe librería de gráficas** en el repo → se recomienda SVG/CSS hechos a mano, consistente con el stack "plain CSS" actual.

## Requirements

Acordadas con el producto en sesiones previas de ideación:

- **R1 — Dashboard personal completo**: tab "Uso" con 6 KPIs (tokens in/out, costo, sesiones, turnos, cache hit %, tiempo activo) + gráficas (tokens/costo por día, uso por modelo, top herramientas, artefactos por lenguaje, heatmap hora×día, top sesiones). Selector de periodo Hoy/7d/30d/Todo.
- **R2 — Export `frida-usage-report/v1`**: JSON versionado, opt-in, con identidad (email en claro + org + proyecto + repo + rol), KPIs, breakdowns, comportamiento, adopción, y un Effectiveness Score pre-calculado. Niveles `aggregated | structured | detailed`.
- **R3 — Principio "etiqueta, no cruces"**: Frida aporta insumos (ej. `assistedKloc`, `bySdlcPhase`, `bugFixSignals`); el concentrador hace los cruces contra métricas externas.
- **R4 — Clasificador SDLC por metadatos**: cada unidad de trabajo (turno/artefacto) se etiqueta en una fase (Analysis/Design/Construction/Testing/Release/Maintenance) usando **solo metadatos** (tool name, skill, comando bash, extensión de archivo) — **nunca contenido del prompt** (privacidad).
- **R5 — Contrato `v1` estable desde el inicio**: los campos de fases posteriores (F2–F4) se incluyen como opcionales en `v1` para no romper el schema; solo un cambio breaking sube a `v2`.
- **R6 — Identidad**: `frida.user.email` (en claro, opt-in), `frida.org`, `frida.user.role`; derivación de proyecto desde el workspace y repo desde `git remote`.
- **Fuera de alcance**: el concentrador/agregador, rankings centralizados, panel de admin, ROI, benchmarks por rol. Esos viven en la app externa.

## Current State Analysis

### Key Discoveries

**A. El JSONL de sesión es la fuente de verdad (ya parseada parcialmente).**

Cada sesión es un archivo `.jsonl` append-only en `globalStorage/sessions/`, una línea JSON por entrada. Volumen observado: **23 sesiones, 11 MB** totales (tamaño manejable para indexar; justifica un indexer incremental por mtime). Esquema exacto verificado contra sesiones reales:

- `entry.type` ∈ {`session`, `message`, `custom_message`, `model_change`, `thinking_level_change`, `compaction`}.
- `entry.timestamp`: **ISO-8601 string** (ej. `2026-08-04T01:05:17.525Z`). `session-stats.ts:80` (`toMs`) ya normaliza ISO↔epoch.
- **`message` entries**: `entry.message.role` ∈ {`user`, `assistant`, `toolResult`}.
- **`usage`** vive en `entry.message.usage` de los assistant messages. Keys exactas: `input, output, cacheRead, cacheWrite, reasoning, totalTokens, cost`. **`cost` es un objeto** `{input, output, cacheRead, cacheWrite, total}` (no un número) — `session-stats.ts:42` (`toCost`) ya lo normaliza. Nota: el gateway DevEngine reporta `cost.total: 0` hoy; el campo existe para cuando se facture.
- **`compaction`** entry: lleva `entry.usage` (toplevel, no anidado en `message`) — `session-stats.ts:103-105` ya distingue ambos casos.
- **`model_change`**: `{type, id, parentId, timestamp, provider, modelId}` → alimenta el breakdown `byModel`/`byProvider`.
- **`thinking_level_change`**: `{..., thinkingLevel}` → insumo de adopción/eficiencia.
- **`session`**: `{type:"session", version:3, id, timestamp, cwd}` → **`cwd` identifica el proyecto** de la sesión (clave para agrupar por proyecto sin depender del workspace actual).

**B. CRÍTICO — los tool calls son bloques `toolCall`, no `tool_use`.**

La estructura de un mensaje assistant con acciones es `message.content: ContentBlock[]` donde cada bloque tiene `type` ∈ {`thinking`, `text`, `toolCall`}. El bloque `toolCall` tiene la forma **`{type:"toolCall", id, name, arguments}`** (usa `arguments`, no `input`). Verificado en sesiones reales:

- `write` → `arguments: {path: string, content: string}` (contenido completo del archivo a escribir).
- `edit` → `arguments: {path: string, edits: [{oldText, newText}]}` (array de reemplazos).
- `bash` → `arguments: {command: string}`.

Distribución real de `name` (agregado sobre 23 sesiones, de los `toolResult.toolName`): **bash 490, todo 371, read 273, write 230, edit 115, ask_user_question 54, agent_browser 43, lens_diagnostics 15, lsp_diagnostics 12, Agent 8 (subagentes), get_subagent_result 7**, más `web_docs_search`, `project_report`, `context` (1 c/u).

**`toolResult`** entries: `message.{role:"toolResult", toolCallId, toolName, content:[{type:"text", text}]}`. El `content` es texto libre (ej. `"Successfully wrote 10866 bytes to <path>"`, `"Successfully replaced 1 block(s) in <path>"`) — **no incluye diff ni conteo de líneas**, pero **no se necesita**: para `assistedKloc` contamos las líneas de `write.arguments.content` y de cada `edit.arguments.edits[].newText` directamente desde los bloques `toolCall`. Ver §Open Questions Q1.

`custom_message` entries: p.ej. `{type:"custom_message", customType:"frida-pipeline-index", content:"..."}` — mensajes de sistema de extensiones (no contar como turnos de usuario/asistente).

**C. Ya existe el patrón de indexer a modelar: `src/session-stats.ts`.**

`readSessionStats(sessionFile)` (`session-stats.ts:84`) lee el JSONL, acumula `inputTotal/outputTotal/cacheRead/cacheWrite/cost` y `firstTs/lastTs`, y **cachea por `(file, mtimeMs)`** (`session-stats.ts:27`, `cache`) para no releer si el archivo no cambió. Es exactamente el patrón que el nuevo agregador multi-sesión debe generalizar: barrer `sessions/*.jsonl`, cachear por mtime por archivo, y solo reindexar sesiones modificadas.

**D. `postUsage` ya calcula los KPIs de la sesión actual.**

`extension.ts:706` `postUsage(session)` computa, combinando estado en memoria + `readSessionStats` (disco), los mismos KPIs que el dashboard necesita a nivel sesión: `inputTotal, outputTotal, cacheRead, cacheWrite, cost, cacheHitRate` (último request), `contextTokens/Window/Percent`, `pressurePercent`, `sessionDurationMs`. Los postea al webview con `post({type:"usage", ...})` (`extension.ts:799`). El nuevo agregador **reutiliza esta lógica**, elevándola de "sesión actual" a "todas las sesiones del periodo".

**E. Protocolo host↔webview documentado y simple de extender.**

- Host→webview: `post(msg: InMessage)` posta mensajes tipados. El handler de salida es `handleWebviewMessage` (`extension.ts:1590`), un `switch(msg.type)` — añadir un `case "usage_*"` es trivial (ej. `list_resources` en `extension.ts:1605` es el patrón: llama a una función y posta el resultado).
- Webview: el store es un reducer puro `reduce(state, msg)` en `webview/store.ts`. El `case "usage"` (`store.ts`) mergea el payload en `state.usage`. Añadir un `case "usage_report"` que llene un nuevo slice `state.usageReport` sigue el mismo molde.
- Tipos: `InMessage` y `State` viven en `webview/types.ts`; `Usage` interface (`types.ts`) es el modelo de KPIs actual.
- **Patrón de "fetch on tab open"**: `SettingsHub.tsx:51` hace `useEffect(() => { if (tab==="resources") post({type:"list_resources"}); })` → el tab "Uso" replicará esto con `post({type:"list_usage", period})`.

**F. Display de uso ya existe (reusar, no duplicar).**

`webview/components/ContextBar.tsx` ya renderiza los KPIs de `state.usage` (tokens ↑↓RW, cache hit CH%, costo $, barra de contexto). El tab "Uso" es **otra superficie** (agregado multi-sesión vs. sesión viva), no reemplaza a `ContextBar`. Reutiliza el helper de formato `fmt()` de `ContextBar.tsx:3`.

**G. Stack del webview = React 18 + Vite + plain CSS, SIN librería de gráficas.**

- `package.json`: React `^18.3.1`, `@vitejs/plugin-react`, `lucide-react` (iconos), `react-markdown` + `rehype-highlight`. **No hay ninguna lib de gráficas** (`recharts/chart.js/d3/...` ausentes — grep confirmó 0 matches en `package.json`). CSS es plano en `webview/styles.css` (no Tailwind). Build: `vite.config.ts` → `dist-webview/`.
- El `.vsix` ya pesa ~42 MB → la sensibilidad al bundle es real. Ver §Open Questions Q2.

**H. Identidad y almacenamiento.**

- Sección de config: `CONFIG_SECTION = "frida"` (`settings.ts:9`). Patrón de settings = getters tipo `isAskUserQuestionEnabled()` (`settings.ts:13`) que leen `vscode.workspace.getConfiguration("frida").get(...)`. **Lugar natural para `frida.user.email`, `frida.org`, `frida.user.role`**: mismos getters + espejar en `package.json contributes.configuration` (hoy vacío de claves de UI, pero el patrón `frida.*` ya se usa en `frida.devengine.*`, `frida.zai.*`, `frida.gates.*`, `frida.askUserQuestion.enabled`).
- Almacenamiento persistente: `context.globalState` (ej. `ACTIVE_MODEL_KEY="frida.activeModel"`, `extension.ts:95,385,906`) para el flag de opt-in y agregados cacheados; `context.secrets` (ej. `frida.devengineKey`, `frida.context7Key`, `api-key-providers.ts`) — no necesario para telemetría (no hay secreto).
- Email: no hay lector de identidad git hoy; **se añade** un `git config user.email` vía bash (o un setting explícito `frida.user.email` preferido). Repo: `git remote get-url origin` vía bash. Proyecto: `vscode.workspace.name` y/o el `cwd` del evento `session` del JSONL.

**I. Gateway NO expone identidad de tenant/usuario.**

`src/providers/softtek-provider.ts`: el gateway DevEngine usa **`X-Api-Key`** (no Bearer), `DEVENGINE_BASE_URL = "https://mywork.softtek.com/apg/devengine"`. La key va en `before_provider_headers` (`softtek-provider.ts:165`). El gateway **no devuelve tenant/org/usuario** en sus respuestas (solo el `GET /models` con `context_window`). Consecuencia: **`org` debe ser un setting** (`frida.org`), no derivable del gateway. La `X-Api-Key` identifica al usuario frente al gateway, pero Frida no la puede usar como identidad de reporte (es secreto); se prefiere `frida.user.email` + `frida.org`.

**J. Señales de comportamiento ya registradas.**

- **Aprobaciones**: `src/gates/approval-logger.ts` — `ApprovalLogger` escribe un JSONL append-only con `ApprovalLogEntry {ts, sessionId?, tool, kind, decision:"allow"|"block", source, path?, command?, ...}` por cada decisión terminal del gate. Directamente alimenta `behavior.approvals.{allow,block}`. El log vive en disco (path por sesión).
- **Subagentes**: `src/tools/frida-subagents/activity-tracker.ts` — `createActivityTracker()` mantiene `state.tokens` acumulado vía `onAssistantUsage({input,output})` (`activity-tracker.ts:112`). Alimenta `behavior.subagentsLaunched` + tokens por subagente.
- **Aborts**: `frida.abort` → `abortRun()` (`extension.ts:2704`). Un abort detiene el run en memoria; **no deja traza explícita en el JSONL** (el turno simplemente no se completa). Para contar aborts, Frida deberá llevar un contador en memoria/globalState durante la sesión, o inferirlo de turnos incompletos. (Decisión de diseño F2.)
- **Compactaciones**: el evento `type:"compaction"` del JSONL (con `usage`) ya es contable directamente desde el indexer.

**K. No existe telemetría/export previa (greenfield).**

Grep de `telemetry|analytics|exportUsage|collector|upload|track` en `src/` solo devuelve "collectors" de `frida-workflow/outcomes.ts` (escáneres de transcript ajenos a telemetría). **No hay código de telemetría/export que reemplazar.** Los `frida-workflow` "collectors" son un patrón reutilizable de **observación de tool calls** (`toolCallCollector`, `urlCollector`) — potencialmente útil como inspiración para el clasificador SDLC, pero no es dependencia.

### Pipeline skills disponibles para el mapa SDLC

`ls src/tools/frida-pipeline/skills` confirma: `discover, research, design, explore, plan, blueprint, implement, validate, slice, revise, elaborate, amend, annotate-guidance, annotate-inline, architecture-review, changelog, code-review, commit, create-handoff, create-frida-extension, design-review, design-slice, frontend-design, grade, migrate-to-guidance, plan, pr-triage, resume-handoff, synthesize`.

## Code References (con `file:line`)

**Datos de sesión / indexer**

- `src/session-stats.ts:6-24` — interfaz `SessionStats` (campos acumulados).
- `src/session-stats.ts:27-34` — caché por mtime (patrón a generalizar).
- `src/session-stats.ts:42-52` — `toCost()` normaliza `cost` objeto↔número.
- `src/session-stats.ts:80-90` — `toMs()` normaliza timestamp ISO↔epoch.
- `src/session-stats.ts:84-120` — `readSessionStats()` bucle de parseo + acumulación.
- `src/extension.ts:706-800` — `postUsage()` cálculo de KPIs + fusión disco/memoria.
- `src/extension.ts:781-799` — refuerzo con `readSessionStats` (disco = fuente de verdad).
- `src/extension.ts:363` — `sessions/` dir bajo `globalStorageUri`.
- Sesiones reales: `~/Library/Application Support/Code/User/globalStorage/softtek.frida-code/sessions/*.jsonl` (23 archivos, 11 MB).

**Webview / protocolo**

- `webview/types.ts` — `State`, `InMessage`, `OutMessage`, `Usage` interfaces (el contrato completo host↔webview).
- `webview/store.ts` — `reduce()` reducer puro; `case "usage"` (~línea media) patrón a imitar para `usage_report`.
- `webview/components/SettingsHub.tsx:13-31` — `SettingsTab` type + array `TABS` (cómo registrar un nuevo tab).
- `webview/components/SettingsHub.tsx:51-53` — patrón "fetch on tab open" (`post({type:"list_resources"})`).
- `webview/components/ContextBar.tsx:3-7` — `fmt()` helper de formato numérico (reutilizable); display de uso existente.
- `webview/components/ResourcesPanel.tsx` — ejemplo de panel rico con secciones/filtros (patrón visual a seguir).
- `src/extension.ts:1590-1670` — `handleWebviewMessage()` switch (dónde añadir `case "usage_*"`).

**Identidad / settings / storage**

- `src/settings.ts:9` — `CONFIG_SECTION = "frida"`.
- `src/settings.ts:13-40` — patrón de getters de settings.
- `src/settings.ts:128-136` — `writeToolToggle()` patrón para persistir un setting global.
- `src/extension.ts:95` — `ACTIVE_MODEL_KEY="frida.activeModel"` (ejemplo de `globalState`).
- `src/extension.ts:353,359` — uso de `context.secrets`.
- `src/providers/api-key-providers.ts:25-43` — `API_KEY_PROVIDERS` + `secretKey` keys (`frida.devengineKey`, `frida.zaiKey`).

**Gateway**

- `src/providers/softtek-provider.ts:6` — `DEVENGINE_BASE_URL`.
- `src/providers/softtek-provider.ts:8,108-110` — `authHeader:false` + `X-Api-Key` (no Bearer).
- `src/providers/softtek-provider.ts:165-170` — inyección de la key en `before_provider_headers`.

**Señales de comportamiento**

- `src/gates/approval-logger.ts:35-66` — `ApprovalLogEntry`; `ApprovalLogger.log()` append JSONL.
- `src/tools/frida-subagents/activity-tracker.ts:40-46` — `ActivityState.tokens`.
- `src/tools/frida-subagents/activity-tracker.ts:112-114` — `onAssistantUsage` acumula tokens.

**Stack / build**

- `package.json` — deps: React 18, Vite, lucide-react, react-markdown (sin lib de gráficas).
- `vite.config.ts` — build webview → `dist-webview/`.
- `tsconfig.webview.json` — `jsx: react-jsx`, `strict`, `target: ES2022`.

## Integration Points

1. **Indexer** (nuevo `src/usage/indexer.ts`): generaliza `readSessionStats` a multi-sesión. Entrada: `globalStorage/sessions/*.jsonl`. Salida: snapshot agregado por periodo. Caché por mtime por archivo (reutiliza patrón `session-stats.ts:27`).
2. **Mensaje host→webview**: añadir `InMessage` `| {type:"usage_report"; report: UsageReport}` + `OutMessage` `| {type:"list_usage"; period}`. Handler `case "list_usage"` en `extension.ts:1590`.
3. **Tab "Uso"**: nueva entrada en `TABS` (`SettingsHub.tsx:22`) + componente `webview/components/UsageDashboard.tsx` + reducer `case "usage_report"` (`store.ts`). Fetch on open como `SettingsHub.tsx:51`.
4. **Settings**: `frida.user.email`, `frida.org`, `frida.user.role`, `frida.telemetry.optIn` en `settings.ts` + `package.json contributes.configuration`.
5. **Comando export**: `frida.exportUsage` en `package.json contributes.commands` + handler en `extension.ts` (usa `vscode.window.showSaveDialog`). Construye `frida-usage-report/v1` desde el indexer + identidad.
6. **Contrato del reporte**: nuevo `src/usage/report-schema.ts` (tipos TS del `v1`) — **única fuente de verdad** del contrato con el concentrador.

## Architecture Insights

**Patrón a seguir (codebase-fit):**

- El indexer **modela** `session-stats.ts` (bucle de parseo + caché por mtime). Es el patrón canónico del repo para "leer el JSONL de sesión".
- El tab "Uso" **modela** `ResourcesPanel`/`SettingsHub` (secciones, fetch on open, `post()`).
- El comando export **modela** el registro de comandos existente (`frida.setKey`, etc.) + `showSaveDialog`.
- El reducer **modela** el `case "usage"` existente.

**Estructura de carpetas propuesta** (sujeta a diseño):

```
src/usage/
  indexer.ts          # agregador multi-sesión (modela session-stats.ts)
  identity.ts         # email/org/proyecto/repo/rol + opt-in
  artifact-classifier.ts  # extensión → lenguaje/tipo (byLanguage/byArtifact)
  sdlc-classifier.ts  # turno/artefacto → fase SDLC (F2)
  report-builder.ts   # ensambla frida-usage-report/v1
  report-schema.ts    # tipos TS del contrato v1 (campos de F1-F4 como opcionales)
webview/components/
  UsageDashboard.tsx  # tab "Uso" + subcomponentes de gráficas (SVG/CSS)
```

**Mapa clasificador SDLC (metadatos únicamente — R4)**, derivado de los tools/skills reales:

| Fase SDLC | Señales (metadata) |
| --- | --- |
| **Analysis** | skills `discover`/`research`; tools `read`, `project_report`, `symbol_search`, `context`, `lsp_diagnostics`, `agent_browser`, `web_search`/`web_docs_search`/`web_fetch` |
| **Design** | skills `design`/`explore`/`blueprint`/`plan`/`architecture-review`/`frontend-design`/`design-review`; artefactos `.md` en `docs/`, `.rpiv/artifacts/designs/`, ADR |
| **Construction** | tools `write`/`edit`; skills `implement`/`amend`/`revise`/`elaborate`/`slice`/`create-frida-extension`; bash de build (`tsc`, `npm run build`, `esbuild`) |
| **Testing** | skills `validate`/`grade`; tools `lens_diagnostics`; bash `npm test`/`vitest`/`pytest`/`jest`/`go test`; archivos `*.test.*`/`*.spec.*` |
| **Release** | skills `commit`/`changelog`; `frida-git-sync`; bash `git commit`/`push`/`tag`; `CHANGELOG.md` |
| **Maintenance** | edits en `*.test.*`/`*.spec.*` posteriores a un fallo de test (proxy); patrón test-fail→edit |

Señales **no clasificables por metadata** (deben quedar `unclassified` antes que leer el prompt): texto del `bash` que no matchee patrón conocido, `read`/`symbol_search` genéricos sin contexto de skill. El clasificador **nunca** inspecciona `entry.message.content[].text` de bloques `text`/`thinking`.

**Contrato `frida-usage-report/v1` (campos, F1 base + F2-F4 opcionales):** ver boceto en §Desired End State. La regla de versionado: aditivo = sigue `v1`; breaking = `v2`.

## Open Questions (resueltas con evidencia)

### Q1 — ¿De dónde se cuentan las líneas para `assistedKloc`? ✅ RESUELTA

**Sí es factible contar líneas desde los `arguments` de los bloques `toolCall`.**

- `write`: `arguments.content` (string completo) → `content.split("\n").length`.
- `edit`: `arguments.edits[i].newText` → sumar líneas de cada `newText` (o delta `newText`−`oldText`).
- `toolResult.content` **no** trae diff/linecount (solo `"Successfully wrote N bytes"` / `"Successfully replaced N block(s)"`), así que **se cuenta en el `toolCall`, no en el result**.
- Los paths vienen en `arguments.path` (write/edit) → clasificables por extensión para `byLanguage`/`byArtifact`.
- **Privacidad OK**: `arguments.content` es el código/archivo que el agente escribe, no el prompt del usuario. Contar líneas **no requiere retener** el contenido — solo el entero + la extensión. El reporte `structured`/`aggregated` **no** incluye el contenido, solo conteos.

### Q2 — ¿Qué librería de gráficas usar para el tab "Uso"? ✅ RESUELTA (recomendación)

- **No existe ninguna lib de gráficas** en el repo (React 18 + Vite + plain CSS + lucide-react). El `.vsix` pesa ~42 MB (sensibilidad al bundle).
- **Recomendación: SVG/CSS hechos a mano.** Para KPI cards + barras (tokens/costo por día, top tools/languages) + dona (por modelo) + heatmap (hora×dow) + tabla (top sesiones), SVG/CSS planos son suficientes, suman ~0 dependencias, y son **consistentes con el enfoque "plain CSS"** del repo (`webview/styles.css`). El control total evita peleas de temas con una lib externa dentro del webview de VS Code.
- **Alternativa**: `recharts` (~130 KB gzip; React-native; reutiliza deps React ya presentes) solo si el diseño decide que quiere gráficas de área/línea suaves con interactividad rica. Es la única alternativa razonable dado el stack. **No** introducir `d3`/`chart.js` directamente (mayor superficie, peor encaje con React).
- **Decisión final la toma `/skill:design`** con esta evidencia; la recomendación por defecto es hand-rolled.

### Q3 — ¿La identidad viene del gateway o de settings? ✅ RESUELTA

- El gateway DevEngine **no expone** tenant/org/usuario en sus respuestas (verificado en `softtek-provider.ts`); la `X-Api-Key` es secreto y no sirve como identidad de reporte.
- → `org` y `email` son **settings** (`frida.org`, `frida.user.email`), con fallback a `git config user.email` para el email si el setting está vacío. `role` es setting explícito (`frida.user.role`).

### Q4 — ¿Cómo se cuentan los aborts si no dejan traza en el JSONL? ⚠️ PARCIAL

- `frida.abort` → `abortRun()` (`extension.ts:2704`) detiene el run en memoria; el turno queda incompleto en el JSONL (sin `usage` final). No hay evento `abort` explícito en disco.
- Opciones para `/skill:design`: (a) contador de aborts en `globalState` por sesión, volcado al JSONL como `custom_message`; (b) inferir de turnos incompletos (assistant sin `usage` siguiente). Decisión de diseño en F2.

## Verification Notes (chequeos verificables)

- **V1 — Esquema JSONL**: `jq -r '.type' <session.jsonl> | sort | uniq -c` muestra los tipos de entry. `jq -c 'select(.message.role=="assistant") | .message.usage'` confirma las keys de `usage` (incluido `cost` como objeto).
- **V2 — Bloques toolCall**: `jq -c 'select(.message.role=="assistant") | .message.content[].type' <session.jsonl> | sort | uniq -c` muestra `thinking|text|toolCall`. `grep -o '"name":"write"' <session.jsonl> | wc -l` cuenta writes.
- **V3 — assistedKloc factible**: `python3` sobre un `toolCall` de write/edit imprime `len(arguments.content.split("\n"))` / `len(edits[].newText.split("\n"))`. Confirmado en sesiones reales.
- **V4 — Sin lib de gráficas**: `grep -iE "recharts|chart\.js|d3|victory|visx|nivo" package.json` → 0 matches.
- **V5 — Sin telemetría previa**: `grep -rinE "telemetry|exportUsage|uploadUsage|trackUsage" src/` → solo `frida-workflow` "collectors" (ajenos).
- **V6 — Gateway sin identidad**: `src/providers/softtek-provider.ts` solo hace `X-Api-Key` + `GET /models`; sin campo de usuario/tenant.
- **V7 — Patrón indexer reutilizable**: `src/session-stats.ts:84` `readSessionStats` es la plantilla (mtime cache + bucle de acumulación).

## Performance Considerations

- **23 sesiones / 11 MB hoy** → indexar todo es barato, pero el indexer debe ser **incremental por mtime** (como `session-stats.ts:27`) para escalar a cientos de sesiones sin releer todo cada apertura del tab.
- **Agregado cacheado**: tras indexar, persistir un snapshot en `globalState` (o un JSON en `globalStorage/usage-index.json`) por periodo; reindexar solo sesiones con mtime nuevo.
- **Parseo defensivo**: líneas malformadas se ignoran sin abortar (igual que `session-stats.ts`).
- **Webview**: el snapshot se envía una sola vez al abrir el tab (fetch on open, no streaming). Selector de periodo recalcula desde el snapshot cacheado, no reindexa.
- **Bundle**: hand-rolled SVG/CSS suma ~0 KB; `recharts` sumaría ~130 KB gzip (decisión de diseño).

## Migration Notes

No aplica (feature nueva, greenfield). No hay datos previos de telemetría que migrar. Las sesiones JSONL existentes son retroactivamente indexables desde el primer arranque del indexer.

## Pattern References

- `src/session-stats.ts:84-120` — patrón de indexer por archivo + caché mtime (modelo del `indexer.ts`).
- `webview/components/SettingsHub.tsx:22-53` — patrón de tab + fetch on open (modelo del tab "Uso").
- `webview/components/ResourcesPanel.tsx` — patrón de panel con secciones/filtros (modelo visual).
- `src/extension.ts:1590-1670` — patrón de handler de mensajes webview (dónde enganchar `usage_*`).
- `src/gates/approval-logger.ts` — patrón de JSONL append-only para señales de comportamiento.
- `src/settings.ts:13-40` — patrón de settings getter (modelo para `frida.user.*`/`frida.org`/opt-in).

## Developer Context

Decisiones de producto acordadas en sesiones de ideación previas (entrada a esta investigación):

- **Alcance = cliente puro.** Frida produce el reporte; el concentrador (app externa) agrega, ranquea y cruza. Frida no hace cruces contra fuentes externas.
- **Identidad = email en claro** (opt-in explícito). Org desde setting.
- **MVP = dashboard completo + export** (tab "Uso" con KPIs + gráficas + comando export).
- **Contrato `v1` estable desde el inicio**, con campos de F2-F4 como opcionales; aditivo = `v1`, breaking = `v2`.
- **Clasificador SDLC por metadatos únicamente** (privacidad): tool/skill/comando/extensión → fase, nunca contenido del prompt.
- **Fases acordadas**: F0 contrato, F1 MVP (dashboard+export), F2 SDLC+assistedKloc+bugFixSignals, F3 calidad+rework+madurez por fase, F4 role-aware+tendencias.
- **Pregunta metodológica**: el usuario quiere contrastar los datos de Frida contra lo que el equipo reporta al management (tiempo, KLOCs, defectos) y dividir el tiempo por fase del SDLC, para evaluar por rol si el tiempo se dedica a la fase correcta y para planeación personal. **Eso es responsabilidad del concentrador**; Frida aporta `bySdlcPhase`, `assistedKloc`, `bugFixSignals`, `role`, y series temporales por fase.

Tres agentes de investigación en background se bloquearon por el `pi-permission-system` ("requires approval, but no interactive UI is available" para sub-agentes); esta investigación se completó directamente desde el agente principal (foreground, con `bash`/`read`/`grep`).

## Desired End State (boceto del contrato `v1`)

```jsonc
{
  "schema": "frida-usage-report/v1",
  "generatedAt": "2026-08-03T21:38:12-0600",
  "clientVersion": "0.6.0",
  "period": { "from": "...", "to": "...", "granularity": "day" },
  "identity": {
    "org": "softtek", "email": "edgar@softtek.com",
    "project": "frida-code", "repo": "frida-code-vsix", "repoRemote": "git@...git",
    "hostFingerprint": "<sha256>", "timezone": "America/Mexico_City",
    "role": "dev"
  },
  "consent": { "telemetryOptIn": true, "detailLevel": "structured" },
  "kpis": { "tokensIn": 0, "tokensOut": 0, "cacheRead": 0, "cacheWrite": 0, "cost": 0,
            "sessions": 0, "turns": 0, "activeMs": 0, "cacheHitPct": 0, "avgTurnTokens": 0 },
  "breakdowns": {
    "byModel":    [{ "model": "", "tokens": 0, "cost": 0, "turns": 0 }],
    "byProvider": [{ "provider": "", "tokens": 0, "cost": 0 }],
    "byTool":     [{ "tool": "", "count": 0 }],
    "byLanguage": [{ "language": "", "files": 0, "edits": 0 }],
    "byArtifact": [{ "kind": "", "count": 0 }],
    "byDay":      [{ "date": "", "tokens": 0, "cost": 0, "turns": 0 }],
    "byHour":     [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    "byDow":      [0,0,0,0,0,0,0],
    "bySdlcPhase":[{ "phase": "", "tokens": 0, "turns": 0, "activeMs": 0, "assistedKloc": 0 }]
  },
  "behavior": { "compactations": 0, "aborts": 0,
                "approvals": { "allow": 0, "block": 0 },
                "subagentsLaunched": 0, "skillsInvoked": 0, "questionsAsked": 0,
                "bugFixSignals": 0, "rework": 0 },
  "adoption": { "skillsUsed": [], "browserUsed": false, "mcpUsed": false,
                "subagentsUsed": false, "contextToolUsed": false, "autoApprovalUsed": false },
  "effectiveness": { "volume": 0, "breadth": 0, "efficiency": 0, "autonomy": 0,
                     "depth": 0, "advanced": 0, "overall": 0 },
  "quality": { "diagnosticsOnWrite": 0, "testsAdded": 0, "testsPassing": 0 }
}
```

## References

- Sesiones JSONL reales: `~/Library/Application Support/Code/User/globalStorage/softtek.frida-code/sessions/*.jsonl`.
- Código fuente (HEAD `c90ad1a`): ver §Code References.
- Pipeline skills: `src/tools/frida-pipeline/skills/`.
- Decisiones de producto: sesiones de ideación previas (este chat) — ver §Developer Context.
