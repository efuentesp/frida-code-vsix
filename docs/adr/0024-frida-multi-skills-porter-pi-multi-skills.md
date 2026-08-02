# ADR-0024: Portear pi-multi-skills como frida-multi-skills

**Estado**: Propuesto
**Fecha**: 2025-08-02
**Autor**: Edgar F. Fuentes Perea

## Contexto

Frida hereda de Pi la invocación de skills vía `/skill:<nombre>`, que inserta el
cuerpo de una skill como un bloque estructurado `<skill name="…"
location="…">…</skill>`. Este mecanismo tiene dos restricciones que limitan la
ergonomía:

1. La invocación debe ir **al inicio** del mensaje.
2. Sólo admite **una skill por turno**.

`pi-multi-skills` (v1.1.3, MIT, QuangThai) resuelve esto con la sintaxis
`$skill_name`: referencias inline reconocibles en cualquier posición del prompt
y combinables varias en un mensaje. La expansión produce el **mismo** bloque
`<skill>` que `/skill:xxx` nativo, así el modelo lo procesa idéntico.

### Por qué un porte y no instalar pi-multi-skills como extensión externa

`pi-multi-skills` es una extensión de Pi diseñada para el **TUI** de Pi: usa
`ctx.ui.addAutocompleteProvider` (autocomplete del TUI), `ctx.ui.setWidget`
(widgets del TUI) y `ctx.ui.theme` (colores del TUI). Frida **no** usa el TUI de
Pi: su composer vive en un **webview React** propio. Instalar pi-multi-skills tal
cual dejaría el autocomplete `$` sin funcionar (su TUI no existe) y sólo
conservaría la expansión del hook `input` — con la asimetría de que el webview
mostraría `$skill` (crudo) mientras el modelo recibe `<skill>`.

Como ya ocurrió con `frida-args` (ADR implícito), `frida-pipeline` (ADR-0021) y
`frida-subagents` (ADR-0022), el patrón correcto en Frida es un **porte nativo
embebido** que se adapta a la arquitectura host+webview.

## Decisiones del usuario

Se eligieron (todas las opciones recomendadas en la propuesta de diseño):

- **D1: Herramienta separada** (`src/tools/frida-multi-skills/`) frente a
  integrar en `frida-args`.
- **D2: Expansión dual** host + hook frente a sólo hook input.
- **D3: Un bloque merger** `name="a, b"` para varias skills frente a N bloques.
- **D4: Autocomplete `$` local** en `Composer.tsx` frente a vía host.
- **D5: Reutilizar** `getSkillIndex`/`buildSkillBlock` de frida-args (no duplicar).
- **D6: Incluir** `/skills` + `/skills-search` (porte de los comandos del upstream).

## Decisiones

### D1: Nombre `frida-multi-skills` y estructura separada

Espeja `pi-multi-skills`. Espacio: `src/tools/frida-multi-skills/` con tres
archivos de responsabilidad nítida: `parser.ts` (extracción `$skill`),
`expand.ts` (expansión, única fuente de verdad), `index.ts` (factory + hook
input). Se separa de `frida-args` porque son concerns distintos: `frida-args`
expande `/skill:name <args>` con placeholders/shell; `frida-multi-skills`
expande `$skill` (referencia inline sin argumentos, posiblemente múltiple).

### D2: Expansión dual host + hook (patrón frida-args)

`expandMultiSkillText()` es la **única fuente de verdad** y la llaman dos sitios:

1. **`runPrompt` (host)** — para que el webview **muestre** el bloque `<skill>`
   en vivo (`toPost`) y el modelo **reciba** idéntico (`toSend`). Paridad
   display↔modelo, igual que ya hace el flujo `/skill:`.
2. **Hook `input` de la factory** — **salvavidas**: expande texto que no venga
   del host (sesiones hijas de workflow, prompts programáticos).

Cuando el texto ya viene expandido (empieza con `<skill`), tanto la guardia de
re-entrada de `frida-args` como el hecho de que `parseSkillRefs` no encuentre
`$skill` hacen que pase intacto por ambos hooks → sin doble expansión.

**Orden de registro:** la factory se registra **después de `frida-args`** en
`extensionFactories` (reutiliza su índice).

### D3: Merger `name="a, b"` para varias skills

Cuando un mensaje trae varias `$skill`, se empaquetan en **un único bloque**:

```xml
<skill name="a, b" location="<dir>/a/SKILL.md">
References are relative to <dir>/a.

## a
<cuerpo a>
---
## b
<cuerpo b>
</skill>
```

Paridad con `pi-multi-skills` y con el `parseSkillBlock` non-greedy de Pi, que
sólo atrapa el primer `<skill>`. El `location`/dir es del **primero** (limitación
documentada: los `_shared/` relativos de skills posteriores resolverían mal).

**N bloques separados** se descartó: requeriría verificar que el protocolo de
invocación y el renderer `SkillBlock.tsx` procesen todos, y `parseSkillBlock` es
non-greedy (sólo atraparía el primero).

### D4: Autocomplete `$` local en el composer

El webview **ya recibe** `state.resources.skills` (vía `collectResources()` →
`App.tsx` construye `CommandItem` con `kind: "skill"`). El autocomplete `$`
filtra ese array localmente en `Composer.tsx` (fuzzy subsequence), sin
round-trip al host. Patrón idéntico al de `@` y `/`.

El autocomplete del TUI de Pi (`ctx.ui.addAutocompleteProvider`, que usa
`pi-multi-skills`) **no existe** en Frida y por eso no se porteó.

### D5: Reutilización del índice de skills de frida-args

`frida-args` ya construye el índice `name → { filePath, baseDir }` desde
`pi.getCommands()` (`buildSkillIndex`/`getSkillIndex`, cache módulo-level
invalidado en `session_start reload|startup`). Se **exportó** `getSkillIndex`
para que `frida-multi-skills` lo consuma, en vez de duplicar la lectura del
registry. También se reutiliza `buildSkillBlock` (ruta de 1 skill) para garantizar
salida byte-exacta con `/skill:`.

### D6: Divergencia intencional — caso standalone puro

`pi-multi-skills` deja el nombre de la skill como texto tras `</skill>` cuando la
referencia es standalone (`$code-review` → bloque + "code-review"). En Frida eso
es semánticamente engañoso: el `SKILL_INVOCATION_PROTOCOL` de `frida-args` trata
el post-`</skill>` como **argumento** de la skill, así que "code-review" se
interpretaría como input espurio de `code-review`.

`expandMultiSkillText` **omite** el `userText` cuando, tras el reemplazo, se
reduce a **sólo** nombres de skills resueltas (`$code-review`, `$a $b`). Casos
con texto adicional (`"Aplica $code-review"`) se preservan (`"Aplica
code-review"`).

## Plan de implementación

### Fase 1: Módulo `frida-multi-skills`

- [x] `parser.ts` — porte del parser de `pi-multi-skills` (regex, dedupe, escape,
      orden por longitud).
- [x] `expand.ts` — `expandMultiSkillText()` reutilizando `getSkillIndex` +
      `buildSkillBlock` de frida-args; merger para N skills; caso standalone.
- [x] `index.ts` — `createFridaMultiSkills()` factory + hook `input`.
- [x] Exportar `getSkillIndex` de `frida-args`.

### Fase 2: Integración en el host

- [x] Registrar factory en `pi-session.ts` (después de `frida-args`).
- [x] `runPrompt` (`extension.ts`) — expansión `$skill` con paridad display↔modelo.
- [x] `/skills` + `/skills-search` en `BUILTIN_COMMANDS` + `runBuiltinSlash`.
- [x] Autocomplete `$` en `Composer.tsx` + `HELP_TOOLS`.

### Fase 3: Documentación y tests

- [x] `docs/tools/frida-multi-skills.md`.
- [x] ADR-0024.
- [x] Tests: parser (7) + expansión (8).
- [x] README (tabla de Herramientas) + CHANGELOG `[Unreleased]`.

## Riesgos y mitigaciones

| Riesgo | Probabilidad | Mitigación |
| --- | --- | --- |
| Orden de hooks input (frida-args, skill-bracket, multi-skills) cause doble expansión | Baja | El texto expandido empieza con `<skill` → guardias de re-entrada lo dejan intacto; `parseSkillRefs` no encuentra `$` |
| Merger `name="a, b"` rompa el override de modelo de `skill-bracket` | Cierta | Documentado como limitación: el override aplica a invocaciones de **una** skill |
| Colisión `$` con tokens de frida-args (`$ARGUMENTS`, `${SKILL_DIR}`) | Baja | El regex exige minúscula inicial; esos tokens son mayúsculas → se ignoran |
| Skills referenciadas no existan | Baja | Se reportan en `unresolved` (aviso al usuario) y la referencia queda literal |
| `_shared/` relativos de la 2ª skill en adelante no resuelvan (location del 1º) | Media | Documentado; las skills multi rara vez usan `_shared/` con paths relativos al body |
