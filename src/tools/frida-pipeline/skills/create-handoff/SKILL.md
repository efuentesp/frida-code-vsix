---
name: create-handoff
description: Crea un documento de handoff que preserva contexto para transiciones de sesión, compactando la tarea actual, decisiones tomadas, cambios en vuelo y preguntas abiertas en un archivo conciso para que una sesión nueva pueda continuar donde ésta quedó. Úsalo cuando el usuario invoque /create-handoff, diga que el contexto está creciendo, quiera cerrar la sesión, o quiera entregar el trabajo a otra sesión.
argument-hint: "[descripción]"
allowed-tools: Read, Write, Bash(git *), Glob, Grep
shell-timeout: 10
contract:
  produces:
    kind: produces
    meta:
      artifactKind: handoff
    data:
      type: object
      required: [topic, status]
      properties:
        topic:
          type: string
        status:
          enum: [in-progress, ready]
---

# Create Handoff

Crea un documento de handoff para transición de sesión.

## Metadatos

```!
node "${SKILL_DIR}/../_shared/now.mjs"
echo
node "${SKILL_DIR}/../_shared/git-context.mjs"
```

## Flujo

1. Recopilar contexto → 2. Compactar → 3. Escribir handoff

## Pasos

### Paso 1: Recopilar contexto

Recopila de la sesión actual:

- **Tarea actual**: qué se estaba haciendo.
- **Decisiones tomadas**: qué se decidió y por qué.
- **Cambios en vuelo**: archivos modificados sin commit (`git status`, `git diff`).
- **Preguntas abiertas**: qué falta por resolver.
- **Artefactos producidos**: paths a `.frida/artifacts/`.

### Paso 2: Compactar

Sintetiza en un documento conciso:

- **Topic**: descripción de una línea.
- **Estado actual**: qué funciona, qué no.
- **Próximos pasos**: qué hacer al reanudar.
- **Comandos**: cómo reanudar (ej. `/skill:resume-handoff <path>`).

### Paso 3: Escribir

Filename: `.frida/artifacts/handoffs/<slug>_<topic>.md`. Frontmatter `status: ready`.

```
Handoff creado:
`.frida/artifacts/handoffs/<slug>_<topic>.md`

Para reanudar en una sesión nueva: /skill:resume-handoff .frida/artifacts/handoffs/<slug>_<topic>.md
```
