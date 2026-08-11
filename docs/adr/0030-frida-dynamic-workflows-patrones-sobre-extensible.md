# Patrón de porteo de `pi-dynamic-workflows` como capa de patrones sobre `frida-extensible-workflows`

**Estado:** aceptado (issue #19; bloqueado por #7 y #18).

## Contexto

[`@quintinshaw/pi-dynamic-workflows`](https://github.com/QuintinShaw/pi-dynamic-workflows) ofrece 5
patrones curados (`deep-research`, `code-review`, `adversarial-review`, `multi-perspective`,
`codebase-audit`) más una serie de características de runtime: stdlib de *quality-patterns*
(`verify`, `judgePanel`, `loopUntilDry`, `completenessCheck`, `retry`, `gate`), *model routing*
por `tier` (small/medium/big), `agent({schema})` con *bounded repair*, *measured usage*
(accounting real de tokens/costo), `meta` export con *per-phase routing*, *edit-and-resume*
posicional y un TUI `/workflows`.

Frida ya cuenta con **`frida-extensible-workflows`** (ADR-0028): porte de
`@juicesharp/rpiv-workflow` con su propio runtime (VM sandbox determinista, `agent()`/`parallel()`/
`pipeline()`/`phase()`/`log()`/`checkpoint()`), journaling/resume por *path/identity* (`RunStore`),
panel en el footer, telemetría y un tool `workflow` para ejecuciones en *background*. Hoy coexiste
con `frida-workflow` (nativo `/wf`), por lo que **ya hay dos sistemas de workflow** montando paneles
en el footer.

Un matiz decisivo: en Frida (extensión de VS Code) los módulos (`frida-extensible-workflows`,
`frida-workflow`, `frida-worktree`, …) **no son paquetes instalables independientes** como en pi
CLI; son módulos del **mismo `.vsix`** integrados en un único bundle (`extension.ts`). Por tanto,
"conflicto entre extensiones" en Frida se traduce en **dos módulos registrando el mismo tool /
panel / comando**. Crear un tercer runtime de workflow registraría un tercer tool `workflow`, un
tercer panel y un tercer store — saturación y ambigüedad, no aislamiento.

Los 5 patrones, además, **no usan** `verify`/`judgePanel`/`checkpoint`/`workflow()` anidado:
los reimplementan *inline* con `agent()`+`parallel()`. La stdlib de *quality-patterns*, por
tanto, **no es un bloqueo**: son funciones puras construibles sobre los primitivos que ya existen.

## Decisión

**D1 — Capa de patrones, no runtime nuevo.** Se crea un módulo
`src/tools/frida-dynamic-workflows/` que **se monta sobre** `frida-extensible-workflows`:
reutiliza su runtime, su tool `workflow`, su panel del footer y su `RunStore`. **No registra**
tool, panel, store ni comando nuevo → **cero conflicto** con los módulos existentes.

**D2 — Reimplementar, no trasladar.** Las características portables (stdlib de
*quality-patterns*, los 5 patrones como catálogo, `tier` routing, `agent({schema})`,
*measured usage*) se **reimplementan** sobre el runtime de `@juicesharp/rpiv-workflow`. NO se
copia `@quintinshaw/pi-dynamic-workflows` tal cual: su runtime es distinto (journaling por
*callIndex* posicional + *hash* vs el *path/identity* de `RunStore`), sus APIs no son
intercambiables y un traslado literal mezclaría dos filosofías de orquestación.

**D3 — Alcance acotado a lo portable.** Quedan **fuera de alcance** las características
propietarias del runtime de quintinshaw que o no aplican en VS Code o no las necesitan los 5
patrones: *edit-and-resume* posicional (`resumeFromRunId`) y el TUI `/workflows` navigator
(ambas son superficies de pi TUI). El *resume* de Frida (por *path/identity*) sigue siendo el
canal de recuperación.

**D4 — Dependencia de estabilización.** Este trabajo **no inicia** hasta que **#7** (panel de
workflow intermitente) y **#18** (tokens de subagentes no contabilizados) estén resueltos y
validados. Razón: `tier`/`budget`/`schema` se construyen sobre un runtime que hoy es
intermitente (#7) y cuyo *measured usage* aún no contabiliza tokens (#18) — exactamente el
*accounting* que esta capa necesita.

### Mapeo portable vs propietario

| Característica de pi-dynamic | ¿Ampliable sobre `frida-extensible-workflows`? | Esfuerzo |
| --- | --- | --- |
| Stdlib de *quality-patterns* (`verify`, `judgePanel`, `loopUntilDry`, …) | ✅ Funciones puras sobre `agent()`/`parallel()` | Bajo |
| Los 5 patrones (scripts) | ✅ Registrar en `workflow_catalog` | Bajo (adaptar `export`/`schema`/`tier`) |
| `tier` routing (small/medium/big) | ✅ Análogo a `resolveRoleOverrides` (role→model) | Medio |
| `agent({schema})` *structured output* | ✅ En el spawner (*outputSchema* + validar) | Medio |
| *Measured usage* (tokens/costo) | ✅ = issue **#18** | Medio |
| `meta` export + *per-phase routing* | ✅ Parser pequeño | Bajo |
| *Edit-and-resume* posicional | ⚠️ Modelo de journaling distinto | Alto (los 5 no lo usan) |
| TUI `/workflows` navigator | ❌ Es de pi TUI, no VS Code | N/A |

## Alternativas consideradas

- **A — Ampliar `frida-extensible-workflows` *inline* (mismo módulo).** Mismo destino técnico que
  la D1 pero sin módulo separado. **Descartada** por mezclar el runtime base con la capa de
  patrones: se prefiere aislar los patrones en su propio módulo para que el runtime evolucione con
  su upstream (ADR-0028) sin arrastrar los patrones.
- **B — Extensión nueva `frida-dynamic-workflows` con runtime propio** (porte fiel de
  `@quintinshaw/pi-dynamic-workflows`). **Descartada** por conflicto: registraría un **tercer**
  tool `workflow`, un tercer panel y un tercer store, duplicando infra (panel, telemetría,
  delivery) y saturando el footer. Va en contra del requisito explícito de evitar conflictos entre
  módulos.

## Consecuencias

**Positivas**

- **Cero conflicto**: ningún tool/panel/comando nuevo; se enriquece el runtime existente.
- **Convergencia con #18**: el *measured usage* de pi-dynamic **es** el *accounting* de tokens que
  #18 introduce; resolver #18 habilita `tier`/`budget` reales.
- **Un solo lugar de verdad** para workflows en *background*; el módulo de patrones es sólo una
  capa de catálogo + helpers.
- **Código aislado**: los patrones viven en su propio directorio, desacoplados del runtime base.

**Negativas**

- **Reimplementar, no copiar**: las características se rehacen sobre el runtime de juicesharp;
  no hay traslado literal ni se hereda automáticamente del upstream de quintinshaw.
- **Acoplamiento a la estabilidad del runtime base**: si `frida-extensible-workflows` regresa
  (#7) o su *accounting* es incorrecto (#18), la capa de patrones hereda el defecto. De ahí la
  D4.
- **Features propietarias no disponibles**: *edit-and-resume* posicional y TUI quedan fuera; el
  *resume* se reduce al modelo por *path/identity* de `RunStore`.

## Referencias

- Issue **#19** (este trabajo) — bloqueado por **#7** y **#18**.
- ADR-0028 — porte de `frida-extensible-workflows` (runtime base sobre el que se monta esta capa).
- Upstream: <https://github.com/QuintinShaw/pi-dynamic-workflows>.
