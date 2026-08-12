# GSD-pi — competidor maduro y benchmark del roadmap de Frida

**Tipo:** nota de investigación (no requiere acción de implementación; benchmark de un
competidor maduro + banco de ideas).
**Fecha:** 2026-08-12.
**Pregunta:** ¿Qué aporta [`open-gsd/gsd-pi`](https://github.com/open-gsd/gsd-pi) a Frida?
**Fuente:** [`open-gsd/gsd-pi`](https://github.com/open-gsd/gsd-pi) (MIT, 1048★, v1.15.0, TypeScript). `@opengsd/gsd-pi` en npm.

## TL;DR — veredicto

**GSD-pi NO es Pi** (el nombre es engañoso). Es un **coding agent local-first
independiente y maduro** sobre `@anthropic-ai/claude-agent-sdk` (no
`@earendil-works/pi-coding-agent`). Es el **competidor más completo** evaluado en la
serie. **No hay reusabilidad directa** — su `extension-manifest.json` es formato propio
(`requires.platform: ">=2.29.0"`, runtime propio), no el formato de extensiones de Pi.
Pero es la **validación independiente más fuerte del roadmap de Frida**: casi cada issue
tiene un equivalente maduro y probado en GSD-pi. Sirve de **benchmark** ("el Frida del
futuro ya construido") + **banco de ideas** (UX, skills, patrones de extensión).

## Qué es

Un **coding agent local-first completo** (v1.15.0, muy activo): flujo autónomo
(milestones → slices → tasks, auto mode research/plan/execute), worktree-aware Git,
memoria de proyecto bajo `.gsd/`, multi-provider routing, extension surface (bundled +
community), y **3 frontends** (TUI + Next.js web `gsd --web` + extensión VS Code + app
Electron `studio/`).

**Arquitectura vs Frida:** la extensión VS Code de GSD-pi es un **cliente thin** que
controla el CLI `gsd` (proceso externo instalado globalmente vía `npm i -g
@opengsd/gsd-pi`). Frida, en cambio, **embebe el SDK in-proceso** en el extension host.
Son modelos distintos: GSD-pi = agente externo + cliente; Frida = runtime embebido.

## Pilar 1 — Validación del roadmap (convergencia independiente)

Cada issue del roadmap de Frida tiene un equivalente **maduro y probado** en GSD-pi. La
convergencia, construida independientemente, es evidencia fuerte de que la dirección de
Frida es correcta:

| Roadmap Frida | Equivalente GSD-pi (maduro) |
| --- | --- |
| `#13` frida-worktree | worktree-aware Git automation (isolation + reviewable main) |
| `#21` frida-hermes + `#29` knowledge-base | memoria `.gsd/` (requirements, decisions, runtime notes, plans, summaries, validation evidence) |
| ADR-0017/0018/0019 providers | multi-provider model routing (API keys, OAuth, external CLIs) |
| `#16` plugin system | extension surface (bundled + community: commands, tools, skills, UI) |
| `#38` frida-aidd (spec-driven) | milestone→slice→task + auto mode (plan/implement/verify/advance) |
| `#36` frida-kanban / observabilidad | sidebar dashboard (context usage bar, cost, session, Auto/Next/Quick/Capture) |
| `#24` frida-background-tasks | `remote-questions` (async human-in-loop vía Discord/Slack/Telegram) |
| `#18` token accounting | `auto-budget` + `token-counter` (tests en `src/tests/`) |

**Implicación:** cuando Frida implemente estos issues, **GSD-pi es la referencia de un
sistema que ya los resuelve en producción** — útil para decisiones de diseño y para
identificar edge cases.

## Pilar 2 — Banco de ideas

### UX del dashboard (→ webview de Frida)

El sidebar de la extensión VS Code de GSD-pi muestra en **dos líneas**: connection
status, model, session, message count, thinking level, **context usage bar**, **cost**.
Workflow controls: **Auto / Next / Quick / Capture**. Referencia directa para el webview
de Frida (#17 panel, #36 kanban).

### Skill pack (~40 skills en `src/resources/skills/`)

Muchas adoptables vía el sistema de skills de Frida (`read_skills`). Solapan con
Frida/Matt Pocock (tdd, handoff, grill-me, frontend-design, security-review, review,
debug-like-expert). **Netas nuevas de interés:**

| Skill | Valor |
| --- | --- |
| `code-optimizer` | references estructuradas (algorithmic-complexity, caching-memoization, concurrency-async, database-queries, dead-code, etc.) |
| `observability` | observabilidad |
| `forensics` | investigación forense de incidentes |
| `userinterface-wiki` | **enorme** — cientos de rules UX/UI (a11y, animation, physics, typography, spacing, Fitts/Hick/Miller laws) |
| `web-quality-audit` | audit de calidad web (con scripts) |
| `react-best-practices` | rules de React (rerender, async, bundle, rendering) |
| `accessibility`, `api-design`, `core-web-vitals` | dominios de especialidad |
| `create-skill`, `create-workflow`, `create-gsd-extension` | meta-skills de authoring |
| `decompose-into-slices`, `spike-wrap-up`, `verify-before-complete` | workflow |

### Patrones de extensión (`src/resources/extensions/`)

GSD-pi tiene extensiones que son **patrones reimplementables** en Frida:

| Extensión GSD-pi | Patrón → Frida |
| --- | --- |
| `remote-questions` | async human-in-loop multi-canal (Discord/Slack/Telegram adapters) → `#24` background-tasks o un remote-relay |
| `search-the-web` | búsqueda (tavily) — Frida ya tiene web tools |
| `subagent` | (agents, isolation, launch, run-store, worker-registry, worktree-cwd) → ya cubierto por frida-subagents |
| `universal-config` | config discovery + scanners (relacionado con Agent OS standards → #29) |
| `ttsr` | rule-loader + manager (interrupt rules) |
| `voice` | input de voz (speech-recognizer Python/Swift) — nicho |
| `ollama` | provider Ollama (Frida ya tiene providers) |
| `visual-brief` | briefs visuales |

### `.gsd/` memory layout (→ `.frida/`)

El layout de memoria de proyecto de GSD-pi (requirements, decisions, runtime notes,
generated plans, summaries, validation evidence bajo `.gsd/`) es referencia concreta
para el layout de `.frida/` de `#21`/`#29`.

## Pilar 3 — Por qué NO es reusable directo

- **SDK distinto:** `@anthropic-ai/claude-agent-sdk` (no
  `@earendil-works/pi-coding-agent`). El runtime del agente es distinto.
- **Formato de extensión propio:** `extension-manifest.json` con
  `requires.platform: ">=2.29.0"` (versionado de plataforma propio), no el formato de
  extensiones de Pi. Las extensiones de GSD-pi **no se importan** a Frida — son
  referencia de patrones, no código reusable.
- **Arquitectura de cliente:** la extensión VS Code controla un CLI externo; Frida es
  runtime embebido. No hay punto de integración directo.

## Contraste filosófico con la serie

GSD-pi **enciarna** lo que Matt Pocock critica — el modelo **"dueño del proceso"** (auto
mode que plan/implement/verify/advance autónomamente). BMAD Loop es el equivalente
determinista del mismo modelo. **Frida está en el medio**: tiene el pipeline RPIV
(discover→design→plan→implement→validate) pero no es "dueño del proceso" en el sentido
autónomo de GSD-pi — el humano retiene el control en cada fase.

| Modelo | Quién controla | Ejemplo |
| --- | --- | --- |
| **Dueño del proceso** (GSD-pi, BMAD Loop) | El agente/loop autónomamente | auto mode, sprint loop |
| **Skills composables** (Matt Pocock) | El humano invoca piezas | ask-matt router |
| **Híbrido** (Frida) | Pipeline estructurado, humano en cada fase | RPIV + checkpoints |

## Implicación para Frida

**GSD-pi es el benchmark del roadmap.** Cuando Frida implemente #13/#16/#18/#21/#29/
# 36/#38, comparar contra lo que GSD-pi ya tiene funcionando en producción es de alto
valor — para decisiones de diseño, edge cases, y UX. **No es un porte ni una fuente de
código** (SDK y formato distintos), pero sí la referencia más madura de un sistema que
resuelve los mismos problemas.

## Referencias

- Repo: [`open-gsd/gsd-pi`](https://github.com/open-gsd/gsd-pi) · npm: `@opengsd/gsd-pi`.
- Issues validados: `#13` (worktree) · `#16` (plugins) · `#18` (tokens) · `#21`+`#29`
  (memory/knowledge) · `#24` (bg-tasks) · `#36` (kanban) · `#38` (aidd).
- Serie de research: `matt-pocock-skills-upstream.md` (contraste filosófico) ·
  `agent-os-standards-injection.md` · `bmad-loop-parity.md` · `aidd-bmad-feasibility.md`
  · `graph-engineering-parity.md` · `sdlc-antigravity-parity.md` ·
  `factory-missions-parity.md` · `adlc-boundary.md`.
