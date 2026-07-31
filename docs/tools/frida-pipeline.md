# `frida-pipeline`

> **Estado:** ✅ **v0.2.0 — Release completo** · [ADR-0021](../adr/0021-frida-pipeline-porter-rpiv-pi.md) · [análisis](../../.rpiv/artifacts/discover/2025-07-31_frida-pipeline-porter-rpiv-pi.md)

Orquestador nativo que ata las 5 extensiones nativas de Frida
(`frida-workflow`, `frida-args`, `frida-context`, `frida-permission-system`,
`frida-agent-browser`) y aporta las piezas que faltan para llegar a paridad
funcional con `@juicesharp/rpiv-pi` (27 skills, 15 subagentes, 3 workflows,
guidance recursiva, git-context, models picker, lane dock).

## ¿Qué es?

`frida-pipeline` es un **orquestador puro**: no registra tools propios
(igual que `rpiv-pi`). Su trabajo es **componer** las 5 extensiones nativas
existentes, **inyectar contexto** (guidance, git, índice de skills) en los
puntos invisibles de la sesión, y **servir** los artefactos que los
workflows y las skills necesitan (artefactos en `.frida/artifacts/`, modelos
en `.frida/models.json`, agentes en el agentDir global).

Sigue el mismo patrón de **porte nativo** que `frida-workflow` (ADR-0020),
`frida-args`, `frida-context`, `frida-permission-system` y
`frida-agent-browser`: 0 dependencias npm nuevas, código propio en `src/`,
reutiliza el SDK de Pi ya embebido en Frida. No reabre ADR-0005.

## ¿Cuándo usarla?

**v0.2.0 (release):** las 11 fases del plan ADR-0021 están completas.
Skills 27/27, Agentes 15/15, Workflows 3/3, Hermanas 5/5.

Las skills se sincronizan a `~/.frida/skills/` al iniciar sesión
(skill-sync); los agentes a `~/.frida/global/agents/` (agents-sync con sha256).

```text
Skills: 27/27 · Agentes: 15/15 · Workflows: 3/3
```

**NO la uses si** quieres correr un workflow definido por el usuario:
usa `/wf` con workflows en `.frida/workflows/`.

## Conceptos

| Término | Significado |
| --- | --- |
| **Hermana (sibling)** | Una de las 5 extensiones nativas requeridas (`frida-workflow`, `frida-args`, etc.). El orquestador valida que las 5 están presentes. |
| **Orquestador puro** | Como `rpiv-pi`: no registra tools; ata otras extensiones y aporta hooks invisibles. |
| **Skill** | Un `SKILL.md` con frontmatter `contract: { produces, consumes }`. Fase 6+ las añadirá (27 en total). |
| **Agente** | Un `.md` en el agentDir global con un system prompt especializado. Fase 5 añadirá 15 perfiles. |
| **Workflow built-in** | Una config en `frida-workflow/load/layers.ts`. Fase 10 añadirá `build`/`vet`/`polish`. |
| **Artefacto** | Un `.md` en `.frida/artifacts/<bucket>/`. Cada skill/workflow escribe uno. |
| **Banner** | Panel React persistente en el footer del webview (D32). Fase 1: muestra estado. Fases 2+: mostrará progress en vivo de runs. |

## Uso

Fase 5 expone tres slash commands:

```text
/pipeline
        → estado del orquestador + banner persistente
          (ahora muestra Agentes: 15/15)

/frida-models
        → muestra overrides activos + abre ~/.frida/models.json en el editor

/frida-update-agents
        → re-sincroniza los 15 agentes al agentDir global.
          Fuerza overwrite (incluye agentes editados a mano).
```

**Ejemplo de `~/.frida/models.json`:**

```jsonc
{
  "defaults": { "model": "anthropic/claude-sonnet-4-20250514" },
  "skills": {
    "commit":  { "model": "github-copilot/gpt-5", "thinking": "low" },
    "discover": { "thinking": "high" }
  }
}
```

Al invocar `/skill:commit`, el modelo cambia a `github-copilot/gpt-5` con
thinking `low`. Al terminar el turno, se restaura el modelo baseline.
`discover` sólo sube el thinking a `high` (sin cambiar de modelo).

**Ayuda contextual:** `/help pipeline` o `/help models` abre este doc.

## API / DSL

### Estado del orquestador

```ts
import { computePipelineStatus } from "frida-pipeline";

const status = computePipelineStatus();
// status.siblings.allPresent    → boolean
// status.siblings.presentCount  → "5" (o menos si falta alguna)
// status.counts.skills          → { present: 0, expected: 27 }
// status.counts.agents          → { present: 0, expected: 15 }
// status.counts.workflows       → { present: 0, expected: 3 }
// status.level                  → "empty" | "degraded" | "ready"
```

### Formato chat-friendly

```ts
import { formatPipelineStatus } from "frida-pipeline";

const text = formatPipelineStatus(computePipelineStatus());
// → "frida-pipeline v0.1.0\n\nHermanas: 5/5 detectadas\n  ✅ frida-workflow ..."
```

### Banner persistente

```ts
import { wirePipelinePanel } from "frida-pipeline";

// Llamar una vez por sesión. Idempotente.
wirePipelinePanel(s.webBridge);
```

### Reset (sólo tests)

```ts
import { _resetPipelinePanel, bannerStore } from "frida-pipeline";
_resetPipelinePanel();
bannerStore._reset();
```

### Guidance (Fase 2)

```ts
import { resolveGuidance, resolveAndFormatNewGuidance } from "frida-pipeline";

// Walk recursivo: de la raíz del proyecto al directorio del archivo.
// En cada profundidad: AGENTS.md > CLAUDE.md > .frida/guidance/<sub>/architecture.md
const files = resolveGuidance("src/lib/foo.ts", cwd);
// → [{ relativePath: "src/lib/AGENTS.md", content: "...", kind: "agents" }]

// Formatea con dedup (sólo lo no inyectado aún):
const block = resolveAndFormatNewGuidance("src/lib/foo.ts", cwd, "edit");
// → "[frida-guidance — material de referencia...]"  o  null
```

### Git-context (Fase 2)

```ts
import { isGitMutatingCommand } from "frida-pipeline";

isGitMutatingCommand("git checkout -b feat");  // true
isGitMutatingCommand("git status");              // false
```

## Configuración

Fase 1 no añade settings a `package.json`. La detección de hermanas es
100% filesystem (busca `src/tools/<hermana>/index.ts` relativo a la raíz del
proyecto).

Fases futuras añadirán:

| Clave (planeada) | Tipo | Default | Descripción |
| --- | --- | --- | --- |
| `frida.pipeline.enabled` | boolean | `true` | Habilita el orquestador completo. |
| `frida.pipeline.banner.autoMount` | boolean | `false` | Si true, monta el banner en cada `session_start` (intrusivo). |
| `frida.pipeline.siblings.strict` | boolean | `true` | Si true, falla el session_start cuando falta alguna hermana. |

## Integración con Frida

- **Registro como extensión Pi:** `src/pi-session.ts` — `createFridaPipeline()`
  factory registrada como `{ name: "frida-pipeline", factory: ... }` en el
  array `extensions`. La factory registra los hooks (`session_start`,
  `session_compact`, `session_shutdown`, `tool_call`, `before_agent_start`)
  vía `registerSessionHooks(pi)`.
- **Registro como slash command:** `src/extension.ts` línea ~43 (import) +
  ~1484 (BUILTIN_SLASH) + ~1558 (`case "pipeline"`) + ~1864
  (`postPipelineCommand`).
- **Sesiones / gates:** No abre sesiones hijas todavía. Las Fases 10+
  heredarán el patrón de `frida-workflow` (D32): el `FridaWorkflowHost`
  reusa el `ApprovalBridge` compartido, así los gates de las hijas
  confluyen en el mismo webview.
- **UI:** `mountPersistent` en `footer`, igual que `WorkflowPanel`. Reusa
  `WebBridge` de la sesión; el componente se reconcilia con los tags
  intrínsecos de `frida-webview` (`<fbox>` / `<ftext>`).
- **Mensajes ocultos:** los bloques de guidance y git-context viajan como
  `customType: "frida-guidance"` / `"frida-git-context"` con
  `display: false` (no aparecen en el chat salvo con `--frida-debug`).

## Arquitectura / Internals

```text
src/tools/frida-pipeline/
├── index.ts            # API pública + createFridaPipeline() factory
├── constants.ts        # namespace frida-* (customType, flags, dirs)
├── siblings.ts         # detección de las 5 hermanas (existsSync)
├── setup-command.ts    # computePipelineStatus + formatPipelineStatus
├── guidance.ts         # walk recursivo AGENTS.md > CLAUDE.md > architecture.md
├── git-context.ts      # cache branch+commit+user (pi.exec "git")
├── session-hooks.ts    # wire de session_start/compact/shutdown/tool_call
├── pipeline-pointer.ts # índice de skills (customType frida-pipeline-index)
├── session-capture.ts  # captura model+registry al session_start; apply/restore
├── skill-bracket.ts    # override de modelo por skill (hook input + agent_end)
├── models-config.ts    # schema + loader + cascade de ~/.frida/models.json
├── banner.tsx          # BannerPanel (React, useSyncExternalStore)
└── panel.ts            # wirePipelinePanel (mountPersistent, idempotente)
```

**Flujo de `/pipeline`:**

1. `runBuiltinSlash` matchea `"pipeline"` en `BUILTIN_SLASH`.
2. `postPipelineCommand` llama `wirePipelinePanel(s.webBridge)` → monta el
   banner en el footer.
3. `computePipelineStatus()` recorre las 5 rutas esperadas con `existsSync`.
4. `formatPipelineStatus` lo serializa a texto chat-friendly.
5. `post({ type: "info" | "warning", text })` lo manda al chat.

**Flujo de guidance (Fase 2, automático):**

1. `tool_call` (read/edit/write) dispara `handleToolCallGuidance`.
2. `resolveGuidance(filePath, cwd)` camina de la raíz al directorio del archivo.
3. `resolveAndFormatNewGuidance` filtra lo ya inyectado (dedup Set) y formatea.
4. Si hay contenido nuevo, `sendMessage({ customType: "frida-guidance", ... })`.

## Ver también

- [README](../../README.md) — índice general de Frida Code
- [ADR-0021](../adr/0021-frida-pipeline-porter-rpiv-pi.md) — la decisión
  arquitectónica (7 decisiones firmadas D1–D7)
- [análisis](../../.rpiv/artifacts/discover/2025-07-31_frida-pipeline-porter-rpiv-pi.md)
  — el documento de descubrimiento que originó esta extensión
- [frida-workflow](frida-workflow.md) — el motor de workflows que se reusa
- [`rpiv-pi` upstream](https://github.com/juicesharp/rpiv-mono/tree/main/packages/rpiv-pi)
  — la extensión que se está portando (referencia de comportamiento)

## Estado y madurez

**Fase 11 de 11 — RELEASE COMPLETO ✅**

| Fase | Entregable | Estado |
| --- | --- | --- |
| 0 | ADR-0021 firmado | ✅ |
| 1 | Esqueleto + banner + `/pipeline` | ✅ |
| 2 | Guidance + git-context | ✅ |
| 3 | Skill bracket + models picker | ✅ |
| 4 | Pipeline pointer | ✅ |
| 5 | Agents sync (15 .md + sha256) | ✅ |
| 6 | Skills lote 1 (3) | ✅ |
| 7 | Skills lote 2 (8) | ✅ |
| 8 | Skills lote 3 (7) | ✅ |
| 9 | Skills lote 4 (9) — 27/27 | ✅ |
| 10 | Workflows built-in (3) | ✅ |
| **11** | **Release 0.2.0 (vsix + CHANGELOG + E2E)** | **✅** |

Riesgos conocidos:

- **Detección de raíz:** `siblings.ts` busca el `package.json` con
  `name === "frida-code"` subiendo hasta 8 niveles desde `process.cwd()`.
  Bajo `esbuild` bundle, el `__dirname` original se pierde; confiamos en
  que VS Code fija el cwd correctamente. Si esto falla en producción, el
  fallback muestra versión "?" y todas las hermanas como missing.
- **Reactividad del banner:** Fase 1 recalcula el estado en cada
  `getSnapshot`. Las Fases 2+ introducirán un store reactivo con sha256
  sobre los `index.ts` de las hermanas para no stat(2) en cada render.
- **Coexistencia con `rpiv-pi`:** ver ADR-0021 §Coexistencia. Sin colisión
  si ambos paquetes están instalados; documentado en README de Frida.
