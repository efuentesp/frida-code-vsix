# How-to: TEA — QA dirigido por riesgo (frida-tea)

> Normalmente pedir pruebas es improvisar: "escríbeme tests de esto" produce
> cobertura genérica, sin criterio de riesgo ni evidencia de que lo crítico
> quedó probado. **TEA** (Test Engineering Architect, adaptado de BMAD MIT)
> convierte eso en metodología: primero *qué* verificar y a qué profundidad,
> después los tests, y al final una decisión formal de release.

Guía de uso — la referencia técnica vive en
[docs/tools/frida-tea.md](tools/frida-tea.md).

## El modelo en 30 segundos

1. **El esfuerzo sigue al riesgo**: clasifica P0-P3, decide profundidad por
   nivel (P0 profundo, P3 ni se automatiza) y dice explícitamente qué NO se
   prueba y por qué.
2. **Evidencia, no claims**: cada workflow termina con un **gate** que lee
   los artefactos y devuelve `PASS / CONCERNS / FAIL / WAIVED` con findings
   de severidad fija.
3. **Auditar también**: TEA revisa suites *existentes* con criterios
   objetivos (flakiness, aserciones tautológicas, estado compartido) — no
   sólo genera tests nuevos.

## Cuándo usarlo (y cuándo no)

**Sí**: proyecto con funcionalidad crítica (pagos, auth, datos), antes de un
release importante, cuando la suite creció sin criterio y nadie confía en
ella, o al arrancar un repo desde cero (framework + estrategia).

**No**: scripts desechables, prototipos, o si sólo necesitas un test puntual
— eso lo pides directo a la sesión, sin workflow.

## Flujo típico (los 9 workflows en orden)

```text
1. tea-test-design   → plan de riesgo (docs/tea/test-design.md)
2. tea-framework     → framework montado con ejemplo verificable
3. tea-automate      → tests ejecutables por target (P0 primero)
4. tea-ci            → pipeline CI con quality gates
5. tea-atdd          → escenarios aprobados + fase roja
6. tea-nfr           → auditoría de evidencia no funcional
7. tea-trace         → matriz de trazabilidad + coverage gate
8. tea-test-review   → auditoría de calidad de la suite
9. tea-teach         → academia de testing en tu repo
```

## Recetas

### Diseñar la estrategia de un epic

```text
/wf tea-test-design subject="epic de checkout con pagos"
```

Murat escribe el plan (registro de riesgo, estrategia por nivel, qué queda
fuera y por qué, criterios de entrada/salida, trazabilidad) y el gate lo
audita antes de mostrártelo. Revisa `docs/tea/test-design.md`, ajusta lo que
haga falta (puedes editar el archivo antes de aprobar el checkpoint).

### Montar el framework de pruebas

```text
/wf tea-framework
/wf tea-framework preference=playwright typescript=true
```

Survey del stack real (lee package.json/go.mod/…) → config + estructura +
**un ejemplo que el agente corre y deja en verde** (o reporta el bloqueo
exacto) → gate. Sin `preference`, elige por ti.

### Automatizar el plan

```text
/wf tea-automate
/wf tea-automate targets="T2,T4" maxTargets=2
```

Extrae los targets del plan (`docs/tea/test-design.md` por defecto),
ordena por riesgo P0→P3, corre un agente por target que escribe el test al
nivel asignado **y lo ejecuta** (`green`/`blocked`), y el gate verifica
archivos contra claims. Cap por defecto: 5 targets (1-8).

### Auditar tu suite existente

```text
/wf tea-test-review scope="test/"
```

Descubre los archivos, calcula la **baseline de convenciones** del repo
(established/emerging/absent — una convención ausente no genera hallazgos),
revisa cada archivo con el registro de criterios de severidad fija y
agrega: score 0-100, hallazgos por severidad con evidencia y fix, manifiesto
de archivos unscorable. Reporte en `docs/tea/test-review.md`.

**Nota**: la *evaluación de cobertura* (qué requisito no tiene test) es otro
workflow (`tea-trace`) — test-review audita *calidad*, no cobertura.

### Configurar el pipeline CI

```text
/wf tea-ci
/wf tea-ci platform=gitlab-ci
```

Survey del repo (plataforma, comando de test **real**, package manager,
node) → pipeline con quality gates (falla si fallan los tests; sin soft
skips; sin jobs de tools que no tienes) → el agente **verifica corriendo
los comandos localmente** antes de entregarte el archivo → gate. Reporte del
bloqueo exacto si algo no puede correr.

### Trabajar ATDD una feature

```text
/wf tea-atdd feature="login con 2FA"
/wf tea-atdd feature="búsqueda con filtros" level=component
```

Dos pasos: escenarios Given/When/Then anclados al código real (taggeados
`[ASSUMPTION]` lo no verificable) → **checkpoint de contrato** — los editas
o apruebas; SON el contrato — → fase roja: tests de aceptación que fallan
**por la razón correcta** (`red` es el estado exitoso de ATDD; `green`
indica que la feature ya existe; `blocked` nombra el bloqueo exacto) más un
checklist de implementación en `docs/tea/atdd-checklist.md`. Nunca
implementa la feature.

### Auditar evidencia NFR antes de release

```text
/wf tea-nfr
/wf tea-nfr subject="checkout" categories="performance,security"
```

Un auditor por categoría (performance/security/reliability/maintainability,
o las que pidas) busca **evidencia citable** — tests, scans, métricas,
CI — no promesas. `NO_EVIDENCE` es una respuesta válida y honesta. Gate
**determinista**: algún FAIL → FAIL; algún CONCERNS/NO_EVIDENCE → CONCERNS.
Reporte en `docs/tea/nfr-assessment.md`.

### Generar la matriz de trazabilidad

```text
/wf tea-trace
/wf tea-trace requirements=docs/aidd/planning/prd.md scope="tests/" gate=release
```

Extrae los requisitos (del doc que apuntes, o **sintetizados desde el
código** si no hay doc) → mapea cada uno a los tests que de verdad lo
verifican → coverage por prioridad y nivel → **gate determinista**: P0 sin
cobertura → FAIL, P1 → CONCERNS. Matriz en `docs/tea/traceability-matrix.md`
con los huecos visibles.

### Montar una academia de testing

```text
/wf tea-teach
/wf tea-teach modules="risk,flakiness" topic="para QA juniors"
```

Escribe lecciones EN tu repo (`docs/tea/academy/`), una por módulo — riesgo,
niveles, flakiness, gates, ATDD — con ejemplos de TU código real,
anti-patrones, ejercicios verificables con respuestas y auto-evaluación.
Índice con orden sugerido en `academy/README.md`.

## Customizar los prompts (3 capas)

Igual que frida-aidd: `skills.ts` (defaults) → `.frida/tea/stages.json`
(equipo, en el repo) → `~/.frida/tea/stages.json` (usuario).

```json
{ "stages": { "test-review": "nuestro registro de criterios interno..." } }
```

Stages: `test-design`, `framework`, `automate`, `test-review`, `ci`, `nfr`,
`trace`, `atdd`, `teach`, `gate`. Un override es el prompt completo del
stage; JSON inválido aborta antes de correr nada.

## Los checkpoints y `review: "auto"`

Por defecto (`review: "manual"`) cada workflow se detiene al final con la
decisión del gate para que apruebes. En corridas desatendidas:

```text
/wf tea-automate review=auto
```

corre sin pausas — el resultado del gate queda en el retorno del workflow.

## Límites honestos

- Los gates de test-design/framework/automate/ci son un agente LLM que
  **lee artefactos reales**, no un verificador formal — su valor es la
  disciplina (severidades fijas, evidencia citada), no la infalibilidad.
  Los de nfr/trace/test-review **sí son deterministas** (reglas sobre el
  JSON agregado).
- `tea-framework`/`tea-ci` no instalan nada por ti: escriben config y
  tests, los corren con el shell del sandbox; si falta una dependencia, el
  setup reporta `blocked` con el comando exacto para resolverla.
- `tea-trace` con oráculo sintético: los requisitos inferidos del código son
  una hipótesis — si tienes PRD, apúntalo en `requirements`.
- Los *execution targets* (Playwright, Pact, …) los elige tu repo — TEA
  recomienda según el stack que encuentra; no agrega deps al agente.
