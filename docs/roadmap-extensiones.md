# Roadmap de extensiones — Frida Code

> **Fuente de verdad** de la priorización de las extensiones pendientes (issues
> abiertos con ADR `aceptado`). Documento vivo: actualízalo conforme se completa
> cada item (marca ✅ y referencia el commit/release).
>
> Generado: 2026-08-12 · Basado en el análisis de los 54 ADRs (`aceptado`) y los
> issues abiertos de GitHub. Metodología al final.
>
> **Actualizado 2026-08-22:** refresh de estado (P0 completo, ciclo Index
> v0.30.0 cerrado, re-evaluación de #2 como bloqueador estructural) e
> integración de las Fases 7–13 del roadmap UI/UX (capacidades del harness
> inspiradas en [oh-my-pi](https://github.com/can1357/oh-my-pi); ver
> [research](../.rpiv/artifacts/research/2026-08-22_oh-my-pi-vs-frida.md) y el
> [roadmap UI/UX](../.rpiv/artifacts/plans/2026-08-19_ui-ux-copilot-roadmap.md)
> con el detalle por fase). Las referencias F7–F13 apuntan a ese documento.

## Resumen ejecutivo

| Prioridad | Foco | Issues | Estado |
| --- | --- | --- | --- |
| **P0** | Correctness del core (auditoría/facturación + UX de la feature bandera) | #18, #7 | ✅ **Completo** — #18 cerrado (`eb30dbc`); #7 resuelto por el panel de workflows (progreso vivo + live view, v0.29.x) |
| **P1** | **Moat** — el agente que aprende y fundamenta en el código real | #25 ✅, #21, #29, **F7** | #25/codebase-index **completo en v0.30.0** (ciclo #100, #109–#120); F7 es el nuevo habilitador |
| **P2** | Autonomía y aislamiento (agente seguro y paralelo) | #35, #13→#14, #26, #16, **F8, F9, F10** | F8 depende de F7 |
| **P3** | Ecosistema de skills/packs (dependen de #16 y/o #19) | #19, #20→#22, #28, #32, #34, #38, #40, #41, #30, **F12** | **F12 bloqueada por el clúster de abort** |
| **P4** | Optimización / observabilidad / nicho / deuda técnica | #17, #23, #31, #24, #27, #33, #36, #39, **#2↗, F11, F13b** | **#2 re-evaluado: ver P2↗** |
| **Blocked** | Plataforma | #42 | requiere refactor del bus Remote React |

**Principio rector:** los pilares de Frida (CONTEXT §1-2) son *UX tipo Claude
Code*, *facturación centralizada*, *auditoría* y *disuasivo* (no perímetro de
seguridad). La priorización pesa **valor para esos pilares × poder
desbloqueante × viabilidad**, no solo el conteo de issues.

---

## P0 — Correctness (corregir lo roto del core)

Estos eran bugs que afectaban la **integridad del pilar de auditoría/facturación**
y la **UX de la feature bandera**.

| Issue | Qué | Resultado |
| --- | --- | --- |
| **#18** | Tokens/coste de sub-agentes no se contabilizan en el `usage` del workflow | ✅ Commiteado `eb30dbc`, validado y cerrado |
| **#7** | Workflow en background sin indicador de progreso | ✅ Cubierto por el panel de workflows (progreso vivo por fase + live view + estados resumibles, v0.29.x; issues #79–#81 del panel) |

---

## P1 — Moat: el agente que aprende y fundamenta en el código real

Ninguno por sí solo distingue a Frida; **la tríada sí**. Juntos forman la barrera
de entrada más alta para un competidor y el núcleo del pilar de *contexto*.
Los tres están **sin bloquear** (no dependen de los P0): arrancar ya.

| Issue | Qué | Rol en el moat | Desbloquea |
| --- | --- | --- | --- |
| **#25** `frida-codebase-index` | Búsqueda semántica + call graph | **Grounding** — fundamenta respuestas en el código *real* del proyecto | ✅ **Completo en v0.30.0** — ciclo #100, #109–#120: progreso vivo, gestión de motores de embeddings (4 proveedores, ping, candado), autoindex, honestidad de estados |
| **#21** `frida-hermes-memory` | Porte nativo de `pi-hermes-memory` | **Memoria** — persistencia de contexto/decisiones entre sesiones | #28, #32 |
| **#29** `frida-knowledge-base` | KB OKF (capa agente) + Foam (capa humana) | **Conocimiento** — base estructurada que aprende y donde el humano inyecta criterios | #30, #41 |
| **F7** Roles de modelo y routing | `default`/`smol`/`commit` + fallback chains Enterprise→Ollama | **Habilitador transversal del moat** — memoria, subagents y extracciones al Ollama local (costo 0) liberan cuota Enterprise para lo difícil; resiliencia ante 429/quota | F8, F13; abarata #21, #26, #28, #32 |

**Orden sugerido:** ~~#25 primero~~ (✅ hecho) → **F7** (habilitador barato, infra
existente) → #21 (memoria se apoya en F7 para consolidar) → #29.

---

## P2 — Autonomía y aislamiento

Que el agente pueda correr **seguro** (aislado) y **en paralelo** (worktrees /
sesiones) sin riesgo de daño colateral.

| Issue | Qué | Notas |
| --- | --- | --- |
| **#35** `frida-sandboxes` (ADR-0047) | Aislamiento por container Docker/devcontainer por agente | Libre, sin blockers |
| **#13** `frida-worktree` → **#14** sesiones paralelas | Worktrees de git para sesiones paralelas + switcher | #13 commiteado en 0.18.0 pero **issue sigue abierto**; #14 depende de #13 |
| **#26** `frida-better-subagents` | Subagentes detached/sandboxed | Refuerza el aislamiento |
| **#16** `frida-plugins` | Sistema de plugins estilo Claude Code (comandos/skills/MCP/hooks empaquetados) | **Mayor palanca del roadmap** pero **ambiguo** (investigación aún abierta). Bloquea #34, #38, #40, #41. **Investigar antes de implementar** |
| **#2↗ Detener/abort** | El clúster de abort (#2 → hoy #85/#90/#96: `abortRun` sobre undefined, run escapado durante tool) | **Subido de P4**: era "bug UX libre"; el análisis TTSR (F12) lo reveló **bloqueador estructural** — sin abort limpio no hay reglas de stream ni control confiable de workflows/subagents. Corregir ANTES de F12 |
| **F8** Advisor + WATCHDOG.md | Revisor por turno (rol smol/Ollama), severidades nit/concern/blocker, emission guard | Depende de F7. Refuerza el pilar de auditoría turno a turno |
| **F9** web_search keyless | Cadena de backends con piso sin API key (duckduckgo/startpage) | Autonomía de investigación del agente — dolor real (sesión 2026-08-22 coja sin keys) |
| **F10** Edición hashline | Anclas por hash de contenido; rechaza ediciones rancias; −61% tokens de salida | Pilar facturación (tokens por turno) + calidad del loop de edición |

> **#16 es especial:** es el que más desbloquea (4 skill packs cuelgan de él),
> pero su diseño no está cerrado. Tratarlo como *investigación* antes de
> comprometer implementación.

---

## P3 — Ecosistema de skills/packs

Metodologías y skill packs que **dependen** de #16 (plugins) y/o #19 (patrones
de dynamic-workflows). No arrancar hasta tener sus dependencias.

| Issue | Qué | Bloqueado por |
| --- | --- | --- |
| **#19** | Portar patrones de `pi-dynamic-workflows` (deep-research, code-review, adversarial-review…) | ~~#18, #7 (P0) — ya #18✅~~ ✅ desbloqueado |
| **#20** `frida-goal` → **#22** `frida-refine` | Goal + continual harness refinement | #20 bloquea a #22 |
| **#28** `frida-relay` | Corrección gobernada de creencias sobre hermes | #21 |
| **#32** | Curaduría de skills sobre hermes | #21 |
| **#30** `frida-doc-converter` | Ingest Office↔markdown con provenance | #29 |
| **#34** `frida-advise-project-approach` | Skill de metodología de estrategia de proyecto | #16 |
| **#38** `frida-aidd` (ADR-0050) | Metodología AiDD (BMAD) como skill pack + meta-workflow | #16 |
| **#40** `frida-cis` | Creative Intelligence Suite (skill pack) | #38, #16 |
| **#41** `frida-tea` | Test Engineering Architect (skill pack, materializa patrones de #19) | #19, #29, #16 |
| **F12** TTSR — reglas de stream | Regex/AST sobre el stream → abort + inyecta recordatorio + reintento. Reglas builtin: es-MX, `Refs #N`, tokens `--vscode-*` | **Clúster de abort #85/#90/#96 (= #2↗ en P2)**. Al desbloquearse sube de facto a P2 |

**Cadena crítica:** #18✅/#7✅ destrabaron a **#19** → #41 (TEA); falta #16 →
# 38 → #40 (CIS) y #2↗ → F12 (TTSR).

---

## P4 — Optimización / observabilidad / nicho / deuda

Valor real pero **menor prioridad estratégica** que el moat (P1). Varios están
**libres** (sin blockers) y sirven para paralelizar cuando haya holgura.

| Issue | Qué | Notas |
| --- | --- | --- |
| **#17** | Panel de workflow: separación visual + collapse | UI; libre (parcialmente cubierto por issues #79–#84 del panel) |
| **#23** `frida-hypa` | Compresión determinista de output | Libre |
| **#31** `frida-headroom` | Compresión de contexto opt-in vía proxy | Complemento de #23 |
| **#24** `frida-background-tasks` | Shell durable + watchers | Libre |
| **#27** `frida-plan-mode` | Modo /plan read-only colaborativo | Libre |
| **#33** `frida-neuroarxiv` | Prior-art vía workflow diverge/converge aislado | Libre, nicho |
| **#36** `frida-kanban` (ADR-0048) | Panel Kanban de observabilidad | Libre |
| **#39** | Consolidación frida-workflow → frida-extensible-workflows (deuda) | Migrar frida-pipeline + /wf |
| **F11** Agent Hub | Tab de supervisión de subagents: roster vivo (costo/tokens/actividad), transcript en vivo, steer/revive/kill | Observabilidad pura — buen valor, menor palanca que F7–F10 |
| **F13b** Menores | `conflict://` en worktrees, dictado 🎤 (#95), magic keywords (`ultrathink`/`orchestrate`/`workflowz`) | Nicho/UX; la memoria 2-fase (F13a) quedó en P1 junto a #21 |

> **#2 (Detener/abort) fue movido a P2** — el análisis de TTSR (F12) lo reveló
> bloqueador estructural, no solo un bug UX de nicho.

---

## Blocked por plataforma

| Issue | Qué | Bloqueo |
|---|---|---|
| **#42** `frida-remote-control` | Control remoto de la sesión embebida (WebSocket sobre el bus Remote React) | Requiere refactor del **bus multiplexado WebBridge**; no es un issue de esta extensión, es de plataforma |

---

## Mapa de dependencias (cadenas de bloqueo)

```
P0:  #18 ✅ ─┐
       #7 ✅ ─┴─→ #19 ──→ #41 (TEA)
                         ↑
#21 (hermes) ←── F7 (roles/smol)
   └─→ #28, #32           │
#29 (KB) ─────→ #30 ─────┤
                         │
#16 (plugins) ─→ #34, #38 ─→ #40 (CIS) ──┘
#20 (goal) ────→ #22 (refine)
#13 (worktree) → #14 (sesiones paralelas)
F7 (roles) ─→ F8 (advisor), F13a (memoria 2-fase)
#2↗ (abort: #85/#90/#96) ─→ F12 (TTSR)
```

**Lectura:** los nodos de mayor palanca hoy son **F7** (habilitador del moat
con costo mínimo), **#16** (cadenas de skills) y **#2↗** (abort — destraba F12
y devuelve control confiable a workflows/subagents). #18✅ y #7✅ ya
destrabaron la base de la pista de workflows; #25✅ completó el grounding.

---

## Secuencia de ejecución recomendada

1. ~~**Sprint P0**~~ ✅ Completo (#18 cerrado, #7 resuelto por el panel de
   workflows).
2. **Sprint P1 (moat)** — **F7** (roles/routing, barato e inmediato) → #21
   (memoria, ahora con consolidación barata vía rol smol) → #29. En paralelo:
   cerrar issues #79–#84 del panel si hay holgura.
3. **En paralelo al P1** — **#2↗ clúster de abort** (#85/#90/#96): es dolor UX
   diario Y prerrequisito de F12; y **investigar #16** (plugins) sin
   comprometer implementación.
4. **Sprint P2** — F8 (advisor, tras F7) + F9 (web_search keyless) + F10
   (hashline); #35 (sandboxes) + cerrar #13→#14 + #26.
5. **Sprint P3** — Desbloquear la cadena #19 → #41 y #16 → #38 → #40; **F12**
   (TTSR) una vez resuelto el abort.
6. **P4 a demanda** — F11 (Agent Hub), F13b (menores), #17/#23/#24/#27/#31/#33/#36/#39
   según holgura.

---

## Metodología de priorización

- **Valor para los pilares de Frida** (UX, facturación, auditoría, disuasivo) —
  no conteo crudo de issues.
- **Poder desbloqueante** — un issue que destraba a N otros sube de prioridad.
- **Viabilidad** — si está bloqueado por plataforma (#42) o por diseño abierto
  (#16), baja o se aparta.
- **Esfuerzo** — estimación gruesa (porte de upstream ≈ M, skill pack ≈ M-L,
  bug fix ≈ S). Refinar al planificar cada uno vía `/skill:plan`.
- Las estimaciones y el desglose fino P2–P4 son **aproximaciones** sujetas a
  refinación cuando se planifique cada item; la asignación P0/P1 y las cadenas
  de bloqueo son las decisiones firmes.
