---
name: elaborate
description: Escribe código implement-ready en UNA fase de un plan sintetizado — lee el plan completo más el código real que la fase toca, luego emite un reemplazo con código para esa sección `## Phase N:` hacia .frida/artifacts/elaborations/. Pasada única, sin subagentes, sin self-review, sin preguntas. Despachado una vez por fase por un fanout elaborate después de synthesize.
argument-hint: "<plan-path> Phase N: <title>"
allowed-tools: Read, Edit, Write, Grep, Glob, Bash
shell-timeout: 10
disable-model-invocation: true
contract:
  produces:
    kind: produces
    meta:
      artifactKind: elaboration
    data:
      type: object
      properties:
        status:
          enum: [in-progress, in-review, ready]
  consumes:
    meta:
      artifactKind: [plan]
---

# Elaborate

Escribe código implement-ready para una fase del plan. Unidad de fanout — no standalone.

## Flujo

1. Leer plan + código real → 2. Elaborar la fase → 3. Escribir elaboración

## Pasos

### Paso 1: Contexto

Lee el plan completo (`.frida/artifacts/plans/*.md`). Identifica qué fase elaboras (número + título). Lee los archivos fuente reales que la fase toca — enteros, sin limit.

### Paso 2: Elaborar la fase

Escribe código concreto para la fase:

- **Snippets de código**: el código real que se escribirá en cada archivo.
- **Ediciones exactas**: para archivos existentes, qué líneas cambiar.
- **Imports**: qué imports añadir.
- **Tests**: qué tests escribir para esta fase.

El código debe ser implement-ready: el agente que ejecute implement sólo copia/pega.

### Paso 3: Escribir elaboración

Filename: `.frida/artifacts/elaborations/<slug>_phase-N-<topic>.md`. Frontmatter `status: ready`.

La elaboración contiene:
- Header con el número de fase y título.
- Sección `## Phase N:` con el código completo.
- Bloques de código con lenguaje correcto.

## Notas

- **Pasada única**: sin iteración, sin subagentes.
- **Código real**: no pseudocódigo — código que compila.
- **La skill stitch-elaborations** (script determinístico) fusiona las elaboraciones de vuelta al plan.
