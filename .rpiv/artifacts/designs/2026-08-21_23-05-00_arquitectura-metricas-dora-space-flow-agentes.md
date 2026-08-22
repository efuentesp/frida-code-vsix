---
date: 2026-08-21T23:05:00-0600
author: Edgar F. Fuentes Perea
commit: d4aca29
branch: main
repository: frida-code
topic: "Arquitectura de recolección de métricas DORA / SPACE / FLOW / Agentes"
tags: [design, metrics, dora, space, flow, agentes, telemetry, concentrador, vsm]
status: ready
parent: ".rpiv/artifacts/research/2026-08-21_22-49-33_metricas-dora-space-flow-agentes.md"
last_updated: 2026-08-21T23:12:00-0600
last_updated_by: Edgar F. Fuentes Perea
---

# Design: Arquitectura de recolección de métricas DORA / SPACE / FLOW / Agentes

## Summary

Documento de diseño que define **cómo recolectar la información** necesaria para los 4 marcos de medición (DORA, SPACE, FLOW Framework, Agentes de IA), **qué incorporar a Frida Code** en cada caso y **cómo se monitorean las métricas en operación continua**. Respeta el principio rector del producto — *"Frida etiqueta telemetría; el concentrador externo cruza"* — ya decidido en el diseño de telemetría (2026-08-03): Frida nunca consulta fuentes organizacionales (CI/CD, ITSM, repos remotos) desde el editor; solo produce insumos versionados y el **concentrador** (app externa) hace las correlaciones.

**TL;DR de brechas:**

| Marco | Cobertura hoy | Brecha arquitectónica principal | Dónde vive la solución |
| --- | --- | --- | --- |
| **Agentes (DX AI)** | ~90% | Experience sampling (impacto directo auto-reportado) | Frida (micro-encuesta opt-in) |
| **SPACE** | 2/5 dims (A + E) | Satisfacción (S), Performance (P), Comunicación (C) | Frida (S) + concentrador (P, C) |
| **FLOW** | ~40% | Flow Items de negocio y value stream completo | Concentrador (ITSM/planificador) |
| **DORA** | ~15% | Eventos de deploy/incidente de CI/CD y producción | Concentrador (integraciones DevOps) |

---

## Contexto y arquitectura de referencia

### Estado actual (qué existe ya)

- **Frida Code** produce por sesión un JSONL append-only (`globalStorage/sessions/*.jsonl`) con: usage (tokens/costo/caché), toolCalls con argumentos, timestamps, model_change, compaction. Un indexer (patrón `src/session-stats.ts`, cacheo por mtime) ya agrega esto en `UsageReportView`.
- Export versionado **`frida-usage-report/v1`** (opt-in) con KPIs, breakdowns, behavior, adopción.
- Panel **"Uso"** (telemetría cruda) y panel **"Productividad"** (Scorecard DX AI × SPACE) ya renderizan los datos logs-based.
- El **concentrador** externo es el componente planeado que recibe reportes `v1` de N devs y correlaciona contra fuentes organizacionales.

### Arquitectura de referencia en capas (para los 4 marcos)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  CAPA 1 — ORIGEN (dentro del editor, por desarrollador)                     │
│  Frida Code: JSONL de sesión + etiquetas SDLC + micro-encuestas S            │
│  → produce frida-usage-report/vN (append de insumos, nunca cruza)            │
├─────────────────────────────────────────────────────────────────────────────┤
│  CAPA 2 — CONCENTRADOR (app externa, central)                               │
│  Ingesta de reportes vN + ingesta de eventos de fuentes org                 │
│  Motor de correlación (join por repo/commit/issue/timestamp)                │
│  Cálculo de métricas compuestas (DORA 5, SPACE S/P/C, FLOW 5)               │
│  Almacén analítico + dashboards + alertas                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│  CAPA 3 — FUENTES ORGANIZACIONALES (systems of record)                      │
│  SCM/CI/CD · ITSM/planificador · calidad · colaboración · productividad org │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Regla de dependencia:** la información fluye Capa 3 → Capa 2 y Capa 1 → Capa 2. **Nunca** Capa 3 → Capa 1 (Frida no llama APIs de Jira/GitHub desde el editor). Excepción de solo-lectura local: git local (`git log`, remote URL, branch) ya disponible en el workspace y usado para etiquetar.

---

## 1. DORA — Software Delivery Performance (5 métricas)

### 1.1 Diagrama de bloques

```
                        ┌──────────────────────────────┐
                        │        FRIDA CODE (dev)      │
                        │  JSONL sesión + etiquetas    │
                        │  - commit SHA del turno (*)  │
                        │  - issue ref (Refs #N) (*)   │
                        └──────────────┬───────────────┘
                                       │ frida-usage-report/vN
                                       │ (insumos etiquetados)
                                       ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                        CONCENTRADOR (app externa)                         │
│                                                                          │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────────────────────┐  │
│  │  Ingesta     │   │  Ingesta     │   │  Ingesta                     │  │
│  │  SCM/PR      │   │  CI/CD       │   │  Incidentes/Observabilidad   │  │
│  │  (webhooks)  │   │  (webhooks)  │   │  (webhooks/API)              │  │
│  └──────┬───────┘   └──────┬───────┘   └──────────────┬───────────────┘  │
│         │                  │                          │                  │
│         ▼                  ▼                          ▼                  │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │  NORMALIZADOR DE EVENTOS (bus de dominio)                          │  │
│  │  commit | pull_request | deployment | incident | recovery          │  │
│  │  + join por repo URL + commit SHA + timestamps                     │  │
│  └──────────────────────────────┬─────────────────────────────────────┘  │
│                                 ▼                                        │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │  MOTOR DORA                                                        │  │
│  │  • Deployment Frequency   = count(deployment) / ventana            │  │
│  │  • Change Lead Time       = deploy(ts) − commit(ts)                │  │
│  │  • Failed Deploy Recovery = recovery(ts) − incident(ts)            │  │
│  │  • Change Fail Rate       = deploys_con_intervención / total       │  │
│  │  • Rework Rate            = deploys_no_planificados / total        │  │
│  └──────────────────────────────┬─────────────────────────────────────┘  │
│                                 ▼                                        │
│                    ┌──────────────────────┐                               │
│                    │  DASHBOARD DORA      │  (por app/servicio,          │
│                    │  + trends + quickcheck│   nunca por dev individual) │
│                    └──────────────────────┘                               │
└──────────────────────────────────────────────────────────────────────────┘
         ▲                    ▲                        ▲
         │ webhooks           │ webhooks               │ webhooks/API
┌────────┴───────┐   ┌────────┴────────┐   ┌───────────┴─────────────┐
│  SCM / PRs     │   │  CI/CD + Deploy │   │  Incidentes / Prod      │
│  GitHub        │   │ GitHub Actions  │   │ PagerDuty / Opsgenie    │
│  GitLab        │   │ GitLab CI       │   │ Datadog Monitors        │
│  Bitbucket     │   │ Jenkins         │   │ Grafana Alerting        │
│  Azure Repos   │   │ ArgoCD / Flux   │   │ Jira Service Mgmt       │
│                │   │ (deploy events) │   │ Statuspage              │
└────────────────┘   └─────────────────┘   └─────────────────────────┘
```

### 1.2 Componentes y responsabilidades

| Componente | Responsabilidad | Tecnología opcional |
| --- | --- | --- |
| **Webhook receivers** (×3) | Recibir `push`, `pull_request`, `deployment`, `incident` como eventos crudos | Cualquier HTTP endpoint (Node/NestJS, FastAPI, Go) |
| **Normalizador de eventos** | Mapear payloads heterogéneos a un bus de dominio canónico (`commit`/`deployment`/`incident`/`recovery`) | Kafka/NATS (alto volumen) o Postgres + worker (escala pequeña) |
| **Motor DORA** | Calcular las 5 métricas por ventana y por app/servicio | Funciones puras sobre el almacén; librerías open-source: `Sleopok`, `FourKeys` (Google, descontingado pero referenciable), `DevLake` (Apache) |
| **Join keys** | `repo URL` + `commit SHA` + `service name` — deben coincidir entre Frida y CI/CD | Convención de naming; git remote como clave canónica |
| **Dashboard** | Tendencias por aplicación, Quick Check comparativo | Grafana, Metabase, Superset; o UI propia del concentrador |

### 1.3 Qué incorporar a Frida Code (delta)

1. **Etiqueta `commit` en el JSONL** (*) — ya existe implícitamente en `bash` toolCalls (`git commit`), pero se necesita **explícita y estructurada**: al detectar un commit exitoso, registrar `{type:"git_commit", sha, branch, repo}` como `custom_message` en la sesión. Permite al concentrador calcular *Change Lead Time* desde el turno de Frida (commits authored-by-assist) sin parsear bash.
2. **Etiqueta `issue`** (*) — los commits ya usan `Refs #N` (política del repo); basta capturar el número en el custom_message anterior para vincular trabajo→issue→deploy.
3. **Nada más**: DORA no requiere cambios de UI en Frida. El panel "Productividad" ya muestra el estado "DORA-ready" y el botón de export.

**Costo estimado de Frida: ~2 componentes (post-commit hook + custom_message) — pequeño.**

---

## 2. SPACE — 5 dimensiones de productividad

### 2.1 Diagrama de bloques

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        FRIDA CODE (dev)                                  │
│                                                                         │
│  ┌───────────────────── A (Activity) ─────────────────────┐             │
│  │  JSONL: turns, toolCalls, assistedKloc, byTool, edits  │  ✓ YA       │
│  └────────────────────────────────────────────────────────┘             │
│  ┌───────────────────── E (Efficiency & Flow) ────────────┐             │
│  │  activeMs, cacheHitPct, compactations, byHour/byDow,   │  ✓ YA       │
│  │  interrupciones HITL (questionsAsked)                  │             │
│  └────────────────────────────────────────────────────────┘             │
│  ┌───────────────────── S (Satisfaction) ─────────────────┐             │
│  │  ★ NUEVO: micro-encuesta post-turno opt-in             │             │
│  │  ask_user_question → 1 pregunta (1–5 + free text)      │             │
│  │  → custom_message {type:"experience_sample"}           │             │
│  └────────────────────────────────────────────────────────┘             │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │ frida-usage-report/vN
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        CONCENTRADOR (app externa)                        │
│                                                                         │
│  ┌────────────── P (Performance: outcomes) ──────────────────────────┐  │
│  │  • Defectos post-release  ←── Jira / GitHub Issues / Linear       │  │
│  │  • Reverts/hotfixes       ←── SCM (webhook)                       │  │
│  │  • Salud del servicio     ←── Datadog / Grafana / Sentry          │  │
│  │  • Adopción/impacto       ←── product analytics (Amplitude, GA)   │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│  ┌────────────── C (Communication & Collaboration) ──────────────────┐  │
│  │  • PR review latency/quality ← GitHub/GitLab PR webhooks         │  │
│  │  • PRs merged por equipo       ← SCM                             │  │
│  │  • Onboarding time             ← ITSM/HR data                    │  │
│  │  • Descubribilidad de docs     ← Confluence/Notion search logs    │  │
│  │  • Red de colaboración         ← Slack/Teams metadata (opt-in)    │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│  ┌────────────── S agregado ─────────────────────────────────────────┐  │
│  │  Agregación de experience samples (promedio por equipo/periodo)   │  │
│  │  — reporte siempre agregado/anónimo, jamás individual             │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  MOTOR SPACE: dashboard de ≥3 dimensiones en tensión + perceptual       │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Componentes y responsabilidades

| Componente | Responsabilidad | Tecnología opcional |
| --- | --- | --- |
| **Experience sampler (Frida)** | Preguntar satisfacción/eficacia 1–5 al cierre de turno o sesión, opt-in configurable | Ya existe `ask_user_question`; solo el flujo y la política de frecuencia son nuevos |
| **Agregador perceptual** | Promediar samples por equipo/ventana; anonimizar | SQL sobre el almacén del concentrador |
| **Ingesta de issues/defectos** | Clasificar issues como defect + fecha de detección vs. release de origen | Jira Cloud/DC (API v3 + webhooks JQL), GitHub Issues, Linear, Azure Boards |
| **Ingesta de observabilidad** | Errores/tasa de error por release (señal de quality) | Sentry, Datadog, Grafana, New Relic |
| **Ingesta de colaboración** | Review latency, throughput de merges, calidad percibida de reviews | GitHub/GitLab GraphQL API; Slack/Teams metadata (fuertemente opt-in) |
| **Dashboard SPACE** | Vista multidimensional con al menos una medida perceptual | Propio del concentrador; DX Core 4 como vocabulario de presentación |

### 2.3 Qué incorporar a Frida Code (delta)

1. **Micro-encuesta S (experience sampling)** — el bloque nuevo principal:
   - Config `frida.experienceSampling: "off" | "session-end" | "daily"`.
   - Al dispararse, usa el pipeline de `ask_user_question` existente con 1–2 preguntas escaladas (satisfacción, eficacia percibida) + campo libre opcional.
   - Persiste `{type:"custom_message", customType:"experience_sample", rating, comment?}` en el JSONL (nunca contenido del prompt).
   - Aparece en el reporte exportado como `perceptual: {samples, avgSatisfaction, avgEfficacy}` agregado.
2. **Señales de quality en el JSONL (opcional, F2)** — `bugFixSignals` ya previsto en la investigación de telemetría: detectar turnos cuyo propósito es arreglar algo (clasificador por metadatos: issue con etiqueta `bug` referenciada, patrón del comando bash de test) y etiquetar el turno como `bugfix-candidate`. Es insumo para P; el cruce con producción sigue en el concentrador.
3. **UI**: el panel "Productividad" ya muestra `Satisfaction (Encuesta)` como píldora pendiente; con este cambio pasaría a `[~] Satisfaction (samples activos)`.

**Costo estimado de Frida: 1 feature completa (sampling) + 1 clasificador (bugfix).**

---

## 3. FLOW Framework — Value Stream Management

### 3.1 Diagrama de bloques

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        FRIDA CODE (dev)                                  │
│                                                                         │
│  ┌──────────────── Clasificador SDLC por metadatos (F2) ─────────────┐  │
│  │  Etiqueta cada turno con fase: Analysis / Design / Construction / │  │
│  │  Testing / Release / Maintenance                                  │  │
│  │  Insumos: tool name (test runner), bash commands (npm test),      │  │
│  │  extensiones de archivo, skill invocada, issue label (Refs #N)    │  │
│  │  NUNCA contenido del prompt                                       │  │
│  └───────────────────────────────┬───────────────────────────────────┘  │
└──────────────────────────────────┼──────────────────────────────────────┘
                                   │ bySdlcPhase en frida-usage-report/vN
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        CONCENTRADOR (app externa)                        │
│                                                                         │
│  ┌────────────── Flow Items (sistema de planificación) ──────────────┐  │
│  │  FEATURES  ← Jira epics/stories, ADO Features/PBIs               │  │
│  │  DEFECTS   ← Jira bugs, GitHub Issues (label:bug)                │  │
│  │  DEBTS     ← issues etiquetados tech-debt / refactors            │  │
│  │  RISKS     ← issues de seguridad/ cumplimiento (Jira, Snyk)      │  │
│  └────────────────────────────┬──────────────────────────────────────┘  │
│                               ▼                                         │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  MOTOR FLOW (por value stream)                                   │   │
│  │  • Flow Velocity     = items completados / periodo               │   │
│  │  • Flow Time         = work_complete(ts) − work_start(ts)        │   │
│  │  • Flow Efficiency   = tiempo activo (Frida + git) / Flow Time   │   │
│  │  • Flow Load         = items in-progress (WIP)                   │   │
│  │  • Flow Distribution = ratio feature:defect:debt:risk            │   │
│  └────────────────────────────┬─────────────────────────────────────┘   │
│                               ▼                                         │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  MAPA DE VALUE STREAM (idea→prod)                                │   │
│  │  funding → backlog → dev (Frida bySdlcPhase aquí) → review →     │   │
│  │  CI → release → cliente → feedback                               │   │
│  └──────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
         ▲ webhooks/API
┌────────┴────────────────┐   ┌────────────────────────────────────┐
│  PLANIFICADOR / ITSM    │   │  HERRAMIENTAS VSM DEDICADAS        │
│  Jira Cloud/DC          │   │  Planview (VSM oficial Kersten)    │
│  Azure DevOps Boards    │   │  Tasktop (Planview)                │
│  Linear / Shortcut      │   │  Jellyfish (Circlist)              │
│  GitHub Projects        │   │  DX (platform)                     │
│  Service Now (riesgos)  │   │  → alternativa "build" vs "buy"    │
└─────────────────────────┘   └────────────────────────────────────┘
```

### 3.2 Componentes y responsabilidades

| Componente | Responsabilidad | Tecnología opcional |
| --- | --- | --- |
| **Clasificador SDLC (Frida, F2)** | Etiquetar cada turno/artefacto con fase SDLC usando solo metadatos | Ya especificado en la investigación de telemetría (R4);regex + tabla tool→fase |
| **Mapeador Flow Items** | Clasificar work items del planificador en feature/defect/debt/risk | Jira API + JQL por tipo/etiqueta; ADO work item types; convención de labels en GitHub |
| **Motor FLOW** | Calcular las 5 Flow Metrics por value stream | Propio; o delegar a plataforma VSM (Planview/Jellyfish) |
| **Cálculo Flow Efficiency** | El "tiempo activo" real del item: suma de actividad de desarrollo (turnos Frida + commits del item) / Flow Time total | Join `issue key` ↔ `Refs #N` ↔ turnos etiquetados |
| **Mapa de value stream** | Modelar las etapas idea→prod del dominio | Config YAML por organización en el concentrador |

### 3.3 Qué incorporar a Frida Code (delta)

1. **Clasificador SDLC `bySdlcPhase` (F2)** — ya está especificado en la investigación de telemetría original; este diseño lo **confirma como prerequisito de FLOW**:
   - Tabla de reglas tool/comando→fase (`npm test`→Testing, `write` sobre `*.ts`→Construction, `read` de ADRs→Analysis...).
   - Output: `breakdowns.bySdlcPhase: Analysis/Design/Construction/Testing/Release/Maintenance` en el reporte.
   - Las fases mapean a tramos del value stream (Construction+Testing = tramo "dev").
2. **Duración de turno por fase** — cada turno etiquetado ya lleva timestamps; con la fase se puede derivar "tiempo de construcción asistida" (insumo directo de Flow Efficiency).
3. **UI**: en el panel "Productividad", la sección Ritmo & Flow ganaría una mini-barra "Distribución de fases" cuando `bySdlcPhase` exista (hoy está como placeholder conceptual).

**Costo estimado de Frida: 1 clasificador (ya diseñado) + enriquecimiento del export. El resto es concentrador.**

---

## 4. Agentes de IA — DX AI Measurement Framework (Utilization / Impact / Cost)

### 4.1 Diagrama de bloques

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        FRIDA CODE (dev) ── fuente primaria              │
│                                                                         │
│  ┌──────────── UTILIZATION ────────────┐  ┌──────────── COST ─────────┐ │
│  │  adoption flags (browser/subagents/ │  │  cost por modelo/turno/   │ │
│  │  contexto), byTool, sessions,       │  │  herramienta, cacheRead/  │ │
│  │  turnos, densidad                   │  │  Write, compactations     │ │
│  └─────────────────────────────────────┘  └───────────────────────────┘ │
│  ┌──────────── IMPACT (indirecto) ────┐  ┌──── IMPACT (directo) ─────┐ │
│  │  assistedKloc, edits, byFileType,   │  │  ★ NUEVO: estimación de  │ │
│  │  throughput de turnos/sesión        │  │  time savings declarada   │ │
│  │                                     │  │  (experience sampling,    │ │
│  │                                     │  │  comparte con SPACE-S)    │ │
│  └─────────────────────────────────────┘  └───────────────────────────┘ │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │ frida-usage-report/vN (ya v1)
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        CONCENTRADOR (app externa)                        │
│  • Join con throughput de PRs (GitHub/GitLab) → "AI lift" longitudinal │
│  • Benchmark interno de adopción por equipo/rol                        │
│  • Gobernanza: presupuestos por modelo, políticas de uso, seguridad    │
│  • Dashboard DX AI (Utilization / Impact / Cost por equipo)             │
└─────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Componentes y responsabilidades

| Componente | Responsabilidad | Tecnología opcional |
| --- | --- | --- |
| **Todo el lado dev** | Recolectar utilization + cost + impacto indirecto | **Ya existe en Frida** (JSONL + report v1 + panel Productividad) |
| **Experience sampling de time savings** | Medir "esta tarea me ahorró ~X min" declarativo | El mismo mecanismo que SPACE-S (una sola feature sirve a dos marcos) |
| **Análisis longitudinal de lift** | Correlacionar adopción de IA vs throughput de PRs en el tiempo | Regresión simple sobre series del concentrador (PRs merged/semana × adopción) |
| **Gobernanza de costos** | Presupuestos, alertas de gasto por modelo, políticas | Reglas del concentrador; notificaciones Slack/e-mail |

### 4.3 Qué incorporar a Frida Code (delta)

1. **Campo de time savings en el experience sampling** — pregunta adicional opcional ("¿cuánto tiempo estimas que ahorró el asistente en esta tarea?": <15m / 15–60m / 1–4h / >4h). Se registra junto al rating de satisfacción. **Una sola interacción alimenta SPACE-S y DX-Impact.**
2. **(Opcional) telemetría de aceptación** — hoy Frida es agente (no autocomplete); no hay "acceptance rate" de sugerencias. Si se añadiera modo inline-completion, habría que emitir `suggestion_shown/accepted`. **Fuera de alcance actual** — documentado como decisión.

**Costo estimado de Frida: 1 pregunta extra en el sampler ya planeado. Es el marco más barato porque ya está casi completo.**

---

## 5. Catálogo de señales de recolección (quién captura qué, cómo)

La tabla canónica de **todas las señales** que alimentan los 4 marcos, agrupadas por fuente. Es la respuesta operativa a "cómo recolectar toda la información": cada fila define el dato, el mecanismo de captura y el payload que viaja al concentrador.

### 5.1 Señales capturadas por Frida (origen: JSONL de sesión)

| Señal | Mecanismo de captura | Payload (ejemplo) | Marcos | Estado |
| --- | --- | --- | --- | --- |
| Tokens/costo por request | `usage` en assistant messages (ya emitido por el runtime) | `{input, output, cacheRead, cacheWrite, cost}` | Agentes-Cost | ✅ YA |
| Cache hit % | Derivado: `cacheRead / (input + cacheRead)` | `cacheHitPct: 78` | Agentes-Cost, SPACE-E | ✅ YA |
| Turnos y sesiones | Conteo de `message` entries (role user/assistant) | `turns: 84, sessions: 12` | SPACE-A, Agentes-Util | ✅ YA |
| Tool calls con conteo | Bloques `toolCall` en assistant messages | `byTool: [{tool:"read", count:142, tokens:480k}]` | SPACE-A, Agentes-Util | ✅ YA |
| Líneas asistidas (KLOC) | Conteo de líneas en `write.arguments.content` y `edit.arguments.edits[].newText` | `byFileType: [{fileType:"TS", assistedKloc:14.2}]` | SPACE-A, Agentes-Impact | ✅ YA |
| Tiempo activo | Δ timestamps first→last message por turno/sesión | `activeMs: 15_120_000` | SPACE-E | ✅ YA |
| Patrones horarios | Timestamps agrupados hora×día | `byHour[24], byDow[7]` | SPACE-E | ✅ YA |
| Adopción de capacidades | Flags de uso de browser/subagentes/contexto | `adoption: {browserUsed:true,...}` | Agentes-Util | ✅ YA |
| Comportamiento (HITL) | Conteos `ask_user_question`, `Agent`, `compaction` entries | `behavior: {subagentsLaunched:8,...}` | Agentes-Util, SPACE-E | ✅ YA |
| Cambios de modelo | `model_change` entries | `byModel/byProvider` | Agentes-Cost | ✅ YA |
| **Commit SHA estructurado** | ★ NUEVO: hook post-commit → `custom_message` | `{type:"git_commit", sha, branch, repo}` | DORA (join key), FLOW | ⬜ F2 |
| **Issue ref estructurada** | ★ NUEVO: parse `Refs #N` del commit capturado | `{issueRef: "#102"}` | FLOW (join key), SPACE-P | ⬜ F2 |
| **Fase SDLC del turno** | ★ NUEVO: clasificador por metadatos (tool + comando bash + extensión) | `bySdlcPhase: {Construction:72%, Testing:18%}` | FLOW-Distribution | ⬜ F2 |
| **Bugfix candidate** | ★ NUEVO: clasificador (issue label bug, patrón test failing→fix) | `turn.tags: ["bugfix-candidate"]` | SPACE-P | ⬜ F2 |
| **Experience sample** | ★ NUEVO: micro-encuesta opt-in sobre `ask_user_question` | `{customType:"experience_sample", rating:4, timeSaved:"1-4h"}` | SPACE-S, Agentes-Impact | ⬜ F3 |

### 5.2 Señales capturadas por el concentrador (origen: sistemas organizacionales)

| Señal | Mecanismo de captura | Fuente tecnológica | Marcos |
| --- | --- | --- | --- |
| Commits y PRs (merged, review latency) | Webhooks `push` / `pull_request` o polling GraphQL | GitHub, GitLab, Bitbucket, Azure Repos | DORA (lead time), SPACE-C |
| Eventos de deployment | Webhook `deployment` / release events | GitHub Actions, GitLab CI, Jenkins, ArgoCD | DORA (deploy freq) |
| Incidentes y recuperación | Webhooks de alerting resueltas / API | PagerDuty, Opsgenie, Datadog, Grafana | DORA (fail rate, recovery) |
| Defectos post-release | API de issues + JQL filtrada por fecha/versión | Jira, GitHub Issues, Linear, Azure Boards | SPACE-P, FLOW (defects) |
| Flow Items (feature/defect/debt/risk) | API de work items con mapeo de tipos/etiquetas | Jira (epic/story/bug), ADO, GitHub Projects | FLOW (todas) |
| WIP en curso (Flow Load) | Consulta de estados `in-progress` | mismo planificador | FLOW (load) |
| Errores por release | API de errores agrupada por versión | Sentry, Datadog, New Relic | SPACE-P |
| Reportes de Frida (N devs) | Push del propio Frida (comando export o post automático opt-in) | `frida-usage-report/vN` vía HTTP o archivo | todos (lado dev) |

### 5.3 Join keys del modelo de datos

La correlación exitosa depende de **3 claves compartidas** entre Frida y las fuentes org:

1. **`repo URL`** — git remote del workspace (Frida lo conoce localmente; el SCM lo conoce). Clave principal de agregación.
2. **`commit SHA`** — une el turno de Frida con el PR y el deployment que lo contiene.
3. **`issue key`** — une turno ↔ work item del planificador (vía `Refs #N`).
Sin estas claves, DORA y FLOW no son calculables de forma attributable; por eso F2 las emite primero.

---

## 6. Monitoreo continuo (cómo se vigilan las métricas)

Recolectar una vez no basta: el sistema debe **monitorear en operación continua**. Se agregan tres piezas: cadencias de cómputo, dashboards y alertas, y meta-monitoreo de la salud del pipeline.

### 6.1 Diagrama de bloques del pipeline de monitoreo

```
┌─────────────────── CAPTURA (continua) ───────────────────────┐
│  Frida: JSONL append-only por turno (write-through, 0 costo)  │
│  Concentrador: webhooks SCM/CI/CD/ITSM en tiempo real         │
└───────────────┬──────────────────────────┬──────────────────┘
                │                          │
                ▼                          ▼
┌─────────── INGESTA ─────────┐   ┌──────── AGREGACIÓN ─────────┐
│ Frida: re-index incremental │   │ Concentrador: jobs          │
│ por mtime al abrir panel    │   │  • rolling 5m (webhooks)    │
│ (patrón session-stats.ts)   │   │  • diario (DORA/FLOW batch) │
└──────────────┬───────────────┘   │  • semanal (SPACE/ DX)     │
               │                   └──────────┬──────────────────┘
               ▼                              ▼
┌─────────── CÓMPUTO ──────────────────────────────────────────┐
│ Motores de métricas: DORA-5 · SPACE-A/E/S/P/C · FLOW-5 ·     │
│ DX-Util/Impact/Cost  (idempotentes, re-procesables)          │
└──────────────┬───────────────────────────────────────────────┘
               ▼
┌─────────── CONSUMO ──────────────────────────────────────────┐
│ Dashboards (trend + rolling windows) · Alertas (umbrales) ·  │
│ Reportes periódicos (weekly digest) · API de consulta        │
└──────────────────────────────────────────────────────────────┘
```

### 6.2 Cadencias por tipo de dato

| Dato | Cadencia de captura | Cadencia de cómputo | Ventana típica |
| --- | --- | --- | --- |
| Tokens/costo (Frida) | Por request (write-through JSONL) | On-demand al abrir panel + export | Hoy/7d/30d/Todo |
| Webhooks SCM/CI/CD | Tiempo real (segundos) | Rolling 5–15 min | 7d/30d/90d |
| DORA-5 | Hereda de webhooks | Batch diario (mediana/percentiles) | 30d/90d rolling |
| FLOW-5 | API del planificador | Batch diario | sprint/mes |
| SPACE-S (samples) | Al cierre de sesión (opt-in) | Diario (agregado anónimo) | 7d/30d |
| SPACE-P (defectos post-release) | Webhooks de issues | Diario | por release |
| DX lift (adopción vs throughput) | Semanal | Semanal (regresión) | 8–12 semanas |

**Regla de idempotencia:** todos los motores son funciones puras sobre el almacén de eventos; re-procesar una ventana siempre produce el mismo resultado (permite backfills y corrección retroactiva).

### 6.3 Qué se monitorea y con qué alertas

| Métrica vigilada | Umbral sugerido (inicial) | Canal | Marco |
| --- | --- | --- | --- |
| Cache hit % (por dev/proyecto) | < 40% sostenido 7d | Panel Frida (tono rojo + consejo) | Agentes-Cost |
| Costo diario / presupuesto | > X% del presupuesto mensual | Notificación concentrador | Agentes-Cost |
| Deployment frequency | Caída > 50% vs 30d previos | Dashboard trend | DORA |
| Change lead time p50 | Regresión > 2× vs trimestre | Dashboard trend | DORA |
| Change fail rate | > 30% del mes | Dashboard + alerta | DORA |
| Flow Load (WIP) | > límite de WIP del VS mapping | Alerta al equipo | FLOW |
| Satisfacción agregada (S) | Promedio < 3/5 dos semanas | Alerta anónima al lead | SPACE-S |
| Tasa de muestreo de S | < 30% de sesiones con sample | Meta-alerta (calidad del dato) | SPACE-S |

### 6.4 Meta-monitoreo (salud del propio pipeline)

Un sistema de métricas que falla silenciosamente es peor que no tenerlo. El concentrador monitorea su propia ingesta:

- **Lag de ingesta**: edad del evento más reciente por fuente (webhook caído → lag crece).
- **Completitud de join keys**: % de reportes Frida con SHA/issue emitidos (baja = clasificador F2 fallando).
- **Cobertura de reporting**: % de devs activos exportando reporte (baja = fricción de export).
- **Sanity de valores**: costos negativos, turnos con duración imposible, caché > 100% → cuarentena del registro + alerta.

Dentro de Frida, el panel "Productividad" actúa como monitoreo local: muestra la frescura del dato ("Cargando telemetría…" vs render) y los tonos semáforo del cache hit, sin dependencia del concentrador.

---

## Matriz resumen de gaps

| Gap | Marco que lo usa | Dónde se resuelve | Componente nuevo |
| --- | --- | --- | --- |
| Etiqueta `git_commit` estructurada en JSONL | DORA, FLOW | Frida | post-commit hook → custom_message |
| Experience sampling (S + time savings) | SPACE, Agentes | Frida | flujo sobre ask_user_question + config |
| Clasificador SDLC `bySdlcPhase` | FLOW, (DORA parcial) | Frida | tabla de reglas por metadatos (ya diseñado F2) |
| `bugFixSignals` | SPACE-P | Frida | clasificador por metadatos (ya diseñado F2) |
| Ingesta SCM/CI/CD (webhooks + normalizador) | DORA, FLOW, SPACE-C | Concentrador | 3 receivers + bus canónico |
| Ingesta ITSM/planificador (Flow Items) | FLOW, SPACE-P | Concentrador | Jira/ADO connector |
| Ingesta observabilidad/incidentes | DORA, SPACE-P | Concentrador | PagerDuty/Datadog/Sentry connector |
| Motor de métricas DORA/FLOW/SPACE | DORA, FLOW, SPACE | Concentrador | funciones de cálculo + almacén |
| Dashboard multimarco del concentrador | todos | Concentrador | UI analítica |
| Extensión del schema export a v2 | todos | Frida | campos opcionales añadidos, v1 compatible |

## Roadmap incremental sugerido

- **F2 (Frida)**: clasificador SDLC + etiqueta git_commit/issue + bugFixSignals → export v1 enriquecido (o v2 si rompe schema).
- **F3 (Frida)**: experience sampling opt-in (S + time savings) → alimenta SPACE y DX AI simultáneamente.
- **F4 (concentrador, fuera del repo)**: ingesta webhooks SCM/CI/CD/ITSM + motores DORA/FLOW/SPACE + dashboards. La decisión build-vs-buy para VSM (Planview/Jellyfish/DX vs propio) es de la org consumidora.

## Decisions

- **D1**: Frida jamás consulta fuentes organizacionales; solo git local. El cruce es del concentrador (reafirma diseño 2026-08-03).
- **D2**: El experience sampling es una sola feature que sirve a SPACE-S y DX-Impact (time savings) — construir una vez, medir dos marcos.
- **D3**: DORA y FLOW se calculan íntegramente en el concentrador; Frida solo garantiza las join keys (repo, commit SHA, issue #).
- **D4**: La UI de Frida no crece más allá del panel Productividad existente; los cambios futuros son de datos (nuevas breakdowns), no de paneles nuevos.

## Open Questions

1. ¿El concentrador será build propio o se adopta una plataforma (DX, Planview, Jellyfish)? Afecta si el "motor DORA/FLOW" se escribe o se compra.
2. Frecuencia y fatiga del experience sampling: ¿session-end, daily, o muestreo aleatorio tipo ESM clásico? Requiere prueba con usuarios.
3. ¿Privacidad de samples de colaboración (Slack/Teams)? Fuertemente opt-in; puede omitirse en v1 del concentrador.
