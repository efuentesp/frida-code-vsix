# Roadmap de extensiones — Frida Code

> **Fuente de verdad** de la priorización de las extensiones pendientes (issues
> abiertos con ADR `aceptado`). Documento vivo: actualízalo conforme se completa
> cada item (marca ✅ y referencia el commit/release).
>
> Generado: 2026-08-12 · Basado en el análisis de los 54 ADRs (`aceptado`) y los
> issues abiertos de GitHub. Metodología al final.

## Resumen ejecutivo

| Prioridad | Foco | Issues | Estado |
| --- | --- | --- | --- |
| **P0** | Correctness del core (auditoría/facturación + UX de la feature bandera) | #18, #7 | #18 ✅ commiteado (`eb30dbc`, pendiente validación); #7 pendiente |
| **P1** | **Moat** — el agente que aprende y fundamenta en el código real | #25, #21, #29 | libres, arrancar ya |
| **P2** | Autonomía y aislamiento (agente seguro y paralelo) | #35, #13→#14, #26, #16 | #16 requiere investigación antes |
| **P3** | Ecosistema de skills/packs (dependen de #16 y/o #19) | #19, #20→#22, #28, #32, #34, #38, #40, #41, #30 | bloqueados por cadenas |
| **P4** | Optimización / observabilidad / nicho / deuda técnica | #2, #17, #23, #31, #24, #27, #33, #36, #39 | lower priority |
| **Blocked** | Plataforma | #42 | requiere refactor del bus Remote React |

**Principio rector:** los pilares de Frida (CONTEXT §1-2) son *UX tipo Claude
Code*, *facturación centralizada*, *auditoría* y *disuasivo* (no perímetro de
seguridad). La priorización pesa **valor para esos pilares × poder
desbloqueante × viabilidad**, no solo el conteo de issues.

---

## P0 — Correctness (corregir lo roto del core)

Estos son bugs que afectan la **integridad del pilar de auditoría/facturación**
y la **UX de la feature bandera**. Además son los **top blockers** de toda la
pista de workflows. Deben ir primero.

| Issue | Qué | Por qué P0 | Estado |
| --- | --- | --- | --- |
| **#18** | Tokens/coste de sub-agentes no se contabilizan en el `usage` del workflow | Reporte de costo falso (pilar de facturación) + `budget.tokens.hard` inoperante; bloquea toda la pista (#19→#41) | ✅ **Commiteado** `eb30dbc`. Pendiente validación del usuario → cerrar |
| **#7** | Workflow en background sin indicador de progreso | UX rota de la feature bandera; bloquea #19 y #41 | Pendiente |

---

## P1 — Moat: el agente que aprende y fundamenta en el código real

Ninguno por sí solo distingue a Frida; **la tríada sí**. Juntos forman la barrera
de entrada más alta para un competidor y el núcleo del pilar de *contexto*.
Los tres están **sin bloquear** (no dependen de los P0): arrancar ya.

| Issue | Qué | Rol en el moat | Desbloquea |
| --- | --- | --- | --- |
| **#25** `frida-codebase-index` | Búsqueda semántica + call graph | **Grounding** — fundamenta respuestas en el código *real* del proyecto | — (independiente, alto impacto inmediato) |
| **#21** `frida-hermes-memory` | Porte nativo de `pi-hermes-memory` | **Memoria** — persistencia de contexto/decisiones entre sesiones | #28, #32 |
| **#29** `frida-knowledge-base` | KB OKF (capa agente) + Foam (capa humana) | **Conocimiento** — base estructurada que aprende y donde el humano inyecta criterios | #30, #41 |

**Orden sugerido:** #25 primero (mayor impacto visible, sin dependencias,
alimenta a los otros) → #21 (memoria se apoya en el index) → #29 (se apoya en
index + memoria).

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

> **#16 es especial:** es el que más desbloquea (4 skill packs cuelgan de él),
> pero su diseño no está cerrado. Tratarlo como *investigación* antes de
> comprometer implementación.

---

## P3 — Ecosistema de skills/packs

Metodologías y skill packs que **dependen** de #16 (plugins) y/o #19 (patrones
de dynamic-workflows). No arrancar hasta tener sus dependencias.

| Issue | Qué | Bloqueado por |
| --- | --- | --- |
| **#19** | Portar patrones de `pi-dynamic-workflows` (deep-research, code-review, adversarial-review…) | #18, #7 (P0) — ya #18✅ |
| **#20** `frida-goal` → **#22** `frida-refine` | Goal + continual harness refinement | #20 bloquea a #22 |
| **#28** `frida-relay` | Corrección gobernada de creencias sobre hermes | #21 |
| **#32** | Curaduría de skills sobre hermes | #21 |
| **#30** `frida-doc-converter` | Ingest Office↔markdown con provenance | #29 |
| **#34** `frida-advise-project-approach` | Skill de metodología de estrategia de proyecto | #16 |
| **#38** `frida-aidd` (ADR-0050) | Metodología AiDD (BMAD) como skill pack + meta-workflow | #16 |
| **#40** `frida-cis` | Creative Intelligence Suite (skill pack) | #38, #16 |
| **#41** `frida-tea` | Test Engineering Architect (skill pack, materializa patrones de #19) | #19, #29, #16 |

**Cadena crítica:** #18✅/#7 → **#19** → #41 (TEA) → ... y #16 → #38 → #40 (CIS).
Resolver #7 y #16 desbloquea lo más grande.

---

## P4 — Optimización / observabilidad / nicho / deuda

Valor real pero **menor prioridad estratégica** que el moat (P1). Varios están
**libres** (sin blockers) y sirven para paralelizar cuando haya holgura.

| Issue | Qué | Notas |
| --- | --- | --- |
| **#2** | Botón Detener / doble-Esc no detiene el proceso | Bug UX; libre |
| **#17** | Panel de workflow: separación visual + collapse | UI; libre |
| **#23** `frida-hypa` | Compresión determinista de output | Libre |
| **#31** `frida-headroom` | Compresión de contexto opt-in vía proxy | Complemento de #23 |
| **#24** `frida-background-tasks` | Shell durable + watchers | Libre |
| **#27** `frida-plan-mode` | Modo /plan read-only colaborativo | Libre |
| **#33** `frida-neuroarxiv` | Prior-art vía workflow diverge/converge aislado | Libre, nicho |
| **#36** `frida-kanban` (ADR-0048) | Panel Kanban de observabilidad | Libre |
| **#39** | Consolidación frida-workflow → frida-extensible-workflows (deuda) | Migrar frida-pipeline + /wf |

---

## Blocked por plataforma

| Issue | Qué | Bloqueo |
|---|---|---|
| **#42** `frida-remote-control` | Control remoto de la sesión embebida (WebSocket sobre el bus Remote React) | Requiere refactor del **bus multiplexado WebBridge**; no es un issue de esta extensión, es de plataforma |

---

## Mapa de dependencias (cadenas de bloqueo)

```
P0:  #18 ✅ ─┐
       #7 ──┴─→ #19 ──→ #41 (TEA)
                         ↑
#21 (hermes) ─→ #28, #32 │
#29 (KB) ─────→ #30 ─────┤
                         │
#16 (plugins) ─→ #34, #38 ─→ #40 (CIS) ──┘
#20 (goal) ────→ #22 (refine)
#13 (worktree) → #14 (sesiones paralelas)
```

**Lectura:** #7 + #16 son los **nodos de mayor palanca**. #18✅ ya destrabó la
base de la cadena de workflows.

---

## Secuencia de ejecución recomendada

1. **Sprint P0** — Cerrar #18 (validar + cerrar issue) y resolver **#7**.
   *Sin esto, la pista de workflows no es confiable ni observable.*
2. **Sprint P1 (moat)** — #25 → #21 → #29 (en paralelo parcial posible).
   *Construye la ventaja competitiva duradera.*
3. **Investigar #16** (plugins) en paralelo al P1 — sin comprometer implementación
   hasta cerrar el diseño.
4. **Sprint P2** — #35 (sandboxes) + cerrar #13→#14 + #26; implementar #16 si el
   diseño ya cerró.
5. **Sprint P3** — Desbloquear la cadena #19 → #41 y #16 → #38 → #40.
6. **P4 a demanda** — según holgura y necesidad real del usuario.

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
