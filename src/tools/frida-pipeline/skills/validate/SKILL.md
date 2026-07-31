---
name: validate
description: Verifica que un plan de implementación se ejecutó correctamente corriendo los criterios de éxito de cada fase contra el árbol de trabajo y produciendo un reporte de validación en .frida/artifacts/validation/. Úsala después de implement, cuando el usuario pida "validar el plan", o necesite confirmar que una feature está completa según su plan.
argument-hint: "[plan-path] [--goal <path>] [--baseline <path>]"
allowed-tools: Read, Bash(git *), Bash(make *), Glob, Grep, Agent
shell-timeout: 10
disable-model-invocation: true
contract:
  produces:
    kind: produces
    meta:
      artifactKind: validation
    data:
      type: object
      required: [verdict]
      properties:
        status:
          enum: [in-progress, in-review, ready]
        verdict:
          enum: [pass, fail]
  consumes:
    reads:
      plans: {}
    meta:
      world: working-tree
---

# Validate

Verifica la implementación contra los success criteria del plan. Produce un veredicto pass/fail.

## Metadatos

```!
node "${SKILL_DIR}/../_shared/now.mjs"
echo
node "${SKILL_DIR}/../_shared/git-context.mjs"
```

## Flujo

1. Leer plan → 2. Por cada fase: correr success criteria → 3. Sintetizar veredicto → 4. Escribir reporte

## Pasos

### Paso 1: Leer plan

Lee el plan completo. Extrae los success criteria de cada fase.

### Paso 2: Correr success criteria

Por cada fase, verifica cada success criterion:

- **Comando verificable**: corre el comando (ej. `npm test`, `npx tsc --noEmit`).
- **Comportamiento visible**: verifica el comportamiento (ej. el endpoint responde).
- **Archivo producido**: verifica que el archivo existe.

Registra pass/fail por criterio.

### Paso 3: Sintetizar veredicto

- **pass**: TODOS los success criteria de TODAS las fases pasan.
- **fail**: al menos un criterio falla.

### Paso 4: Escribir reporte

Filename: `.frida/artifacts/validation/<slug>_<topic>.md`. Frontmatter `status: ready`, `verdict: pass|fail`.

```
Validación: PASS ✅ / FAIL ❌
{N}/{M} criterios pasaron.

Fases fallidas:
- Fase {N}: <criterio que falló>

**Siguiente paso:** /skill:commit (si pass) o /skill:revise (si fail)
```

## Notas

- **Veredicto binario**: pass o fail, no parcial.
- **Corre comandos reales**: no simulaciones.
- **Si findings son locales**: arréglalos y re-corre /skill:validate.
- **Si findings implican cambios al plan**: escala a /skill:revise primero.
