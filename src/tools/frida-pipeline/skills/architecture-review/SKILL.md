---
name: architecture-review
description: Conduce una revisión de arquitectura top-down, capa por capa, de un módulo de software leyendo cada archivo en scope, corriendo un checklist uniforme de 10 dimensiones por capa, y triando cada hallazgo candidato a través de un checkpoint estructurado del desarrollador. Produce un plan de pulido fase-por-fase en .frida/artifacts/architecture-reviews/. Úsalo antes de un release 1.0, después de un refactor mayor, o cuando un módulo ha crecido lo suficiente para justificar una auditoría estructural.
argument-hint: "[target: archivo, directorio, o módulo]"
shell-timeout: 10
disable-model-invocation: true
contract:
  produces:
    kind: produces
    meta:
      artifactKind: architecture-review
    data:
      type: object
      required: [phases, layer_count]
      properties:
        status:
          enum: [in-progress, ready]
        layer_count:
          type: integer
          minimum: 1
        phases:
          type: array
          minItems: 1
---

# Architecture Review

Revisión de arquitectura top-down, capa por capa.

## Metadatos

```!
node "${SKILL_DIR}/../_shared/now.mjs"
echo
node "${SKILL_DIR}/../_shared/git-context.mjs"
```

## Flujo

1. Definir scope → 2. Leer todo → 3. Checklist 10 dimensiones por capa → 4. Triage → 5. Plan fase-por-fase

## Pasos

### Paso 1: Definir scope

Identifica el módulo/directorio a revisar. Lista todos los archivos en scope.

### Paso 2: Leer todo

Lee CADA archivo en scope completo (sin limit/offset). Sin lecturas parciales.

### Paso 3: Checklist 10 dimensiones

Por cada capa (directorio/nivel de abstracción), corre:

1. **Cohesión**: ¿los elementos de la capa pertenecen juntos?
2. **Acoplamiento**: ¿depende de capas que no debería?
3. **Profundidad del módulo**: ¿la interfaz es simple vs la implementación?
4. **Complejidad ciclomática**: ¿hay funciones demasiado complejas?
5. **Consistencia de naming**: ¿nombres siguen un patrón?
6. **Manejo de errores**: ¿errores se propagan correctamente?
7. **Testabilidad**: ¿se puede testear sin mocks excesivos?
8. **Documentación**: ¿los contratos están documentados?
9. **Seguridad**: ¿hay vectores de ataque?
10. **Performance**: ¿hay cuellos de botella obvios?

### Paso 4: Triage

Por cada hallazgo, pregunta al desarrollador via `ask_user_question`:

- Severidad: blocker / concern / suggestion.
- Acción: arreglar ahora / programar / ignorar.

### Paso 5: Plan fase-por-fase

Compila los hallazgos aceptados en un plan fase-por-fase:

Filename: `.frida/artifacts/architecture-reviews/<slug>_<topic>.md`. Frontmatter `status: ready`, `layer_count: N`.

```
Revisión de arquitectura completada:
`.frida/artifacts/architecture-reviews/<slug>_<topic>.md`

{N} capas, {M} hallazgos, {K} fases de pulido.

**Siguiente paso:** /skill:blueprint para planificar las fases de pulido.
```
