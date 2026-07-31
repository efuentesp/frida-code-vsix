---
name: migrate-to-guidance
description: Migra los archivos CLAUDE.md inline de un proyecto al sistema de shadow tree .frida/guidance/. Encuentra cada CLAUDE.md, transforma referencias internas, y crea archivos architecture.md equivalentes bajo .frida/guidance/. Úsalo cuando el usuario quiera moverse de CLAUDE.md inline al shadow tree de guidance.
argument-hint: "[--delete-originals]"
allowed-tools: Bash, Read, Glob
contract:
  produces:
    kind: side-effect
    meta:
      effect: guidance-migration
  consumes:
    meta:
      world: claude-md-tree
---

# Migrate to Guidance

Migra CLAUDE.md inline a `.frida/guidance/` shadow tree.

## Flujo

1. Encontrar CLAUDE.md → 2. Transformar → 3. Crear architecture.md → 4. (Opcional) borrar originales

## Pasos

### Paso 1: Encontrar CLAUDE.md

Usa `find . -name CLAUDE.md` para localizar todos los archivos CLAUDE.md del proyecto.

### Paso 2: Transformar

Por cada CLAUDE.md:

1. Lee el contenido.
2. Transforma referencias internas (paths relativos a otros CLAUDE.md → paths al shadow tree).
3. Mapea la ruta: `<dir>/CLAUDE.md` → `.frida/guidance/<dir>/architecture.md`.

### Paso 3: Crear architecture.md

Escribe cada archivo transformado bajo `.frida/guidance/<dir>/architecture.md`.

### Paso 4: Borrar originales (opcional)

Si `--delete-originals` se especifica, borra los CLAUDE.md originales después de verificar que la migración fue exitosa.

## Notas

- **Idempotente**: re-corre sin duplicar.
- **Transformación de referencias**: los paths internos se ajustan al shadow tree.
- **Sin --delete-originals**: los CLAUDE.md quedan (el usuario puede borrarlos manualmente).
