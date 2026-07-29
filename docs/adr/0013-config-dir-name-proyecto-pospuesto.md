# CONFIG_DIR_NAME de proyecto: posponer el aislamiento (`.pi` → `.frida`)

**Estado:** pospuesto (evaluado). Reabrir si surge necesidad real de extensions/skills de
proyecto propias de Frida.

## Contexto

`CONFIG_DIR_NAME` (`config.ts`) es el nombre del directorio de configuración de pi.
Es una `export const` resuelta como `pkg.piConfig?.configDir || ".pi"`. Tiene **dos
niveles** de uso en el SDK:

| Nivel | Path | Contenido |
| --- | --- | --- |
| **Global** | `getAgentDir()` → `~/${CONFIG_DIR_NAME}/agent` | auth, models, settings, extensiones globales |
| **Proyecto** | `join(cwd, CONFIG_DIR_NAME)` → `<cwd>/.pi/` | skills, prompts, themes, extensions **del repo** |

El nivel **global** ya está aislado por [ADR-0010](./0010-frida-agentdir-propio.md):
Frida pasa `agentDir: ~/.frida` explícito al `SessionManager`, `ModelRuntime` y
`DefaultResourceLoader`, así que el `getAgentDir()` del SDK **no rige** (no lo
llamamos; auth/models propios, desacoplados del `pi` CLI de consola).

El nivel **proyecto** sí nos ata: `DefaultResourceLoader`
(`core/resource-loader.js`) calcula los dirs de recursos del proyecto con la
constante, sin override:

```js
join(this.cwd, CONFIG_DIR_NAME, "skills"),      // <cwd>/.pi/skills
join(this.cwd, CONFIG_DIR_NAME, "prompts"),
join(this.cwd, CONFIG_DIR_NAME, "themes"),
join(this.cwd, CONFIG_DIR_NAME, "extensions"),
```

`migrations.ts` (`join(cwd, CONFIG_DIR_NAME)`) y los help-text del CLI también la
usan, pero esos no aplican al host embebido.

## Razón

Se consideró simetrizar el aislamiento: igual que `~/.frida` desacopla el config
global del CLI, un `<cwd>/.frida` desacoplaría el config **de proyecto**. Beneficios
esperados:

1. **Aislamiento de proyecto** — un repo podría tener `.frida/skills/`,
   `.frida/extensions/`, `.frida/prompts/` propios de Frida, separados del `.pi/`
   del CLI.
2. **Evitar side-effects cruzados** — hoy Frida carga extensions de `<cwd>/.pi/`
   (compartido con el CLI); podrían no ser compatibles con el host embebido.
3. **Identidad de marca** — `.frida/` señala "config de Frida" en el repo del usuario.

## Decisión

**Posponer. No se aísla el config de proyecto.** Frida sigue leyendo
`<cwd>/.pi/{skills,prompts,themes,extensions}` (compartido con el CLI `pi`). Se
registrará como **feature request upstream**: que `DefaultResourceLoader` acepte un
override de `projectConfigDirName` (o `projectDirs: string[]`) para que un host
embebido pueda apuntar a su propio dir sin parchear.

## Alternativas consideradas

- **(A) Feature request upstream (elegida como salida).** Que pi exponga el override
  en `DefaultResourceLoader`. Limpio, durable, sin deuda técnica. Depende del
  upstream; no bloquea nada hoy.
- **(B) Monkey-patch de `CONFIG_DIR_NAME`.** Reasignar la export antes de importar el
  SDK (`Object.defineProperty` / re-export). Frágil: es un `const` de módulo ESM
  bundleado a CJS; la reasignación puede no propagarse a los sitios de lectura
  (binding inmutable del import) y se rompe en cada bump del SDK. Descartada.
- **(C) Subclase de `DefaultResourceLoader`.** Un loader propio de Frida que
  reproduzca el escaneo apuntando a `<cwd>/.frida`. Funciona, pero duplica lógica
  del SDK que ya se actualiza sola (nuevos tipos de recurso, orden de precedencia,
  migraciones) → deuda alta y riesgo de desincronización. Descartada por ahora.

## Consecuencias

- **Hoy:** las extensions/skills/prompts/themes de proyecto se leen de `<cwd>/.pi/`,
  igual que el CLI. Un proyecto que quiera recursos para Frida los pone ahí. Las
  extensiones globales viven en `~/.frida/npm` (pi-lens) y `~/.frida/extensions`,
  ya aisladas (ADR-0010).
- **Riesgo residual (bajo):** si un repo tiene `.pi/extensions/` pensadas sólo para
  el CLI, Frida las cargaría también. Mitigación actual: las extensiones de proyecto
  son raras y normalmente compatibles; el `bindExtensions({ mode: "rpc" })` + nuestro
  `ExtensionUIContext` (ADR-0011) ya enruta las que respetan el contrato.
- **Reabrir si:** (1) pi añade el override upstream → adoptar enseguida; o (2)
  aparecen conflictos reales extensions-de-proyecto incompatibles entre Frida y el
  CLI → reconsiderar la opción (C).

## Referencias

- [ADR-0010](./0010-frida-agentdir-propio.md) — agentDir global propio (`~/.frida`).
- `node_modules/@earendil-works/pi-coding-agent/dist/config.js:394` — definición de
  `CONFIG_DIR_NAME`.
- `…/dist/core/resource-loader.js:571-574` — consumo sin override en el loader.
