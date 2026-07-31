---
name: plan
description: Convierte un artefacto de diseño en un plan de implementación fase-por-fase con fases paralelizables y criterios de éxito explícitos, escrito en .frida/artifacts/plans/. Úsala después de design cuando el usuario quiere un diseño convertido en un plan accionable fase por fase para entregar a implement.
argument-hint: "[path a artefacto de design]"
shell-timeout: 10
disable-model-invocation: true
contract:
  produces:
    kind: produces
    meta:
      artifactKind: plan
    data:
      type: object
      required: [phases, phase_count]
      properties:
        status:
          enum: [in-progress, in-review, ready]
        phase_count:
          type: integer
          minimum: 1
          maximum: 32
        phases:
          type: array
          minItems: 1
          maxItems: 32
---

# Plan

Convierte un diseño en un plan de implementación fase-por-fase.

## Metadatos

```!
node "${SKILL_DIR}/../_shared/now.mjs"
echo
node "${SKILL_DIR}/../_shared/git-context.mjs"
```

## Flujo

1. Consumir design → 2. Descomponer en fases → 3. Criterios de éxito → 4. Escribir plan

## Pasos

### Paso 1: Consumir design

Lee el artefacto de design (`.frida/artifacts/designs/*.md`) completo. Extrae: slices, mapa de archivos, decisiones.

### Paso 2: Descomponer en fases

Convierte cada slice en una fase:

1. **Fase = slice**: una fase por slice del diseño.
2. **Ordena por dependencia**: la fase A antes de B si B importa de A.
3. **Paralelización**: marca fases que pueden correr en paralelo (sin dependencias entre ellas).
4. **Archivos por fase**: lista los archivos que cada fase crea/modifica.
5. **Interfaces por fase**: qué define y qué consume.

### Paso 3: Criterios de éxito

Por cada fase, define criterios observables:

- Comando verificable (ej. "npm test pasa").
- Comportamiento visible (ej. "el endpoint responde 200").
- Archivo producido (ej. "existe `.frida/artifacts/X`").

### Paso 4: Escribir plan

Filename: `.frida/artifacts/plans/<slug>_<topic>.md`. Frontmatter `status: ready`, `phase_count: N`.

```
Plan completado:
`.frida/artifacts/plans/<slug>_<topic>.md`

{N} fases, {M} pueden paralelizarse.

**Siguiente paso:** /skill:implement
```

## Notas

- **Fases atómicas**: cada fase es independiente y autocontenida.
- **Criterios testeables**: cada success criterion debe ser verificable objetivamente.
- **Máx 32 fases**: si necesitas más, descompón en subplanes.
