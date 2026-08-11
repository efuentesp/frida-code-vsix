# Frida frente al ADLC (Agentic Development Life Cycle)

**Tipo:** nota de investigación (no requiere acción de implementación).
**Fecha:** 2026-08-11.
**Fuente:** video *"ADLC: Claude Code's New Lifecycle for AI Coding"* (youtube `aMBQB_IJ0dQ`, ~62 min).
**Transcripción:** extraída vía `yt-dlp` + sesión Brave + `--remote-components` (ver ADR-0049 para el método).
**Parte de la serie:** `graph-engineering-parity.md` · `sdlc-antigravity-parity.md` · `factory-missions-parity.md` · esta nota.

## Resumen

A diferencia de los 3 videos previos (sobre **usar agentes para entregar
software** — el dominio de Frida), este video describe el **ADLC**: el ciclo de
vida para **construir PRODUCTOS agenticos** (sistemas que *son* agentes). Son 7
fases: preparación/hipótesis · scope · diseño · simulación/proof-of-value ·
implementación · testing · deployment · mantenimiento/aprendizaje continuo. Tesis
central: el software agéntico es un **sistema vivo** (no determinista); la lógica
vive en código+prompts+modelos+herramientas+servicios; las métricas de éxito son
precisión/alucinación/costo (no pass/fail); el deployment es inicio de monitoreo
activo, no estado estable.

**Veredicto:** Frida es la **herramienta de BUILD dentro de un ADLC** y cubre muy
bien las fases 1-6(build). Las fases 6-eval/7-deploy/8-monitor son
**deliberadamente fuera de scope** — y así debe quedar: Frida es el martillo, no la
pila de observabilidad del producto agéntico (esa es categoría de Ragas/DeepEval/
LangSmith/Braintrust). Este es el único video del set que **aclara una frontera**
en vez de revelar un gap a cerrar.

## Por qué este video es distinto a los demás

Los videos previos: *agentes que programan* (dominio exacto de Frida).
Este video: *cómo desarrollas un sistema que ES un agente* (producto agéntico).
La diferencia de scope es la conclusión clave.

## Mapeo ADLC → Frida

| Fase ADLC | Equivalente Frida | Estado |
| --- | --- | --- |
| 1. Planning mode (comportamiento, no impl.) | #27 frida-plan-mode + #34 advise-project-approach | ✅ MATCH (planeado) |
| 2. Responsabilidad humano-agente | `frida-permission-system` + checkpoints + modos de aprobación | ✅ MATCH |
| 3. Diseño (patrones, data flow) | `frida-extensible-workflows` (react/plan-act/multi-agent) | ✅ MATCH |
| 3. Economía de tokens | #18 (accounting) + #23 hypa + #31 headroom + `frida-context` | 🟡 PARCIAL (necesita #18) |
| 3. Edición/compaction de contexto | compaction nativa + `frida-context` + #23/#31 | 🟡 PARCIAL |
| 4. Simulación & proof of value | skill `prototype` + checkpoints como validation gate | ✅ MATCH |
| 5. Implementación (lógica en código+prompts+tools) | el dominio core de Frida | ✅ STRONG MATCH |
| 5. Orquestación ("agents view") | `frida-extensible-workflows` + `frida-subagents` | ✅ MATCH |
| 5. Integración MCP | `frida-mcp-adapter` | ✅ MATCH |
| 5. Gestión de contexto (memoria, anti context rot) | `frida-context` + #21 hermes + #29 KB | 🟡 PARCIAL (#21 bloqueado) |
| 6. Testing de código (correctitud) | #19 patrones + pi-lens | ✅ MATCH |
| 6. **Métricas de agente (alucinación/precisión/costo por outcome)** | — | ❌ FUERA de scope |
| 7. **Deployment + monitoreo activo de comportamiento** | — | ❌ FUERA de scope |
| 8. Aprendizaje continuo (feedback loops) | #21 hermes + #22 refine + #28 relay | 🟡 PARCIAL (bloqueados) |

## Frida cubre bien el "build", debe quedarse fuera del "deploy/eval/monitor"

**Build (fases 1-6):** Frida cubre planning mode (#27), diseño/prototipo,
implementación con MCP, orquestación, testing vía #19. Su roadmap ataca las
preocupaciones dev-side (economía de tokens #18, memoria #21, aprendizaje
# 22/#28).

**Deploy/eval/monitor (fases 6-eval/7/8):** deliberadamente fuera de scope:

- **Métricas de agente** (tasa de alucinación, distribución de precisión, costo por
  outcome) → del producto agéntico en producción, evaluado con Ragas/DeepEval/
  LangSmith/Braintrust. No del coding agent que ayuda a *construirlo*.
- **Deployment + monitoreo activo** → runtime/observability del producto agéntico
  (drift, alerting, rollout). Otra categoría.

## Reflexión estratégica

| | Fases 1-6 (build) | Fases 6-eval/7/8 (deploy/monitor) |
| --- | --- | --- |
| Frida | ✅ dominio + roadmap | ❌ fuera de scope (correcto) |
| LangSmith/Braintrust/Ragas | — | ✅ su categoría |

## Síntesis de la serie de 4 videos

| Video | Tema | Veredicto para Frida |
| --- | --- | --- |
| Graph Engineering (`H7t3uUp3HVw`) | agentes que programan (grafos) | ~85% hoy; gap = #18→#19 (routing de modelo) |
| Antigravity SDLC (`K3YYr6yauAw`) | agentes que programan (SDLC) | 100% hoy; componer (#19/#16) |
| Factory Missions (`ow1we5PzK-o`) | agentes que programan (multi-día) | arquitectura alineada (bitter lesson = Frida); gaps = #18→#19 + lifecycle async #20/#24 |
| **ADLC (`aMBQB_IJ0dQ`)** | **construir productos agénticos** | **herramienta de build (✅); deploy/eval/monitor fuera de scope (correcto)** |

**Constante:** los 3 primeros (dominio de Frida) convergen en el gap recurrente
**#18** (token accounting → routing de modelo por rol/nodo). El cuarto (ADLC) es el
que **define la frontera**: Frida no debe perseguir el espacio de
deployment/eval/monitoring de productos agénticos.

## Conclusión

Frida está bien posicionado como la **herramienta de implementación/testing dentro
de un proceso ADLC** (build + continuous-learning vía #21/#22/#28), y su roadmap ya
ataca las preocupaciones dev-side. A diferencia de los 3 videos anteriores (donde
Frida aspira a paridad plena), el ADLC **aclara que Frida debe NO perseguir** el
espacio de deployment/eval/monitor de productos agénticos — es una categoría
distinta de producto (agent observability).

## Referencias

- Fuente: video *"ADLC: Claude Code's New Lifecycle for AI Coding"* (youtube `aMBQB_IJ0dQ`).
- Notas de la serie: `graph-engineering-parity.md` · `sdlc-antigravity-parity.md` · `factory-missions-parity.md`.
- ADR-0023 — `frida-mcp-adapter` (MCP en implementación).
- ADR-0028 — `frida-extensible-workflows` (orquestación multi-agente).
- ADR-0030 — `frida-dynamic-workflows` (capa de patrones #19: testing/auditor).
- Issues relevantes: **#27** (plan-mode) · **#34** (advise) · **#18** (token accounting) · **#21/#22/#28** (continuous learning).
