# How-to: workflows con patrones curados (multi-perspective, codebase-audit, adversarial-review, code-review, aidd-plan, aidd-ship)

> Frida puede convertir **una petición tuya en una flota de sub-agentes paralelos** que se
> revisan entre sí y te devuelven una sola respuesta sintetizada. El catálogo de
> **`frida-extensible-workflows`** trae 4 **patrones curados** (porte de
> `pi-dynamic-workflows`, issue #19) más **`aidd-plan`** registrado en runtime por
> `frida-aidd` (issue #38): los pides en lenguaje natural, el agente arma
> `workflow({ name, args })` y el panel del footer muestra el progreso mientras el
> resultado llega a la conversación.
>
> Referencia técnica: [docs/tools/frida-extensible-workflows.md](tools/frida-extensible-workflows.md) ·
> ADR-0028 · ADR-0030.

## El modelo en 30 segundos

```text
Tú:        "corre un code-review de mi diff"
Agente:    workflow({ name: "code-review", args: { diff: <tu diff> } })
Frida:     ▸ Workflow code-review — panel del footer:
           Find ▸▸▸▸▸▸▸ 7/7 · Verify 3/5 · $0.06 · 2:14
           → resultado como follow-up en la conversación
```

- **No escribes scripts**: el patrón ya está curado; tú sólo das los `args`.
- **Corre en background**: sigues chateando; el panel del footer trackea fases y agentes.
- **Todo pasa por tu gate de permisos**: el bash de los sub-agentes se aprueba igual.
- El intermedio vive en variables del script, **no llena tu contexto** — sólo la síntesis vuelve.

## Los 4 patrones: cuándo usar cada uno

### `multi-perspective` — decisiones con varios ángulos

Cuando una pregunta merece más de una opinión: migraciones, decisiones de arquitectura,
trade-offs.

> *"Corre un multi-perspective: ¿debería migrar el webview a React 19 o quedarme en 18?"*

5 agentes en paralelo (técnica, producto, seguridad, UX, mantenibilidad — o las que digas:
*"perspectivas: costo, riesgo, esfuerzo del equipo"*) + un sintetizador que destaca
acuerdos, tensiones y trade-offs abiertos.

| Arg | Tipo | Default |
| --- | --- | --- |
| `topic` | string (req) | — |
| `perspectives` | string[] | las 5 por defecto si faltan o hay <2 |

### `codebase-audit` — auditorías del código

Cuando quieres revisar el repo contra criterios concretos, con verificación cruzada.

> *"Audita src/tools/ con checks: imports circulares y exports muertos"*

Un agente por check (con read/grep) → fase de **cross-validation** (un agente lee el código
citado y descarta falsos positivos) → reporte priorizado.

| Arg | Tipo |
| --- | --- |
| `scope` | string (req) — carpeta o descripción del alcance |
| `checks` | string[] (req) — cada check corre en su propio agente |

### `adversarial-review` — hallazgos que sobreviven escépticos

El antídoto contra el agente que te dice "todo bien". Úsalo para validar que un fix
realmente cierra lo que dice cerrar.

> *"Revisa adversarialmente si el fix de permisos deja fugas en el gate"*

**Investigate** (1 agente lista hallazgos con salida estructurada) → **Refute** (por CADA
hallazgo, N revisores **escépticos** en paralelo, instruidos a refutarlo y con
`real=false` por defecto) → **Consensus**: sólo sobreviven los que superan el umbral de
acuerdo, y el reporte dice cuántos cayeron.

| Arg | Tipo | Default |
| --- | --- | --- |
| `task` | string (req) | — |
| `reviewers` | 1-5 | 2 |
| `threshold` | 0-1 | 0.5 |

### `code-review` — revisión multi-ángulo de diffs

Para revisar cambios antes de commitear/abrir PR, con ranking por severidad.

> *"Revisa mi diff con code-review"*

**7 finders especializados en paralelo** — A/B/C correctness (condiciones invertidas,
off-by-one, comportamiento eliminado, call-sites rotos), D/E/F cleanup (reuso,
simplificación, eficiencia), G altitude (¿el cambio está en la capa correcta?) — cada uno
con salida estructurada `{file, line, summary, failure_scenario}`. Luego: dedup →
**verify** por candidato (CONFIRMED/PLAUSIBLE/REFUTED, los refutados se filtran) → ranking
(correctness → cleanup → altitude) → top 10.

| Arg | Tipo | Default |
| --- | --- | --- |
| `diff` | string (req) | — |
| `diffSource` | string | "git diff HEAD" (etiqueta de procedencia) |

El diff se trunca a 200k caracteres (con aviso en el log) — los hallazgos del prefijo
siguen teniendo valor.

### `aidd-plan` — de una idea a un plan ejecutable (frida-aidd)

Cuando tienes una idea de producto y quieres **especificaciones buenas antes de
codificar** (metodología AiDD/BMAD adaptada): el workflow corre la cadena
brief → prd → architecture → epics-and-stories y luego fan-out de una spec por
historia — cada stage la escribe un agente desechable **a disco**
(`docs/aidd/planning/*.md`), con checkpoints para que revises cada artefacto.

> *"Corre aidd-plan: módulo de reportes exportables para el panel"*

Los artefactos quedan en tu repo — auditables, versionados, editables a mano antes de
aprobar cada checkpoint. Referencia completa y customización 3-capas de los prompts:
[docs/tools/frida-aidd.md](tools/frida-aidd.md).

| Arg | Tipo | Default |
| --- | --- | --- |
| `idea` | string (req) | — |
| `project` | string | `"project"` |
| `language` | string | el idioma de la idea |
| `review` | `"manual" \| "auto"` | `"manual"` (checkpoints) |

### `aidd-ship` — sprint autónomo historia por historia (frida-aidd)

La otra mitad de AiDD: ya tienes los specs de `aidd-plan`, ahora el **loop de ejecución
determinista**. Por cada historia: un dev desechable implementa → el orquestador
**verifica el diff real contra lo que el dev reclama** (lie-detector) → review
adversarial acotado → comandos de verify del spec → **commit del orquestador**
(no del LLM). Sin specs previos hace bootstrap desde los artefactos de aidd-plan.

> *"Corre aidd-ship con review auto: ejecuta el sprint 1"*

Todo el estado vive en `docs/aidd/sprint-status.yaml` (único writer, estados
never-regress) + `deferred-ledger.json` (impedimentos no bloqueantes que el sweep
re-empaqueta al final). Con `review: "manual"` (default) cada commit pide tu
aprobación por checkpoint; un dev que "afirma sin hacer" queda `blocked` con la
razón. Requiere repo git. Referencia: [docs/tools/frida-aidd.md](tools/frida-aidd.md).

| Arg | Tipo | Default |
| --- | --- | --- |
| `sprint` | string | `"1"` (sólo bootstrap) |
| `review` | `"manual" \| "auto"` | `"manual"` (checkpoint pre-commit) |
| `maxSweeps` | 0-5 | 2 |

## Ruteo por tier (barato lo simple, caro lo difícil)

`code-review` usa **tiers**: los finders de correctness corren en `medium`, los de cleanup
en `small`, y la síntesis en `big`. Sin configuración, todos caen al modelo de tu sesión.
Para routing real, define los aliases (una vez):

```bash
mkdir -p ~/.frida/pi-extensible-workflows
cat > ~/.frida/pi-extensible-workflows/settings.json << 'EOF'
{
  "modelAliases": {
    "small": "zai/glm-4.6-flash",
    "medium": "zai/glm-4.6",
    "big": "zai/glm-5.3"
  }
}
EOF
```

(Reemplaza los modelos por los que tengas configurados. También puedes ponerlos por
proyecto en `.pi/pi-extensible-workflows/settings.json`.) El costo real de cada agente se
acumula en el `usage` del workflow (issue #18) — el panel lo muestra.

## Salida estructurada en tus propios scripts

Si escribes un workflow propio (`script` inline), cualquier `agent()` puede pedir JSON:

```js
const r = await agent("Lista los archivos con TODOs pendientes", {
  label: "todos",
  outputSchema: {
    type: "object",
    properties: {
      files: { type: "array", items: { type: "string" } },
    },
    required: ["files"],
  },
})
return r.files // objeto real, no texto por parsear tú
```

El host inyecta el contrato en el prompt, parsea la respuesta, valida contra el schema y
**repara una vez** con los errores concretos si el JSON no calza. Los tokens del reintento
se contabilizan.

## Ciclo de vida de un run

- **Background por defecto**: el resultado llega como follow-up; el panel del footer
  muestra fases (`Find` → `Verify` → `Report`), agentes y costo.
- **`workflow_status({ runId })`** — estado autoritativo de un run.
- **`workflow_stop({ runId })`** — detener un run en curso.
- **`workflow_retry({ runId })`** — reintentar un run fallido (replay de lo completado,
  sin re-pagar los agentes ya terminados).
- **`workflow_resume({ runId, budget? })`** — continuar un run que agotó presupuesto.
- Presupuesto opcional al lanzar: `workflow({ name, args, budget: { tokens: { hard: 500000 } } })`.

## Recetas rápidas

- **Pre-PR**: "corre un code-review del diff contra main" → revisa el top 10 antes de pushear.
- **Refactor grande**: "audita src/legacy con checks: funciones >50 líneas, exports sin
  usar, imports del barrel roto" → cross-validation mata los falsos positivos.
- **Decisión arquitectónica**: "multi-perspective de monorepo vs polyrepo, perspectivas:
  DX, CI, costo, contratación".
- **Desconfianza sana**: "adversarial-review de que el caching de proveedores no filtre
  keys entre sesiones, reviewers 3, threshold 0.66".

## Límites honestos

- **`deep-research` no está portado** (requiere web tools en sub-agentes, gap G4 — issue de
  seguimiento). Los 4 patrones operan sobre tu código y tu sesión.
- Los patrones son **scripts estáticos**: leen `args` en runtime (misma identidad de
  journaling entre corridas). Si necesitas lógica condicional, escribe un `script` propio.
- **Tier sin alias configurado degrada al modelo de la sesión** — no falla, pero tampoco
  ahorra. Revisa el panel de costo para confirmar que el routing está activo.
- Los sub-agentes **no lanzan workflows ni sub-agentes** (anti-recursión) y corren con las
  herramientas de código; no tienen acceso web.
- El sandbox valida los scripts: `parallel(nombre, record)` exige objeto de tareas (no
  array) y no se permiten `export`. Los patrones curados ya cumplen; tu script propio debe
  seguir el mismo formato.

## Relación con el resto de Frida

- **frida-subagents** (`Agent`): un sub-agente conversacional que puedes dirigir — ideal
  para investigación interactiva. Los **workflows** son orquestación determinista con
  fan-out/verificación — para trabajos anchos con criterio de calidad. Se complementan.
- **frida-permission-system**: cada sub-agente pasa por el mismo gate; sus bash se
  aprueban/desaprueban con tus reglas (el host no ejecuta bash del workflow por el gate,
  pero los agentes sí).
- **Panel del footer**: un solo panel para todos los runs (patrones y scripts propios).

## Buenos hábitos

- Arranca con runs pequeños (un check, 3 perspectivas) y escala — el costo se multiplica
  por el fan-out.
- Fija `budget.tokens.hard` en exploraciones grandes; es tu freno de mano.
- `threshold` alto en adversarial-review (0.66+) cuando el costo de un falso positivo es
  bajo; standard 0.5 para trabajo normal.
- Revisa `workflow_status` antes de `resume`/`retry` — el estado persistido manda.
