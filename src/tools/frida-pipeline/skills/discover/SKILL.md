---
name: discover
description: Entrevista al desarrollador una pregunta a la vez para extraer intención y requisitos de la feature, luego sintetiza un Feature Requirements Document en .frida/artifacts/discover/. La primera pregunta es sólo de intención y corre antes de cualquier sondeo del codebase. Entry point canónico del pipeline antes de research.
argument-hint: "[descripción libre de la feature | path a artefacto existente]"
shell-timeout: 10
disable-model-invocation: true
contract:
  produces:
    kind: produces
    meta:
      artifactKind: frd
    data:
      type: object
      properties:
        status:
          enum: [in-progress, in-review, ready]
---

# Discover

Extrae intención y requisitos mediante una entrevista de una-pregunta-a-la-vez, luego escribe un Feature Requirements Document (FRD) que las skills downstream consumen. Dos principios: (1) **intención antes que agentes** — la pregunta fundacional de intención corre antes de cualquier sondeo; (2) **lazy + confirmar** — construye el árbol de decisiones un nivel a la vez.

## Input

`$ARGUMENTS` — descripción libre de la feature, o path a un FRD/ticket/doc existente para refinar.

## Metadatos

```!
node "${SKILL_DIR}/../_shared/now.mjs"
echo
node "${SKILL_DIR}/../_shared/git-context.mjs"
```

Copia los valores verbatim — no reformatees el offset de zona horaria.

## Flujo

1. Input → 2. Pregunta de intención → 3. Sondeo del codebase → 4. Árbol lazy → 5. Loop de entrevista → 6. Sintetizar FRD → 7. Escribir artefacto → 8. Follow-ups

## Pasos

### Paso 1: Manejo del input

1. **Sin argumento**: pide al usuario una descripción de la feature o un path. Espera input.
2. **Detectar forma del input**: si es un archivo existente, léelo completo (sin limit/offset). Si es texto libre, es una feature nueva.
3. **Lee otros archivos mencionados** (tickets, docs, artefactos relacionados) antes de continuar.

**Sin dispatch de agentes en el Paso 1.** Sólo `Read` en paths nombrados por el usuario.

### Paso 2: Pregunta fundacional de intención

Antes de cualquier sondeo del codebase, haz UNA pregunta abierta de intención via `ask_user_question`:

- Enmarca: "¿Qué problema resuelves y quién lo sufre?" / "¿Cómo se ve el éxito para quien lo experimenta hoy?"
- **Sin opción `(Recomendado)`**. El desarrollador debe generar el enmarque.
- **Sin citas `file:line`** — el codebase no tiene nada que decir sobre intención.
- Captura la respuesta en las palabras del desarrollador, verbatim.

Checa si la intención soporta un sondeo angosto. Si es muy vaga, pregunta UNA vez más para afilar. Tope: 3 preguntas de intención antes de continuar.

### Paso 3: Sondeo ligero del codebase (agentes paralelos, intención-orientado)

1. **Escoge el set de agentes**: despacha `codebase-locator`, `codebase-analyzer`, o ambos. Tope: 2 agentes.
2. **Spawnea en paralelo** con el Agent tool, con prompts derivados de la intención del desarrollador:

   ```
   Agent({
     subagent_type: "codebase-locator",
     description: "<tarea de 3-5 palabras>",
     prompt: "<prompt de slice angosto, orientado a la intención>"
   })
   ```

3. **Espera a TODOS los agentes** antes de continuar.
4. **Lee archivos relevantes** (≤5 en contexto principal).
5. **Resultados vacíos no son fatales** — registra "sin precedente en el codebase".

### Paso 4: Árbol lazy + confirmación de pre-resoluciones

1. **Construye raíz + hijos inmediatos**: raíz = problema del Paso 2. Hijos = Goals/Non-Goals · Requisitos funcionales · Requisitos no-funcionales · Constraints · Criterios de aceptación · Enfoque recomendado.
2. **Marca pre-resoluciones** basadas en evidencia del Paso 3 con citas `file:line`. No las grabes como Decisiones todavía.
3. **Confirma en lote** via `ask_user_question`: "Del sondeo inferí — `<comportamiento>` (`file:line`). ¿Lo mantenemos o lo cambiamos?".
4. El árbol lazy queda interno — no lo presentes al desarrollador.

### Paso 5: Loop de entrevista

Camina el árbol lazy depth-first, padre antes que hijo. Expande el siguiente nivel sólo después de que el nodo se resuelva. Para cada nodo sin resolver:

1. **Clasifica por tier**:
   - `intent` — ya hecho en el Paso 2.
   - `scope` (goals, non-goals, reqs, constraints) — recomendación con base en intención. Citas `file:line` sólo cuando una opción referencia código existente.
   - `shape` (decisión arquitectónica) — enmarca **dialécticamente**: nombra el eje de tradeoff, no un ganador. Cada opción debe decir qué optimiza Y qué sacrifica.
   - `detail` (criterios de aceptación) — batcheable cuando 2-4 hojas son independientes.

2. **Respuesta recomendada** (`scope`/`shape`/`detail`): deriva de intención + evidencia. Lleva `(Recomendado)`.
3. **Pregunta via `ask_user_question`**. Una pregunta a la vez. Espera la respuesta.
4. **Clasifica cada respuesta**: Decisión / Corrección / Ajuste de scope / Cross-cutting / Defer.
5. **Batching**: 2-4 hojas `detail` independientes pueden batchearse.
6. **Terminación**: para cuando toda rama tenga Decisión o Deferral, las palabras del desarrollador aparezcan en Problem/Goals, y ninguna Decisión sea `Recomendación aceptada` sin rationale.

**Presupuesto total de agentes**: 2 (Paso 3) + N×1 (correcciones, 0-2) = 2-4 agentes por FRD.

### Paso 6: Sintetizar el cuerpo del FRD

Redistribuye las respuestas de la entrevista en las secciones del FRD:

- **Summary** — 2-3 oraciones capturando el concepto settling.
- **Problem & Intent** — enmarque del desarrollador del Paso 2, verbatim.
- **Goals / Non-Goals** — listas explícitas in/out.
- **Functional Requirements** — numeradas, cada una testeable independientemente.
- **Non-Functional Requirements** — perf, seguridad, UX, accesibilidad, fiabilidad.
- **Constraints & Assumptions** — ambientales, técnicas, de calendario.
- **Acceptance Criteria** — condiciones observables que un reviewer puede checar.
- **Recommended Approach** — 1-2 oraciones nombrando la forma arquitectónica.
- **Decisions** — log completo Q/A por decisión.
- **Open Questions** — sólo items explícitamente diferidos.
- **Suggested Follow-ups** — relacionados pero fuera de scope.

### Paso 7: Escribir artefacto, presentar, encadenar

1. **Filename**: `.frida/artifacts/discover/<slug>_<topic>.md` — `<slug>` del bloque Metadatos.
2. **Escribe el FRD** con el Write tool. Frontmatter `status: ready` y
   `parent:` vacío (el FRD es la raíz de la cadena: las skills downstream
   enlazan contra esta ruta — el pipeline N1 de `/pipeline` encadena
   artefactos por `parent` con fallback al topic del filename).
3. **Presenta y encadena**:

   ```
   Intención capturada en:
   `.frida/artifacts/discover/<slug>_<topic>.md`

   {N} requisitos, {M} decisiones, {K} preguntas abiertas.

   **Siguiente paso:** /skill:research .frida/artifacts/discover/<slug>_<topic>.md
   ```

### Paso 8: Follow-ups

- **Artefacto fresco por invocación** — no hay modo append in-place.
- **Iterar reinvocando** `/skill:discover [path-al-FRD-previo]`.
- **Sin pregunta rubber-stamp final** — el encadenamiento a research es automático.
- **Ediciones manuales permitidas** via Edit.

## Notas importantes

- **Siempre entrevista-primero, intención-primero**: nunca escribas el FRD sin el loop de entrevista.
- **Siempre una pregunta a la vez**.
- **`intent` genera, `scope`/`shape`/`detail` revisa**.
- **`file:line` es condicional por tier**: intent → nunca; scope → sólo con código existente; shape → requerido en opciones con código.
- **Árbol lazy, no pre-construir el árbol completo**.
- **Pre-resoluciones confirman, nunca se graban en silencio**.
- **Orden de entrevista ≠ orden de secciones del FRD**.
- **Sólo fan-out ligero**: Paso 3 ≤2 agentes; correcciones ≤1 por evento.
- **Nunca escribas o edites archivos fuente** — esta skill produce sólo un artefacto.
- **Artefacto fresco cada invocación**.
