# Consolidación `frida-workflow` → `frida-extensible-workflows` (ejecución de D9)

**Estado:** aceptado (#39). **Ejecución diferida** — se registra la decisión y el plan;
la eliminación no se realiza hasta migrar `frida-pipeline` y el comando `/wf` (ver §Plan).
Cuando se ejecute, **ADR-0020 queda SUPERSEDED** por este ADR.

## Contexto

Frida tiene **dos** extensiones de orquestación, portes de orígenes distintos:

| | `frida-workflow` | `frida-extensible-workflows` |
| --- | --- | --- |
| Origen | `@juicesharp/rpiv-workflow` (ADR-0020) | `pi-extensible-workflows` (ADR-0028) |
| LOC | 5.225 | 7.620 |
| Modelo | **DSL declarativa** (grafo stages+edges, typebox) | **Script imperativo JS** (sandbox `node:vm`) |
| Primitivas | routing, loops, jueces, skill-contracts, outcomes, schemas | parallel, pipeline, checkpoint, budget, retry/resume, withWorktree |

El ADR-0028 ya tomó la **decisión D9** explícita:

> *"Recomendación: marcar `frida-workflow` como legacy y consolidar en
> `frida-extensible-workflows` (mayor funcionalidad). Migración gradual: los nuevos
> workflows usan `frida-extensible-workflows`."*

Este ADR **ejecuta D9** tras una auditoría de uso que confirma su premisa.

### Auditoría de uso (grep en todo `src/`)

`frida-workflow` **no es del todo código muerto**: `frida-pipeline` (3.014 LOC) depende
de ella y el comando `/wf` está activo en `extension.ts:2720`. Pero se verificó qué se
consume realmente:

**Lo que SÍ se usa** (grafo lineal + despacho de skills):

- `frida-pipeline` define 3 workflows (`build`/`vet`/`polish`) como **grafo puramente
  lineal** (`edges: { a: "b", b: "stop" }`) con stages `kind: "side-effect"` que
  despachan skills.
- `registerWorkflows` + comando `/wf` + `resumeWorkflow` (`/wf @ref`).
- Audit JSONL + panel `wireWorkflowPanel`.

**Features que son CÓDIGO MUERTO (cero consumidores verificados):**

| Feature | Consumidores |
| --- | --- |
| Jueces (`judge`/`verify`/`assess`/`panel`/`majority`) | 0 |
| Routing declarativo (`gate`/`match`/`defineRoute`) | 0 |
| Loops (`fanout`/`iterate`/`fanin`) | 0 |
| Skill-contracts (`registerSkillContracts`/`canCompose`) | 0 |
| DSL `defineWorkflow` | 0 (los workflows se definen como literales) |

## Decisión

**D1 — Ejecutar D9: consolidar en `frida-extensible-workflows`.** `frida-workflow` se
marca **legacy** y se elimina tras migrar a sus dos consumidores (`frida-pipeline` +
`/wf`). Elimina 5.225 LOC + 9 archivos de test + un bundle, y unifica el modelo de
orquestación en uno solo (script imperativo determinista con retry/resume).

**D2 — Paridad confirmada para todo lo que se usa.**

| Uso actual | Cobertura `frida-extensible-workflows` |
| --- | --- |
| Grafo lineal + despacho de skills | ✅ script con `pipeline()`/`agent()` |
| Sesiones hijas (`spawnChild`) | ✅ `agent()` |
| Resume (`/wf @ref`) | ✅ `workflow_resume`/`workflow_retry` (más robusto) |
| Audit/persistencia | ✅ `RunStore` (state/journal/snapshot — más rico) |
| Panel | ✅ `wireExtensibleWorkflowPanel` (ya existe) |
| Registry por nombre + `/wf` | ⚠️ parcial: tool `workflow({name})` + `workflow_status` cubren la función; **sin slash command `/wf` equivalente** |

**D3 — Único gap real: el slash command `/wf`.** No existe equivalente directo en
`frida-extensible-workflows` (se invoca vía la tool `workflow` del modelo o el picker
`/workflow`). La migración debe decidir: (a) eliminar `/wf` y usar la tool + picker, o
(b) conservar un thin-wrapper `/wf` que invoque `workflow`. Recomendación: **(a)** — el
picker `/workflow` ya es la superficie canónica.

**D4 — Las features código muerto se eliminan sin reemplazo.** Jueces, routing
declarativo, loops tipados, skill-contracts y la DSL `defineWorkflow` no tienen
consumidores → se borran. Si en el futuro se necesitan (p.ej. jueces para AiDD #38 /
# 19), se reimplementan sobre `frida-extensible-workflows` (patrón detached-auditor),
no se rescata `frida-workflow`.

**D5 — Ejecución diferida.** No se elimina nada hasta que `frida-pipeline` y `/wf`
estén migrados y verificados. `frida-workflow` queda marcado **legacy** mientras tanto
(comentario en `index.ts` + nota en su doc), sin nuevos consumidores.

## Plan de migración (5 pasos — trabajo del issue #39)

1. **Migrar `build`/`vet`/`polish`** de objetos `Workflow` lineales → funciones
   registradas vía `registerWorkflowExtension()` de `frida-extensible-workflows` (o
   scripts). Migración mecánica (secuencias simples), preservando orden de skills y
   handles.
2. **Migrar/eliminar el comando `/wf`** (`postWfCommand` en `extension.ts:2720`) →
   reemplazar por el picker `/workflow`.
3. **Desacoplar `frida-pipeline`** de `frida-workflow` (solo importa
   `registerWorkflows` + `type Workflow`).
4. **Eliminar** `src/tools/frida-workflow/` (5.225 LOC) + `test/frida-workflow/`
   (9 archivos) + bundle `frida-workflow.js` + `wireWorkflowPanel`.
5. **Marcar ADR-0020 como SUPERSEDED** por este ADR (D9 ejecutada).

## Alternativas consideradas

- **A — Mantener ambas (status quo).** Descartado: el ADR-0028 D9 ya decidió
  consolidar; mantener duplica 5.225 LOC y mantiene la confusión de modelo
  declarativo (rpiv) vs imperativo (pi-extensible).
- **B — Solo matar código muerto, conservar el runtime lineal + `/wf`.** Descartado:
  deja duplicado el motor de orquestación (dos runtimes de sesión-hija). La meta de D9
  es **un solo motor**, no solo limpiar primitivas sin uso.
- **C — Eliminar `frida-workflow` sin migrar `frida-pipeline`.** Descartado: rompería
  el pipeline (`build`/`vet`/`polish` son flujos principales) y el comando `/wf`.

## Consecuencias

**Positivas**

- Un solo motor de orquestación: -5.225 LOC, -9 archivos de test, -1 bundle.
- Elimina la confusión de dos modelos (declarativo vs imperativo) y la nota de "no
  cargar ambos simultáneamente" del ADR-0028.
- `frida-extensible-workflows` es **más capaz** (retry/resume/budget/worktree/parallel)
  — los workflows migrados ganan resiliencia gratis.
- Cierra la decisión D9 pendiente desde la Fase 7 del ADR-0028.

**Negativas**

- **Riesgo de migración:** `build`/`vet`/`polish` son superficie principal; la
  migración debe preservar comportamiento exacto (orden de skills, handles). Requiere
  verificación (tests E2E del pipeline).
- **Pérdida del slash `/wf`:** se reemplaza por el picker `/workflow` (D3). Cambio de
  UX para quien usaba `/wf` directamente.
- **Pérdida de features código muerto:** si en el futuro se necesitan jueces/routing
  tipados, hay que reimplementarlos sobre el nuevo motor (no rescatar código).

## Referencias

- Issue **#39**.
- **ADR-0020** (`frida-workflow`) — a SUPERSEDED cuando se ejecute.
- **ADR-0028** (`frida-extensible-workflows`) — **decisión D9** que este ADR ejecuta.
- **ADR-0021** (`frida-pipeline`) — el consumidor principal a migrar.
- Conexión con **#19** / **#38** (AiDD): las features avanzadas eliminadas (jueces,
  routing) se reimplementarían, si se necesitan, como patrones detached-auditor sobre
  `frida-extensible-workflows`, no rescatando `frida-workflow`.
