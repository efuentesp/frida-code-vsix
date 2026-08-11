# Frida frente a BMAD Method + BMAD Loop (orquestador determinista + metodología)

**Tipo:** nota de investigación (no requiere acción de implementación).
**Fecha:** 2026-08-11.
**Fuente:** video *"bmad-loop First Look: AI Agents Build Entire Epics Overnight"* (youtube `iW86sMHszJw`, ~6 h, live demo).
**Transcripción:** extraída vía `yt-dlp` + sesión Brave + `--remote-components` (ver ADR-0049 para el método).
**Parte de la serie:** `graph-engineering-parity.md` · `sdlc-antigravity-parity.md` · `factory-missions-parity.md` · `adlc-boundary.md` · esta nota.

## Resumen

BMAD Method (metodología spec-first: PRD → arquitectura → epics & stories →
dev → review → retro, con **Quickdev** como flujo brownfield ágil) +
**BMAD Loop** (aplicación **Python determinista que corre FUERA de Claude/Codex**
y orquesta build+test de stories en orden). Piezas: deferred-work engine (split +
defer no-bloqueante), ciclo de review 2/3-agentes, modos (per-epic overnight /
per-story / continuo), escalación/resolve/resume, sweeping (triage del ledger de
deferred work), worktrees por story, TMux (sesiones reales — evita paywall de
headless + scraping determinista), model-agnostic (dev vs review), hooks-based.

**Veredicto:** Frida ya **ES** BMAD Loop — ambos convergen en la arquitectura del
"bitter lesson" (orquestación determinista fuera del LLM + inteligencia dentro,
con worktrees + review creator-verifier + resume). Frida tiene **retry/resume
nativo** que BMAD Loop tuvo que construir. La diferencia: BMAD Loop drivar CLIs
externos vía TMux; Frida **ES** el harness (sin capa de indirección). Los gaps:
**#18 (recurrente)** + metodología spec-first empaquetada + patrones
deferred-work/sweeping + async multi-día (#20/#24).

## La coincidencia clave: BMAD Loop ≈ `frida-extensible-workflows`

| BMAD Loop | Frida | Estado |
| --- | --- | --- |
| **Orquestador Python determinista fuera del LLM** | `frida-extensible-workflows` — el ADW ES un script determinista que orquesta sesiones | ✅ MATCH casi exacto |
| Driva sesiones Claude/Codex vía CLI | `agent()` llama al modelo dentro del harness | ✅ MATCH |
| TMux (gestión + scraping de sesiones) | Frida ES el harness + `RunStore` | ✅ N/A (no necesita TMux) |
| **Worktrees por story/run** | `frida-worktree` (#13) + `withWorktree()` | ✅ MATCH directo |
| **Escalación/resolve/resume** | `checkpoint()` + `workflow_retry`/`workflow_resume` (nativo) | ✅ MATCH |
| Deferred-work engine (split + defer + continue) | patrón (#19 + `iterate`/`fanin` del DSL workflow) | 🟡 PARCIAL |
| Ciclo de review 2/3-agentes | detached-auditor (#19) + code-review/adversarial | ✅ MATCH |
| Sweeping (triage ledger, empaqueta, resuelve) | patrón (`iterate`/`fanin` del workflow) | 🟡 PARCIAL |
| Modos (per-epic overnight / per-story / continuo) | checkpoints hoy; async multi-día = #24/#20 | 🟡 PARCIAL |
| Spec-first (buenos specs → mejor implementación) | guidance (`.frida/guidance/`) + skills + #27 plan-mode | 🟡 PARCIAL (mecanismo sí) |
| **Model-agnostic + modelo por rol (dev vs review)** | #19 G2 tier routing — bloqueado por #18 | ❌ GAP (recurrente) |
| Hooks (control determinista en puntos clave) | Frida tiene hooks parciales; faltan `agent_settled`/context-injection (#20/#21) | 🟡 PARCIAL |
| Observabilidad (logs, tracking enterprise) | `RunStore` + #36 kanban + #18 budget | 🟡 PARCIAL |

## Hallazgos clave

1. **Frida ya ES BMAD Loop.** Ambos convergen en la arquitectura del "bitter
   lesson" (Factory video): orquestación determinista fuera del LLM + inteligencia
   del modelo dentro. Frida tiene **retry/resume nativo** (`RunStore`,
   `workflow_retry`/`workflow_resume`) que BMAD Loop construyó a mano. Frida es el
   harness (más limpio); BMAD Loop drivar CLIs externos vía TMux.

2. **La infraestructura dura ya está; la metodología es capa blanda.** BMAD =
   metodología (prompts/docs) + loop determinista (infra). Frida **ya tiene el
   loop**; por tanto **Frida + un skill de metodología BMAD-style = equivalente a
   BMAD + BMAD Loop**. La parte portable (metodología spec-first) puede portarse
   como guidance/skills **sin tocar la arquitectura**. Misma dicotomía del video
   de Factory: "Missions = disciplina + modelos = inteligencia".

3. **#18 sigue siendo el gap recurrente.** BMAD hace "dev con un modelo, review con
   otro" (model-agnostic + per-role). Frida usa un solo modelo; tier routing =
   #19 G2 bloqueado por #18. Aparece en los 4 videos dentro-del-dominio.

## Los gaps (3 + 1 recurrente)

1. **Routing de modelo por rol (#18 → #19)** — gap recurrente de la serie.
2. **Metodología spec-first empaquetada** — PRD→arch→epics→stories→spec. Frida
   tiene el mecanismo (skills/guidance/#27) pero no una metodología empaquetada.
3. **Patrones deferred-work + sweeping** — split inteligente + defer no-bloqueante
   + triage del ledger. Territorio de #19 (`iterate`/`fanin` del DSL ya existen).
4. **Async multi-día (#20/#24)** — per-epic overnight.

## Síntesis de la serie (5 videos)

| Video | Modelo | Converge en |
| --- | --- | --- |
| Graph Engineering (`H7t3uUp3HVw`) | orquestación en grafo | #18 (routing de modelo) |
| Antigravity SDLC (`K3YYr6yauAw`) | agentes en SDLC lineal | sin gap (componer #19/#16) |
| Factory Missions (`ow1we5PzK-o`) | multi-agente multi-día async | bitter lesson = Frida; #18 + #20/#24 |
| ADLC (`aMBQB_IJ0dQ`) | ciclo de vida de **productos** agenticos | **frontera** (Frida = build, no deploy/eval) |
| **BMAD Loop (`iW86sMHszJw`)** | **orquestador determinista + metodología** | **Frida ya ES el loop**; portar metodología; #18 |

**Constante absoluta:** los 4 videos dentro-del-dominio convergen en que **(a) la
arquitectura de orquestación determinista de Frida es la correcta** (validada por
Factory + BMAD) y **(b) el gap técnico recurrente es #18** (token accounting →
routing de modelo por rol/nodo), que desbloquea la capacidad más enfatizada en los
videos de barra alta.

## Conclusión

Frida está **arquitectónicamente equivalente a BMAD Loop** — ambos son capas
deterministas de orquestación sobre sesiones de LLM, con worktree + review
creator-verifier + resume. La parte difícil (el orquestador determinista) ya está
construida en Frida. La oportunidad concreta: **portar la metodología spec-first
de BMAD como skills/guidance de Frida** (capa blanda, sin tocar arquitectura) y
**desbloquear #18** para el routing de modelo por rol (el gap recurrente de toda
la serie). Esta nota es la validación más directa de que `frida-extensible-workflows`
es la pieza de infraestructura correcta.

## Referencias

+ Fuente: video *"bmad-loop First Look"* (youtube `iW86sMHszJw`).
+ Notas de la serie: `graph-engineering-parity.md` · `sdlc-antigravity-parity.md` · `factory-missions-parity.md` · `adlc-boundary.md`.
+ ADR-0028 — `frida-extensible-workflows` (orquestador determinista = BMAD Loop).
+ ADR-0013 — `frida-worktree` (worktrees por story).
+ ADR-0030 — `frida-dynamic-workflows` (capa de patrones #19: auditor, deferred-work, sweeping).
+ ADR-0046 — Loop Engineering como arquitectura de referencia (BMAD Loop = instancia concreta).
+ Issues críticos: **#18** (token accounting, recurrente) · **#19** (patrones) · **#20/#24** (async multi-día) · **#16** (skills, para portar metodología).
