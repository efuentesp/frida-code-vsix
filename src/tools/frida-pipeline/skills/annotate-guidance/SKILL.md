---
name: annotate-guidance
description: Genera archivos architecture.md de guidance bajo .frida/guidance/ que documentan la arquitectura y patrones de un proyecto para asistentes de IA, escritos en un shadow tree junto al código fuente. Úsalo cuando el usuario quiera onboardear a un agente de IA al codebase via el sistema de guidance, documentar arquitectura, o pida "anotar guidance".
argument-hint: "[directorio objetivo]"
allowed-tools: Agent, Read, Write, Glob, Grep
contract:
  produces:
    kind: side-effect
    meta:
      effect: guidance-generation
  consumes:
    meta:
      world: source-tree
---

# Annotate Guidance

Genera archivos `architecture.md` bajo `.frida/guidance/` que documentan arquitectura para asistentes de IA.

## Flujo

1. Escanear código → 2. Por cada directorio: generar architecture.md → 3. Escribir shadow tree

## Pasos

### Paso 1: Escanear código

Despaca `codebase-locator` y `codebase-analyzer` para entender la estructura del proyecto:

- Directorios principales y sus responsabilidades.
- Patrones de imports y dependencias.
- Contratos públicos (interfaces, tipos, exports).

### Paso 2: Generar architecture.md

Por cada directorio significativo, genera un `.frida/guidance/<sub>/architecture.md`:

- **Propósito**: qué hace este directorio.
- **Estructura**: archivos clave y sus roles.
- **Patrones**: convenciones que un agente debe seguir.
- **Dependencias**: qué importa y quién lo importa.
- **Invariantes**: reglas que no deben romperse.

### Paso 3: Escribir shadow tree

Escribe los archivos bajo `.frida/guidance/` (no inline junto al código). El hook de guidance de frida-pipeline los inyecta automáticamente cuando un agente toca archivos en ese subdirectorio.

## Notas

- **Shadow tree**: los archivos van en `.frida/guidance/`, no junto al código.
- **Automáticamente inyectados**: frida-pipeline guidance.ts los carga en tool_call.
- **Preferir sobre annotate-inline** cuando el proyecto usa `.frida/guidance/`.
