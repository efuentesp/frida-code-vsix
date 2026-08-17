# ADR-0016 — frida-permission-system: permisos declarativos + webcontent

**Estado:** Aceptada · **Fecha:** 2025-07-28 · **Relaciona:** ADR-0001 (disuasivo), ADR-0014 (patrón extensión web), ADR-0015 (frida-context)

## Contexto

Los gates de aprobación de Frida viven hoy en `src/gates/approval-gates.ts` con la
política **hardcodeada** en sets de TypeScript (`FREE_TOOLS`, `DIFF_TOOLS`,
`PATH_TOOLS`) más tres modos globales (`manual` / `auto-edit` / `auto`). El logger de
auditoría (JSONL 0600) ya existe y es no-bloqueante. La inspiración canónica es
[`@gotgenes/pi-permission-system`](https://github.com/gotgenes/pi-packages), extensión
declarativa y centralizada de pi con estados `allow` / `ask` / `deny` por superficie
(`tool` / `path` / `bash` / `external_directory`), wildcard matching, hide-tools y
authorizer chain.

Queremos: (1) migrar a un **modelo declarativo** (paridad con gotgenes) para que la
política sea editable sin recompilar; (2) empaquetar todo como una **extensión
independiente** (`frida-permission-system`, mismo patrón que `todo-web` y
`frida-context`); (3) añadir **webcontent** Remote React: auditoría navegable, editor
visual de permisos, stats de sesión y diálogo de aprobación.

### Paridad y diferencias con gotgenes

| Característica | gotgenes (pi) | frida-permission-system |
| --- | --- | --- |
| Política | Declarativa (JSON, wildcard) | **Declarativa** (JSON) ✅ nuevo |
| Estados | allow / ask / deny | allow / ask / deny ✅ |
| Modos | yoloMode (override) | `manual`/`auto-edit`/`auto` como **override** ✅ |
| Hide tools (deny) | ✅ antes de arrancar | **Fase 7** (requiere investigar API del SDK) |
| Bash wildcard | ✅ | ✅ (Fase 1+) |
| Path cross-cutting | ✅ + symlink resolve | ✅ basename/segmentos, **sin** symlink (ADR-0001) |
| External dir | ✅ pattern map | ✅ prefijo cwd (Fase 1) |
| MCP/skills gating | ✅ granular | ❌ (todo desconocido → `ask`) |
| Authorizer chain | ✅ | ❌ fuera de alcance |
| Session approvals | ✅ por patrón | ✅ por patrón (Fase 4) |
| Fail-closed | ✅ | ✅ (heredado) |
| Filosofía | **Candado** (enforced) | **Disuasivo** (ADR-0001: el operador puede evadir) |

La diferencia de fondo **no** es declarativo-vs-imperativo, sino **candado vs
disuasivo**. Por eso no portamos symlink-resolve ni project-trust: Frida asume que el
operador *puede* evadir y se enfoca en evitar accidentes del modelo.

## Decisión

Crear la extensión `src/tools/frida-permission-system/` con política declarativa
(`~/.frida/permission.json`), evaluación en 4 capas (most-restrictive-wins) y un flag
`forceAsk` que sobrevive al modo `auto` (preserva el disuasivo de bash compuesto / path
externo del diseño actual).

### Estructura

```
src/tools/frida-permission-system/
├── types.ts        # Policy, Surface, PermissionDecision, GateEntry, GateStats
├── config.ts       # DEFAULT_POLICY (= behavior actual) + load/save permission.json
├── policy.ts       # evaluate(): 4 capas + force-ask + modo override
├── index.ts        # createPermissionSystem (gate tool_call) + registro de extensión
├── audit-log.ts    # wrapper sobre ApprovalLogger → API del panel (Fase 2)
├── session-store.ts# session approvals por patrón + stats (Fase 3/4)
├── AuditPanel.tsx  # Remote React: auditoría navegable (Fase 2)
└── ConfigPanel.tsx # Remote React: editor visual allow/ask/deny (Fase 5)
```

Los helpers actuales (`sensitive-paths`, `dangerous-commands`, `bash-indirection`,
`external-paths`) se quedan en `src/gates/` durante Fase 0-1 (sus tests los importan) y
`policy.ts` los consume; migrarlos a `surfaces/` dentro de la extensión es cleanup
posterior.

### Política declarativa (`~/.frida/permission.json`)

```jsonc
{
  "version": 1,
  "mode": "manual",            // override rápido: manual | auto-edit | auto
  "policy": {
    "tool": {
      "read": "allow", "grep": "allow", "find": "allow", "ls": "allow",
      "todo": "allow", "ask_user_question": "allow",
      "edit": "ask", "write": "ask", "bash": "ask",
      "*": "ask"               // default: desconocido pide
    },
    "path": {                  // cross-cutting (todos los file access)
      "*": "allow", "*.env": "deny", "*.env.*": "deny", ".env.example": "allow",
      "~/.ssh/*": "deny", "*.pem": "deny", "*.key": "deny"
    },
    "bash": {                  // wildcard sobre comando normalizado
      "*": "ask", "rm -rf *": "deny", "git status": "allow"
    },
    "external_directory": "ask" // CWD boundary
  }
}
```

**Estados:** `allow` (pasa silencioso) · `ask` (diálogo) · `deny` (bloquea con reason).

**`DEFAULT_POLICY` reproduce EXACTAMENTE el behavior actual** (Fase 0-1 = migración
sin surprise): los sets hardcodeados se traducen a la policy default.

### Evaluación — 4 capas (most-restrictive-wins) + force-ask

```
1. path (deny)  →  2. external_directory  →  3. per-tool  →  4. bash
   orden de precedencia: deny > ask > allow
```

Sobre la decisión de la policy se aplica el **force-ask** (capa de seguridad heredada
del diseño actual): un bash compuesto/wrapper (`hasShellIndirection`) o un path fuera
del workspace (`isExternalPath`) marca `forceAsk: true`, que **sobrevive al modo
`auto`** — esto preserva el disuasivo: en auto el usuario no mira, y un sub-comando
peligroso no debe colarse amparado por uno benigno, ni el agente salir del workspace
sin avisar.

Aplicación del **modo** (override):

- `deny` → siempre bloquea (incluso en `auto`, como yoloMode de gotgenes).
- `ask` sin `forceAsk` + `auto` → `allow`.
- `ask` sin `forceAsk` + `auto-edit` → `allow` sólo para edit/write.
- `ask` + `forceAsk` → siempre `ask`.
- `allow` → pasa.

### Webcontent (Remote React) — 4 paneles

| Panel | Trigger | Tipo | Contenido | Fase |
| --- | --- | --- | --- | --- |
| **AuditPanel** | `/gates` | overlay persistente | JSONL navegable: filtros (tool/decisión/source), colores (✓allow ✗block ⚡auto), detalle expandible | 2 |
| **Stats footer** | siempre | footer | modo + `✓N ✗M ⚡Z` (aprobadas/bloqueadas/auto-allow de la sesión) | 3 |
| ~~ApprovalDialog~~ | ~~`tool_call` ask~~ | ~~diálogo efímero~~ | **REVERTIDO**: el overlay Remote React no se materializaba de forma fiable (banner sin tarjeta); se vuelve a la ApprovalCard nativa del webview (canal `approval_response`) | 6 |
| **ConfigPanel** | Configuración → Auto-Aprobación (webview) | pestaña del SettingsHub | editor visual allow/ask/deny por superficie (escribe permission.json) | 5 → reemplazado por webview (#55) |

### Plan por fases

| Fase | Qué | Riesgo | Valor |
| --- | --- | --- | --- |
| **0** ✅ | Estructura + `types.ts` + `config.ts` (DEFAULT_POLICY = behavior actual) | bajo | base |
| **1** ✅ | `policy.ts` evaluación declarativa + `index.ts` (createPermissionSystem) → reemplazar `approval-gates.ts` | **medio** (core) | 🎯 declarativo |
| **2** ✅ | `AuditPanel` (Remote React) + `/gates` | bajo | alto (observabilidad) |
| **3** ✅ | **Stats footer** | bajo | medio |
| **4** ✅ | Session approvals por **patrón** (no bool) | medio | medio |
| **5** ✅ | **ConfigPanel** (editor visual) | medio | medio |
| **6** ↩️ | ~~ApprovalDialog Remote React~~ → **revertido** (ApprovalCard nativa) | — | fiabilidad |
| **7** ✅ | `deny` oculta tools del catálogo (`before_agent_start` + `setActiveTools`) | medio | paridad gotgenes |

**Implementado (Fases 0-7 — todas):**

- **Fase 0-1:** behavior idéntico al anterior (DEFAULT_POLICY = sets hardcodeados),
  fail-closed + logger intactos. Validado con 13 tests de `policy.evaluate()`
  (baseline tool / deny por policy / force-ask).
- **Fase 2 — AuditPanel** (`/gates`): overlay Remote React que lee el JSONL
  (`audit-log.ts:readAuditLog`, últimas 200 entradas, más reciente primero) y lo
  muestra con filtros (`Todas`/`Permitidas`/`Bloqueadas` vía `useState`), colores
  por decisión (✓ allow verde / ✗ block rojo), stats (✓N ✗M) y detalle por fila
  (tool · source · path|command · flags · hora). Snapshot puntual: re-ejecutar
  `/gates` refresca.
- **Fase 3 — Stats footer:** contadores de la sesión (`session-store.ts:GateStatsStore`)
  junto al toggle de modo en el header: `✓N` aprobadas (verde) · `✗M` bloqueadas
  (rojo) · `⚡Z` auto-allow (amarillo, sólo si >0). El gate alimenta el store en cada
  decisión (`record()` = log + count); el host publica vía `gate_stats` al webview;
  se resetea al `/new`.
- **Fase 4 — Session approvals por patrón:** `SessionApprovals` (`session-approvals.ts`)
 registra patrones aprobados por sesión; el gate los consulta antes del diálogo
 (`matches(kind, value)` → allow, source `session_pattern`, cuenta como ⚡ en stats).
 El diálogo sugiere un patrón (`suggestPattern`: bash → `npm *`, diff → `src/*`) y
 ofrece un botón «Aprobar `<patrón>` (esta sesión)». Force-ask (bash compuesto /
 path externo) siempre pide, aunque el prefijo esté aprobado. Clear al `/new`.
- **Fase 5 — ConfigPanel** (originalmente `/gates-config`; desde #55 es la pestaña
  **Configuración → Auto-Aprobación** del webview): editor visual de la política
  declarativa. Estado "controlado" en el host (`config-store.ts`; el puente de
  mensajes de extension.ts llama a los setters y republica el snapshot con
  `postPermissionsConfig`). Cada tool tiene un tri-state segmentado
  (Permitir ✓ / Preguntar ● / Bloquear ✕); clic → `setTool` → persiste → el
  cache que el gate lee en cada tool_call se actualiza → aplica al instante.
- **Fase 6 — ApprovalDialog (REVERTIDO):** se migró la ApprovalCard nativa a un
  componente Remote React (`ApprovalDialog.tsx`) montado como overlay por el host
  (`syncApprovalDialogs`). **Revertido** porque el overlay no se materializaba de
  forma fiable en el webview: el usuario veía el banner "Frida espera tu
  aprobación:" pero no la tarjeta con los botones. Se vuelve a la **ApprovalCard
  nativa** del webview, renderizada directo desde `state.approvals` (que sí llega)
  y respondida por el canal `approval_response` → `bridge.resolve`. Es además
  más rica (renderiza el diff con `<Diff>` + iconos). El mecanismo Remote React
  (`mountPersistent`) se conserva para AuditPanel/ConfigPanel/todo.
- **Fase 7 — hide-tools deny:** el SDK expone `setActiveTools(toolNames)` (filtra el
  catálogo del LLM) + el evento `before_agent_start`. En cada turno,
  `computeDeniedTools(policy)` (excluye el wildcard `*` a propósito: un `*: deny` NO
  oculta todo) → `pi.getActiveTools().filter(no denegados)` → `pi.setActiveTools`.
  Doble defensa: el tool desaparece del catálogo (el agente no pierde turnos
  probándolo) Y el gate `tool_call` lo bloquea si lo alucina. Best-effort
  (try/catch): si falla, el gate sigue protegiendo.
- **Fase 5b — editor de path/bash wildcards:** `evaluate()` ahora aplica los
  patrones declarativos de `policy.path`/`policy.bash` (wildcard, most-restrictive-
  wins; un `*: allow` default no anula un `*.env: deny` específico). Nuevos sources
  `policy_path`/`policy_bash` en el log. El ConfigPanel añade secciones path/bash:
  lista editable (3 botones allow/ask/deny + quitar) + input controlado para añadir
  patrones (`setPathPattern`/`setBashPattern` en config-store). **163 tests en verde.**

## Consecuencias

- **Positivas:** política editable sin recompilar; base para observabilidad (audit
  panel) y editor visual; paridad conceptual con gotgenes; la extensión es
  autocontenida (mismo patrón que todo-web / frida-context).
- **Negativas:** más superficie de configuración (dos fuentes de verdad durante la
  transición: settings `frida.gates.*` legacy vs `permission.json`); Fase 1 es un
  refactor del path crítico de seguridad (hay que validar con los 5 tests de helpers
  - logger + tests nuevos de `policy.evaluate`).
- **Riesgo mitigado:** DEFAULT_POLICY reproduce el behavior actual; los helpers no se
  mueven en Fase 0-1 (tests intactos); el flag `forceAsk` preserva el disuasivo de
  bash/path externo.

## Fuera de alcance

- Symlink-resolve y project-trust (candado, contradice ADR-0001).
- MCP/skills gating granular (todo desconocido sigue → `ask`).
- Authorizer chain (model judge).
- Subagent forwarding (Frida no tiene subagents).
