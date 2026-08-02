# `frida-pix-skills`

> **Estado:** ✅ porte de [`@xynogen/pix-skills`](https://www.npmjs.com/package/@xynogen/pix-skills)
> v0.7.4 (MIT, xynogen) como extensión nativa embebida · referencia:
> [pix-skills](https://github.com/xynogen/pix-mono/tree/main/packages/pix-skills) ·
> [ADR-0025](../adr/0025-frida-pix-skills-porter-pix-skills.md)

Carga **skills on-demand** con un tool (`read_skills`), interpola **salida de
comandos en vivo** (`` !`cmd` ``) al leerlas y da acceso al ecosistema
**Skills.sh**. Es el patrón "el agente se auto-promptea" de forma segura y
auditable: nada se inyecta solo, el agente carga lo que necesita y queda visible
en la conversación como una llamada a tool.

```text
read_skills()                                          → lista skills disponibles
read_skills(name="commit", full=true)                  → cuerpo completo (+ git status/diff vivos)
read_skills(search="react")                            → busca en Skills.sh (no descarga)
read_skills(source="nutlope/hallmark", name="hallmark", full=true)  → fetch+cache+load
```

## ¿Qué es?

Frida carga las skills de `~/.frida/skills` y `.frida/skills` como comandos
`/skill:<name>` nativos. Eso tiene dos costos: (1) sus descripciones viven en el
**system prompt** aunque no se usen, y (2) no hay forma de que el agente cargue
una skill **mid-conversación** sin que el usuario la invoque.

`frida-pix-skills` aporta la capa on-demand sin romper nada:

- **Tool `read_skills`** — el agente descubre (`read_skills()`), lee la
  descripción, o carga el cuerpo completo (`full=true`) cuando lo necesita.
- **Skills off-context** — una skill con `disable-model-invocation: true` en su
  frontmatter **no** se inyecta en el system prompt; el agente la encuentra vía
  `read_skills()`. Así puedes tener decenas de skills con un baseline plano.
- **Interpolación `` !`cmd` ``** — al cargar `full=true`, las directivas embebidas
  se evalúan y la skill llega **pre-poblada** con estado vivo del repo
  (`` !`git status -sb` ``, `` !`git diff --cached` ``).
- **Recursos tipo bundle** — `references/` se lee al contexto; `scripts/` y
  `assets/` se copian al proyecto con `output=`.
- **Skills.sh** — busca skills de la comunidad y cachea una seleccionada
  (validada, sandboxed) desde su repo público de GitHub.

Es un **porte** de `pix-skills`, **sin bundle propio** (no añade skills nuevas →
no colisiona con `frida-pipeline`): opera sobre las skills **ya existentes** del
usuario/proyecto y las remotas.

## ¿Cuándo usarla?

- **System prompt limpio** — skills poco usadas (deploy específico, runbooks)
  con `disable-model-invocation: true`; el agente las carga on-demand.
- **Estado del repo pre-poblado** — el agente carga `commit` y recibe el diff
  real sin tener que ir a buscarlo con tools.
- **Skills de la comunidad (Skills.sh)** — probar una skill pública sin
  instalarla manualmente.
- **Skills con assets** — copiar una plantilla/script de un bundle al proyecto.

**NO la uses si** la skill ya vive en el system prompt y se invoca seguido: el
overhead de un tool call no aporta. Tampoco para invocar skills tú mismo como
usuario — para eso usa `/skill:name` o [`$skill`](./frida-multi-skills.md)
(`frida-multi-skills`).

## Conceptos

| Término | Significado |
| --- | --- |
| **`read_skills`** | Tool del agente para descubrir/cargar skills on-demand. |
| **`disable-model-invocation: true`** | Frontmatter que mantiene una skill fuera del system prompt (off-context). |
| **Directiva `` !`cmd` ``** | Salida de comando embebida en la skill; se evalúa al cargar `full=true`. |
| **Bundle** | Skill en directorio (`SKILL.md` + `references/`/`scripts/`/`assets/`). |
| **Skills.sh** | Registro público de skills; `search` (informativo) + `source` (fetch). |

## Uso

```text
# Listar skills locales disponibles
read_skills()

# Leer sólo la descripción
read_skills(name="commit")

# Cargar el cuerpo completo (interpola !`cmd`)
read_skills(name="commit", full=true)

# Leer una referencia UTF-8 al contexto
read_skills(name="docx", resource="references/compatibility.md")

# Copiar un script/asset al proyecto (no se ejecuta)
read_skills(name="docx", resource="scripts/render.ts", output=".frida/tools/render.ts")

# Buscar en Skills.sh (no descarga nada)
read_skills(search="react-components")

# Fetch+cache+load de una skill pública seleccionada
read_skills(source="nutlope/hallmark", name="hallmark", full=true)

# Re- descargar una skill cacheada
read_skills(source="nutlope/hallmark", name="hallmark", full=true, refresh=true)
```

## API / DSL

### Parámetros de `read_skills`

| Parámetro | Tipo | Descripción |
| --- | --- | --- |
| `name` | string? | Skill a leer. Omitir para listar todas. |
| `full` | bool? | `true` → cuerpo completo (interpola directivas). Default `false` → sólo descripción. |
| `resource` | string? | Ruta bundle-relativa bajo `scripts/`, `references/` o `assets/`. |
| `output` | string? | Destino proyecto-relativo para copiar el recurso. Requerido para `scripts/` y `assets/`. |
| `search` | string? | Busca en Skills.sh. **No** se combina con `name`/`source`/`resource`/`full`. |
| `source` | string? | `owner/repo` público de GitHub para fetch+cache. Requiere `name`. |
| `refresh` | bool? | Re-descarga la skill remota en vez de usar el cache. |

### Seguridad de las directivas

Las directivas `` !`cmd` `` se gatean **sin diálogo** (igual que pix-skills),
mapeadas al gate de Frida (`frida-permission-system`):

- **Shell-meta** (`;|&$\`><(){}`) → bloqueado.
- **Comando destructivo** (reglas de `dangerous-commands.ts`: `rm -rf /`, `mkfs`,
  `dd` a dispositivo, fork bomb, etc.) → bloqueado.
- Si pasa → ejecución **shell-free** (spawn argv directo), bounded (10s, 16KB).
- Bloqueadas → marker `[blocked: reason]` inline (el autor lo ve y lo arregla).
- Escape `` \!`cmd` `` → literal (para documentar la sintaxis).

> **Diferencia vs pix-skills:** el upstream respeta reglas extra del usuario
> desde `~/.pi/agent/pix.json`. Frida guarda esos patrones en el setting
> `frida.gates.dangerousCommandSubstrings` (que lee el host, no el runtime del
> tool), así que aquí las directivas se gatean con las **reglas por defecto** del
> gate de Frida. Las directivas típicas (`git status`, `git diff`) nunca las
> disparan.

### Seguridad de Skills.sh

Dos llamadas deliberadas: `search` es informativo (nunca descarga); `source`
fetchea la seleccionada. Validación de `owner/repo` (slug), retención sólo de
`SKILL.md` + `references/scripts/assets`, límites de files (100) y bytes
(10MB), escritura atómica y re-validación del `name` del frontmatter. El
contenido remoto se marca **untrusted** y **no** interpola directivas.

## Ejemplos

### Skill off-context cargada on-demand

```markdown
---
name: deploy-staging
description: Despliega a staging
disable-model-invocation: true
---
### Estado actual
!`git status -sb`
...pasos...
```

El agente, cuando necesite deployar:

```text
read_skills(name="deploy-staging", full=true)
# → llega con `git status -sb` ya evaluado, sin haber ocupado tokens en el system prompt hasta ahora
```

### Copiar un asset de un bundle

```text
read_skills(name="docx", resource="assets/template.docx", output=".frida/tools/docx/template.docx")
```

### Explorar Skills.sh

```text
read_skills(search="anti-slop")
# → "skills.sh matches ... 1. hallmark · nutlope/hallmark · 1.2K installs"
read_skills(source="nutlope/hallmark", name="hallmark", full=true)
```

## Configuración

Sin settings propios. Las skills se buscan en `~/.frida/skills` (global) y
`.frida/skills` (proyecto, precedencia en colisión). Cache remoto en
`~/.frida/cache/skills.sh`.

## Integración con Frida

- **Registro:** factory `createFridaPixSkills()` en `extensionFactories` de
  `pi-session.ts`, tras `frida-multi-skills`.
- **Render:** estándar de frida (webview `ToolCard.tsx`); **sin** `renderCall`/
  `renderResult`/`Text`/pi-tui (descartado del upstream).
- **Gate:** directivas → `frida-permission-system` (`dangerous-commands.ts`).
- **Sesiones / gates:** registra un tool del modelo; sin paneles propios.

## Arquitectura / Internals

```text
src/tools/frida-pix-skills/
  index.ts        # factory + registerTool("read_skills"); discoverSkills, recursos,
                  #   interpolateSkill. Roots: ~/.frida/skills + <cwd>/.frida/skills
  directive.ts    # parser puro de !`cmd` (findCommandDirectives, tokenizeCommand, hasShellMeta)
  gate.ts         # directiveBlockReason → mapeo a frida-permission-system
  run.ts          # runArgv: spawn shell-free, bounded, non-throwing (porte literal)
  remote.ts       # Skills.sh search + fetch/cache (porte literal, paths → ~/.frida)
```

```text
test/frida-pix-skills/
  frida-pix-skills.test.ts  # directive + gate + remote (fetcher mock) + discovery/interp (30 tests)
```

## Ver también

- [README](../../README.md) — índice general de Frida Code
- [frida-multi-skills](./frida-multi-skills.md) — invocación `$skill` inline + multi
- [frida-args](./frida-args.md) — argumentos y shell en `/skill:name <args>`
- [frida-permission-system](./frida-permission-system.md) — el gate que clasifica directivas
- [ADR-0025](../adr/0025-frida-pix-skills-porter-pix-skills.md) — decisión de porte

## Estado y madurez

Porte del núcleo lógico de `pix-skills` (skill loader + interpolación + Skills.sh
remoto). Diferencias intencionales sobre el upstream, en el
[ADR-0025](../adr/0025-frida-pix-skills-porter-pix-skills.md):

- **Sin bundle de skills** (no añade skills nuevas → no colisiona con
  `frida-pipeline`).
- **Render estándar de frida** (capa TUI del upstream descartada).
- **Gate mapeado a `frida-permission-system`** (no depende del ecosistema pix).
- **Cache y roots bajo `~/.frida`** (agentDir propio, ADR-0010).
- **Limitación conocida:** las directivas se gatean con las reglas por defecto
  del gate de Frida, sin respetar `frida.gates.dangerousCommandSubstrings`
  (viven en el host). Las directivas típicas no se ven afectadas.
