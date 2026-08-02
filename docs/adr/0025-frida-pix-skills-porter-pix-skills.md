# ADR-0025: Portear pix-skills como frida-pix-skills

**Estado**: Propuesto
**Fecha**: 2025-08-02
**Autor**: Edgar F. Fuentes Perea

## Contexto

Frida carga las skills de `~/.frida/skills` y `.frida/skills` como comandos
`/skill:<name>` nativos de Pi. Eso implica dos limitaciones:

1. Las descripciones de las skills viven en el **system prompt** desde el
   arranque, aunque no se usen (el baseline crece con cada skill).
2. No hay forma de que el **agente** cargue una skill mid-conversación: sólo el
   usuario puede invocarla (`/skill:name` o `$skill`).

`@xynogen/pix-skills` (v0.7.4, MIT) resuelve ambos con el patrón "el agente se
auto-promptea": un tool `read_skills` para descubrir y cargar skills on-demand,
skills off-context (`disable-model-invocation: true`) que no hinchan el system
prompt, interpolación de directivas `` !`cmd` `` con estado vivo del repo,
recursos tipo bundle y acceso al ecosistema Skills.sh.

### Por qué un porte y no instalar pix-skills como extensión externa

`pix-skills` depende del **TUI de Pi** (`@earendil-works/pi-tui` para `Text`,
`@xynogen/pix-pretty` y `pix-runtime` para el render/collapse de tools) y del
**ecosistema pix** (`pix-gate` con config en `~/.pi/agent/pix.json`). Frida **no**
usa el TUI de Pi (su composer vive en un webview) y tiene su propio sistema de
gates (`frida-permission-system`) y su agentDir propio (`~/.frida`, ADR-0010).
Instalar pix-skills tal cual dejaría el render roto y acoplaría a `~/.pi`.

Como ya ocurrió con `frida-args`, `frida-pipeline` (ADR-0021), `frida-subagents`
(ADR-0022), `frida-mcp-adapter` (ADR-0023) y `frida-multi-skills` (ADR-0024), el
patrón correcto es un **porte nativo embebido**.

## Decisiones del usuario

Se eligieron (todas las opciones recomendadas en la propuesta de diseño):

- **D1: Gate de directivas** → mapear a `frida-permission-system` (no depender de pix-gate).
- **D2: Render** → estándar de frida (descartar la capa TUI del upstream).
- **D3 + D4: Sin bundle de skills** → no incluir las 27 skills de pix-skills, para
  **evitar colisiones** de nombres con `frida-pipeline` (commit, review, plan, test…).
- **D5: Nombre del tool** → `read_skills` (paridad con pix).
- **D6: Skills.sh remoto** → incluir el porte de `remote.ts`.

## Decisiones

### D1: Gate mapeado a frida-permission-system (no pix-gate)

`pix-skills` clasifica las directivas con `@xynogen/pix-gate` (`classify`,
`buildRules`, `loadUserConfig`), que lee reglas del usuario desde
`~/.pi/agent/pix.json` vía `pix-runtime`. Frida tiene su propio gate disuasivo
(`src/gates/dangerous-commands.ts` con `isDangerousBash`). `frida-pix-skills`
mapea `directiveBlockReason(command)` a:

1. `hasShellMeta` (metacaracteres) → bloqueado.
2. `isDangerousBash(command)` (reglas de Frida) → bloqueado con el `reason` de Frida.

Sin dependencia del ecosistema pix.

**Diferencia intencional:** el upstream respeta las reglas extra del usuario
(`buildRules(loadUserConfig())`). En Frida esos patrones viven en el setting
`frida.gates.dangerousCommandSubstrings` (leído por el **host**, no disponible en
el runtime del tool de Pi). Para mantener el tool autónomo, las directivas se
gatean con las **reglas por defecto** del gate de Frida. Las directivas típicas
(`git status`, `git diff`) nunca las disparan; el subconjunto destructivo real
sí queda cubierto.

### D2: Render estándar de frida (capa TUI descartada)

El upstream define `renderCall`/`renderResult` con `Text` de `pi-tui` y
collapse con `pix-pretty`/`pix-runtime`. Frida renderiza todos los tools igual
con su mecanismo del webview (`ToolCard.tsx` + `summarizeResult`). El porte
**descarta** toda la capa de render (como ya hace `frida-context`) y registra el
tool con `pi.registerTool({name, label, description, promptSnippet,
promptGuidelines, parameters, execute})`. El `content.text` del resultado lleva
texto plano legible; los `details` estructurados quedan como metadata.

### D3 + D4: Sin bundle de skills (evitar colisión con frida-pipeline)

`pix-skills` empaqueta 27 skills (commit, review, plan, test, debug…). Frida YA
tiene `frida-pipeline` con 27 skills (porte de rpiv-pi) que comparten nombres.
Registrar ambos bundles vía `resources_discover` provocaría colisiones de
`/skill:<name>`. Decisión: **no incluir bundle propio**. `frida-pix-skills`
aporta **sólo la capacidad** (tool `read_skills` + interpolación + Skills.sh)
operando sobre las skills **ya existentes** del usuario/proyecto y las remotas.

Esto reduce el porte (sin `resources_discover`, sin `skills/`) y elimina la
colisión.

### D5: Nombre del tool `read_skills`

Paridad con pix-skills: si un usuario conoce el tool, el nombre es el mismo.

### D6: Skills.sh remoto incluido

Porte literal de `remote.ts` (`searchRemoteSkills` + `fetchRemoteSkill` + cache),
puro (sin deps pix, sólo `fetch` + `fs` + `path`). Único cambio: el cache vive en
`~/.frida/cache/skills.sh` (agentDir propio, ADR-0010) en vez de
`~/.cache/pi/skills.sh`.

## Módulos porteados

| Archivo | Origen pix-skills | Cambios |
| --- | --- | --- |
| `run.ts` | `src/run.ts` | Literal (spawn shell-free, bounded, non-throwing). |
| `remote.ts` | `src/remote.ts` | Literal; cache → `~/.frida/cache/skills.sh`. |
| `directive.ts` | `src/directive.ts` | Parte pura (sin `pix-gate`); `directiveBlockReason` → `gate.ts`. |
| `gate.ts` | (nuevo) | Mapeo `directiveBlockReason` → `frida-permission-system`. |
| `index.ts` | `src/index.ts` | `registerTool` sin render TUI; `discoverSkills` sobre `~/.frida/skills` + `.frida/skills`; sin `resources_discover`/bundle. |

**Descartado del upstream:** `renderCall`/`renderResult` (`Text`, `pix-pretty`,
`pix-runtime/collapse`), `once` (reimpl. trivial no necesario), `resources_discover`
(sin bundle), los `format*` con theme (eran para el render TUI).

## Plan de implementación

### Fase 1: Módulo frida-pix-skills

- [x] `run.ts` — porte literal (spawn shell-free).
- [x] `remote.ts` — porte literal (Skills.sh + cache `~/.frida`).
- [x] `directive.ts` — porte de la parte pura.
- [x] `gate.ts` — mapeo a `frida-permission-system`.
- [x] `index.ts` — factory + `registerTool("read_skills")`.

### Fase 2: Integración + tests

- [x] Registrar factory en `pi-session.ts` (tras `frida-multi-skills`).
- [x] Tests: directive + gate + remote (fetcher mock) + discovery/interp (30).
- [x] Suite completa verde (858 tests).

### Fase 3: Documentación

- [x] `docs/tools/frida-pix-skills.md`.
- [x] ADR-0025.
- [x] README (tabla Herramientas) + CHANGELOG `[Unreleased]` + `HELP_TOOLS`.

## Riesgos y mitigaciones

| Riesgo | Probabilidad | Mitigación |
| --- | --- | --- |
| Directivas que necesiten los `extraSubstrings` del usuario (host) | Baja | Documentado: reglas por defecto cubren los destructivos reales; directivas típicas no se ven afectadas |
| Contenido remoto malicioso ejecute comandos al cargarse | Baja | Las skills remotas **no** interpolan directivas (`remoteSource ? content : interpolateSkill`); se marcan untrusted |
| Skills.sh caído/rate-limited | Media | `search`/`fetch` fallan a un mensaje claro (isError); el cache local sigue sirviendo |
| Colisión con frida-pipeline | Nula | Sin bundle propio (D3/D4) |
| `disable-model-invocation` no respetado por el loader de Frida | Baja | Comportamiento nativo de Pi; el `DefaultResourceLoader` lo respeta |
