---
name: annotate-inline
description: Genera archivos CLAUDE.md colocados inline junto al código fuente a lo largo de un proyecto, documentando arquitectura y patrones para asistentes de IA. Úsalo cuando el usuario quiera onboardear a un agente via archivos CLAUDE.md inline, generar guidance por-directorio, o documentar arquitectura in-place.
argument-hint: "[directorio objetivo]"
allowed-tools: Agent, Read, Write, Glob, Grep
contract:
  produces:
    kind: side-effect
    meta:
      effect: inline-annotation
  consumes:
    meta:
      world: source-tree
---

# Annotate Inline

Genera archivos `CLAUDE.md` inline junto al código fuente.

## Flujo

1. Escanear código → 2. Por cada directorio: generar CLAUDE.md → 3. Escribir inline

## Pasos

### Paso 1: Escanear código

Despacha `codebase-locator` y `codebase-analyzer` para entender la estructura.

### Paso 2: Generar CLAUDE.md

Por cada directorio significativo, genera un `CLAUDE.md`:

- **Propósito**: qué hace este directorio.
- **Patrones**: convenciones a seguir.
- **Reglas críticas**: lo que NO se debe hacer.
- **Dependencias clave**: imports importantes.

### Paso 3: Escribir inline

Escribe cada `CLAUDE.md` directamente en el directorio correspondiente (no en un shadow tree).

## Notas

- **Inline**: los archivos van junto al código, no en `.frida/guidance/`.
- **Pi los carga automáticamente**: `loadContextFileFromDir` lee `<dir>/CLAUDE.md`.
- **Preferir sobre annotate-guidance** cuando CLAUDE.md debe vivir junto al código.
