---
name: changelog
description: Regenera la sección [Unreleased] de cada CHANGELOG.md afectado en estilo Keep a Changelog. Lee commits desde el último tag de release más cambios sin commit o stagados, los clasifica por prefijo Conventional Commit, y reescribe cada bloque [Unreleased]. Funciona en repos mono-paquete y monorepos (un CHANGELOG.md por paquete). Idempotente — seguro re-correr conforme aterriza trabajo.
argument-hint: "[--since <ref>]"
allowed-tools: Bash(git *), Read, Edit
shell-timeout: 10
contract:
  produces:
    kind: side-effect
    meta:
      effect: changelog-edit
  consumes:
    meta:
      world: git-history
---

# Changelog

Regenera [Unreleased] en CHANGELOG.md basado en commits Conventional Commit.

## Metadatos

```!
node "${SKILL_DIR}/../_shared/now.mjs"
echo
node "${SKILL_DIR}/../_shared/git-context.mjs"
```

## Flujo

1. Determinar rango de commits → 2. Clasificar → 3. Reescribir [Unreleased] → 4. Reportar

## Pasos

### Paso 1: Determinar rango de commits

- **Sin --since**: usa `git describe --tags --abbrev=0` para el último tag.
- **Con --since <ref>**: usa ese ref como base.
- Lee commits desde el base hasta HEAD: `git log <base>..HEAD --oneline`.
- Incluye cambios sin commit: `git status --short`.

### Paso 2: Clasificar

Clasifica cada commit por prefijo Conventional Commit:

- `feat:` → **Added**
- `fix:` → **Fixed**
- `refactor:` → **Changed**
- `docs:` → **Documentation**
- `test:` → **Tests**
- `chore:`, `ci:`, `build:` → **Internal**

### Paso 3: Reescribir [Unreleased]

Lee cada `CHANGELOG.md`. Reescribe la sección `[Unreleased]`:

```markdown
## [Unreleased]

### Added
- <descripción del feat>

### Fixed
- <descripción del fix>

### Changed
- <descripción del refactor>
```

Si no existe `CHANGELOG.md`, créalo con el header estándar Keep a Changelog.

En monorepos: procesa cada `CHANGELOG.md` por separado (uno por paquete).

### Paso 4: Reportar

```
Changelog regenerado:
- CHANGELOG.md: {N} entradas añadidas
- packages/foo/CHANGELOG.md: {M} entradas añadidas
```

## Notas

- **Idempotente**: re-correr produce el mismo resultado.
- **Conventional Commits**: requiere commits con prefijos `feat:`/`fix:`/etc.
- **Monorepo**: un CHANGELOG.md por paquete.
