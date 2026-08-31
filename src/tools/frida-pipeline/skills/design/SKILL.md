---
name: design
description: Diseña features complejas descomponiéndolas en slices verticales, generando código slice por slice con verificador por-slice y revisión independiente post-finalización, produciendo un artefacto de diseño (decisiones arquitectónicas, desglose de slices, mapa de archivos) en .frida/artifacts/designs/. El diseño alimenta la skill plan o blueprint. Úsala para features multi-componente que tocan 6+ archivos en múltiples capas.
argument-hint: "[path a artefacto de research]"
shell-timeout: 10
disable-model-invocation: true
contract:
  produces:
    kind: produces
    meta:
      artifactKind: design
    data:
      type: object
      properties:
        status:
          enum: [in-progress, in-review, ready]
  consumes:
    data:
      type: object
      properties:
        status:
          const: ready
    meta:
      artifactKind: [research, solutions]
---

# Design

Diseña una feature compleja descomponiéndola en slices verticales. Produce decisiones arquitectónicas, un mapa de slices, y un mapa de archivos.

## Metadatos

```!
node "${SKILL_DIR}/../_shared/now.mjs"
echo
node "${SKILL_DIR}/../_shared/git-context.mjs"
```

## Flujo

1. Consumir research → 2. Decidir arquitectura → 3. Descomponer en slices → 4. Mapa de archivos → 5. Escribir artefacto

## Pasos

### Paso 1: Consumir research

Lee el artefacto de research (`.frida/artifacts/research/*.md`) o solutions completo. Extrae: arquitectura observada, riesgos, recomendaciones.

### Paso 2: Decidir arquitectura

Sintetiza las decisiones arquitectónicas basadas en el research:

- **Enfoque**: nombra la forma arquitectónica (nuevo módulo, refactor, extensión).
- **Seams**: dónde cortar — interfaces, contratos, fronteras de módulos.
- **Patrones**: qué patrones existentes del codebase seguir.
- **Tradeoffs**: qué optimiza el enfoque y qué sacrifica.

Confirma las decisiones clave via `ask_user_question` (1-3 preguntas, todas `shape` tier).

### Paso 3: Descomponer en slices verticales

Cada slice es una unidad vertical end-to-end (capa a capa) que se puede implementar y verificar independientemente:

1. Identifica los slices en orden de dependencia.
2. Por cada slice: título, descripción, archivos que toca, interfaces que define.
3. Ordena por dependencia (slice 1 no depende de slice 2).

### Paso 4: Mapa de archivos

Lista cada archivo que se creará/modificará, agrupado por slice:

- Archivos nuevos: ruta + responsabilidad.
- Archivos modificados: ruta + qué cambia.
- Tests: ruta + qué cubren.

### Paso 5: Escribir artefacto

Filename: `.frida/artifacts/designs/<slug>_<topic>.md`. Frontmatter
`status: ready` y `parent: <ruta-relativa-del-research>` — el path del
artefacto consumido en el Paso 1 (relativo al cwd, sin comillas): el
reconciler del pipeline N1 encadena research → design → plan por `parent`.

```
Diseño completado:
`.frida/artifacts/designs/<slug>_<topic>.md`

{N} slices, {M} archivos.

**Siguiente paso:** /skill:plan o /skill:blueprint
```

## Notas

- **Requiere research o solutions**: no diseñas desde cero sin investigación previa.
- **Slices verticales**: cada slice cruza todas las capas necesarias, no es horizontal.
- **Nunca escribas código fuente**: esta skill produce sólo un artefacto de diseño.
