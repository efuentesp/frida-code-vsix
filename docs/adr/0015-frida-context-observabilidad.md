# frida-context: observabilidad de la capacidad del contexto

**Estado:** aceptado (fase A + B).

> **Fase A (D27):** tool agent-facing `context` con snapshot de presión (JSON
> constante). El **medidor para el humano ya existía** (`webview/components/ContextBar.tsx`).
> **Fase B (D27):** comando `/context` + tool `mode:"full"` con reporte de
> atribución (categorías de uso + composición del system prompt) — `before_agent_start`
> cachea `systemPromptOptions`/`systemPromptText`.

## Contexto

`@mrclrchtr/supi-context` añade observabilidad de la capacidad del contexto a pi con
**dos caras**:

- **Snapshot de presión (agent-facing):** tool `supi_context` → JSON constante de 1
  línea (`ContextPressureSnapshot`: contextWindow, usedTokens, usagePercent,
  compactionEnabled, reserveTokens, headroomTokens, pressurePercent, compacted,
  approximationNote). El agente lo consulta para decidir si cabe otra operación.
- **Reporte de uso (human-facing):** comando `/supi-context` → desglose de **dónde**
  se gasta el contexto (categorías: system prompt / user / assistant / tool calls /
  tool results; composición del system prompt: base, AGENTS.md, skills, guidelines,
  tool snippets, archivos inyectados). Entra al transcript, **nunca** al LLM.

Frida **no** exponía nada de esto al agente: el modelo no veía su propia presión de
contexto. El humano sí veía tokens totales (ContextBar), pero sin desglose.

## Decisión

Crear la extensión **`frida-context`** (`src/tools/frida-context/index.ts`) que
registra el tool **`context`** (sin prefijo supi). Misma **filosofía** que supi, otra
**superficie** (web, no TUI):

| Principio supi | En frida-context |
| --- | --- |
| Snapshot = decisión operativa (constante, sin ruido) | igual — `context` devuelve JSON 1 línea |
| Reporte = diagnóstico humano (fuera del LLM) | igual — `/context` → `notice` (no entra al contexto) |
| Reutiliza el SDK (`getContextUsage`, `SettingsManager`, `getLatestCompactionEntry`) | igual |
| `analysis.ts` es pura → portable | porteada en `frida-context/analysis.ts` |

## Fase A — MVP implementado

**Tool `context`** (`src/tools/frida-context/index.ts`):

```ts
interface ContextPressureSnapshot {
  modelName: string;
  contextWindow: number | null;
  usedTokens: number;
  usagePercent: number | null;        // % de la ventana bruta
  compactionEnabled: boolean;
  reserveTokens: number;
  headroomTokens: number | null;      // contextWindow − reserve − used
  pressurePercent: number | null;     // % de la capacidad EFECTIVA (ventana − reserve)
  compacted: boolean;                 // getLatestCompactionEntry(branch) !== null
  approximationNote: string | null;   // si el gateway no reportó tokens medidos
}
```

Datos (todos del SDK, sin estimar salvo que el gateway no reporte):

- `ctx.getContextUsage()` → `{ tokens, contextWindow }`.
- `SettingsManager.create(ctx.cwd, undefined, { projectTrusted })` → `getCompactionEnabled()`, `getCompactionReserveTokens()`.
- `getLatestCompactionEntry(ctx.sessionManager.getBranch()) !== null` → compactado.
- `ctx.model?.name` → modelName.

**`pressurePercent`** se mide contra la capacidad **efectiva** (ventana − reserve), no
la bruta: `>100%` ⇒ el agente debería compactar. Es la métrica operativa clave.

**Medidor para el humano:** `ContextBar` (barra de % con color low/mid/high + tokens).
Ahora usa `pressurePercent` (ajustado por reserve) en vez de `usagePercent` simple →
la barra anticipa la compactación (ver "Mejora del ContextBar" abajo).

## Registro y configuración

- Factory `createFridaContext()` registrada en `extensionFactories` como
  `{ name: "frida-context", factory: toggleable(opts.contextEnabled, ...) }` — mismo
  patrón que `todo`/`ask_user_question`.
- Toggle `frida.context.enabled` (default `true`) en `settings.ts` +
  `package.json` (contributes.configuration). Se re-evalúa en `/reload`.

## Ventajas para el usuario

1. **Auto-regulación del agente:** con `pressurePercent`, el modelo deja de adivinar si
   cabe otra operación — compacta proactivamente, resume o pide confirmación antes de
   inyectar archivos grandes.
2. **Transparencia de tokens:** el snapshot expone `usedTokens`/`headroom`/`reserve` que
   el agente puede citar al usuario ("estoy al 85% de presión, voy a compactar").
3. **Robustez ante gateways que no reportan tokens:** `approximationNote` señala cuándo
   la lectura es estimada (relevante para DevEngine, que ya vimos no reporta reasoning).

## Fase B — implementada (reporte detallado `/context` + `mode:"full"`)

**Comando `/context`** (built-in slash, `extension.ts:postContextCommand`): monta un
**panel overlay Remote React** (`ContextReport.tsx`) con una **barra segmentada** estilo
Claude Code — el contextWindow completo dividido en segmentos coloreados por categoría
(system prompt / tool snippets / messages / tool calls / tool results / free space),
proporcionales a los tokens — más leyenda con tokens/% y métricas (presión, headroom,
compaction). Se monta vía `WebBridge.mountPersistent(…, "overlay")` y se cierra con un
botón (onClose → unmount); re-ejecutar `/context` reemplaza el panel anterior.

```
Context Usage · gpt-5.4-mini · 142k/300k tokens (47%)
[████████████████████████░░░░░░░░░░░░░░░░░░░░░░░░]  ← barra segmentada (colores reales)
presión 52% · headroom 128k · sin compactar · compaction on (reserve 30k)
■ System prompt   62k (21%)
■ Tool snippets   26k (9%)
■ Messages        34k (12%)
■ Free space     158k (53%)
[ Cerrar ]
```

**Catálogo ampliado:** se añadió `background?: string` + `height?: number` a `BoxProps`
(para los segmentos coloreados de la barra), propagado a `RemoteRoot.flexStyle`.

**Tool `context({mode:"full"})`** devuelve el mismo análisis serializado en JSON al
agente (diagnóstico de atribución).

**Análisis** (`frida-context/analysis.ts` + `prompt-inference.ts`, paridad con supi-context):

- `estimateTextTokens`, `computeMessageCategories` (por rol), `applyScaling`.
- `computeSystemPromptBreakdown` con **atribución detallada**: base, **instruction
  files** (AGENTS.md/CLAUDE.md separados, con origin global/project), **skills** (tokens
  por skill vía `formatSkillsForPrompt`), **guidelines** (bullets + fuente: default /
  tool built-in / extensions, vía `classifyGuidelines` parseando la sección
  `"Guidelines:"` del systemPrompt), **tool snippets** (tokens por tool), appendText.
- `computeToolDefinitions` (count + tokens + descripción por tool) vía
  `pi.getAllTools()` + `pi.getActiveTools()`.
- Datos: `ctx.getContextUsage()`, `buildSessionContext(branch).messages`,
  `ctx.getSystemPrompt()`, `systemPromptOptions` + `allTools`/`activeTools` (cacheados).

El ContextReport muestra ahora: barra segmentada + métricas + **Uso por categoría** +
**Composición del system prompt** (sub-desglose) + **Instruction files** + **Skills** +
**Guidelines** (fuentes + ejemplos) + **Tool definitions** (activos).

**Conectores de árbol (├/└):** todas las listas indentan sus items con conectores
(`├` intermedio, `└` último) vía un componente `TreeItem`, dejando el header de sección
(bold, sin conector) claramente distinguible de los items. El "… y N más" de
truncamiento cierra el árbol con `└`.

**Mejora del `ContextBar` (implementada):** la barra ahora usa `pressurePercent`
(ajustado por reserve) en vez de `usagePercent` simple → anticipa la compactación. El
host calcula `pressurePercent` + `reserveTokens` en `postUsage` (reserve cacheado vía
`SettingsManager`) y los envía al webview; `ContextBar` los consume con fallback a la
bruta (`usage.contextPercent`).

### Corrección — `/context` lee el systemPrompt en tiempo real (no del cache)

Originalmente `postContextCommand` leía `systemPrompt` + `options` + `tools` de un
**cache module-level** poblado en `before_agent_start` (solo dispara en un turno del
agente). Si el usuario daba `/context` **sin un turno del agente en la instancia
actual** (reabrir VS Code + sesión existente), el cache estaba vacío y la "Composición
del system prompt" salía toda en 0, aunque el uso total sí viniera de
`frida.session.getContextUsage()`.

**Fix:** `postContextCommand` ahora lee en **tiempo real de `frida.session`** (con
fallback al cache): `.systemPrompt` (getter público), `.getAllTools()` (público),
`._baseSystemPromptOptions` y `.getActiveToolNames()` (internos). Ya están poblados al
configurar los tools (`setActiveToolsByName` → `_rebuildSystemPrompt`), antes del primer
turno. Optional chaining en todo → si un campo interno cambia en el SDK, cae al cache sin
romper. El tool `context` ya usaba `ctx.getSystemPrompt()` en runtime y no se ve afectado.

## Referencias

- `@mrclrchtr/supi-context` en `~/.pi/agent/npm/node_modules/@mrclrchtr/supi-context` —
  referencia original (TUI: tool `supi_context` + comando `/supi-context`).
- `webview/components/ContextBar.tsx` — medidor persistente (ya existente).
- D27 en `CONTEXT.md`.
