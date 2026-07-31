---
name: implement
description: Ejecuta un plan de implementación aprobado de .frida/artifacts/plans/ fase por fase, aplicando cambios y verificando cada fase contra sus criterios de éxito antes de continuar. Úsala cuando el usuario invoque /implement, pida "implementar este plan", o quiera ejecutar un plan fase-por-fase existente.
argument-hint: "[plan-path] [Phase N]"
allowed-tools: Read, Edit, Write, Bash(*), Glob, Grep
shell-timeout: 10
disable-model-invocation: true
contract:
  produces:
    kind: side-effect
    meta:
      effect: code-mutation
  consumes:
    reads:
      plans:
        meta:
          artifactKind: plan
---

# Implement

Ejecuta un plan fase por fase. Aplica cambios al código fuente y verifica cada fase.

## Metadatos

```!
node "${SKILL_DIR}/../_shared/now.mjs"
echo
node "${SKILL_DIR}/../_shared/git-context.mjs"
```

## Flujo

1. Leer plan → 2. Por cada fase: aplicar → verificar → continuar → 3. Reportar

## Pasos

### Paso 1: Leer plan

Lee el plan (`.frida/artifacts/plans/*.md`) completo. Si se especifica `Phase N`, comienza desde esa fase.

### Paso 2: Ejecutar fase por fase

Por cada fase del plan, en orden:

1. **Leer la fase**: archivos a crear/modificar, código, success criteria.
2. **Aplicar cambios**: usa Write para archivos nuevos, Edit para modificaciones.
3. **Verificar**: corre los success criteria de la fase (comandos, tests, comportamientos).
4. **¿Pasó?**: si sí, continúa a la siguiente fase. Si no, pausa y pregunta al usuario:
   - "Seguir el plan" / "Saltar este cambio" / "Actualizar el plan"

Si una fase tiene una elaboración (`.frida/artifacts/elaborations/`), úsala como guía de código.

### Paso 3: Reportar

```
Implementación completada:
{N} fases aplicadas, {M} archivos modificados.

**Siguiente paso:** /skill:validate .frida/artifacts/plans/<plan>.md
```

Si se pausó:
```
Implementación pausada en Fase {N}:
<motivo>

Reanudar con: /skill:implement <plan-path> Phase {N}
```

## Notas

- **Verifica antes de continuar**: cada fase debe pasar sus success criteria.
- **Mismatches código/plan**: surfácealos via ask_user_question, no improvises.
- **Para cambios a nivel plan**: usa /skill:revise.
- **Para pausas de sesión**: usa /skill:create-handoff.
