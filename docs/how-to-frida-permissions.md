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

Sobre esas capas vive el **modo global** (el interruptor grande): `manual`
respeta la política tal cual; `auto-edit` deja pasar ediciones `●`; `auto`
deja pasar TODO `●`. Dos cosas sobreviven incluso a `auto`:

- `✕` **niega siempre** (deny gana, sin excepciones).
- El **force-ask**: bash compuesto (`&&`, `|`, `sudo`, `bash -c`, …) y acceso
  fuera del workspace **siempre** abren el diálogo.

Además hay **deny hardcodeados** que no se pueden apagar desde el panel:
secretos (`.env`, `~/.ssh`, credentials, …) y comandos destructivos
(`rm -rf /`, `chmod -R 777 /`, …). Por eso un `path: ✓` sobre `*.env` no
sufre: la capa hardcodeada lo niega igual. Ajusta esos sets con los settings
`frida.gates.*` (ver [Configuración](tools/frida-permission-system.md#configuración)).

## Los tres modos

| Modo | Qué pasa con los `●` | Úsalo para |
| --- | --- | --- |
| **manual** | abren el diálogo | default — tú decides cada acción |
| **auto-edit** | edit/write pasan; bash y force-ask siguen preguntando | revisar diffs tú, dejarlo escribir |
| **auto** | TODO pasa (salvo `✕` y force-ask) | tareas desechables / sanboxing |

Cambias el modo desde el **footer** de la conversación o desde el dropdown del
panel — los dos mandan al mismo lugar y al salir de `manual` Frida pide
confirmación (no quieres activar `auto` por accidente). Desde #55 el modo
**persiste** en `permission.json`: sobrevive recargas de ventana.

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

### Modo "sólo lectura" (el agente analiza, no toca)

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

Modo **auto** + Fuera del workspace **✓**, corre la tarea, y de vuelta a
manual. El force-ask sigue protegiendo bash compuesto. (Sólo en carpetas que
puedes romper sin llorar.)

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
  "mode": "manual",          // manual | auto-edit | auto
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
  `auto` para terrenos desechables.
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
