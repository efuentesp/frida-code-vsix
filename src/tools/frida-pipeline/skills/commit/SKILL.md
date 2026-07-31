---
name: commit
description: Crea commits de git estructurados analizando cambios stagados y no-stagados y agrupándolos lógicamente en uno o más commits con mensajes claros y descriptivos. Úsala cuando el usuario pida commit, diga "commit esto", quiera ayuda escribiendo un mensaje de commit, o haya terminado un bloque de trabajo que necesita commit.
argument-hint: "[message] [--baseline <path>]"
allowed-tools: Bash(git *), Bash(node *), Read, Glob, Grep
shell-timeout: 10
contract:
  produces:
    kind: side-effect
    meta:
      effect: git-commit
  consumes:
    meta:
      world: dirty-tree
---

# Commit

Crea commits de git estructurados. Agrupa cambios lógicamente con mensajes descriptivos.

## Metadatos

```!
node "${SKILL_DIR}/../_shared/now.mjs"
echo
node "${SKILL_DIR}/../_shared/git-context.mjs"
echo "---"
node "${SKILL_DIR}/../_shared/git-changes.mjs"
```

## Flujo

1. Analizar cambios → 2. Agrupar lógicamente → 3. Crear commit(s) → 4. Reportar

## Pasos

### Paso 1: Analizar cambios

Lee el snapshot de cambios del bloque Metadatos arriba:

- `---status---`: archivos modificados (stagados y no-stagados).
- `---staged---`: diff stat de cambios stagados.
- `---unstaged---`: diff stat de cambios no-stagados.

Si no hay cambios, informa al usuario y termina.

### Paso 2: Agrupar lógicamente

Agrupa los archivos en 1-N commits lógicos:

- **Un commit** si todos los cambios son coherentes (una feature, un fix).
- **Múltiples commits** si hay grupos independientes (ej. feature + refactor + docs).

Por cada grupo:
- Lee los diffs para entender qué cambió.
- Genera un mensaje de commit estructurado (Conventional Commits o el formato del repo).

### Paso 3: Crear commit(s)

Por cada grupo:

1. `git add <archivos del grupo>` (sólo los de este commit).
2. `git commit -m "<mensaje>"`.

Si el usuario proporcionó un mensaje (`$ARGUMENTS`), úsalo para el primer commit.

### Paso 4: Reportar

```
{N} commit(s) creado(s):
  abc1234 — feat: <mensaje>
  def5678 — refactor: <mensaje>

Working tree: clean (o "X archivos sin stagar")
```

## Notas

- **Conventional Commits**: usa el formato del repo (feat:, fix:, refactor:, docs:, etc.).
- **Un commit por unidad lógica**: no mezcles features con refactor.
- **Mensaje descriptivo**: el mensaje debe explicar QUÉ y POR QUÉ, no sólo QUÉ.
- **Si hay artefactos .frida/**: inclúyelos en el commit si son parte del cambio.
- **No hagas push**: el push es decisión del usuario.
