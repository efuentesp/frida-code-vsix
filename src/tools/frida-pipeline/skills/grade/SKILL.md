---
name: grade
description: Califica UN artefacto a lo largo de UNA dimensión de calidad nombrada y escribe un veredicto JSON en .frida/artifacts/verdicts/. Pasada única, sin subagentes, sin arreglos — sólo juzga. Despachado una vez por dimensión por un panel de grade del workflow; el workflow pliega los veredictos por-dimensión en una decisión advance/loop.
argument-hint: "--dimension <name> --artifact <path> [--context <path>] [--goal <path>] [--prior <verdict-path>]"
allowed-tools: Read, Grep, Glob, Write
shell-timeout: 10
disable-model-invocation: true
contract:
  produces:
    kind: produces
    meta:
      artifactKind: verdict
    data:
      type: object
      required: [dimension, pass, severity]
      properties:
        dimension:
          type: string
        pass:
          type: boolean
        score:
          type: integer
          minimum: 0
          maximum: 100
        severity:
          type: string
          enum: [none, low, medium, high]
---

# Grade

Califica un artefacto en una dimensión. Miembro de panel — no standalone.

## Flujo

1. Leer artefacto + dimensión → 2. Evaluar → 3. Emitir veredicto → 4. Escribir JSON

## Pasos

### Paso 1: Leer artefacto + dimensión

Lee el artefacto a calificar. Identifica la dimensión (ej. "completitud", "consistencia", "calidad-del-código", "seguridad").

Si hay `--context <path>`: léelo para contexto adicional (ej. research, plan).
Si hay `--prior <verdict-path>`: léelo para comparar con el veredicto anterior.

### Paso 2: Evaluar

Evalúa el artefacto contra la dimensión:

- **Criterios**: ¿qué hace que un artefacto "pase" esta dimensión?
- **Evidencia**: cita secciones/líneas específicas del artefacto.
- **Score**: 0-100 (qué tan bien cumple la dimensión).

### Paso 3: Emitir veredicto

```json
{
  "dimension": "<nombre>",
  "pass": true|false,
  "score": 0-100,
  "severity": "none|low|medium|high",
  "findings": [
    { "severity": "high|medium|low", "message": "<descripción>", "location": "<referencia>" }
  ]
}
```

- `pass`: true si score >= umbral (típicamente 70).
- `severity`: el nivel del finding más severo.

### Paso 4: Escribir JSON

Filename: `.frida/artifacts/verdicts/<slug>_<dimension>.json`.

## Notas

- **Sólo juzga**: no arregla, no sugiere código, no reescribe.
- **Pasada única**: sin iteración.
- **Una dimensión por invocación**: el workflow despacha una por dimensión.
- **El workflow decide**: el panel pliega los veredictos en advance/loop.
