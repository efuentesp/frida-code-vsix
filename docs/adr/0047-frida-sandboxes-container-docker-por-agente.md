# `frida-sandboxes`: aislamiento por container Docker/devcontainer por agente

**Estado:** aceptado (#35). No bloqueado (Docker en host).

## Contexto

El modelo *Agentic Engineering* (video *"FORGET Loop Engineering"*, IndyDevDan, youtube
`VQy50fuxI34`) escala el aislamiento en dos tiers: **worktrees** (filesystem por branch, ya en Frida
vía #13) → **agent sandboxes** ("dale a cada agente su propia computadora"). El ecosistema pi **no
ofrece "own computer local"**:

- `pi-sandbox` (carderne) = **boundaries de permisos** (allow/deny fs+network vía
  `@carderne/sandbox-runtime`) → **redundante** con `frida-permission-system` (Frida ya tiene
  allow/deny read/grep/find/bash/path).
- `pi-extension-e2b` (edlsh) = **cloud VM** (E2B) → vendor-lock + costo + dependencia de red. No
  local-first.

**Gap real:** ningún paquete pi da aislamiento por **container local** Docker/devcontainer por agente.
`frida-sandboxes` lo llena.

## Decisión

**D1 — Nueva extensión independiente (primitiva horizontal).** Como `frida-worktree`, la consumen
múltiples subsistemas: #26 (detached subagents), el patrón detached-auditor (#19), y futuramente
`withSandbox()` en `frida-extensible-workflows`. No vive dentro de #26.

**D2 — Container local Docker/devcontainer por agente.** Cada agente opera en su propio entorno Linux
aislado; saltas al container a revisar, luego mergeas. El container **ES** el boundary (no se necesita
un sandbox-runtime OS adicional).

**D3 — Extraer de `pi-extension-e2b` la arquitectura de redirección de tools** (NO el backend cloud):
`createE2bReadOps(getSandbox)` define `ReadOperations`/`BashOperations` que rutean al sandbox en vez
del filesystem local. **SWAP E2B SDK → `docker exec`.** Lifecycle (create/pause/resume/reconnect/kill)
→ `docker create`/`pause`/`unpause`/`ps`/`rm`. File sync → `docker cp`. Persistencia → `docker pause`
- named volumes.

**D4 — Extraer de `pi-sandbox` la capa de policy** (NO el sandbox-runtime): `src/policy.ts` (74 LOC —
`shouldPromptForWrite`, `extractDomainsFromCommand`, `domainMatchesPattern`, `domainIsAllowed`,
`expandPath`) y `resolveAllowances(domains/readPaths/writePaths)` de `sandbox-runtime.ts`. Aplican
como policy **in-container** (qué puede tocar el agente dentro del container).

**D5 — Frida-original:** el adapter Docker local (sin cloud), la integración con el runtime de
workflows (`withSandbox()` análogo a `withWorktree()`), y el gating de capability (toggle on/off,
disclosure si Docker falta).

**D6 — Cero conflicto.** Horizontal. No duplica `frida-permission-system` (boundaries vs entorno).
Ortogonal a #26 (detached = lifecycle; sandboxes = entorno). Complementa #13 (worktree = tier-1,
sandbox = tier-2).

## Alternativas consideradas

- **A — Portear `pi-sandbox` directo.** Descartado: redundante con `frida-permission-system`
  (boundaries, no "own computer").
- **B — Portear `pi-extension-e2b` directo (E2B cloud).** Descartado: vendor-lock + cloud. Se extrae
  su **arquitectura**, no su backend.
- **C — Plegar en #26 (better-subagents).** Descartado: el sandbox es horizontal (lo consumen
  workflows, auditor, subagents) → no es específico de subagents.

## Consecuencias

**Positivas**

- Tier-2 de aislamiento ("own computer") local-first, sin vendor-lock.
- Reusa la arquitectura de redirección de `pi-extension-e2b` y la policy de `pi-sandbox` — no se
  inventa de cero.
- Horizontal: un solo motor lo consumen múltiples subsistemas.

**Negativas**

- Requiere Docker/devcontainer en el host (gating + disclosure obligatorios).
- Overhead de container por agente (latencia de arranque).

## Referencias

- Issue **#35**.
- Origen conceptual: video *"FORGET Loop Engineering"* (IndyDevDan, youtube `VQy50fuxI34`).
- **Extraíble de:** `pi-extension-e2b` (edlsh, MIT, `index.ts` 1156 LOC) · `pi-sandbox` (carderne,
  MIT, `policy.ts` 74 LOC + `sandbox-runtime.ts` + `config.ts` 216 LOC).
- Complementa: **#13** worktree (tier-1) · **#26** better-subagents (la compone opc.) · patrón
  detached-auditor (#19).
- Arquitectura de referencia: **ADR-0046** (Loop Engineering) — forma el tier-2 de aislamiento.
