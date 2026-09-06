# How-to: frida-permission-system — permisos y auto-aprobación

> **frida-permission-system** (ADR-0016) es el gate de permisos de Frida: decide
> qué puede hacer el agente **sin preguntarte** (✓), qué te **consulta antes**
> (●) y qué **nunca hace** (✕). Desde #55 todo se controla desde la pantalla
> **Configuración → Auto-Aprobación** del webview — el panel de esta guía — y
> cada cambio aplica **en vivo**, sin recargar la sesión.
>
> Referencia técnica: [docs/tools/frida-permission-system.md](tools/frida-permission-system.md) ·
> ADR-0016 · [ADR-0001](../adr/0001-alcance-disuasivo-no-perimetro.md) (el gate
> es disuasivo, no un perímetro de seguridad).

## El modelo en 30 segundos

```
✓ permitir  →  pasa sin preguntar (silencioso)
● preguntar →  abre el diálogo de aprobación
✕ negar     →  bloquea con mensaje al modelo (siempre gana)
```

Cuatro **superficies** deciden, en capas (la más restrictiva gana entre capas):

| Superficie | Qué decide | Ejemplo |
| --- | --- | --- |
| `path` | **Archivos** — aplica a cualquier tool que los toque | `*.env: ✕` |
| `bash` | **Comandos** shell (wildcard sobre el comando) | `git push *: ●` |
| `tool` | **Tools** individuales (read, edit, bash, MCP, …) | `write: ●` |
| `external_directory` | Salir de la **carpeta de trabajo** | `●` (default) |

Y **dentro** de una superficie, si varios patrones matchean, también gana el más
restrictivo — `*.env: ✓` + `*.env.example: ✕` → el `.env.example` queda negado.
(Esto difiere de pi-permission-system, donde gana el último patrón listado.)

Sobre esas capas vive el **modo global** (el interruptor grande, escala de 5
niveles #197): decide qué hace con los `●`. Una cosa **NUNCA** se quita:

- `✕` **niega siempre** (deny gana, sin excepciones — el «candado» es inmune
  al modo: bloquea incluso en YOLO).

Y el **force-ask** — bash compuesto (`&&`, `|`, `sudo`, `bash -c`, …) y acceso
fuera del workspace — sobrevive a `auto-edit` y `auto-guarded`; sólo `auto`
(YOLO) lo suelta (semántica histórica, ver los niveles abajo).

Además hay **deny hardcodeados** que no se pueden apagar desde el panel:
secretos (`.env`, `~/.ssh`, credentials, …) y comandos destructivos
(`rm -rf /`, `chmod -R 777 /`, `sudo rm`, `gh repo delete`, gestores de
contraseñas, … — ver [El candado](#el-candado-de-comandos-196)). Por eso un
`path: ✓` sobre `*.env` no sufre: la capa hardcodeada lo niega igual. Ajusta
esos sets con los settings `frida.gates.*`
(ver [Configuración](tools/frida-permission-system.md#configuración)).

## Los cinco niveles (#197)

El candado (`✕` + deny hardcodeados) está activo en TODOS; los niveles difieren
en fricción de aprobación, no en daño potencial. Elígelo por la TAREA:

| Nivel | Modo | Qué pasa con los `●` | Tarea típica |
| --- | --- | --- | --- |
| 🔍 **Solo lectura** | `plan` | edit/write **imposibles** (ocultos del catálogo del LLM + deny del gate); bash pregunta | entender un repo ajeno, auditoría, research |
| ✅ **Normal** | `manual` | abren el diálogo | default — feature diaria en repos que importan |
| ✏️ **Auto-edit** | `auto-edit` | edit/write pasan; bash y force-ask siguen preguntando | refactor confiado, formato masivo |
| 🚀 **Autónomo** | `auto-guarded` | TODO pasa **salvo force-ask**: bash compuesto y rutas externas siguen preguntando | migraciones largas, tareas desatendidas — el «yolo seguro» |
| ⚡ **YOLO** | `auto` | TODO pasa (incl. force-ask) — sólo el candado protege | sandbox, experimentos desechables |

Cambias el nivel desde el **footer** de la conversación (clic en el ícono de
escudo cicla la escalera) o desde el panel — y al salir de `manual` hacia un
modo autónomo Frida pide confirmación (no quieres activar YOLO por accidente;
`plan` no la pide: es MÁS restrictivo). El **borde rojo** del composer indica
YOLO; el **ámbar**, Autónomo. El modo vive **sólo durante la sesión** (#199):
toda sesión nueva o reabierta arranca siempre en ✅ Normal — nunca heredas
autonomía de la sesión anterior. La POLÍTICA (superficies) sí persiste en
`permission.json` (#55).

## El candado de comandos (#196)

Capas de deny de bash, en orden de evaluación — todas inmunes al modo:

1. **Substrings tuyos** — `frida.gates.dangerousCommandSubstrings` (literal).
2. **Regex ERE tuyas** — `frida.gates.dangerousCommandPatterns` (POSIX-ERE con
   clases `[[:space:]]` auto-convertidas; anclas `^` por línea). Un patrón
   inválido se ignora (fail-open): jamás rompe el gate.
3. **Denylist compartido multi-agente** — `frida.gates.dangerousCommandDenylistPath`
   apunta a un archivo de regex ERE (p. ej.
   `~/.agents/hooks/dangerous-patterns.txt`, el formato de
   [davidondrej/skills](https://github.com/davidondrej/skills/tree/main/hooks))
   compartible con Claude Code, Cursor, Codex y Pi. Re-lectura automática al
   cambiar el archivo; inexistente/ilegible → se ignora.
4. **RULES hardcodeadas** — `src/gates/dangerous-commands.ts`: rm raíz/home,
   fork bomb, mkfs, dd a dispositivo, `chmod 777 /`, `sudo rm`, `diskutil
   erase*`, `gh repo delete`, `gh auth token`, destruir reflog, CLIs de
   gestores de contraseñas, volcado de keychain, exportar llaves GPG privadas.

**Deliberadamente fuera del default** (opt-in vía settings o denylist):
`git push --force` (uso diario; `--force-with-lease` siempre libre) y
`curl | sh` (subjetivo). Los patrones listos para copiar están en la skill
global `global-agent-guardrails` (`~/.frida/skills/`).

Todo bloqueo llega al modelo con el patrón que lo disparó y la instrucción de
no reintentar; se registra en auditoría con source `dangerous_command`.

## El panel: Configuración → Auto-Aprobación

Ábrelo con el engrane ⚙ del webview (o desde el onboarding). Sección por
sección:

### Modo global

Dropdown + descripción del modo activo. Sincronizado con el footer.

### Tools

Un tri-state ✓/●/✕ por tool: `read`, `edit`, `write`, `bash`, `grep`, `find`,
`ls`, `todo`, `ask_user_question` y `*` (herramientas desconocidas — MCP,
extensiones de terceros). Si marcaste `bash` en ✕ **por error**, acá está la
reversión: tri-state de vuelta a ● y listo — aplica en el próximo tool_call.
Bonus: un tool en ✕ **desaparece del catálogo del LLM** al inicio del siguiente
turno (el agente deja de "verlo" y de alucinar su uso).

### Paths (wildcards)

Chips con estado y 🗑 para patrones de archivos. Formas útiles: `*.env`,
`*.pem`, `dist/*`, `~/.ssh/*`. La forma de abajo da de alta `patrón + estado`.
Los patrones cruzan herramientas: leer, editar o greppear un archivo negado da
igual.

### Comandos bash

Igual que Paths pero sobre el comando completo: `git push *`, `npm *`,
`rm -rf *`, `docker *`. Los deny hardcodeados siguen como capa extra.

### Fuera del workspace

Un solo tri-state para el CWD boundary: `●` (default) pregunta la primera vez
que el agente toca algo fuera de tu carpeta de trabajo. `✓` lo libera del todo
(útil en monorepos vecinos); `✕` lo encierra hermético. El force-ask de paths
externos desaparece sólo si pones `✓`.

### Aprobado en esta sesión

Cuando en el diálogo eliges «Sí, siempre» para un **patrón** (`npm *`, `src/*`),
el patrón vive aquí, en memoria. Revócalo con el × — el próximo uso vuelve a
preguntar **de inmediato**. Sin tocar nada, se olvidan solos al iniciar sesión
nueva (`/new`).

### Auditoría

Toggle del log `approvals.jsonl` (una línea JSON por decisión allow/block del
gate) + botón **Restablecer defaults** (vuelve a la política de fábrica y a
modo manual; no borra historial). Con el toggle apagado, no se registra nada
nuevo — el gate sigue decidiendo igual, sólo deja de auditar. El historial se
consulta con `/gates` (overlay navegable).

## Recetas clásicas

### Proteger secretos (aunque ya haya capa hardcodeada)

```
Paths:  *.env ✕   ·   *.pem ✕   ·   ~/.ssh/* ✕   ·   *.env.example ●
```

`*.env.example` en ● en vez de ✕: los `.env.example` no tienen secretos y el
agente suele necesitar leerlos para replicar estructura.

### Forzar un package manager

```
Bash:  npm * ✕  (con los deny hardcodeados cubriendo lo destructivo)
```

El modelo recibe «negado» y un mensaje: puede pedirte cambiar a pnpm en vez de
fracasar en silencio.

### Modo "sólo lectura" (nivel plan)

El nivel 🔍 **Solo lectura** (#197) ya lo trae de fábrica: edit/write se
ocultan del catálogo del LLM y el gate los bloquea con explicación. Para una
versión a la carta (p. ej. permitir un subcomando de bash), usa el panel:

```
Tools:  edit ✕  ·  write ✕  ·  bash ✕   (read/grep/find/ls quedan ✓)
```

Ideal para sesiones de revisión/auditoría: el agente no puede modificar nada y
sus tools de escritura desaparecen del catálogo.

### Confianza acotada en git

```
Bash:  git status ✓  ·  git diff ✓  ·  git log ✓  ·  git push * ●
```

Mata el 80% de los diálogos rutinarios sin abrir la granja.

### Tarea desechable de confianza

Nivel **⚡ YOLO** + Fuera del workspace **✓**, corre la tarea, y de vuelta a
manual. Ojo: en YOLO el force-ask TAMBIÉN se suelta — sólo el candado protege.
Si quieres la versión con red de seguridad, usa **🚀 Autónomo**: corre todo
salvo bash compuesto y rutas externas. (Sólo en carpetas que puedes romper
sin llorar.)

## El diálogo de aprobación (lo que el agente ve cuando pregunta)

- **Sí** — una vez.
- **Sí, siempre (patrón)** — aprueba el patrón sugerido (`npm run build` →
  `npm *`; `src/app.ts` → `src/*`) por LO DE LA SESIÓN. Aparece en el panel,
  revocable.
- **No** / **No, con motivo** — niega; el motivo se inyecta en el tool_result
  para que el modelo entienda por qué y se adapte.

## Editar a mano: `~/.frida/permission.json`

El panel y el archivo son el mismo estado (el panel lee/escribe ese archivo,
con permisos 0600). Si prefieres el editor:

```jsonc
{
  "version": 1,
  "mode": "manual",          // plan | manual | auto-edit | auto-guarded | auto
  "auditLog": true,          // toggle del panel (#55)
  "policy": {
    "tool": { "read": "allow", "edit": "ask", "write": "ask", "bash": "ask", "*": "ask" },
    "path": { "*": "allow", "*.env": "deny" },
    "bash": { "*": "ask", "git status": "allow", "npm *": "deny" },
    "external_directory": "ask"
  }
}
```

Un JSON inválido no rompe el gate: Frida cae a la política default (segura) y
sigue. El botón **Restablecer defaults** del panel regenera este contenido.

## Límites honestos

- **Disuasivo, no perímetro** (ADR-0001): el gate evita *accidentes del
  modelo*. Un operador determinado puede evadirlo — para aislamiento real usa
  [frida-sandboxes](how-to-frida-sandboxes.md) (contenedores Docker).
- Sin resolutor de symlinks ni confianzas por proyecto (decisiones ADR-0016:
  modelo ligero). Un symlink puede vestir un path sensible de path inocente
  para las capas declarativas — los deny hardcodeados cubren los casos
  comunes.
- Los patrones de sesión **no** se persisten: por diseño, la confianza "por
  sesión" muere con la sesión.
- `external_directory` es un tri-state plano; no hay mapa de excepciones
  (`~/.cargo/*: ✓`) como en pi-permission-system. Si lo necesitas, issue.

## Buenos hábitos

- Arranca en **manual**; sube a `auto-edit` cuando confíes en la tarea;
  `auto-guarded` para correr desatendido; `auto` (YOLO) para terrenos
  desechables; `plan` cuando el día es de leer y no de tocar.
- Niega por **patrón** (`npm *`), no por tool completo, cuando el problema es
  un subcomando.
- Revisa «Aprobado en esta sesión» después de sesiones intensas — es donde se
  acumula la confianza olvidada.
- `/gates` + el toggle de auditoría son tu bitácora: si algo raro pasó, ahí
  está la decisión, el input y la regla que la produjo.
- Cambia una cosa, observa una acción del agente, cambia la siguiente — el
  efecto en vivo lo hace barato calibrar.

## Relación con el resto de Frida

- **frida-sandboxes**: aislamiento físico (contenedores) vs permisos
  (disuasivos). Complementarios: sandbox para lo que no puedes permitirte
  fallar, permisos para el día a día.
- **Herramientas (toggles #53)**: los toggles apagan módulos completos (el
  tool deja de existir); los permisos regulan el uso de tools vivos. Si dudas
  entre "apagar subagents" y "negar bash a subagents": lo primero es el toggle,
  lo segundo el permiso.
- **Auditoría** (`/gates`): lee el mismo JSONL que el toggle del panel
  enciende/apaga.
