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
>
> **Actualizado 2026-09-06 (2):** alta de **#202 frida-shunt** (delegación de I/O a modelos baratos, patrón Spotify Portal — 82–94% de ahorro reportado en lecturas masivas; research en [docs/research/2026-09-06-shunt-portal-spotify.md](research/2026-09-06-shunt-portal-spotify.md)). Repriorización por valor: **#202 + F10 forman la "dupla de facturación" y toman la cima del P2** — shunt optimiza el *input* (lecturas) con infraestructura ya existente (rol smol de F7 + subagents + gate #196 + pi-lens), F10 el *output* (edición). La secuencia recomendada pasa a: #202 → F10 → #191 → F9 → F8.
>
> **Actualizado 2026-09-06:** refresh de estado tras 0.33.0/0.34.0 — **P1 queda 100% completo** (M8 #133 y M1 #134 cerrados: `/walkthrough` · `/understand` · `/size` en producción); en P2 cerraron **#35 sandboxes, #26 better-subagents, #16 plugins** (desbloquea la cadena P3 #34/#38/#40) y **M9/M2/M3/M10** (M3 #144 cerrado con evidencia). 0.34.0 además trajo pipeline N1 + monitor HTTP+SSE + kanban de frida-workflow, lo que **sube el peso de #39** (consolidación). Alta de **#191** (kanban de tareas del usuario) como continuación natural.
>
> **Actualizado 2026-08-24:** integración de la pista de **entendimiento,
> mantenimiento y modernización de apps desconocidas** — items **M1–M10** —
> derivada de la investigación de [docs/modernization-apps.md](modernization-apps.md)
> (§9 técnico, §10 funcional). Los items M viven ahora en su propia sección
> **Pista M**, ordenada por valor hacia el objetivo "app desconocida →
> entendida (funcional + técnico) → mantenida → modernizada": **M8
> (`app-walkthrough`) y M1 (`understand-app`) a P1** (mejor ratio valor/esfuerzo:
> todo lo que consumen ya existe), **M9, M2, M3 y M10 a P2**, **M6 a P3**; M7 es
> micro-tarea y M4/M5 quedan condicionales — en gran parte porque **#25✅ ya
> cubre** búsqueda semántica + call graph (wrapper de open-codebase-index) y
> pi-lens ya da hotspots/rename.
>
> **Refresh P2 (2026-08-26):** alta de **M10 (#139) workflow `size-app`** —
> contraparte **cuantitativa** de M1 (#134, ya en producción): LOC,
> complejidad por función, duplicación, acoplamiento, churn/hotspots y
> **COCOMO±rango** desde `scc`+pi-lens → `docs/dimensionamiento/`. Insumo
> directo del dimensionamiento de esfuerzo de mantenimiento/modernización
> (investigación de métricas 2026-08-26: SonarQube, COCOMO/Boehm, scc/lizard).
>
> **Refresh P1 (mismo día):** verificación contra issues/código confirma que
> **#21 ✅, #29 ✅ y F7 ✅ (#121) ya están completos** — este documento los
> listaba como pendientes. **P1 queda reducido a M8 (#133) y M1 (#134)**.

## Resumen ejecutivo

| Prioridad | Foco | Issues | Estado |
| --- | --- | --- | --- |
| **P0** | Correctness del core (auditoría/facturación + UX de la feature bandera) | #18, #7 | ✅ **Completo** — #18 cerrado (`eb30dbc`); #7 resuelto por el panel de workflows (v0.29.x) |
| **P1** | **Moat** — el agente que aprende y fundamenta en el código real | #25 ✅, #21 ✅, #29 ✅, F7 ✅ (#121), M8 (#133) ✅, M1 (#134) ✅ | ✅ **Completo** (0.34.0) — tríada + F7 + Pista M P1 (`/walkthrough` · `/understand` · `/size`) |
| **P2** | Autonomía, aislamiento y **facturación** (agente seguro, paralelo y barato) | ✅ #35, ✅ #26, ✅ #13; **#202 shunt↖, F10, #14, #2✅, F8, F9** | **#202 y F10 = dupla de facturación (cima por valor/esfuerzo)**; sandboxes/detached/worktrees/plugins/abort listos; restan sesiones paralelas (#14) y las F de UX |
| **P3** | Ecosistema de skills/packs | #19, #20→#22, #28, #32, #34, #38, #40, #41, #30, F12, M6 | **Desbloqueado por #16 ✅** (cc-plugins en producción); F12 sigue bloqueada por el clúster de abort |
| **P4** | Optimización / observabilidad / nicho / deuda técnica | #17, #23, #31, #24, #27, #33, #36, #39↗, F11, F13b, M7, M4↘, M5, #191 | #39 cobra peso tras 0.34.0 (frida-workflow creció con pipeline N1/monitor/kanban); #191 kanban de tareas listo para arrancar |
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
✅ **P1 100% completo**: la tríada (#25/#21/#29), F7 (#121) y los dos items de
Pista M (M8 #133 `app-walkthrough` y M1 #134 `understand-app`) — todos en
producción (`/walkthrough` · `/understand` · `/size`, CHANGELOG 0.34.0).

| Issue | Qué | Rol en el moat | Desbloquea |
| --- | --- | --- | --- |
| **#25** `frida-codebase-index` | Búsqueda semántica + call graph | **Grounding** — fundamenta respuestas en el código *real* del proyecto | ✅ **Completo en v0.30.0** — ciclo #100, #109–#120: progreso vivo, gestión de motores de embeddings (4 proveedores, ping, candado), autoindex, honestidad de estados |
| **#21** `frida-hermes-memory` | Porte nativo de `pi-hermes-memory` | **Memoria** — persistencia de contexto/decisiones entre sesiones | ✅ **Completo — issue cerrado**; retarget de better-sqlite3 al Electron del extension host, auto-review OOB ([how-to-frida-learn](how-to-frida-learn.md)) — destraba #28, #32 |
| **#29** `frida-knowledge-base` | KB OKF (capa agente) + Foam (capa humana) | **Conocimiento** — base estructurada que aprende y donde el humano inyecta criterios | ✅ **Completo — issue cerrado**; vault OKF v0.2 en `<proyecto>/.llm-wiki/` (`docs/tools/frida-knowledge-base.md`) — destraba #30, #41 |
| **F7** Roles de modelo y routing (#121) | `default`/`smol`/`commit` + fallback chains Enterprise→Ollama | **Habilitador transversal del moat** — memoria, subagents y extracciones al Ollama local (costo 0); resiliencia ante 429/quota | ✅ **Completo (#121)** — resolvedor puro (`src/model-roles.ts`) + sección Roles en el tab Modelos — destraba F8, F13a |

**Orden sugerido:** ~~tríada + F7~~ (✅ todo hecho). ~~Solo restan M8 (#133) y
M1 (#134)~~ ✅ **también completos** — ver
[Pista M](#pista-m--entendimiento-de-aplicaciones-funcional--técnico) abajo.

---

## Pista M — Entendimiento de aplicaciones (funcional + técnico)

> Objetivo de la pista: que Frida tome una **app desconocida** y pueda
> (1) **usarla como usuario** y documentar su funcionalidad, (2) entender su
> código, (3) diagnosticar y mantener, y (4) modernizar. Origen:
> [docs/modernization-apps.md](modernization-apps.md) (§9 técnico, §10
> funcional). Cada item es una extensión/skill que agrega **una capacidad
> incremental**; el orden de la tabla = valor aportado hacia ese objetivo.

| Orden | Item | Capacidad que agrega | Valor para el objetivo | Depende de | Esfuerzo | Prioridad |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | **M8** workflow `app-walkthrough` (#133) | El agente **usa la app como usuario nuevo**: navega, prueba acciones/validaciones, y produce el catálogo funcional (pantallas, journeys, reglas de negocio observadas, roles) | **La capacidad que hoy no existe y abre la pista**: Frida entiende código, no funcionalidad. El snapshot semántico de D34 (a11y tree) ya es un inventario funcional de pantalla — solo falta orquestarlo y documentarlo | `frida-agent-browser` ✅ (D34), `frida-subagents` ✅, `frida-workflow` ✅ — **todo listo** | S–M | **P1** ✅ cerrado (0.34.0) |
| 2 | **M1** workflow `understand-app` (#134) | Contraparte **técnica**: overview + hotspots + riesgos → `docs/entendimiento.md` + modelo LikeC4 semilla | Junto con M8 cubre el entendimiento completo (funcional × técnico); además valida M4/M5 vía el piloto | #25 ✅, pi-lens ✅, `frida-workflow` ✅ — **todo listo** | S–M | **P1** ✅ cerrado (0.34.0) |
| 3 | **M9** `frida-traffic2api` (#135) | Del tráfico capturado durante la exploración (HAR/mitmproxy) → **spec OpenAPI** + matriz funcionalidad↔endpoint↔módulo (cruce M8×M1) | **Puente funcional↔técnico**: convierte dos documentos aislados en un mapa accionable para mantenimiento quirúrgico y para detectar endpoints huérfanos | M8 ✅ (modo walk), o HAR externo (devtools/mitmproxy) | M | **P2** ✅ |
| 4 | **M10** workflow `size-app` (#139) | **Dimensionamiento cuantitativo**: NCLOC/ULOC+DRYness, CCN p50/p90/p99 por función, duplicación, acoplamiento, churn/hotspots, bus factor → **COCOMO±rango + olas de migración** en `docs/dimensionamiento/` | El insumo del **negocio**: "app tomada → cuánto cuesta mantenerla/modernizarla". Hermano cuantitativo de M1✅; `scc` cubre ~80% en un binario polyglota (270+ lenguajes) | Motor ✅, pi-lens ✅, `scc` ✅ (pin v4.0.0 al agentDir) | S–M | **P2** ✅ |
| 5 | **M2** panel "Mapa del proyecto" | Visualizar en producto el mapa técnico (`/lens-map` de pi-lens) **y** el funcional (grafo de journeys de M8); clic → abrir archivo | Comunicar y compartir el entendimiento (equipo, stakeholders, demo comercial) | M8 (mapa funcional), pi-lens ✅ (mapa técnico) | S–M | **P2** ✅ cerrado — fases 1–4 (grafo SVG, cruce m9, export HTML) en 0.34.0 |
| 6 | **M3** `frida-sonar` | Quality gate en el loop: issues por severidad/rama, verificación post-fix, panel de tendencia | Cierra el ciclo entender → diagnosticar → corregir → **verificar**; refuerza el pilar de auditoría | Libre (requiere SonarQube operativo en la empresa) | M | **P2** ✅ cerrado (#144) — fases 1–6 en 0.34.0 (snapshot por turno, tab Sonar, badge, gate) |
| 7 | **M6** `frida-openrewrite` | Migraciones mecánicas deterministas: dry-run + diff en VS Code + verificación post-receta | Fase modernización: lo mecánico con recetas type-aware; el criterio queda con el agente (guiado por M1) | M1 (contexto de lo no-mecánico); opcional M3 (verificación) | M–L | **P3** |
| 8 | **M7** embeddings vía router | Semántica de #25 con el modelo autorizado por la empresa | Micro-tarea de configuración sobre #25 ✅ | Router con endpoint de embeddings compatible OpenAI | XS | P4 |
| — | **M4↘** porte parcial pi-shazam | (condicional) solo el gap en hotspots/lookup/rename | Solape casi total con pi-lens + #25✅; evaluar tras el piloto | Piloto (modernization-apps §8) | M | P4 — evaluar/cancelar |
| — | **M5** `frida-codegraph` | (watchlist) grafo persistente para monolitos enormes | Solo si #25 no escala en las apps objetivo | Piloto (modernization-apps §8) | L | P4 — watchlist |

**Detalle de M8 (`app-walkthrough`)** — fases de la [§10 funcional](modernization-apps.md):

1. **Explorar:** el agente navega la app con `frida-agent-browser` (sesión
   autenticada vía perfiles de D34), snapshot semántico por pantalla, acciones
   y validaciones probadas, mensajes de error capturados.
2. **Correlacionar:** tráfico de red durante la exploración → insumo de M9.
3. **Documentar:** entregables en `docs/funcional/` — catálogo de pantallas,
   journeys, reglas de negocio observadas, roles/permisos.

Toda acción destructiva/irreversible pasa por el gate (`ApprovalBridge`);
   el fanout de scouts (subagents) paraleliza la exploración.

> **Watchlist de la pista** (fuentes opcionales para M8/M9, no items propios):
> análisis de videos/tutoriales de la app (pi-web-access), process mining si
> hay logs de eventos (pm4py), session replay self-hosted (hyperdx/highlight).
> Ver [modernization-apps §10](modernization-apps.md).

---

## P2 — Autonomía y aislamiento

Que el agente pueda correr **seguro** (aislado) y **en paralelo** (worktrees /
sesiones) sin riesgo de daño colateral.

| Issue | Qué | Notas |
| --- | --- | --- |
| **#202** `frida-shunt` | **Delegación de I/O a modelos baratos** (patrón Spotify Portal): gate de lecturas costosas (read sin offset/limit > N líneas + cat/head/tail sobre grandes) con escalera de delegación (pi-lens → subagent smol → read dirigido), 2 skills y benchmark | **Cima del P2 por valor/esfuerzo**: 82–94% de ahorro reportado en lecturas masivas; ~80% de la infra ya existe (rol smol F7, subagents, gate #196, pi-lens). Dupla de facturación con F10 (input↔output). Research en [docs/research](research/2026-09-06-shunt-portal-spotify.md) |
| **F10** Edición hashline | Anclas por hash de contenido; rechaza ediciones rancias; −61% tokens de salida | La otra mitad de la dupla de facturación (pilar facturación + calidad del loop de edición) |
| **#35** `frida-sandboxes` (ADR-0047) | Aislamiento por container Docker/devcontainer por agente | ✅ **Cerrado** — container Docker local por agente (CHANGELOG, [how-to-frida-sandboxes](how-to-frida-sandboxes.md)) |
| **#13** `frida-worktree` → **#14** sesiones paralelas | Worktrees de git para sesiones paralelas + switcher | #13 ✅ cerrado (0.18.0, src/worktree/ + docs); **#14 sigue abierto** — la base ya está lista |
| **#26** `frida-better-subagents` | Subagentes detached/sandboxed | ✅ **Cerrado** — modo detached (proceso propio que sobrevive al padre) + how-to |
| **#16** `frida-plugins` | Sistema de plugins estilo Claude Code (comandos/skills/MCP/hooks empaquetados) | ✅ **Cerrado (2026-08-17)** — `frida-cc-plugins` en producción — **desbloquea #34, #38, #40, #41** |
| **#2↗ Detener/abort** | El clúster de abort (#2 → hoy #85/#90/#96: `abortRun` sobre undefined, run escapado durante tool) | **Siguiente candidato** — dolor UX diario Y prerrequisito de F12; sin abort limpio no hay reglas de stream ni control confiable de workflows/subagents. Corregir ANTES de F12 |
| **F8** Advisor + WATCHDOG.md | Revisor por turno (rol smol/Ollama), severidades nit/concern/blocker, emission guard | F7 ✅ lo destrabó. Refuerza el pilar de auditoría turno a turno |
| **F9** web_search keyless | Cadena de backends con piso sin API key (duckduckgo/startpage) | Autonomía de investigación del agente — dolor real (sesión 2026-08-22 coja sin keys) |
| **F10** Edición hashline | Anclas por hash de contenido; rechaza ediciones rancias; −61% tokens de salida | Pilar facturación (tokens por turno) + calidad del loop de edición |

> ~~**#16 es especial**~~ — resuelto: cc-plugins (instalados/mercados/toggles)
> ya cumple el rol y la cadena P3 (#34 → #38 → #40) quedó desbloqueada.

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
| **#34** `frida-advise-project-approach` | Skill de metodología de estrategia de proyecto | ~~#16~~ ✅ desbloqueado |
| **#38** `frida-aidd` (ADR-0050) | Metodología AiDD (BMAD) como skill pack + meta-workflow | ~~#16~~ ✅ desbloqueado |
| **#40** `frida-cis` | Creative Intelligence Suite (skill pack) | #38 (~~#16~~ ✅) |
| **#41** `frida-tea` | Test Engineering Architect (skill pack, materializa patrones de #19) | #19, #29, #16 |
| **F12** TTSR — reglas de stream | Regex/AST sobre el stream → abort + inyecta recordatorio + reintento. Reglas builtin: es-MX, `Refs #N`, tokens `--vscode-*` | **Clúster de abort #85/#90/#96 (= #2↗ en P2)**. Al desbloquearse sube de facto a P2 |

**Cadena crítica:** #18✅/#7✅ destrabaron a **#19** → #41 (TEA); **#16✅ ya
destrabó** #34 → #38 → #40 (CIS); falta **#2↗ → F12 (TTSR)**

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
| **#36** `frida-kanban` (ADR-0048) | Panel Kanban de observabilidad | Libre — notar el solape con el kanban de workflow (0.34.0) y con **#191** (tareas del usuario): evaluar fusión de alcance |
| **#39** | Consolidación frida-workflow → frida-extensible-workflows (deuda) | **Peso creciente**: 0.34.0 añadió pipeline N1 + monitor HTTP+SSE + kanban a frida-workflow; la consolidación (D9, ADR-0028) debería venir antes de seguir construyendo sobre frida-workflow |
| **F11** Agent Hub | Tab de supervisión de subagents: roster vivo (costo/tokens/actividad), transcript en vivo, steer/revive/kill | Observabilidad pura — buen valor, menor palanca que F7–F10 |
| **F13b** Menores | `conflict://` en worktrees, dictado 🎤 (#95), magic keywords (`ultrathink`/`orchestrate`/`workflowz`) | Nicho/UX; la memoria 2-fase (F13a) quedó en P1 junto a #21 |

Los items M (M1–M9) viven consolidados en la
[Pista M](#pista-m--entendimiento-de-aplicaciones-funcional--técnico), con
dependencias, valor y orden de implementación por item.

> **#2 (Detener/abort) fue movido a P2** — el análisis de TTSR (F12) lo reveló
> bloqueador estructural, no solo un bug UX de nicho.

---

## Blocked por plataforma

| Issue | Qué | Bloqueo |
| --- | --- | --- |
| **#42** `frida-remote-control` | Control remoto de la sesión embebida (WebSocket sobre el bus Remote React) | Requiere refactor del **bus multiplexado WebBridge**; no es un issue de esta extensión, es de plataforma |

---

## Mapa de dependencias (cadenas de bloqueo)

```text
P0:  #18 ✅ ─┐
       #7 ✅ ─┴─→ #19 ──→ #41 (TEA)
                         ↑
#21 (hermes ✅) ←── F7 (roles/smol ✅)
   └─→ #28, #32           │
#29 (KB ✅) ───→ #30 ────┤
                         │
#16 (plugins ✅) ─→ #34, #38 ─→ #40 (CIS) ──┘
#20 (goal ✅) ───→ #22 (refine)
#13 (worktree ✅) → #14 (sesiones paralelas) ← ABIERTO
F7 (roles ✅) ─→ F8 (advisor), F13a (memoria 2-fase ✅)
#2↗ (abort: #85/#90/#96) ─→ F12 (TTSR)      ← SIGUIENTE CANDIDATO
Pista M (entendimiento de apps):
  M8 (app-walkthrough ✅ 0.34.0) ←─ agent-browser ✅ + subagents ✅ + workflow ✅
  M1 (understand-app ✅ 0.34.0)  ←─ #25 ✅ + pi-lens ✅ ──valida→ M4, M5
  M9 (traffic2api ✅ 0.33.0)     ←─ M8 ──cruza con→ M1 (matriz función↔endpoint↔módulo)
  M2 (panel mapa ✅ 0.34.0)      ←─ M8 (mapa funcional) + pi-lens ✅ (mapa técnico)
  M3 (sonar ✅ 0.34.0, #144 cerrado) ──────refuerza→ M6 (verificación)
  M6 · M7 — libres
```

**Lectura:** P0/P1 y la Pista M P1-P2 están completos. Los nodos de mayor
palanca hoy son **#2↗** (abort — destraba F12 y devuelve control confiable a
workflows/subagents), **#14** (sesiones paralelas, base #13 lista) y **#39**
(la deuda de consolidación crece con cada feature sobre frida-workflow). La
cadena P3 (#34 → #38 → #40) ya está desbloqueada por #16✅.

---

## Secuencia de ejecución recomendada

1. ~~**Sprint P0**~~ ✅ Completo (#18 cerrado, #7 resuelto por el panel de
   workflows).
2. ~~**Sprint P1 (moat)**~~ ✅ **Completo** — tríada (#25/#21/#29), F7 (#121),
   M8 (#133) y M1 (#134), todos en producción (0.34.0).
3. ~~**En paralelo al P1**~~ — #16✅ cerrado (cc-plugins). **QUEDA: #2↗ clúster
   de abort (#85/#90/#96)** — dolor UX diario y prerrequisito de F12: **el
   siguiente sprint natural**.
4. **Sprint P2** — **#202 frida-shunt (PRIMERO — dupla de facturación, mejor
   ratio valor/esfuerzo del backlog)** + **F10 hashline** (la otra mitad);
   después #14 (sesiones paralelas, base #13 lista) + F8 (advisor, F7 listo) +
   F9 (web_search keyless). ~~#35, #26, M9, M2, M3, M10~~ ✅ todos cerrados.
5. **Sprint P3** — cadena #19 → #41 (TEA) y #34 → #38 → #40 (CIS, desbloqueada
   por #16✅); **F12 (TTSR)** una vez resuelto el abort; **M6
   (`frida-openrewrite`)** cuando el piloto madure hacia modernización.
6. **P4 a demanda** — **#191 (kanban de tareas, diseñado)**, **#39↗
   (consolidación workflow — antes de seguir construyendo sobre
   frida-workflow)**, F11 (Agent Hub), F13b (menores), M7 (embeddings del
   router), #17/#23/#24/#27/#31/#33/#36 según holgura. **M4/M5 solo si el
   piloto demuestra el gap.**

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
