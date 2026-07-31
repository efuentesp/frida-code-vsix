---
name: design-review
description: Un checkpoint consolidado del desarrollador sobre CADA diseño por-slice que un fanout produjo — presenta la forma propuesta (enfoque, tipos, interfaces, mapa de archivos, scope) como un resumen cross-slice compacto y deja al desarrollador aceptar o ajustar via ask_user_question, luego aplica ajustes quirúrgicos in-place antes de la síntesis. Pasada fan-in única.
argument-hint: "--designs <design-path> [--designs <design-path> ...] --slices <slices-path>"
allowed-tools: Read, Edit, Write, Grep, Glob
shell-timeout: 10
disable-model-invocation: true
contract:
  produces:
    kind: produces
---

# Design Review

Checkpoint del desarrollador sobre los diseños por-slice. Unidad de fan-in — no standalone.

## Flujo

1. Leer todos los diseños por-slice → 2. Resumen cross-slice → 3. Aceptar/ajustar → 4. Aplicar ajustes

## Pasos

### Paso 1: Leer diseños

Lee TODOS los artefactos de diseño por-slice. Extrae: enfoque, tipos, interfaces, mapa de archivos, scope.

### Paso 2: Resumen cross-slice

Presenta un resumen compacto: qué propone cada slice, dónde se solapan, dónde hay gaps.

### Paso 3: Aceptar/ajustar

Via `ask_user_question`, pregunta al desarrollador si acepta el diseño o quiere ajustar. Si ajusta, identifica qué slices se ven afectados.

### Paso 4: Aplicar ajustes

Edita los diseños por-slice in-place para reflejar los ajustes. Propaga contracts cambiados a slices dependientes (cascada).

## Notas

- **Una pasada**: el loop aceptar↔ajustar vive dentro de la skill.
- **Cascada**: un contract cambiado se propaga a slices dependientes.
- **Sin re-diseñar**: sólo ajustes quirúrgicos, no rediseño completo.
