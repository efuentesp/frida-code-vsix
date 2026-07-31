---
name: resume-handoff
description: Reanuda el trabajo desde un documento de handoff producido por create-handoff. Lee el handoff, verifica el repo/branch/estado actuales, y continúa desde donde la sesión anterior quedó. Úsalo al iniciar una sesión nueva cuando el usuario referencie un handoff, diga "reanudar desde handoff", "continuar donde lo dejamos", o invoque /resume-handoff.
argument-hint: "[handoff-path]"
shell-timeout: 10
contract:
  produces:
    kind: side-effect
    meta:
      effect: work-continuation
  consumes:
    meta:
      artifactKind: handoff
---

# Resume Handoff

Reanuda trabajo desde un handoff.

## Flujo

1. Leer handoff → 2. Verificar estado → 3. Continuar

## Pasos

### Paso 1: Leer handoff

Lee el handoff (`.frida/artifacts/handoffs/*.md`) completo. Extrae: tarea, decisiones, cambios en vuelo, próximos pasos.

### Paso 2: Verificar estado

Verifica que el estado del repo coincide con el handoff:

- **Branch**: ¿sigue en el mismo branch? (`git branch --show-current`)
- **Commit**: ¿el commit base coincide?
- **Cambios en vuelo**: ¿los archivos modificados siguen ahí? (`git status`)

Si el estado no coincide (branch cambió, archivos se perdieron), advierte al usuario.

### Paso 3: Continuar

Resume la tarea desde donde quedó:

- Lee los artefactos referenciados en el handoff.
- Continúa con los próximos pasos listados.
- Si hay cambios sin commit, verifícalos antes de continuar.

```
Handoff reanudado: <topic>
Branch: <branch> ✅
Cambios en vuelo: <N> archivos

Próximo paso: <descripción del handoff>
```
