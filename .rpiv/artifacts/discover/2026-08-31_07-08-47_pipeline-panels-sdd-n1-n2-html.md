---
date: 2026-08-31T07:08:47-0600
author: Edgar F. Fuentes Perea
commit: d46ed97
branch: main
repository: frida-code
topic: "Paneles de pipeline SDD (N1 planeación + N2 ejecución) con monitor HTML por método"
tags: [intent, frd, frida-workflow, board, pipeline-panels, extension-api]
status: ready
last_updated: 2026-08-31T07:55:04-06:00
last_updated_by: Edgar F. Fuentes Perea
---

# FRD: Paneles de pipeline SDD (N1 planeación + N2 ejecución) con monitor HTML por método

## Summary

Ecosistema de paneles que hace visible la fábrica SDD completa en dos niveles: un **panel N1 de planeación** (`/pipeline`, nuevo — features avanzando por discover→research→design→plan→ready-to-ship, con estado propio en `features.json`) y el **board N2 de ejecución** (el kanban existente de fases sdd-ship), unidos por un puente de *ship* manual. Todo ello espejado en un **monitor HTML externo con una página por método** (SDD hoy; AiDD y futuros como TEA entran por configuración del mismo motor, con arranque desde la Welcome «Frida Studio»).

## Problem & Intent

Del desarrollador, en sus palabras: «**que el usuario siempre tenga claro en dónde va en ambos ciclos**» — el flujo SDD tiene hoy dos niveles invisibles como sistema (la planeación RPIV vive como archivos `.rpiv/artifacts/` dispersos y la ejecución como board kanban), y el usuario pierde el hilo entre «estoy planeando» y «estoy ejecutando». Además: «**SDD y AiDD deben ser páginas separadas para no mezclarlas y confundir al usuario, el arranque de una u otra es por la página de inicio de Frida** donde en la sección "Desde cero" tenemos "Desarrollo Autónomo" (SDD) y "Planificar con AiDD"… porque cuando pasemos en un futuro a TEA o cualquier otro workflow nuevo, tengan siempre visibilidad los usuarios».

(Origen de la sesión: partió como «kanban de tareas manuales libres» — issue #191 — y fue reencuadrado por el desarrollador hacia paneles de pipeline con evidencia.)

## Goals

- El usuario ve en TODO momento en qué etapa de planeación está cada feature (N1) y en qué fase de ejecución está el trabajo (N2) — ambos ciclos visibles, no uno.
- Puente explícito y deliberado N1→N2: una feature planeada «baja a producción» con un gesto (ship manual) que crea las fases en N2 sin ejecutar nada.
- Monitor HTML externo con mucho más espacio, en vivo (SSE) y operable (control con token), con una página por método.
- Extensibilidad estructural: AiDD (bmad) y métodos futuros (TEA…) entran como **configuración declarativa del motor** — cero rediseño, y la Welcome les da visibilidad desde el día 1.

## Non-Goals

- El panel AiDD NO se construye en este ciclo (solo se garantiza el motor genérico que lo hospeda).
- El board N2 NO se rediseña — hereda solo un badge de progreso puente (feature → fases) y la página HTML lo espeja.
- Kanban de «tareas manuales libres» (todo/doing/done con avance conversacional, el alcance original del #191) queda sustituido por este diseño.
- WIP limits en N1 (sin límites por columna en planeación; N2/HTML sin WIP en este ciclo).
- Pulso visual «en ejecución» derivado de runs (limitación documentada: `extractPhaseId` exige ids de fase — plan-utils.ts:93-110).

## Functional Requirements

1. El sistema SHALL exponer el comando `/pipeline` que abre un overlay de planeación con columnas fijas `discover | research | design | plan | 🚀 ready-to-ship`, en el mismo lenguaje visual que `/board`.
2. El sistema SHALL persistir el estado de las features en `.frida/artifacts/pipeline/features.json` (estado propio: etapa actual, ruta del FRD/artefactos, metadata) con escritura atómica tmp+rename (multi-escritor, heredado del board).
3. El sistema SHALL crear una tarjeta en `discover` cuando un FRD nuevo aparece (p. ej. generado por `/skill:discover`).
4. El sistema SHALL, al pulsar ▶ en una tarjeta de N1, inyectar al chat el comando de la siguiente etapa (`/skill:<etapa> <ruta-frd>`) Y mover la tarjeta a esa columna al iniciar la etapa (movimiento temprano, mismo patrón que N2).
5. El sistema SHALL ofrecer ▶ ship en `ready-to-ship` que crea las fases del plan como unidades backlog en el board N2 del plan — SIN ejecutar nada (el usuario dispara fases desde N2 como hoy).
6. El sistema SHALL mostrar en la tarjeta N1 (post-ship) un badge de progreso heredado: «n/m fases commit» calculado del board N2.
7. El sistema SHALL servir un monitor HTML (host HTTP dentro de la extensión, bind 127.0.0.1) con **una página por método**: `/sdd` muestra N1 y N2 juntos; cada método futuro tiene su página; la landing/html espeja el hub de la Welcome.
8. El monitor SHALL reflejar cambios en vivo vía SSE (watch de features.json + boards) y aceptar acciones de control vía POST autenticado con token (401 sin token).
9. El motor SHALL ser genérico: definición declarativa de panel (columnas, artefactos detectados, disparadores por etapa) de la cual SDD-N1 es la primera configuración — AiDD entra luego sin cambios de código del motor.
10. La Welcome «Frida Studio» sección «Desde cero» SHALL enlazar «Desarrollo Autónomo» (SDD) y «Planificar con AiDD» (futuro/próximamente) al ecosistema — los métodos nuevos siempre visibles.
11. Cada tarjeta de feature SHALL dibujar un mini-timeline de las 5 etapas con 4 estados por punto: completada, actual (destacada), próxima y **pausada/saltada (ámbar)** — patrón StepIndicator de Design OS.
12. La tarjeta SHALL reconciliar `features.json` contra los artefactos reales del FS: si existe el artefacto de una etapa que el JSON no refleja, mostrar indicador ámbar «desincronizado» (nadie tiene que ser el escritor perfecto — el desfase se ve).
13. El botón de avance de cada tarjeta SHALL nombrar el movimiento concreto («Continuar a research →», «Ship → fases a ejecución»), no un ▶ genérico — patrón NextPhaseButton.
14. El sistema SHALL mostrar un banner ámbar dismissible (con memoria) cuando el usuario dispare una etapa con prerrequisitos incompletos (p. ej. ship con research inconcluso) — advertencia con links, no bloqueo; patrón PhaseWarningBanner.
15. Todo estado vacío (panel N1 sin features, board N2 sin plan, HTML sin datos) SHALL mostrar el comando que lo llena (p. ej. «genera un FRD: /skill:discover <idea>») con botón accionable — patrón EmptyState de Design OS / fail-with-guidance.
16. El HTML externo SHALL ofrecer vista detalle por feature (click en tarjeta): timeline completo + artefactos enlazados (FRD, research, design, plan) con estado individual — la página rica por fase de Design OS, donde hay espacio para ella.

## Non-Functional Requirements

- **Performance**: el reflejo SSE ante un cambio de features.json/board.json debe verse en el navegador en < 1s.
- **Security**: servidor bind 127.0.0.1; GET/SSE sin token (solo lectura local); POST de control exige token; nunca exponer fuera del host sin decisión explícita del usuario.
- **UX / Accessibility**: overlays N1 con codicons/estética VS Code (`--vscode-*`) iguales a /board; HTML con modo claro/oscuro y modo muro (fullscreen); estados excepcionales (pausada, desincronizado) SIEMPRE en ámbar, nunca ocultos.
- **Reliability**: escrituras atómicas multi-escritor (tmp+rename, patrón board #159); si features.json no existe, el panel arranca vacío sin error; el HTML degrada a estado vacío si el host no responde.

## Constraints & Assumptions

- FS como API: features.json y boards son la fuente de verdad; el HTML/overlays son vistas.
- Las skills del pipeline RPIV producen artefactos en `.rpiv/artifacts/{discover,research,design,plan}/*.md` con frontmatter `status` — insumo de detección/enlace.
- El board N2 (board.ts/board-ui.tsx) ya soporta jerarquía por convención de punto (`parentOf`, board.ts:341-346) y gating genérico (`depsSatisfied`) — no se duplica en N1.
- El disparo de acciones del HTML va por el mismo canal que un submit del usuario (`runPrompt`) — sin caminos divergentes.
- Asumimos que el host HTTP cabe en la extensión (node http nativo, sin dependencias nuevas) — a validar en research.

## Acceptance Criteria

- [ ] `/pipeline` abre el overlay con las 5 columnas y las features de features.json (vacío elegante si no existe).
- [ ] Correr `/skill:discover <algo>` genera un FRD y, al refrescar, su tarjeta aparece en `discover`.
- [ ] ▶ en una tarjeta en `research` inyecta `/skill:research <ruta-frd>` al chat y la tarjeta pasa a la columna `research`.
- [ ] Tras terminar `/skill:plan`, ▶ ship crea las unidades F01…Fn en backlog del board del plan (visible en `/board`), sin iniciar ejecución.
- [ ] Con el monitor HTML abierto, mover/crear tarjetas en VS Code se refleja en el navegador en < 1s (SSE).
- [ ] `POST /api/advance` sin token responde 401; con token ejecuta el disparo de etapa.
- [ ] La página `/sdd` muestra N1 y N2 juntos; `/aidd` (o su entrada en la Welcome) se muestra como próximamente.
- [ ] Definir un panel nuevo (p. ej. `aidd`) reutilizando la configuración declarativa NO requiere modificar el motor (test con configuración fixture).
- [ ] Una tarjeta en `research` muestra el mini-timeline con discover completada, research destacada, design/plan/ship por venir.
- [ ] Crear a mano un artefacto de research sin tocar features.json muestra el punto ámbar «desincronizado».
- [ ] El botón de una tarjeta en `discover` dice «Continuar a research →»; en ready-to-ship dice «Ship → fases a ejecución».
- [ ] Disparar ship con research inconcluso muestra el banner ámbar con link a research, dismissible.
- [ ] El panel N1 vacío muestra el botón «/skill:discover <idea>»; el detalle de feature en el HTML lista FRD/research/design/plan con estado individual.

## Recommended Approach

Overlay hermano de `/board` (mismo stack webview, `panel.ts`/`board-ui.tsx` como referencia) para N1, con dominio nuevo `features.ts` + persistencia `features.json` reutilizando el patrón atómico de `board.ts`; servidor HTTP+SSE embebido en la extensión (node:http nativo) que sirve páginas estáticas por método y POSTs autenticados que enrutan a `runPrompt`; motor de panel genérico con columnas/disparadores declarativos del cual SDD-N1 es la primera configuración.

## Decisions

### Alcance reencuadrado: de tareas libres a paneles de pipeline

**Question**: ¿Qué problema resuelve el kanban de tareas y quién lo sufre hoy?
**Recommended**: n/a — pregunta de intent.
**Chosen**: Reencuadre del desarrollador: paneles especializados por método SDD (N1 planeación + N2 ejecución) «que el usuario siempre tenga claro en dónde va en ambos ciclos»; el kanban de tareas libres queda sustituido.
**Rationale**: El ciclo sdd-ship con evidencia (validate/verdict) ya existe; exponer el pipeline completo es más valioso que un todo/doing/done declarativo.

### Unidad del panel N1

**Question**: ¿La tarjeta de N1 es la feature (FRD) o mezcla tareas manuales libres?
**Recommended**: Feature (FRD) como tarjeta.
**Chosen**: Feature (FRD) como tarjeta.
**Rationale**: Separación nítida planear-vs-ejecutar que el desarrollador pidió; las tareas libres quedan fuera.

### Columnas de N1

**Question**: ¿Columnas exactas de N1 — 4 etapas canónicas o incluir variantes (explore/blueprint)?
**Recommended**: 4 etapas + ready-to-ship.
**Chosen**: `discover | research | design | plan | 🚀 ready-to-ship`.
**Rationale**: Espejo 1:1 con los comandos del pipeline; las variantes son rutas internas de una etapa, no columnas.

### Origen de verdad de N1

**Question**: ¿N1 deriva 100% de los artefactos en disco (stateless) o tiene archivo de estado propio?
**Recommended**: 100% derivado del FS.
**Chosen**: `features.json` con estado propio.
**Rationale**: El desarrollador quiere metadata de control (etapa actual, pausas, orden, enlaces) que los artefactos solos no codifican.

### Mecanismo de avance por etapa

**Question**: ¿Cómo se disparan las transiciones de una feature?
**Recommended**: ▶ inyecta prompt + avanza.
**Chosen**: ▶ por etapa inyecta `/skill:<etapa> <ruta-frd>` al chat Y mueve la tarjeta a esa columna al iniciar (movimiento temprano, igual que N2).
**Rationale**: Mismo patrón de disparo por chat ya validado en N2 (#156); sin estado oculto.

### Puente N1→N2

**Question**: ¿Cruce de features a N2 — ship manual o auto-aparición en backlog?
**Recommended**: Ship manual.
**Chosen**: Solo el ▶ ship de ready-to-ship crea las fases en N2 (backlog, sin ejecutar nada).
**Rationale**: Gesto deliberado de «bajar a producción»; nada ejecuta solo.

### Panel AiDD

**Question**: ¿Construimos AiDD ya o solo garantizamos el motor genérico?
**Recommended**: SDD N1+N2 ahora, AiDD después.
**Chosen**: AiDD después; motor genérico (columnas declarativas + disparadores) garantiza entrada sin rediseño.
**Rationale**: AiDD no está instalado (solo #40 en backlog); el motor genérico es la garantía estructural.

### Estructura del HTML externo

**Question**: ¿Qué secciones nacen en la primera versión del HTML?
**Recommended**: (propuesta tabs) — corregida por el desarrollador.
**Chosen**: Páginas separadas por método, sin mezclar; el hub es la Welcome de Frida («Desde cero»: Desarrollo Autónomo = SDD, Planificar con AiDD); métodos futuros (TEA…) siempre visibles ahí.
**Rationale**: Claridad por método; la Welcome ya existe y es el punto de arranque natural.

### Alcance del HTML

**Question**: ¿El HTML nace read-only y el control después, o todo junto?
**Recommended**: Monitoreo primero.
**Chosen**: Monitoreo + control juntos (SSE en vivo + POST con token).
**Rationale**: El desarrollador quiere el muro operativo completo desde la primera versión.

### WIP limits en N1

**Question**: ¿WIP limits en columnas de N1?
**Recommended**: Sin WIP en N1.
**Chosen**: Sin WIP en N1.
**Rationale**: Bajo volumen de features simultáneas; no aplica la disciplina de Jira aquí.

### Comando del panel N1

**Question**: ¿Comando para abrir N1 — /pipeline, /plan, /features?
**Recommended**: /pipeline.
**Chosen**: `/pipeline`.
**Rationale**: Par natural de `/board`; verbaliza el ciclo; evita colisión con `/skill:plan`.

### Jerarquía de unidades (heredada del árbol pre-reencuadre)

**Question**: ¿Convención de punto (parentOf) o parentId explícito siempre?
**Recommended**: Convención de punto + override.
**Chosen**: Convención de punto + parentId como override opcional.
**Rationale**: evidence: board.ts:341-346 — parentOf ya deriva jerarquía (F10c.1); menos código nuevo.

### Pulso «en ejecución»

**Question**: ¿Extender extractPhaseId para ids libres en fase 1?
**Recommended**: Fuera de fase 1.
**Chosen**: Fuera — limitación documentada.
**Rationale**: evidence: plan-utils.ts:93-110 — maquinaria de runs que el pipeline N1 aún no ejercita.

### Refinamientos de visibilidad (Design OS)

**Question**: Explorado buildermethods/design-os — ¿qué patrones de visibilidad se adoptan para N1?
**Recommended**: 6 patrones mapeados al ecosistema.
**Chosen**: Timeline 4-estados (incl. pausada ámbar), reconciliación FS con indicador de desincronización, botón que nombra el siguiente paso, banner ámbar dismissible para saltos, EmptyState con comando accionable, vista detalle por feature en el HTML externo.
**Rationale**: evidence: github.com/buildermethods/design-os (`StepIndicator.tsx`, `PhaseNav.tsx`, `NextPhaseButton.tsx`, `PhaseWarningBanner.tsx`, `EmptyState.tsx`) — producto homólogo en producción; resuelve las 2 open questions previas.

### Escritor de features.json (resuelta por reconciliación)

**Question**: ¿Quién escribe features.json al completar una etapa?
**Recommended**: n/a — abierta.
**Chosen**: Modelo híbrido: features.json es el estado de verdad, y la tarjeta reconcilia contra los artefactos del FS marcando desfases en ámbar (nadie tiene que ser el escritor perfecto).
**Rationale**: Combina la decisión previa del desarrollador (estado propio) con el patrón de Design OS (estado derivado de artefactos) sin conflicto.

## Open Questions

- Ninguna — las dos previas quedaron resueltas por los refinamientos de Design OS (Decisions «Refinamientos de visibilidad» y «Escritor de features.json»); `order` explícito se difiere a cuando existan >5 features simultáneas.

## Suggested Follow-ups

- Issue #191 (kanban de tareas manuales libres) queda absorbido/sustituido por este FRD — editar su cuerpo o cerrarlo con referencia a este artefacto.
- Panel AiDD como configuración del motor — issue nuevo cuando se instale/porte el método (backlog #40: frida-cis porte de bmad-module relacionado).
- El diseño previo de «tablero HTML solo para N2» discutido en la sesión queda subsumido por la página `/sdd` de este FRD.

## References

- Issue #191 `efuentesp/frida-code-vsix` — origen (kanban tareas) e investigación triangulada GitHub/Jira con fuentes.
- Probe de codebase (agentes locator/analyzer): `board.ts:63-75,233-235,341-346,5072-5123`, `board-ui.tsx:82-86,213-214`, `extension.ts:4342-4344,5072-5123,5144-5151`, `extension-api.ts:45-84`, `plan-utils.ts:93-110`.
- Welcome «Frida Studio» — `webview/components/Welcome.tsx` (sección «Desde cero»).
- Pipeline RPIV: `/skill:discover → research → design → plan` y `sdd-ship`/`sdd-full` (`~/.frida/workflows/config.ts` + `src/tools/frida-workflow/sdd-factory.ts`).
- Design OS (buildermethods) — referencia de visibilidad UI: <https://github.com/buildermethods/design-os> (StepIndicator/PhaseNav/NextPhaseButton/PhaseWarningBanner/EmptyState).
