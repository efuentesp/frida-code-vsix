---
template_version: 1
date: 2026-08-28T09:25:48-0600
author: Edgar F. Fuentes Perea
commit: 70ddeb0
branch: main
repository: frida-code
topic: "Validation of M10 size-app — dimensionamiento cuantitativo de apps para preventa"
status: ready
verdict: pass
parent: ".rpiv/artifacts/plans/2026-08-28_05-31-13_m10-size-app.md"
tags: [validation, frida-size-app, scc, cocomo, frida-extensible-workflows, skill-pack, installer]
last_updated: 2026-08-28T09:25:48-0600
---

## Validation Report: M10 size-app — dimensionamiento cuantitativo de apps para preventa

### Implementation Status

- ✓ Phase 1: Fundaciones del binario — constants + installer — Fully implemented (8/8 tests en verde; digests sha256 reales de matrix completa de 8 assets verificados contra el release v4.0.0; `extractTarGz` con guard tar-slip; `ensureBinary` con orden sha→extraer→copiar→chmod→marker)
- ✓ Phase 2: Prompts y resolver 3-capas — Fully implemented (6/6 tests en verde; 6º consumidor de `createLayeredStageResolver` de frida-aidd; veto de solo-escritura y juez de números en `SIZE_APP_PREAMBLE` fuera del mapa de stages)
- ✓ Phase 3: Args y validación eager (workflow.ts parte 1) — Fully implemented (5/5 criterios grep; `validateSizeAppArgs` con wage requerido instruyendo `ask_user_question` pre-launch; decimales permitidos sin `Number.isInteger`; constantes COCOMO y specs de anexos exportadas)
- ✓ Phase 4: Generador — bootstrap + metrics (workflow.ts parte 2) — Fully implemented (16/16 criterios grep; agregador node host-side `metrics-agg.js` por límite RPC de 10 MB; doble pasada scc con/sin curada para medir volumen excluido; fence `SA_EOF`; invocación de scc por ruta absoluta `shq(SCC_BIN)`)
- ✓ Phase 5: Generador — analyze + synthesize + judge (workflow.ts parte 3) — Fully implemented (18/18 criterios grep; fanout de 3 escritores interpretativos con gate `test -s` y reintento informado; synthesize derivando KLOC/percentiles/SQALE/COCOMO 3 corridas EAF/bus factor/olas exclusivamente de `metrics.json`; juez detached con regla corte→CONCERNS runtime duplicada)
- ✓ Phase 6: Patrón + factory + registro — Fully implemented (31/31 tests en verde; patrón builtin `size-app` con `meta.moat` y `requiredTools`; factory con disparo fire-and-forget gateado e idempotente; entrada registrada en `src/pi-session.ts` con `agentDir` + getter `codebaseIndexEnabled`)
- ✓ Phase 7: E2E + dominio COCOMO — Fully implemented (9 e2e + 7 dominio en verde; assert de fanout estabilizado en `e2e.test.ts:850-854`; fixture congelada COCOMO Basic 81 V2 con 521.3 PM y literales independientes; borde SQALE B verificado; smoke real V1 con transcript en `.rpiv/tmp/scc-smoke/transcript.txt`)
- ✓ Phase 8: Doctor + publicación — Fully implemented (19/19 doctor tests en verde; `checkScc` como 8º check síncrono marker+existsSync; call-site productivo pasando `defaultAgentDir()`; entrada `HELP_TOOLS` con 6 alias sin colisión; fila README; docs par de 267/231 líneas; roadmap M10 cerrado con `P2 ✅`; suite completa `npm test` en verde con 205 archivos y 2282 tests pasados; motor `src/tools/frida-extensible-workflows/` y `webview/` 100% intactos)

### Automated Verification Results

- ✓ Typecheck limpio: `npm run typecheck && npm run typecheck:test` — 0 errores en código fuente y suites de tests
- ✓ Suite del pack: `npx vitest run test/frida-size-app/` — **61/61 tests pasados** (installer 8, resolver 6, pattern 31, e2e 9, cocomo-domain 7)
- ✓ Doctor del entorno: `npx vitest run test/environment-doctor.test.ts` — **19/19 tests pasados** (16 previos descongelados a 8 deps + 3 nuevos de `checkScc`)
- ✓ V6 — instalación nunca bloquea: `npx vitest run test/frida-size-app/pattern.test.ts -t "aunque ensureBinary rechace"` — 1/1 pasado
- ✓ V2 — fixture congelada: `npx vitest run test/frida-size-app/cocomo-domain.test.ts -t "fixture congelada"` — 1/1 pasado (E(1.00)=521.3 PM verificado con literales del test)
- ✓ V5 — juez FAIL no-abortivo: `npx vitest run test/frida-size-app/e2e.test.ts -t "caso negativo del juez"` — 1/1 pasado (entregables preservados en disco)
- ✓ Fan-out honesto y reintento: `npx vitest run test/frida-size-app/e2e.test.ts -t "escritor"` — 2/2 pasados (mentiroso aborta tras reintento, flaky rescatado)
- ✓ Criterios grep de fases 3-5: 39/39 verificados (`SA_EOF`×3, `shq(SCC_BIN)`×7, `metrics-agg.js`×4, constantes COCOMO exactas, 3 fases secuenciales, writer único de entregables, `CONCERNS, no FAIL`×1)
- ✓ Criterios grep de fases 6+8: 18/18 verificados (registro runtime, fire-and-forget, `checkScc`, call-site `defaultAgentDir()`, HELP_TOOLS ×2, `toBe(8)`×2 sin residuos de 7, fila README, roadmap cerrado)
- ✓ V8 — motor y webview intactos: `git diff --stat 9d6d8bb..HEAD -- src/tools/frida-extensible-workflows/` vacío; `git diff --stat 9d6d8bb..HEAD -- webview/` vacío
- ✓ Integridad de binario: los 8 sha256 de `SCC_DIGESTS` coinciden byte a byte con `checksums.txt` del release v4.0.0
- ✓ Baseline del repositorio: `npm test` — **205 test files pasados, 2282 tests pasados, 19 skipped preexistentes, 0 fallos** (100% verde y estable tras el fix de orden-independencia en el e2e)

### Code Review Findings

#### Matches Plan

- `src/tools/frida-size-app/constants.ts`: pin deliberado SCC_PIN="4.0.0", tabla de assets por plataforma-arquitectura Node, digests sha256 verificados, helpers de rutas `sccBinPath`/`sccMarkerPath`.
- `src/tools/frida-size-app/installer.ts`: `ensureBinary` con verificación sha256 estricta antes de descomprimir, `extractTarGz` con protección anti tar-slip, `isSccInstalledAtPin` síncrono para gates de launch, `SccInstallError` con guía accionable.
- `src/tools/frida-size-app/skills.ts`: 2 stages agénticos (`analyze`, `judge`), `SIZE_APP_PREAMBLE` no-stage con veto de solo-escritura y juez de números inalterables por overrides 3-capas.
- `src/tools/frida-size-app/resolver.ts`: integración de `createLayeredStageResolver` de `frida-aidd` (defaults → equipo `.frida/size-app/stages.json` → usuario `~/.frida/size-app/stages.json`).
- `src/tools/frida-size-app/workflow.ts`: validación eager con mensaje instructivo para `ask_user_question` en sesión principal; generador declarativo con 5 fases secuenciales (`bootstrap` → `metrics` → `analyze` → `synthesize` → `judge`); helper host-side `metrics-agg.js` para agregación sin saturar canal RPC; fórmulas COCOMO Basic 81, SQALE proxy, percentiles nearest-rank, bus factor y olas strangler-fig declaradas junto al valor; fence determinista `SA_EOF`.
- `src/tools/frida-size-app/index.ts`: patrón builtin `size-app` con `meta.moat` (`lens: true`, `codebaseIndex: true`) y `meta.requiredTools: ["shell"]`; factory `createFridaSizeApp` con disparo fire-and-forget no-bloqueante; registro en `src/pi-session.ts` con paso de `agentDir` y getter `codebaseIndexEnabled`.
- `src/environment/doctor.ts` y `src/extension.ts`: 8º check `checkScc` agregado al doctor con sonda síncrona sin exec; call site en `extension.ts` pasando `defaultAgentDir()`.
- Documentación y publicación: fila en tabla Herramientas de `README.md`, referencia técnica `docs/tools/frida-size-app.md` (267 líneas), guía `docs/how-to-frida-size-app.md` (231 líneas), cierre de roadmap en `docs/roadmap-extensiones.md` (`P2 ✅`), alias de `HELP_TOOLS` en `src/extension.ts` sin colisiones.
- Evidencia de smoke real V1: transcript capturado en `.rpiv/tmp/scc-smoke/transcript.txt` sustentando los mocks e2e.

#### Deviations from Plan

- None. La implementación es una realización fiel y exhaustiva de todas las especificaciones y contratos del plan.

#### Pattern Conformance

- ✓ Estructura de módulos y archivos en `src/tools/frida-size-app/` coincide perfectamente con los skill packs precedentes (`frida-understand-app`, `frida-traffic2api`, `frida-app-walkthrough`, `frida-tea`, `frida-aidd`).
- ✓ El resolver 3-capas reutiliza el motor común de `frida-aidd` sin bifurcaciones de lógica.
- ✓ El check del doctor `checkScc` respeta la interfaz `DependencyStatus` e incluye guías de instalación por plataforma.
- ✓ Los tests aíslan `$HOME` a directorios temporales, ejercitan fixtures sintéticas con mocks de binarios/agentes y cubren tanto caminos felices como degradaciones y fallos de red.

### Manual Testing Required

1. **Piloto OFBiz (V10)**:
   - [ ] Ejecutar el patrón `size-app` sobre un clone fresco del repositorio Apache OFBiz.
   - [ ] Registrar las métricas observadas (KLOC efectivos, CCN p50/p90/p99, top churn/hotspots, COCOMO ±rango con costo en MXN/USD) como comentario de evidencia en el issue #139 de GitHub.
2. **Ejercicio interactivo en repositorio real**:
   - [ ] Invocar `workflow({ name: "size-app", ... })` desde una sesión interactiva del agente.
   - [ ] Confirmar la formulación pre-launch de preguntas de presupuesto con `ask_user_question`.
   - [ ] Verificar la generación de los artefactos en `docs/dimensionamiento/` (`dimensionamiento.md`, `README.md`, `analisis/*.md`, `artifacts/metrics.json`) y la aprobación del checkpoint final con `review: "manual"`.
3. **Doctor en interfaz gráfica**:
   - [ ] Abrir el tab de "Verificar entorno" en la extensión de Frida Code.
   - [ ] Confirmar que se listan 8 dependencias incluyendo `scc` con su estado y guía accionable.

### Recommendations

- Ready to commit — implementación completa, robusta y 100% validada con suite de tests en verde.
