# `frida-args`

> **Estado:** ✅ porte de `@juicesharp/rpiv-args` v2.3.0 (MIT) como extensión nativa
> embebida · referencia: [rpiv-args](https://www.npmjs.com/package/@juicesharp/rpiv-args)

Argumentos y sustitución de shell para **skills**: pasa parámetros a una skill
como si fuera un comando de shell (`$1`, `$ARGUMENTS`) e incrusta la salida real
de comandos (`!`git status -s``) en el prompt **antes** de que el modelo lo lea.

## ¿Qué es?

Frida hereda de Pi el comando `/skill:<nombre>`, que inserta el cuerpo de una
skill (`.frida/skills/`, `~/.frida/skills/`) en el prompt. Por defecto, una skill
es texto fijo: o escribes una copia por cada caso, o el modelo debe ir a buscar
el contexto (estado de git, rama, etc.) con tools.

`frida-args` añade dos capacidades encima de ese mecanismo, **sin romperlo**: si
una skill no usa placeholders ni sintaxis de shell, la salida es byte-idéntica a
la expansión nativa de Pi.

- **Argumentos estilo shell** — `$1`, `$2`… `$N`, `$ARGUMENTS`, `$@`, `${@:N}`,
  `${@:N:L}`, divididos con comillado estilo shell, de modo que
  `/skill:deploy "staging server" --force` pone `staging server` en `$1`.
- **Sustitución de shell** — los `` !`cmd` `` inline y los bloques ```` ```! ````
  se ejecutan primero y el modelo lee la **evidencia** en vez de decidir ir a
  buscarla.

Es un **porte** de `@juicesharp/rpiv-args` (mismo comportamiento y contratos),
reorganizado como extensión embebida de Frida (patrón de `frida-context` /
`frida-lens`) en vez de paquete pi-extension suelto.

## ¿Cuándo usarla?

- **Skills parametrizadas** — una sola skill `deploy` sirve para cualquier
  servicio/entorno, en vez de copias hard-codeadas por caso.
- **Contexto vivo en el prompt** — `` !`git status -s` `` o `` !`git log -5 --oneline` ``
  ponen el estado real del repo *antes* de que el modelo actúe → menos
  ida-vuelta de "voy a revisar…".
- **Plantillas que referencian assets** — `${SKILL_DIR}/checklist.md` apunta a un
  archivo hermano de la skill sin importar cómo se instaló.

**NO la uses si** lo que necesitas es **orquestar** varias etapas (skills en
cadena, loops, jueces): eso es [frida-workflow](./frida-workflow.md). Y recuerda
que las skills son *instrucciones*; si quieres añadir un **tool** o **provider**
reutilizable, usa una [extensión](./extensions.md).

## Conceptos

| Término | Significado |
| --- | --- |
| **Skill** | Un `SKILL.md` en `.frida/skills/` o `~/.frida/skills/`. Sólo instrucciones. |
| **Placeholder** | Token del cuerpo que se reemplaza por un argumento: `$1`, `$ARGUMENTS`, … |
| **Sustitución de shell** | `` !`cmd` `` o bloque ```` ```! ````: se ejecuta y su salida reemplaza el token. |
| **Skill input:** | Etiqueta del trailer que lleva los argumentos crudos tras `</skill>`. |
| **Protocolo de invocación** | Sección que `frida-args` antepone al system prompt cada turno. |

## Uso

1. Crea una skill con un placeholder en el cuerpo:

   ```yaml
   ---
   name: deploy
   description: Despliega un servicio a un entorno
   ---

   Despliega el servicio $1 a $2.
   Rama actual: !`git branch --show-current`
   ```

2. Invócala con argumentos:

   ```text
   /skill:deploy api production
   ```

El modelo recibe el cuerpo con `$1`→`api`, `$2`→`production`, la **rama real** en
lugar del comando `git`, y un `Skill input: api production` final que marca la
entrada cruda.

## API / DSL

### Placeholders de argumentos

La sustitución corre **sólo** si el cuerpo contiene al menos uno de estos tokens.

| Placeholder | Reemplazado por | Ejemplo (`/skill:foo a b c d`) |
| --- | --- | --- |
| `$1`, `$2`… `$N` | El N-ésimo argumento, 1-indexado | `$2` → `b` |
| `$ARGUMENTS` | Todos los argumentos unidos por un espacio | `a b c d` |
| `$@` | Idéntico a `$ARGUMENTS` | `a b c d` |
| `${@:N}` | Argumentos desde la posición N | `${@:2}` → `b c d` |
| `${@:N:L}` | L argumentos empezando en N | `${@:2:2}` → `b c` |

**Reglas de indexado:**

- 1-based: `$1` es el primer argumento.
- Fuera de rango → cadena vacía (no un `$3` literal). `/skill:foo a` deja `$2` como `""`.
- Dígitos greedys: `$11` es el undécimo argumento.
- En `${@:N}` / `${@:N:L}`, `N` se clampea a `≥ 1`; un slice que empieza pasado el fin → cadena vacía.

**Orden de sustitución** (determinante): `$N` → `${@:N[:L]}` → `$ARGUMENTS` → `$@`.
Como `$N` corre primero, un valor que contenga `$1` **no** se re-expande al caer
en el cuerpo vía `$ARGUMENTS`. No hay sustitución recursiva.

**Tokenización:** el string tras `/skill:<name>` se divide estilo shell — split
por espacio y tab (los runs colapsan), comillas dobles y simples agrupan
multi-palabra, los estilos pueden mezclarse (`"a b"c` → `a bc`).

```text
/skill:deploy "staging server" --force
```

→ `$1` = `staging server`, `$2` = `--force`, `$ARGUMENTS` = `staging server --force`

### Variables de runtime

Se sustituyen en **cada** invocación, haya o no placeholders de argumentos.

| Variable | Reemplazado por |
| --- | --- |
| `${SKILL_DIR}` | Ruta absoluta del directorio que contiene la skill |
| `${SESSION_ID}` | El id de sesión actual |

`${SKILL_DIR}` es siempre `dirname()` del archivo de la skill, así una skill
puede referenciar un asset hermano (`${SKILL_DIR}/template.md`) sin importar cómo
se instaló. En Windows se normaliza a barras; en POSIX se preserva byte a byte.
`${FOO}` desconocidos se dejan intactos.

### Sustitución de shell

| Forma | Comportamiento |
| --- | --- |
| `` !`command` `` | Inline. Una sola línea (nunca cruza newline). Exige ≥ 1 char. |
| ```` ```!\n…\n``` ```` | Bloque. Multilínea; los newlines se preservan y el bloque entero va al shell. |

Ambas corren en **cada** invocación, haya o no placeholders. La salida del comando
reemplaza el `` !`…` `` o el fence antes de que el modelo vea nada.

**Semántica:**

- **Directorio de trabajo** — `process.cwd()` (el cwd de la sesión de Frida), no el
  directorio de la skill. Usa `${SKILL_DIR}` si necesitas una ruta relativa a la skill.
- **Secuencial** — los comandos de un cuerpo corren uno a uno, en orden, nunca en
  paralelo. `` !`mkdir x` `` seguido de `` !`ls x` `` es seguro.
- **Bloques antes que inlines** — la salida de un bloque se enmascara durante la
  pasada inline, así un stdout de bloque con `` !`algo` `` no se re-ejecuta.
- **Shell** — `sh -c` en macOS/Linux, `powershell.exe -Command` en Windows.

**Errores y presupuesto de salida:** los errores se inlinean para que el resto de
la skill igual llegue al modelo.

| Situación | Texto sustituido |
| --- | --- |
| Timeout | `[Shell error: timed out after Ns]` |
| Exit != 0 | `[Shell error: exit code N]` seguido del stderr |
| Éxito con stderr | stdout, luego `[stderr]` en su línea, luego stderr |

La salida se acota a **50 KB / 2000 líneas**, truncada por la cola (donde suelen
estar los fallos), con footer `[truncated: hit …]`. El tope aplica también a la
ruta de error. El timeout gana sobre el exit code.

**Modelo de confianza:** el orden es argumentos → variables → shell. Un argumento
que contenga `` !`echo hi` `` y caiga en el cuerpo vía `$ARGUMENTS` **se ejecutará**.
Es deliberado: el autor de la skill y el usuario local son de confianza. Trata las
invocaciones `/skill:` con la misma confianza que tu propio shell.

## Ejemplos

### Skill con argumentos libres (`$ARGUMENTS`)

```yaml
---
name: fix-issue
description: Corrige un issue por número o descripción
---

Corrige el siguiente issue: $ARGUMENTS
```

```text
/skill:fix-issue la página de login truena en móvil
```

→ `Corrige el siguiente issue: la página de login truena en móvil`

### Skill estructurada (posicionales + shell)

```yaml
---
name: migrate-component
description: Migra un componente entre frameworks
---

Migra el componente $1 de $2 a $3.
Estado del repo: !`git status -s`
```

```text
/skill:migrate-component SearchBar React Vue
```

El modelo recibe:

```text
<skill name="migrate-component" location="/path/to/migrate-component/SKILL.md">
References are relative to /path/to/migrate-component.

Migra el componente SearchBar de React a Vue.
Estado del repo: M src/SearchBar.tsx
</skill>

Skill input: SearchBar React Vue
```

> Prefiere `$ARGUMENTS` salvo que la invocación sea realmente estructurada. Un
> posicional que reciba lenguaje natural (`/skill:migrate-component migra el
> search porfa`) se rompe: `$1`=migra, `$2`=el, `$3`=search.

### Skill con assets relativos y bloque shell

```markdown
Sigue el checklist en ${SKILL_DIR}/checklist.md antes de editar nada.

\`\`\`!
node --version
npm ls --depth=0 2>/dev/null | head -20
\`\`\`
```

## Configuración

| Clave | Tipo | Default | Descripción |
| --- | --- | --- | --- |
| `shell-timeout` (frontmatter de la skill) | número (seg) | `120` | Techo por comando `` !`cmd` `` / ```` ```! ```` de **esa** skill. `0` desactiva el timer. |

`frida-args` no lee archivo de config ni variables de entorno. La única perilla
es el frontmatter `shell-timeout` de cada skill:

```yaml
---
name: commit
description: Redacta un mensaje de commit desde el working tree
shell-timeout: 30
---
```

| Valor | Efecto |
| --- | --- |
| ausente | 120 s |
| número positivo (`5`, `0.5`) | A milisegundos; los sub-segundo se respetan |
| `0` | Timer desactivado |
| negativo, string, `true`, `.nan`, `.inf` | Fallback silencioso a 120 s |

## Integración con Frida

- **Registro:** extensión embebida en `extensionFactories` de `pi-session.ts`
  (`createFridaArgs()`), junto a `frida-lens` / `frida-context` / `frida-agent-browser`.
  Siempre activa — no hay toggle.
- **Modo webview:** es 100% headless (sólo transforma texto y el system prompt);
  no registra UI Ink, así que funciona completo bajo `mode: "rpc"` + `bindExtensions`.
- **Sesiones hijas (workflow):** el loader curado de las sesiones hijas **no** carga
  `.frida/extensions`, pero sí ven las skills globales de `~/.frida/skills/`.
  `frida-args` intercepta `/skill:` en cualquier sesión que cargue la extensión.
- **Hot-reload:** `/reload` invalida el índice de skills (hook `session_start` con
  `reason: reload|startup`), así que añadir/renombrar una skill + `/reload` la
  reconoce.
- **No-op seguro:** una skill sin placeholders, sin `${…}` y sin sintaxis de shell
  emite bytes idénticos a la expansión nativa de Pi.

## Arquitectura / Internals

```text
src/tools/frida-args/
  index.ts            — factory createFridaArgs() + toda la lógica:
                         • hooks: input + before_agent_start + session_start
                         • parseCommandArgs / substituteArgs (byte-equiv. a Pi)
                         • substituteVariables (${SKILL_DIR}/${SESSION_ID})
                         • resolveShellTimeoutMs (frontmatter shell-timeout)
                         • executeShellInBody (mask-and-restore: bloques→inlines)
                         • buildSkillIndex (desde pi.getCommands(), cache lazy)
```

Flujo de extremo a extremo en el hook `input`:

```text
/skill:deploy api production
  → re-entrada? (empieza con <skill ) → continue
  → skill conocida en el índice? si no → continue (Pi la maneja)
  → leer SKILL.md → split frontmatter/body → resolver shell-timeout
  → hadTokens? → substituteArgs($1/$ARGUMENTS/…)   [sólo si había tokens]
  → substituteVariables(${SKILL_DIR}/${SESSION_ID}) [siempre]
  → executeShellInBody(!`cmd` / ```!)              [siempre]
  → buildSkillBlock(<skill …>) byte-exacto
  → emitir: appendArgs (sin tokens) | appendSkillInput "Skill input:" (con tokens)
```

Tres detalles de ingeniería a tener presentes:

- **Wrapper byte-exacto** `<skill name="…" location="…">` — es el contrato que el
  regex `parseSkillBlock` de Pi usa para detectar bloques de skill. No reformatear.
- **Índice desde el registry** — se construye con `pi.getCommands()` (no con un
  walk del FS), así reconoce skills de manifiestos de paquetes y las invocaciones
  programáticas `sendUserMessage("/skill:…")`.
- **`Skill input:` es un contrato** — si luego añades un resumen de lane/transcript
  que lo oculte para display, debe coincidir con esta etiqueta literal.

## Ver también

- [Extensiones](./extensions.md) — el sistema que carga esta y otras extensiones nativas
- [frida-workflow](./frida-workflow.md) — orquestación de skills (cadenas, loops, jueces)
- [README](../../README.md) — índice general de Frida Code
- [rpiv-args (fuente original)](https://www.npmjs.com/package/@juicesharp/rpiv-args) — MIT, juicesharp

## Estado y madurez

- ✅ **Argumentos** (`$1`/`$ARGUMENTS`/`${@:N:L}`) — porte byte-equivalente a Pi.
- ✅ **Variables** (`${SKILL_DIR}`/`${SESSION_ID}`) — siempre activas.
- ✅ **Shell** (`!`cmd`` / ```` ```! ````) — con timeout, presupuesto y errores inlineados.
- ✅ **No-op seguro** para skills existentes (salida idéntica a la expansión nativa).
- ✅ **Modo webview** (headless, rpc).
- ○ **Tests** — pendiente: los tests de regresión de rpiv-args (byte-exactitud,
  tokenización, slicing) deberían portarse para fijar los contratos.
- ○ **Rutas no cubiertas** — `session.steer()` / `session.followUp()` no pasan por
  el evento `input`, así los placeholders no se resuelven ahí (igual que rpiv-args).
