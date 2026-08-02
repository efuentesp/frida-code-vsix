# `frida-multi-skills`

> **Estado:** ✅ porte de [`pi-multi-skills`](https://www.npmjs.com/package/pi-multi-skills)
> v1.1.3 (MIT, QuangThai) como extensión nativa embebida · referencia:
> [pi-multi-skills](https://github.com/QuangThai/pi-multi-skills) · [ADR-0024](../adr/0024-frida-multi-skills-porter-pi-multi-skills.md)

Invoca **cualquier skill desde cualquier parte del prompt** con la sintaxis
`$skill_name`, y combina **varias en un solo mensaje**. La expansión produce el
mismo bloque `<skill>` que `/skill:xxx` nativo (y que [`frida-args`](./frida-args.md)),
así que el modelo lo procesa idéntico; la diferencia es ergonómica.

```text
Aplica $code-review y $commit a estos cambios
```

## ¿Qué es?

Frida hereda de Pi el comando `/skill:<nombre>`, que inserta el cuerpo de una
skill (`.frida/skills/`, `~/.frida/skills/`) en el prompt como un bloque
estructurado `<skill name="…" location="…">…</skill>`. Ese mecanismo tiene dos
límites: la invocación debe ir **al inicio** del mensaje y sólo admite **una
skill por turno**.

`frida-multi-skills` levanta ambas restricciones sin romper el formato:

- **Posición libre** — `$skill_name` se reconoce en cualquier punto del mensaje:
  `"Corre $code-review sobre el diff"`, no sólo al principio.
- **Varias por mensaje** — `"$code-review y luego $commit"` combina ambas en un
  único turno.
- **Mismo bloque nativo** — cada `$skill_name` se expande a un `<skill>`; cuando
  hay varias, se **mergean en un solo bloque** `name="a, b"` (paridad con
  `pi-multi-skills` y con el `parseSkillBlock` non-greedy de Pi, que sólo atrapa
  el primer bloque).
- **Autocomplete `$`** en el composer (junto al de `@` y `/`) y comandos
  `/skills` + `/skills-search` para descubrir skills.

Es un **porte** de `pi-multi-skills` (mismo parser y mecánica de expansión),
adaptado a la arquitectura de Frida: el composer vive en el webview (no en el
TUI de Pi), así que el autocomplete `$` se implementa en `Composer.tsx`, y la
expansión es **dual** (host + hook), igual que `frida-args`, para que lo que ve
el webview sea idéntico a lo que recibe el modelo.

## ¿Cuándo usarla?

- **Combinar skills en un turno** — `"$code-review y $commit"` en vez de dos
  mensajes separados.
- **Skill en medio de instrucciones** — `"Revisa el módulo X con $code-review y
  propón mejoras"` (la skill no tiene que ir al inicio).
- **Descubrir skills** — `/skills` para listarlas con su sintaxis `$name`,
  `/skills-search <palabra>` para filtrar.

**NO la uses si** necesitas pasar **argumentos** a una skill: `$skill` es una
referencia sin argumentos. Para argumentos (`$1`, `$ARGUMENTS`) y shell
(`` !`cmd` ``) usa `/skill:<nombre> <args>` con [`frida-args`](./frida-args.md).

## Conceptos

| Término | Significado |
| --- | --- |
| **`$skill_name`** | Referencia inline a una skill; se expande a un bloque `<skill>`. Minúsculas por convención (ignora `$PATH`, `$ARGUMENTS`). |
| **Bloque `<skill>`** | XML estructurado que Pi/Frida inyectan para activar el protocolo de invocación de skills. |
| **Merger** | Cuando hay varias `$skill`, se empaquetan en UN bloque `name="a, b"` con ambos cuerpos. |
| **Hook dual** | `expandMultiSkillText()` como única fuente de verdad, llamada desde `runPrompt` (host) y el hook `input` (salvavidas). |

## Uso

Escribe `$` en el composer y aparecerá el autocomplete con las skills
disponibles (filtrado fuzzy). Confirma con `Tab`/`Enter` o haz clic.

```text
Aplica $code- [Tab]
  ↓
┌─ $code-change-verification  ─┐
│ $code-review                  │   ← clic o Enter
│ $code-simplification          │
└───────────────────────────────┘

Aplica $code-review y $commit a estos cambios
```

Al enviar, el webview muestra el bloque `<skill>` en vivo y el modelo recibe
idéntico. Si referencias una skill inexistente, Frida avisa y deja la referencia
literal (`$inexistente`) para que veas que no resolvió.

```text
/skills                 → lista todas las skills con su sintaxis $name
/skills-search review   → filtra por nombre o descripción
```

## API / DSL

### Sintaxis de referencias

```text
$nombre-de-skill          # referencia (minúsculas, [a-z0-9_-])
\$nombre-de-skill         # $ literal (no se resuelve)
$A $ARGUMENTS             # ignorados (mayúsculas = variables, no skills)
```

### Expansión programática (`expandMultiSkillText`)

Única fuente de verdad del módulo. La llama `runPrompt` (host) y el hook
`input`. Devuelve `null` si el texto no contiene `$skill` → el caller cae al
comportamiento por defecto.

```ts
import { expandMultiSkillText } from "./tools/frida-multi-skills";

const result = await expandMultiSkillText(text, {
  pi: extensionApi, // getCommands() resuelve el índice de skills
  sessionId: "…",
  cwd: workspaceCwd(),
});
if (result) {
  // result.transformed  → `<skill name="…" location="…">…</skill>\n\n<texto>`
  // result.unresolved   → ["skill-inexistente", …]  (para avisar al usuario)
}
```

## Ejemplos

### Una skill en medio del mensaje

```text
Revisa el módulo auth con $code-review y dime qué mejorar
```

→

```xml
<skill name="code-review" location="~/.frida/skills/code-review/SKILL.md">
References are relative to ~/.frida/skills/code-review.

<cuerpo de code-review>
</skill>

Revisa el módulo auth con code-review y dime qué mejorar
```

### Varias skills (merger)

```text
$code-review y $commit
```

→

```xml
<skill name="code-review, commit" location="~/.frida/skills/code-review/SKILL.md">
References are relative to ~/.frida/skills/code-review.

## code-review

<cuerpo de code-review>

---

## commit

<cuerpo de commit>
</skill>
```

> Caso **standalone puro** (`$code-review` sola, sin más texto): el nombre se
> omite del texto del usuario para no dejarlo como "argumento" espurio tras
> `</skill>` (mejora sobre `pi-multi-skills`, que lo deja suelto). `"Aplica
> $code-review"` → `"Aplica code-review"` sí se preserva.

## Configuración

Sin settings propios. Las skills se descubren donde Frida/Pi ya las busca:
`~/.frida/skills/` (global) y `.frida/skills/` (proyecto). Recarga con `/reload`
tras añadir una.

## Integración con Frida

- **Registro:** factory `createFridaMultiSkills()` en `extensionFactories` de
  `pi-session.ts`, **después de `frida-args`** (reutiliza su índice de skills
  `getSkillIndex`).
- **Expansión dual:** `runPrompt` (host) llama a `expandMultiSkillText` para
  mostrar el bloque `<skill>` en vivo en el webview (paridad display↔modelo); el
  hook `input` de la factory hace lo mismo como salvavidas para texto que no
  venga del host (sesiones hijas, prompts programáticos).
- **UI:** autocomplete `$` local en `Composer.tsx` (sin round-trip al host,
  patrón de `@` y `/`); comandos `/skills` + `/skills-search` en `BUILTIN_COMMANDS`.
- **Sesiones / gates:** sin efecto. No registra tools del modelo ni abre paneles.

## Arquitectura / Internals

```text
src/tools/frida-multi-skills/
  index.ts     # createFridaMultiSkills() factory + hook input (salvavidas);
               #   re-exporta expandMultiSkillText para runPrompt
  parser.ts    # parseSkillRefs / replaceSkillRefs / hasSkillRefs
               #   (porte del parser de pi-multi-skills)
  expand.ts    # expandMultiSkillText(): ÚNICA fuente de verdad.
               #   reutiliza getSkillIndex + buildSkillBlock de frida-args;
               #   merger name="a, b" para N skills

test/frida-multi-skills/
  frida-multi-skills.test.ts  # parser (7) + expansión (8) + helpers
```

Flujo de extremo a extremo:

```text
"$code-review y $commit"
   │
   ├─ runPrompt (host) ──► expandMultiSkillText() ──► toPost = toSend = <skill>
   │                                                      (webview muestra el bloque)
   └─ hook input (salvavidas) ──► ya empieza con <skill → pasa intacto
                                                         (frida-args y multi-skills)
```

## Ver también

- [README](../../README.md) — índice general de Frida Code
- [frida-args](./frida-args.md) — argumentos y shell en skills (`/skill:name <args>`)
- [extensiones](./extensions.md) — skills en `~/.frida/skills/` y `.frida/skills/`
- [ADR-0024](../adr/0024-frida-multi-skills-porter-pi-multi-skills.md) — decisión de porte

## Estado y madurez

Porte completo de la funcionalidad de `pi-multi-skills` (parser + expansión +
autocomplete + comandos). Diferencias intencionales sobre el upstream,
documentadas en el [ADR-0024](../adr/0024-frida-multi-skills-porter-pi-multi-skills.md):

- **Autocomplete `$`** en el composer del webview (no en el TUI de Pi).
- **Expansión dual** host + hook (paridad display↔modelo), no sólo hook.
- **Caso standalone puro** omite el nombre repetido como argumento espurio.
- **Limitación conocida:** con varias `$skill` (merger `name="a, b"`), el
  override de modelo por skill de `skill-bracket` **no aplica** individualmente
  (el `name` del bloque no matchea `config.skills["a"]` ni `"b"`). El override
  por skill sigue funcionando para invocaciones de **una** skill.
