---
date: 2026-08-21T22:49:33-0600
author: Edgar F. Fuentes Perea
commit: de8d27d
branch: main
repository: frida-code
topic: "Métricas de productividad de desarrolladores: DORA vs SPACE vs FLOW vs Agentes de IA — ajuste a la telemetría de Frida"
tags: [research, metrics, dora, space, flow, agentes, dx-core-4, usage, telemetry, dashboard]
status: ready
last_updated: 2026-08-21T22:49:33-0600
last_updated_by: Edgar F. Fuentes Perea
---

# Research: DORA vs SPACE vs FLOW vs Métricas de Agentes de IA — ¿cuál encaja con la telemetría de Frida?

## Summary

Investigación sobre los cuatro marcos de medición de productividad de software relevantes en 2025–2026 para decidir cuál se acomoda mejor a los datos que **Frida ya recolecta** (telemetría de uso: tokens, costo, sesiones, turnos, herramientas, cache hit, código asistido) y para diseñar un **panel nuevo en un tab de Configuración**.

**Conclusión principal:**

1. **DORA** y **FLOW Framework** miden el *sistema de entrega organizacional* (deployments, lead time, value streams) — datos que Frida **no puede recolectar** desde el JSONL de sesiones. Solo encajan de forma parcial (proxys) o a través del concentrador externo (principio "etiqueta, no cruces" ya decidido en la investigación de telemetría 2026-08-03).
2. **SPACE** encaja **fuertemente en 2 de sus 5 dimensiones** (Activity y Efficiency & Flow) que son exactamente logs-based measures; otras 2 dimensiones (Satisfaction, Performance) requieren datos que Frida no produce hoy (encuestas, calidad de producción).
3. **Métricas de Agentes de IA** (DX AI Measurement Framework + DORA State of AI 2025) es el marco con **mejor ajuste natural**: sus 3 dimensiones (Utilization / Impact / Cost) corresponden casi 1:1 con lo que Frida recolecta del JSONL — es la fuente de telemetría del agente por definición.
4. **Recomendación**: organizar el nuevo panel bajo el lente de **Agentes (DX AI Framework)** reforzado con las dimensiones **A + E de SPACE** (y optionally el clasificador SDLC planeado como "Flow Distribution ready"). DORA/FLOW quedan como contrato de export para el concentrador.

## Requirements

- R1: Identificar marcos de medición relevantes (DORA, SPACE, FLOW, agentes IA, unificadores como DX Core 4) desde **fuentes primarias**.
- R2: Mapear cada marco contra el inventario exacto de datos que Frida recolecta hoy (`webview/types.ts` `UsageReportView` + JSONL de sesiones).
- R3: Proponer opciones de panel nuevo para un tab de Configuración (que no duplique el tab "Uso" ya rediseñado).

## Frameworks (fuentes primarias)

### 1. DORA — Software Delivery Performance Metrics

Fuente: [dora.dev/guides/dora-metrics-four-keys](https://dora.dev/guides/dora-metrics-four-keys/) (actualizado enero 2026).

Modelo actual de **5 métricas** (evolucionó de los "four keys"):

- **Throughput:**
  - *Change lead time*: de commit a producción.
  - *Deployment frequency*: frecuencia de deploys a producción.
  - *Failed deployment recovery time*: (antes MTTR) tiempo de recuperación de un deploy fallido.
- **Instability:**
  - *Change fail rate*: % de deploys que requieren intervención inmediata (rollback/hotfix).
  - *Deployment rework rate*: % de deploys no planeados por incidentes.

Notas clave de la fuente: predicen desempeño organizacional y bienestar; son **métricas por aplicación/servicio** (no por equipo ni por dev); advertencias explícitas contra Goodhart's law y comparaciones dispares. La guía de DORA sobre [elección de marcos de medición](https://dora.dev/research/2025/measurement-frameworks/) (ago 2025) clasifica los datos en **self-reported** (encuestas) vs **logs-based** (quantity / time-based / frequency) — Frida produce logs-based por naturaleza.

**Dato que Frida NO tiene:** eventos de deployment, producción, incidentes. DORA requiere el pipeline CI/CD completo.

### 2. SPACE — Framework de Productividad de Desarrolladores

Fuente: [Forsgren, Storey, Maddila, Zimmermann et al., ACM Queue vol 19 no 1 (2021)](https://queue.acm.org/detail.cfm?id=3454124) — paper completo.

5 dimensiones, cada una medible en 3 niveles (individual / equipo / sistema):

| Dimensión | Qué mide | Métricas ejemplo |
| --- | --- | --- |
| **S**atisfaction & well-being | Satisfacción, eficacia percibida, burnout | Encuestas, retención, recomendación del equipo |
| **P**erformance | **Resultas como outcomes, no output** | Calidad/reliability, impacto en cliente, adopción |
| **A**ctivity | Conteo de acciones/salidas | PRs, commits, reviews, builds, incidentes |
| **C**ommunication & collaboration | Cómo colaboran los equipos | Descubribilidad de docs, velocidad de reviews, onboarding |
| **E**fficiency & flow | Progreso con mínima fricción/interrupciones | Tiempo enfocado sin interrupciones, handoffs, wait time, "flow state" |

Recomendaciones del paper: usar **≥3 dimensiones** (nunca una sola), incluir al menos una **medida perceptual**, y aceptar la **tensión** entre métricas por diseño. Advertencias: nunca usar activity en solitario para evaluar personas; privacidad (reportar agregado).

### 3. FLOW Framework — Mik Kersten (Project to Product)

Fuente: [flowframework.org/ffc-discover](https://flowframework.org/ffc-discover/) (marco de Value Stream Management).

- **4 Flow Items** (unidades de trabajo de negocio): **features, defects, debts, risks**.
- **5 Flow Metrics**: **Flow Velocity** (items completados/periodo), **Flow Time** (work-start→work-complete, activo+espera), **Flow Efficiency** (activo vs espera), **Flow Load** (WIP en curso), **Flow Distribution** (ratio de los 4 tipos de items).

La propia fuente lo posiciona frente a DORA: "DORA optimiza de desarrollo a release; Flow Metrics miden de request del cliente a release y feedback". **Nivel organizacional / value stream**: requiere mapear el flujo de trabajo completo (funding, diseño, CI/CD, cliente).

### 4. Métricas de Agentes de IA (2025)

#### 4a. DX AI Measurement Framework™

Fuente: [getdx.com/research/measuring-ai-code-assistants-and-agents](https://getdx.com/research/measuring-ai-code-assistants-and-agents/).

3 dimensiones alineadas al **ciclo de vida de adopción de IA**:

1. **Utilization / Adopción**: uso activo de herramientas IA, % adoption, sentimiento.
2. **Impact**: directo (AI-driven time savings por dev/semana, vía experience sampling) + indirecto (análisis longitudinal de métricas Core 4: throughput de PRs, perceived rate of delivery, Developer Experience Index).
3. **Cost**: costo de uso, ROI por caso de uso, gobernanza.

Consejos específicos del documento: **medir agentes como extensiones del equipo** ("cada dev opera como un lead de un equipo de agentes IA"), balancear velocidad vs calidad/mantenibilidad, expandir la definición de "developer", y advertencias fuertes contra usar métricas de volumen de código generado para evaluación individual (gamificación).

Casos citados: Booking.com (+16% throughput con 3,500 devs), Block (4,000 devs, guía su estrategia de agentes), Intercom (2× adopción → +41% time savings). Dato de referencia: incluso organizaciones líderes alcanzan ~60% de uso activo de herramientas IA.

#### 4b. DORA State of AI-assisted Software Development 2025 + AI Capabilities Model

Fuentes: [dora.dev/dora-report-2025](https://dora.dev/dora-report-2025/) y [AI Capabilities Model](https://dora.dev/research/2025/ai-capabilities-model/) (PDF: services.google.com/fh/files/misc/2025_dora_ai_capabilities_model.pdf).

- Hallazgo central: **la IA es un amplificador** del sistema organizacional existente — magnifica fortalezas Y debilidades; el retorno no viene de las herramientas sino del sistema subyacente.
- **7 capacidades** que amplifican el beneficio de IA: (1) postura/política de IA clara y comunicada, (2) ecosistema de datos saludable, (3) datos internos alcanzables por la IA, (4) versionado fuerte, (5) lotes pequeños (small batches), (6) foco user-centric, (7) plataforma interna de calidad.
- La guía de marcos de medición de DORA (ago 2025) confirma: **no se necesita un marco nuevo para la era IA** — se extienden las métricas existentes (acceptance rate de sugerencias IA, calidad del modelo, confianza) manteniendo las baseline.

### 5. Contexto: DX Core 4 (unificador)

Fuente: [getdx.com/research/measuring-developer-productivity-with-the-dx-core-4](https://getdx.com/research/measuring-developer-productivity-with-the-dx-core-4/) (Noda, Tacho, Storey, Greiler + asesores Forsgren/Zimmermann).

Unifica DORA + SPACE + DevEx en 4 dimensiones: **Speed, Effectiveness, Quality, Business Impact**; métricas por system-metrics + self-report + experience sampling. Relevante como vocabulario puente entre los otros marcos.

## Current State Analysis — Mapeo contra los datos de Frida

Inventario real de Frida (verificado contra `webview/types.ts` `UsageReportView` y la investigación 2026-08-03 de telemetría):

| Dato Frida | Origen | DORA | SPACE | FLOW | Agentes (DX) |
| --- | --- | --- | --- | --- | --- |
| `tokensIn/Out`, `cacheRead/Write`, `cost` | JSONL `usage` | — | A (parcial) | — | **Cost ✓✓** |
| `sessions`, `turns`, `avgTurnTokens` | JSONL | — | **A ✓✓** | Flow Velocity (proxy) | Utilization ✓ |
| `activeMs` (tiempo activo) | JSONL timestamps | — | **E ✓✓** | Flow Efficiency (activo vs espera) ✓ | Impact (indirecto) ✓ |
| `cacheHitPct` | JSONL usage | — | **E ✓✓** (eficiencia de contexto) | — | **Cost ✓✓** |
| `byTool` (count + tokens) | toolCalls | — | **A ✓✓** | — | **Utilization ✓✓** |
| `byFileType` (files, edits, assistedKloc) | toolCalls arguments | — | A ✓ | Flow Distribution (proxy débil) | Impact (indirecto) ✓ |
| `byDay/byHour/byDow` | timestamps | — | **E ✓✓** (patrones de flow) | Flow Time (proxy) | Utilization ✓ |
| `byModel/byProvider` | model_change | — | — | — | **Cost + Utilization ✓✓** |
| `behavior.compactations` | compaction entries | — | E ✓ (gestión de contexto) | — | **Cost ✓** |
| `behavior.subagentsLaunched` | Agent toolCalls | — | — | — | **Utilization ✓✓** (agente como equipo) |
| `behavior.questionsAsked` | ask_user_question | — | E ✓ (interrupciones human-in-the-loop) | — | Utilization ✓ |
| `adoption.{browser,subagents,contextTool}Used` | flags | — | — | — | **Utilization ✓✓** |
| `sessions[].cwd` (proyecto) | session entry | — | — | Flow Distribution por proyecto | Utilization por proyecto ✓ |
| **NO disponible** | — | deployments, lead time a prod, change fail rate (DORA completo) | encuestas (S), calidad de producción (P), colaboración (C) | flow items reales (feature/defect/debt/risk), WIP org | time savings auto-reportado (impacto directo) |

### Veredicto de ajuste

1. **Agentes (DX AI Framework): ~90% de cobertura** — Utilization y Cost están completas con datos nativos; Impact directo requiere self-report (posible vía `ask_user_question` como experience sampling ligero). **Es el marco natural de Frida porque Frida ES la fuente de telemetría del agente.**
2. **SPACE: cobertura de 2/5 dimensiones fuertes (A + E)** — cumple la recomendación del paper solo parcialmente (pide ≥3 dimensiones); llegar a Satisfaction requeriría micro-encuestas opt-in y a Performance señales de calidad (bugFixSignals ya planeado como F2 en la investigación de telemetría).
3. **FLOW Framework: cobertura parcial (~40%)** — Flow Time/Efficiency proxys a nivel sesión sí; Flow Items reales y Flow Load organizacional no. El clasificador SDLC por metadatos (R4 de la investigación previa) produciría un *Flow Distribution ready* para el concentrador.
4. **DORA: cobertura mínima (~15%)** — ninguna de las 5 métricas es calculable desde el JSONL. DORA-2025 aporta el lente conceptual (IA como amplificador, extensión de métricas existentes) pero no métricas calculables. Su rol natural: **contrato de export del concentrador** (que sí ve CI/CD).

### Síntesis recomendada

**Panel nuevo = lente "Productividad & Agentes"**: dimensión organizadora primaria **DX AI (Utilization/Impact/Cost)** sobre el flujo SPACE (A ctivity + E fficiency) que Frida ya llena, con badges de "dimensiones completas" (A, E, Utilization, Cost) y "requiere instrumentación" (S, P, C, DORA) para no prometer lo que no se mide. Export F2 (SDLC/bugFixSignals) se documenta como "DORA-ready / Flow Distribution-ready" para el concentrador, respetando el principio "etiqueta, no cruces".

## Open Questions

1. **¿Experience sampling en Frida?** SPACE/DX insisten en medida perceptual. Frida ya tiene `ask_user_question` — un micro-cuestionario opt-in post-sesión (1 pregunta: satisfacción/eficacia 1–5) llenaría la dimensión S con costo mínimo. Decisión de producto (privacidad vs completitud).
2. **¿Clasificador de Flow Items?** Mapear SDLC phase → feature/defect/debt/risk es posible con metadatos (tool + bash commands + extensiones), pero el FLOW Framework espera value streams completos; el valor real solo emerge en el concentrador.
3. **Scope del panel**: los datos actuales alcanzan para un panel 100% logs-based; las dimensiones faltantes se muestran como roadmap/hueco o se omiten.

## Sources

- DORA four keys: <https://dora.dev/guides/dora-metrics-four-keys/>
- DORA choosing measurement frameworks (ago 2025): <https://dora.dev/research/2025/measurement-frameworks/>
- DORA State of AI-assisted SD 2025: <https://dora.dev/dora-report-2025/>
- DORA AI Capabilities Model: <https://dora.dev/research/2025/ai-capabilities-model/> (PDF: <https://services.google.com/fh/files/misc/2025_dora_ai_capabilities_model.pdf>)
- SPACE (ACM Queue 2021, Forsgren et al.): <https://queue.acm.org/detail.cfm?id=3454124>
- Flow Framework (Kersten): <https://flowframework.org/ffc-discover/>
- DX Core 4 (Noda, Tacho, Storey, Greiler): <https://getdx.com/research/measuring-developer-productivity-with-the-dx-core-4/>
- DX AI Measurement Framework: <https://getdx.com/research/measuring-ai-code-assistants-and-agents/>
- Investigación previa del repo: `.rpiv/artifacts/research/2026-08-03_21-38-12_frida-usage-telemetry.md` (inventario JSONL verificado, principio "etiqueta, no cruces")

## Verdict

**Recomendado: marco de Agentes de IA (DX AI Measurement Framework) + dimensiones A/E de SPACE como esqueleto del panel; DORA y FLOW quedan como contratos de export para el concentrador externo.** El documento incluye 3 opciones de panel para decidir con el usuario.
