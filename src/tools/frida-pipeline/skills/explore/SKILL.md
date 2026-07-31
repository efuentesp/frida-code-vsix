---
name: explore
description: Analiza opciones de solución para una feature o cambio, comparando enfoques con pros, contras, trade-offs y un camino recomendado. Úsala cuando el usuario esté sopesando enfoques, pregunte "cuáles son las opciones", quiera comparar approaches, o enfrente una decisión con múltiples implementaciones válidas. Produce documentos de solutions en .frida/artifacts/solutions/.
argument-hint: "[descripción de feature/cambio]"
shell-timeout: 10
disable-model-invocation: true
contract:
  produces:
    kind: produces
    meta:
      artifactKind: solutions
    data:
      type: object
      properties:
        verdict:
          enum: [pass, fail, needs_input]
        status:
          enum: [in-progress, ready]
        confidence:
          enum: [high, medium, low]
        complexity:
          enum: [low, medium, high]
  consumes:
    meta:
      artifactKind: [research]
---

# Explore

Analiza opciones de solución y compara enfoques. Alternativa a design cuando el foco es sopesar approaches antes de comprometerse.

## Metadatos

```!
node "${SKILL_DIR}/../_shared/now.mjs"
echo
node "${SKILL_DIR}/../_shared/git-context.mjs"
```

## Flujo

1. Input → 2. Generar opciones → 3. Comparar → 4. Recomendar → 5. Escribir

## Pasos

### Paso 1: Input

- **Path a research**: léelo como contexto fundacional.
- **Descripción libre**: úsala como topic. Despacha codebase-locator para sondear.
- **Sin argumento**: pide al usuario qué feature/cambio explorar.

### Paso 2: Generar opciones

Genera 2-4 enfoques candidatos. Por cada uno:

- **Descripción**: qué es y cómo funciona.
- **Pros**: qué optimiza.
- **Contras**: qué sacrifica.
- **Complejidad**: low/medium/high.
- **Trade-offs**: el eje de tensión principal.

### Paso 3: Comparar

Compara las opciones en una tabla: enfoque × dimensión (complejidad, riesgo, tiempo, alineación con el codebase).

### Paso 4: Recomendar

Recomenda UN enfoque con rationale:

- `verdict`: pass (hay un ganador claro) / fail (ninguno es viable) / needs_input (falta info).
- `confidence`: high/medium/low.
- `complexity`: low/medium/high.

### Paso 5: Escribir

Filename: `.frida/artifacts/solutions/<slug>_<topic>.md`. Frontmatter `status: ready`.

```
Exploración completada:
`.frida/artifacts/solutions/<slug>_<topic>.md`

{N} enfoques comparados, recomendación: <enfoque>.

**Siguiente paso:** /skill:design (si verdict=pass) o /skill:plan
```

## Notas

- **Mínimo 2 opciones**: nunca presentes una sola opción como si fuera una elección.
- **Trade-offs explícitos**: cada opción debe decir qué optimiza Y qué sacrifica.
- **Puede alimentar design**: el solutions artifact es input válido para design.
