---
name: design-slice
description: Diseña UN slice vertical del mapa de slices en aislamiento — sus decisiones arquitectónicas, mapa de archivos, interfaces clave, puntos de integración y criterios de éxito — y escribe un doc de diseño por-slice en .frida/artifacts/designs/. Pasada única, sin subagentes, sin self-review. Despachado una vez por slice por un fanout de design.
argument-hint: "<slices-path> Slice N: <title> [--upstream <design-path>]"
allowed-tools: Read, Grep, Glob, Write
shell-timeout: 10
disable-model-invocation: true
contract:
  produces:
    kind: produces
    meta:
      artifactKind: design
    data:
      type: object
      properties:
        status:
          enum: [in-progress, in-review, ready]
  consumes:
    meta:
      artifactKind: [slices, design]
---

# Design Slice

Diseña un slice vertical individual. Unidad de fanout — no standalone.

## Flujo

1. Leer mapa de slices + diseño upstream → 2. Diseñar el slice → 3. Escribir doc por-slice

## Pasos

### Paso 1: Contexto

Lee el mapa de slices y el diseño upstream. Identifica qué slice diseñas (número + título).

### Paso 2: Diseñar el slice

- **Decisiones arquitectónicas**: patrones, estructuras de datos, algoritmos.
- **Mapa de archivos**: archivos que crea/modifica este slice.
- **Interfaces clave**: firmas de funciones, tipos, contracts.
- **Puntos de integración**: cómo se conecta con slices anteriores/posteriores.
- **Criterios de éxito**: condiciones observables y testeables.

Pregunta al usuario SÓLO cuando un fork de diseño genuino bloquea el slice.

### Paso 3: Escribir doc

Filename: `.frida/artifacts/designs/<slug>_slice-N-<topic>.md`. Frontmatter `status: ready`.

## Notas

- **Pasada única**: sin iteración, sin subagentes.
- **Aislamiento**: no diseñas otros slices.
- **Integration points**: declara explícitamente cómo se conecta con otros slices.
