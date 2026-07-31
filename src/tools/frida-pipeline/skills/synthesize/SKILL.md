---
name: synthesize
description: Fusiona N diseños por-slice independientes (más el research en que se apoyan) en UN plan fase-por-fase coherente en .frida/artifacts/plans/ — reconciliando overlaps cross-slice, cableando integración inter-slice, y ordenando fases por dependencias de slice. Pasada única, sin subagentes, sin self-review. La barrera fan-in de un flujo fanout-and-synthesize.
argument-hint: "--designs <path>... [--research <path>] [--as-subplan] [--cluster <k>]  |  --subplans <path>... [--research <path>]"
allowed-tools: Read, Grep, Glob, Write
shell-timeout: 10
disable-model-invocation: true
contract:
  produces:
    kind: produces
    meta:
      artifactKind: plan
    data:
      type: object
      required: [phases, phase_count]
      properties:
        status:
          enum: [in-progress, in-review, ready]
        phase_count:
          type: integer
          minimum: 1
          maximum: 32
        phases:
          type: array
          minItems: 1
---

# Synthesize

Fusiona diseños por-slice en un plan fase-por-fase coherente. La barrera fan-in del flujo fanout-and-synthesize.

## Flujo

1. Leer todos los diseños → 2. Reconciliar overlaps → 3. Ordenar fases → 4. Escribir plan

## Pasos

### Paso 1: Leer diseños

Lee TODOS los artefactos de diseño por-slice. Si hay research, léelo para contexto.

### Paso 2: Reconciliar overlaps

- Identifica archivos tocados por múltiples slices.
- Reconcilia interfaces: si dos slices definen la misma, unifica.
- Cablea integración inter-slice: cómo se conectan las fases.

### Paso 3: Ordenar fases

Ordena los slices como fases por dependencia:

1. Una fase por slice (slice → fase).
2. Ordena por dependencia: la fase A antes de la B si B depende de A.
3. Asigna `### Phase N: <title>` a cada fase.

### Paso 4: Escribir plan

Filename: `.frida/artifacts/plans/<slug>_<topic>.md`. Frontmatter `status: ready`, `phase_count: N`.

Estructura del plan:
- **Phases**: array de fases, cada una con título, archivos, interfaces, success criteria.
- **Success Criteria**: por fase, condiciones observables.

```
Plan sintetizado:
`.frida/artifacts/plans/<slug>_<topic>.md`

{N} fases, dependencias reconciliadas.

**Siguiente paso:** /skill:elaborate (fanout por fase) o /skill:implement
```

## Notas

- **Una fase por slice**: el mapeo es 1:1.
- **Sin subagentes**: pasada única de pura lógica.
- **Plan-compatible**: implement/validate lo consumen sin cambios.
