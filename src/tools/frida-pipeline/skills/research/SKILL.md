---
name: research
description: Responde preguntas estructuradas de investigación sobre un codebase usando agentes de análisis paralelos, luego sintetiza hallazgos en un documento de investigación en .frida/artifacts/recovery/. Despacha internamente el agente scope-tracer para formular preguntas de calidad, luego las responde. Úsalo cuando el usuario quiera investigación profunda de un área del codebase.
argument-hint: "[prompt libre de investigación]"
shell-timeout: 10
disable-model-invocation: true
contract:
  produces:
    kind: produces
    meta:
      artifactKind: research
    data:
      type: object
      properties:
        status:
          enum: [in-progress, in-review, ready]
  consumes:
    meta:
      artifactKind: [frd]
---

# Research

Investiga un codebase en profundidad: formula preguntas de investigación de calidad con `scope-tracer`, respóndelas con agentes de análisis paralelos, y sintetiza los hallazgos en un documento Markdown estructurado.

## Input

`$ARGUMENTS` — prompt libre de investigación, o path a un FRD de discover.

## Metadatos

```!
node "${SKILL_DIR}/../_shared/now.mjs"
echo
node "${SKILL_DIR}/../_shared/git-context.mjs"
```

## Flujo

1. Input → 2. Scope-tracer → 3. Agentes paralelos → 4. Síntesis → 5. Escribir artefacto

## Pasos

### Paso 1: Manejo del input

1. **Sin argumento**: pide al usuario qué quiere investigar.
2. **Si es un path a FRD** (`.frida/artifacts/discover/*.md`): léelo completo. Extrae el **Recommended Approach** y las **Decisions** como Developer Context.
3. **Si es texto libre**: úsalo como topic de investigación.

### Paso 2: Scope-tracer (formular preguntas)

Despacha el agente `scope-tracer` para formular 5-10 preguntas densas que acoten la investigación:

```
Agent({
  subagent_type: "scope-tracer",
  description: "trazar alcance de investigación",
  prompt: "Barre estos términos ancla en el codebase: <topic>. Lee 5-10 archivos clave. Devuelve un Discovery Summary + 5-10 preguntas numeradas que acoten lo que esta investigación debe examinar."
})
```

Espera el resultado. Si las preguntas son demasiado vagas o amplias, refina con un prompt más angosto.

### Paso 3: Agentes paralelos (responder preguntas)

Por cada pregunta (o grupo de preguntas relacionadas), despacha agentes en paralelo:

- `codebase-analyzer` — para trazar flujos de implementación.
- `codebase-locator` — para encontrar dónde vive el código.
- `codebase-pattern-finder` — para encontrar patrones similares.
- `integration-scanner` — para mapear conexiones.
- `artifacts-locator` — para buscar en `.frida/artifacts/`.

```
Agent({
  subagent_type: "codebase-analyzer",
  description: "<3-5 palabras>",
  prompt: "<pregunta de investigación específica>"
})
```

**Tope**: 3-5 agentes en paralelo. Espera a TODOS antes de continuar.

Lee archivos relevantes (≤10) para profundidad.

### Paso 4: Síntesis

Compila los hallazgos de los agentes en un documento estructurado:

1. **Topic** — qué se investigó y por qué.
2. **Developer Context** — heredado del FRD (Decisions, Recommended Approach).
3. **Preguntas de investigación** — las del scope-tracer, numeradas.
4. **Hallazgos** — por pregunta, con evidencia (`file:line`).
5. **Arquitectura observada** — cómo funciona el código hoy.
6. **Riesgos y dependencias** — qué podría romperse.
7. **Recomendaciones** — qué hacer después.

### Paso 5: Escribir artefacto

1. **Filename**: `.frida/artifacts/research/<slug>_<topic>.md`.
2. **Escribe** con el Write tool. Frontmatter `status: ready` y
   `parent: <ruta-relativa-del-FRD>` — el path del input del Paso 1 bajo
   `.frida/artifacts/discover/` (relativo al cwd, sin comillas).
   `parent:` vacío si la investigación no viene de un FRD: el reconciler
   del pipeline N1 enlaza por `parent` y cae al topic del filename como
   fallback.
3. **Presenta y encadena**:

   ```
   Investigación completada:
   `.frida/artifacts/research/<slug>_<topic>.md`

   {N} preguntas respondidas, {M} hallazgos clave.

   **Siguiente paso:** /skill:design o /skill:explore para sopesar enfoques.
   ```

## Notas importantes

- **Scope-tracer primero**: siempre formula preguntas antes de despachar agentes de análisis.
- **Paralelismo controlado**: 3-5 agentes por ronda, no más.
- **Fundamenta con `file:line`**: cada hallazgo debe citar el código real.
- **Nunca escribas código fuente** — esta skill produce sólo un artefacto de investigación.
- **Si el FRD existe**: hereda Decisions como Developer Context.
