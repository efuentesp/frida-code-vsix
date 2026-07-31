---
name: code-review
description: "Revisión exhaustiva de cambios pendientes, un branch o un PR usando agentes especialistas paralelos que auditan el diff, comparan contra código peer y verifican claims contra los estándares de Frida. Úsalo cuando el usuario pida 'revisar esto', quiera revisar cambios pendientes, un PR, un branch o un diff. Produce documentos de revisión en .frida/artifacts/reviews/."
argument-hint: "[scope]"
shell-timeout: 10
contract:
  produces:
    kind: produces
    meta:
      artifactKind: review
    data:
      type: object
      required: [blockers_count]
      properties:
        status:
          enum: [in-progress, in-review, ready]
        blockers_count:
          type: integer
          minimum: 0
---

# Code Review

Revisa cambios de código contra dos ejes: **Estándares** (¿el código sigue los estándares documentados del repo?) y **Spec** (¿el código coincide con lo que el PRD/issue pedía?). Despacha agentes especialistas en paralelo, luego reporta los hallazgos lado a lado.

## Estándares de Frida (específicos de este dominio)

Esta skill revisa contra los estándares documentados de Frida:

- **ADRs** (`docs/adr/`):决策es arquitectónicas firmadas. Cada cambio debe respetar los ADRs existentes y, si los contradice, proponer un ADR nuevo.
- **ADR-0001** (alcance disuasivo): las skills/herramientas NO deben operar fuera del perímetro disuasivo. Si el diff añade funcionalidad que viola el alcance, marcar como blocker.
- **ADR-0005** (sin extensión ajena): cero dependencias npm nuevas. Si el diff añade un `import` de un paquete no listado en `package.json`, marcar como blocker.
- **Docs de tools** (`docs/tools/*.md`): cada herramienta documentada tiene un contrato. Si el diff cambia una herramienta, verificar que la doc esté actualizada.
- **Catálogo de providers** (`docs/adr/0017*`, `0018*`, `0019*`): los providers soportados son canónicos. No inventar providers.
- **Convención AGENTS.md**: "Todas las conversaciones, creación y edición de archivos deben hacerse en español de México."

## Input

`$ARGUMENTS` — scope de la revisión. Puede ser:

- Vacío → revisar cambios sin commit (`git diff`)
- Un branch → revisar contra main
- Un commit/PR → revisar ese diff

## Metadatos

```!
node "${SKILL_DIR}/../_shared/now.mjs"
echo
node "${SKILL_DIR}/../_shared/git-context.mjs"
```

## Flujo

1. Determinar scope → 2. Extraer diff → 3. Agentes paralelos → 4. Compilar reporte → 5. Escribir artefacto

## Pasos

### Paso 1: Determinar scope

1. **Sin argumento**: revisar `git diff HEAD` (cambios sin commit).
2. **Branch name**: revisar `git diff main...<branch>`.
3. **Commit hash**: revisar `git show <hash>`.
4. Lee el diff completo con `git diff` via bash.

### Paso 2: Extraer surface-list

Construye una surface-list de los archivos y símbolos tocados por el diff:

1. Lista los archivos modificados (`git diff --name-only`).
2. Para cada archivo, identifica las surfaces (funciones, tipos, exports).
3. Mapea cada cambio a un surface-id.

### Paso 3: Agentes paralelos

Despacha agentes especialistas en paralelo contra el diff y la surface-list:

1. **`diff-auditor`** — camina el diff fila por fila, emite hallazgos pipe-delimitados.

   ```
   Agent({
     subagent_type: "diff-auditor",
     description: "auditar diff fila por fila",
     prompt: "Camina este diff contra la surface-list. Archivos: <lista>. Emite una fila por hallazgo: file:line | verbatim | surface-id | nota."
   })
   ```

2. **`peer-comparator`** — compara los cambios contra código sibling existente.

   ```
   Agent({
     subagent_type: "peer-comparator",
     description: "comparar contra peers",
     prompt: "Compara <archivo_nuevo> contra <archivo_peer>. Etiqueta cada invariante: Mirrored/Missing/Diverged/Intentionally-absent."
   })
   ```

3. **`claim-verifier`** — verifica claims del commit message / PR description contra el código real.

   ```
   Agent({
     subagent_type: "claim-verifier",
     description: "verificar claims del PR",
     prompt: "Verifica estos claims contra el repo: <claims>. Emite FINDING <id> | <tag> | <justificación>."
   })
   ```

4. **`artifact-code-reviewer`** — revisa calidad, encaje y accionabilidad.

   ```
   Agent({
     subagent_type: "artifact-code-reviewer",
     description: "revisar calidad del código",
     prompt: "Revisa el diff contra tres dimensiones: calidad, encaje en el codebase, accionabilidad. Cita docs/adr/ cuando aplique."
   })
   ```

**Tope**: 4 agentes en paralelo. Espera a TODOS.

### Paso 4: Compilar reporte

Sintetiza los hallazgos de los agentes en dos secciones:

#### Eje 1: Estándares

- ¿El código sigue los ADRs de `docs/adr/`?
- ¿Respeta ADR-0001 (alcance disuasivo)? ¿No añade features fuera del perímetro?
- ¿Respeta ADR-0005 (cero deps npm nuevas)? ¿No hay imports no listados?
- ¿La documentación (`docs/tools/`) está actualizada si se cambió una herramienta?
- ¿Respeta la convención de español de `AGENTS.md`?
- ¿Usa el patrón de porte nativo (factory, hooks, 0 deps)?

#### Eje 2: Spec

- ¿El código coincide con lo que el PRD/issue pedía?
- ¿Los tests cubren los casos del spec?
- ¿Hay tests faltantes para behavior nuevo?

**Clasificar hallazgos por severidad**:

- `blocker` — debe arreglarse antes de merge (rompe ADR, añade dep, falta test crítico).
- `concern` — debería arreglarse (estilo, doc desactualizada, naming).
- `suggestion` — mejora opcional (refactor, claridad).

### Paso 5: Escribir artefacto

1. **Filename**: `.frida/artifacts/reviews/<slug>_<topic>.md`.
2. **Escribe** con el Write tool. Frontmatter `status: ready`, `blockers_count: N`.
3. **Presenta**:

   ```
   Revisión completada:
   `.frida/artifacts/reviews/<slug>_<topic>.md`

   {N} blockers, {M} concerns, {K} suggestions.

   Eje Estándares: <resumen>
   Eje Spec: <resumen>
   ```

## Notas importantes

- **Cita ADRs específicos**: cuando un hallazgo viole un ADR, nómbralo por número (ej. "viola ADR-0005").
- **Verifica deps**: cualquier `import` nuevo debe estar en `package.json`.
- **Verifica español**: comentarios, mensajes de error y nombres de variables deben seguir la convención.
- **No arregles código**: esta skill sólo revisa. Los arreglos son trabajo de `implement`.
- **Paralelismo**: 4 agentes máximo por ronda.
