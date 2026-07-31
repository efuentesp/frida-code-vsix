---
name: slice
description: Descompone un artefacto de research en slices verticales independientes — cada uno autocontenido y diseñable por separado — y escribe un mapa de slices en .frida/artifacts/slices/ con un array `slices:` legible por máquina. Requiere un artefacto de research (es el fundamento del corte). También corre en modo RE-SLICE para re-cortar estructuralmente un mapa que falló el gate de design-readiness.
argument-hint: "<research-path>  |  --slices <map> --slice-verdicts <verdict>..."
shell-timeout: 10
disable-model-invocation: true
contract:
  produces:
    kind: produces
    meta:
      artifactKind: slices
    data:
      type: object
      required: [slices, slice_count]
      properties:
        status:
          enum: [in-progress, in-review, ready]
        slice_count:
          type: integer
          minimum: 1
          maximum: 32
        slices:
          type: array
          minItems: 1
          maxItems: 32
---

# Slice

Descompone research en slices verticales independientes. Alimenta un fanout de design por-slice.

## Metadatos

```!
node "${SKILL_DIR}/../_shared/now.mjs"
echo
node "${SKILL_DIR}/../_shared/git-context.mjs"
```

## Flujo

1. Leer research → 2. Identificar slices verticales → 3. Confirmar → 4. Escribir mapa

## Pasos

### Paso 1: Leer research

Lee el artefacto de research completo. Extrae: arquitectura observada, riesgos, áreas de cambio.

### Paso 2: Identificar slices verticales

Cada slice es:

- **Vertical**: cruza todas las capas necesarias (no horizontal).
- **Independiente**: diseñable e implementable por separado.
- **Autocontenido**: no requiere otro slice para tener sentido.

Identifica 2-8 slices en orden de dependencia. Por cada slice: id, título, descripción breve, dependencias.

### Paso 3: Confirmar

Presenta los slices al desarrollador via `ask_user_question`. Confirma el corte antes de escribir.

### Paso 4: Escribir mapa

Filename: `.frida/artifacts/slices/<slug>_<topic>.md`. Frontmatter `status: ready`, `slice_count: N`.

El frontmatter incluye un array `slices:` legible por máquina:
```yaml
slices:
  - id: slice-1
    title: "<título>"
    brief: "<descripción>"
    depends_on: []
  - id: slice-2
    title: "<título>"
    brief: "<descripción>"
    depends_on: [slice-1]
```

## Notas

- **Requiere research**: el research es el fundamento del corte.
- **Slices verticales**: no cortes por capa horizontal.
- **Modo RE-SLICE**: si un mapa falló design-readiness, re-corta estructuralmente.
