---
template_version: 1
date: 2026-08-28T08:52:18-0600
author: Edgar F. Fuentes Perea
commit: 9d6d8bb
branch: main
repository: frida-code
topic: "Validation of M10 size-app — dimensionamiento cuantitativo de apps para preventa"
status: ready
verdict: fail
parent: ".rpiv/artifacts/plans/2026-08-28_05-31-13_m10-size-app.md"
tags: [validation, frida-size-app, scc, cocomo, frida-extensible-workflows, skill-pack, installer]
blockers: [{ id: b1, command: "npm test", file: "test/frida-size-app/e2e.test.ts", line: 853 }]
last_updated: 2026-08-28T08:52:18-0600
---

## Validation Report: M10 size-app — dimensionamiento cuantitativo de apps para preventa

### Implementation Status

- ✓ Phase 1: Fundaciones del binario — constants + installer — **Fully implemented** (incluidos sus 2 criterios manuales, verificados en esta corrida: 8/8 digests byte a byte contra el `checksums.txt` real del release v4.0.0; `extractTarGz` documentado con typeflags L/x,g/5, tar-slip y la racionalización del CRC de gzip)
- ✓ Phase 2: Prompts y resolver 3-capas — **Fully implemented** (6/6 tests; sexto consumidor de `createLayeredStageResolver`, forma idéntica al hermano traffic2api)
- ✓ Phase 3: Args y validación eager (workflow.ts parte 1) — **Fully implemented** (5/5 criterios grep)
- ✓ Phase 4: Generador — bootstrap + metrics (workflow.ts parte 2) — **Fully implemented** (16/16 criterios grep)
- ✓ Phase 5: Generador — analyze + synthesize + judge (workflow.ts parte 3) — **Fully implementd** (18/18 criterios grep; los 2 fixes de transcripción del Plan Review — escapes `` \` `` y `\n` doblados — están aplicados correctamente en el archivo final)
- ✓ Phase 6: Patrón + factory + registro — **Fully implemented** (31/31 tests; entrada pi-session en línea 700, tras traffic2api línea 687, con `agentDir` + getter `codebaseIndexEnabled`)
- ✓ Phase 7: E2E + dominio COCOMO — **Fully implemented** (9+7 tests en verde en aislamiento; smoke V1 presente; ver Potential Issues — uno de sus asserts es sensible al orden del fanout bajo carga)
- ⚠️ Phase 8: Doctor + publicación — **Partial — see Findings** (todo el wiring verificado: doctor 19/19, greps 12/12, docs 267/231 líneas, README/roadmap/HELP_TOOLS sin colisiones, motor y webview intactos; PERO el criterio terminal `npm test` completo en verde NO es confiable — falló 2 de 3 corridas por el assert frágil de la Fase 7)

### Automated Verification Results

- ✓ Typecheck limpio: `npm run typecheck && npm run typecheck:test` — sin errores (repo + tests)
- ✓ Suite del pack: `npx vitest run test/frida-size-app/` — **61/61 en verde** (installer 8 · resolver 6 · pattern 31 · e2e 9 · cocomo-domain 7)
- ✓ Doctor: `npx vitest run test/environment-doctor.test.ts` — **19/19 en verde** (16 previos descongelados a 8 deps + 3 nuevos de `checkScc`)
- ✓ V6 — instalación nunca bloquea: `npx vitest run test/frida-size-app/pattern.test.ts -t "aunque ensureBinary rechace"` — 1/1
- ✓ V2 — fixture congelada: `npx vitest run test/frida-size-app/cocomo-domain.test.ts -t "fixture congelada"` — 1/1 (E(1.00)=521.3 PM con literales independientes)
- ✓ V5 — juez FAIL no-abortivo: `npx vitest run test/frida-size-app/e2e.test.ts -t "caso negativo del juez"` — 1/1
- ✓ Fan-out honesto: `npx vitest run test/frida-size-app/e2e.test.ts -t "escritor"` — 2/2 (mentiroso + flaky)
- ✓ Criterios grep fases 3-5: 39/39 en verde (incl. escapes, `SA_EOF`×3, `shq(SCC_BIN)`×7, constantes COCOMO exactas, 3 fases, writer único, `CONCERNS, no FAIL`×1)
- ✓ Criterios grep fases 6+8: 18/18 en verde (registro, fire-and-forget, `checkScc`, call-site `defaultAgentDir()`, HELP_TOOLS ×2, `toBe(8)`×2 sin residuos de 7, fila README, roadmap cerrado)
- ✓ V8 — motor intacto: `git diff --stat src/tools/frida-extensible-workflows/` vacío; `git diff --stat webview/` vacío
- ✓ Digests verificados en esta validación: los 8 sha256 de `SCC_DIGESTS` coinciden byte a byte con `checksums.txt` del release v4.0.0 (fetch real + comparación programática: 8/8 match)
- ✗ Baseline del repo: `npm test` — **inestable: falló 2 de 3 corridas** (run 1: 1 failed/2281 passed; run 2: **205 archivos · 2282 pasados · 19 skipped — todo verde, cifras exactas del plan**; run 3: 1 failed/2281 passed). El fallo recurrente es el mismo assert (ver Potential Issues); en aislamiento la suite del pack pasa consistentemente.

### Code Review Findings

#### Matches Plan

- `src/tools/frida-size-app/constants.ts` — pin deliberado SCC_PIN=4.0.0, matrix explícita de 8 assets con claves Node, digests reales (verificados contra el release), helpers de rutas; espejo estructural de codebase-index/constants.ts como pide el plan
- `src/tools/frida-size-app/installer.ts` — `ensureBinary` con orden sha→extraer→copiar→chmod→marker, `extractTarGz` con guard tar-slip, https-only con redirects https y límite 256 MiB, `SccInstallError` con guía accionable; deps inyectables para tests sin red
- `src/tools/frida-size-app/skills.ts` — 2 stages (analyze/judge), `SIZE_APP_PREAMBLE` con VETADO + JUEZ DE NÚMEROS fuera del mapa de stages (D11), prompts default es-MX
- `src/tools/frida-size-app/resolver.ts` — reuso de `createLayeredStageResolver` de frida-aidd, capas defaults → `.frida/size-app/stages.json` → `~/.frida/size-app/stages.json`
- `src/tools/frida-size-app/workflow.ts` (1232 líneas) — args+validación eager (wage requerido con instrucción `ask_user_question` y opciones MXN/USD embebidas; `Number.isInteger` sólo para maxMinutes), generador de 5 fases con todas las constantes interpoladas host-side, fence `SA_EOF`, scc por ruta absoluta, degradaciones `{familia, causa, hint}`, olas/SQALE/bus factor/COCOMO con fórmulas declaradas
- `src/tools/frida-size-app/index.ts` — patrón con `meta.moat`/`requiredTools`, sonda `detectSizeAppCapabilities`, factory con fire-and-forget gateado e idempotente; `src/pi-session.ts:700` registra la entrada junto a traffic2api con `agentDir` + getter
- `src/environment/doctor.ts` — `checkScc` como 8º check (sonda síncrona marker+existsSync, sin exec), `checkEnvironment` con `agentDir` inyectable; call-site productivo `src/extension.ts` pasa `defaultAgentDir()`
- Publicación completa: fila README (línea 215), docs par (267/231 líneas, esqueleto de los hermanos), roadmap M10 ✅ con pin v4.0.0, entrada HELP_TOOLS con 6 alias sin colisión (verificado contra las 32 entradas: first-match y label.includes)
- Smoke V1 (paso previo de la Fase 7): transcript real presente en `.rpiv/tmp/scc-smoke/transcript.txt` (582 líneas — contrato observado: FileJob shape, CSVs con header precedido de `# window:` que `csvBody` salta, `-a` con ULOC por lenguaje, DRYness sólo en texto plano, comportamiento fuera de git) — los canned del e2e derivan del contrato observado como manda el Ordering Constraint

#### Deviations from Plan

- `test/frida-size-app/e2e.test.ts:850-854` — el assert `seen.find((p) => p.includes("## Tu anexo"))` + `expect(...).toContain("Ruta EXACTA donde escribirlo: " + ANNEX_FILES[0])` está transcrito **verbatim del propio bloque de código de la Fase 7 del plan**, pero es sensible al orden de despacho del fanout de 3 agentes: el plan garantiza contenido, no orden. La implementación es fiel al plan; el defecto es del plan (criterio terminal "`npm test` completo en verde" intermitentemente inalcanzable con ese código). Fix trivial y localizado — ver Potential Issues.

#### Pattern Conformance

- ✓ `resolver.ts` replica 1:1 la forma del hermano `frida-traffic2api/resolver.ts` (imports de frida-aidd, `TEAM_OVERRIDES_PATH`, `userOverridesPath`, factory del núcleo)
- ✓ Entrada `extensionFactories` en pi-session con la misma forma que understand-app/traffic2api (`agentDir` + getter del toggle, sin toggle propio)
- ✓ `checkScc` sigue la forma de los checks hermanos del doctor (id/name/category/notes/installGuides); la sonda síncrona coincide con `CAPABILITIES.scc`
- ✓ `cocomo-domain.test.ts` importa `typebox` igual que el molde `openapi-schema.test.ts` de traffic2api (schema test-local + fixtures congeladas + anti-fixtures)
- ✓ Estructura de tests (HOME aislado a tmpdir, fixtures en disco, seam `ensureDeps` sin red, spawner mock por anclas) sigue los moldes M1/M8/M9 declarados
- Observación menor (aceptable, no desviación): el conteo de archivos de la corrida verde (`npm test`) difiere entre corridas del runner (213 descubiertos vs 205 ejecutados en la verde) por skips condicionales preexistentes — sin impacto

#### Potential Issues

- **BLOCKER — assert frágil en el e2e feliz** (`test/frida-size-app/e2e.test.ts:850-854`): `seen.find("## Tu anexo")` devuelve el prompt del escritor que el host despachó primero — con `parallel()` el orden de invocación de los 3 agentes del fanout no está garantizado bajo carga. Evidencia de esta validación: 3 corridas de `npm test` completo → 2 fallaron en `recorrido feliz` con el mismo `AssertionError`; en la corrida 3 el prompt recibido fue el de `deuda-modulos.md` (`+ Ruta EXACTA donde escribirlo: docs/dimensionamiento/analisis/deuda-modulos.md`) en lugar de `hotspots.md` (`ANNEX_FILES[0]`). En aislamiento (`npx vitest run test/frida-size-app/`) el archivo pasa consistentemente — el flip sólo ocurre bajo la carga paralela del suite completo. El criterio terminal de la Fase 8 ("`npm test` completo en verde") no es confiable tal como está. Fix sugerido (localizado, 1 línea): anclar el find al anexo objetivo — `seen.find((p) => p.includes("Ruta EXACTA donde escribirlo: " + ANNEX_FILES[0]))` (los asserts de contenido del prompt — metrics.json, preamble — ya son orden-independientes), o iterar sobre todos los prompts de escritor.

### Manual Testing Required

1. **Piloto OFBiz (V10)** — pendiente: corrida del patrón sobre clone fresco y dejar los números de evidencia (KLOC efectivos, CCN p50/p90/p99, top churn/hotspots, COCOMO±rango con costo) como comentario en el issue #139.
2. **Corrida interactiva en repo real** — pendiente: ejercicio end-to-end del Desired End State (pregunta de presupuesto pre-launch → entregables en `docs/dimensionamiento/` → checkpoint con `review=manual`).
3. **Doctor UI** — verificar "Verificar entorno" en la UI lista 8 checks incluido scc con la guía accionable (la parte determinista — `checkScc` + reporte de 8 deps — ya está cubierta por tests).

Verificados durante esta validación (ya no requieren ejercicio manual): digests 8/8 contra el release real, doc de `extractTarGz`, smoke V1 con transcript, alias HELP_TOOLS sin colisiones, fila README + roadmap M10 ✅, motor y webview intactos, mocks bash `bash -n` (cubierto por los e2e en verde).

### Recommendations

- Corregir el assert orden-dependiente de `e2e.test.ts:850-854` (fix de 1 línea descrito arriba) y re-corrobar con al menos 2 corridas de `npm test` — es la única brecha; todo lo demás está en verde.
- Re-ejecutar `/skill:validate` tras el fix para un reporte fresco (debería salir `pass`).
- No commitar hasta que el baseline sea estable — el bloqueo b1 lo impide.
