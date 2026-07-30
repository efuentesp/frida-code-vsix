# Extensiones

> **Estado:** ✅ heredado del SDK de Pi (auto-descubrimiento vía `agentDir`) + cableado
> de proyecto `.frida/` · [ADR-0010](../adr/) · referencia: [pi extensions.md](https://www.npmjs.com/package/@earendil-works/pi-coding-agent)

Las **extensiones** son archivos TypeScript que viven **fuera del `.vsix`** y que
Frida carga al arrancar (y recarga con `/reload`). Cada una puede registrar
**tools**, **providers**, **hooks de eventos** y **commands** para el agente — sin
tocar el código de Frida.

> No es una característica nueva: Frida **hereda** el sistema de extensiones de Pi
> (al que ya está cableado por `agentDir` + `session.bindExtensions()`). Aquí sólo
> documentamos cómo usarlo en el contexto de Frida y añadimos la ubicación de
> proyecto `.frida/`.

## ¿Qué es?

Pi (el SDK que Frida embebe) descubre extensiones en ubicaciones estándar. Como
Frida apunta el `agentDir` a `~/.frida`, Pi ya busca extensiones en
`~/.frida/extensions/`. Además, Frida cablea `.frida/extensions/` (proyecto) vía
`additionalExtensionPaths` del `DefaultResourceLoader`.

Una extensión es un `.ts` que **exporta por defecto una función** que recibe la
`ExtensionAPI` de Pi y registra cosas:

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.notify("¡Extensión cargada!", "info");
  });
}
```

Los imports (`@earendil-works/pi-coding-agent`, `typebox`, `@earendil-works/pi-ai`)
los resuelve el cargador de Pi por ti (vía `virtualModules`) — no necesitas
instalarlos en tu proyecto.

## ¿Cuándo usarla?

- **Extensión** → añade un **tool**, **provider** o **hook** que varias sesiones /
  workflows necesitan y quieres versionar fuera del `.vsix`.
- **Skill** (`~/.frida/skills/` o `.frida/skills/`, un `SKILL.md`) → son sólo
  **instrucciones** (markdown) que el agente lee; no ejecutan código. Para
  convenciones o guías, usa una skill.
- **Workflow** ([frida-workflow](./frida-workflow.md)) → cuando lo que quieres es
  **orquestar** varias etapas (skills en cadena, loops, jueces).

## Conceptos

| Término | Significado |
| --- | --- |
| **Extensión** | Un `.ts` (o un dir con `index.ts`) en una ubicación de descubrimiento. |
| **ExtensionAPI** | El objeto `pi` que recibe tu función: `registerTool`, `registerProvider`, `on(event)`, `registerCommand`, … |
| **Hook / evento** | Reacción a un momento del ciclo: `session_start`, `tool_call`, `agent_end`, eventos de modelo/recurso. |
| **Descubrimiento** | Pi escanea las ubicaciones estándar al crear la sesión y en `/reload`. |
| **Hot-reload** | `/reload` re-descubre extensiones sin reiniciar Frida. |
| **Headless** | Tools, providers y hooks (sin UI) — funcionan completos en Frida. |
| **TUI/Ink** | Renderers y commands que pintan la consola — **no** aparecen en el webview (ver caveat). |

## Uso

1. Crea el archivo en la ubicación que quieras (ver [Configuración](#configuración)).
2. Escribe tu `export default function (pi) { ... }`.
3. **`/reload`** — Frida lo recarga y reporta cuántas extensiones/skills cargó.

```text
~/.frida/extensions/mi-tool.ts      ← global (todos los proyectos)
.fridida/extensions/mi-tool.ts       ← proyecto (sólo este workspace)
```

> Tip: `/help extensions` abre esta misma doc.

## API / DSL

### Forma canónica

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function (pi: ExtensionAPI) {
  // registra tools, providers, hooks…
}
```

### Registrar un tool

```typescript
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const saludar = defineTool({
  name: "saludar",
  label: "Saludar",
  description: "Saluda a alguien",
  parameters: Type.Object({ nombre: Type.String() }),
  async execute(_id, params) {
    return { content: [{ type: "text", text: `Hola, ${params.nombre}!` }] };
  },
});

export default function (pi: ExtensionAPI) {
  pi.registerTool(saludar);
}
```

### Reaccionar a eventos (hooks)

```typescript
export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName === "bash" && event.input.command?.includes("rm -rf")) {
      const ok = await ctx.ui.confirm("Peligroso", "¿Permitir rm -rf?");
      if (!ok) return { block: true, reason: "Bloqueado por el usuario" };
    }
  });
}
```

Eventos típicos: `session_start`, `tool_call`, `agent_end`, `resource_changed`,
más los de modelo y recurso (ver la [referencia de Pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent)).

### Registrar un provider

```typescript
export default function (pi: ExtensionAPI) {
  pi.registerProvider("mi-provider", { /* ProviderConfig */ });
}
```

## Ejemplos

### Mínimo: un tool "hello"

`~/.frida/extensions/hello.ts`:

```typescript
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function (pi: ExtensionAPI) {
  pi.registerTool(
    defineTool({
      name: "hello",
      description: "Saluda",
      parameters: Type.Object({ name: Type.String() }),
      async execute(_id, p) {
        return { content: [{ type: "text", text: `Hello, ${p.name}!` }] };
      },
    }),
  );
}
```

`/reload` → el agente ya puede usar el tool `hello`.

### Guardián de comandos destructivos

```typescript
export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName === "bash" && /rm -rf|mkfs|dropdb/.test(event.input.command ?? "")) {
      const ok = await ctx.ui.confirm("Comando destructivo", "¿Confirmar?");
      if (!ok) return { block: true, reason: "cancelado" };
    }
  });
}
```

## Configuración

### Ubicaciones de descubrimiento

| Ubicación | Ámbito | Qué carga |
| --- | --- | --- |
| `~/.frida/extensions/*.ts` · `*/index.ts` | Global (todos los proyectos) | extensiones |
| `.frida/extensions/*.ts` · `*/index.ts` | Proyecto (este workspace) | extensiones (cableado Option B) |
| `~/.frida/skills/` · `.frida/skills/` | Global / proyecto | skills (markdown, sin código) |

- **Global** (`~/.frida/`): lo hereda Pi del `agentDir` de Frida; funciona tal cual.
- **Proyecto** (`.frida/`): Frida lo pasa al loader vía
  `additionalExtensionPaths` / `additionalSkillPaths` (`pi-session.ts`).
- **`package.json` con campo `"pi.extensions"`**: si tu extensión es un dir con
  `package.json`, Pi lee las rutas declaradas ahí.

### Seguridad y trust

- Las extensiones **globales** (`~/.frida/`) son tuyas: se cargan siempre.
- Las de **proyecto** (`.frida/extensions/`) cargan estilo CLI (sin gate de trust),
  **igual que `.frida/workflows/*.ts`** que Frida ya auto-carga vía jiti. Es decir:
  abrir un proyecto ejecuta su `.frida/*.ts`. Abre sólo proyectos en los que confíes.
- Los hooks de tipo `tool_call` pueden **bloquear** acciones — útil para guardias
  custom (pero recuerda: el gate es disuasivo, [ADR-0001](../adr/0001-alcance-disuasivo-no-perimetro.md)).

## Integración con Frida

- **`agentDir` propio** (`~/.frida`, [ADR-0010](../adr/)): desacoplado de `~/.pi`,
  así Frida no lee ni pisa la config/auth del `pi` de consola.
- **`session.bindExtensions({ uiContext, mode: "rpc" })`**: Frida inyecta su propio
  contexto de UI y fija `mode: "rpc"`. Las extensiones que detectan `mode === "rpc"`
  enrutan su UI por **diálogos** (`ctx.ui.confirm` / `select` / `input`) en vez de
  la factory Ink del TUI.
- **Hot-reload**: `/reload` → `session.reload()` re-descubre; Frida reporta los
  conteos (`N extensiones, M skills`).
- **Sesiones hijas** (frida-workflow): NO cargan `.frida/extensions` (loader curado,
  sólo providers + gates); sí ven las skills globales de `~/.frida/skills/`.

## Caveat: headless vs UI

| Tipo de extensión | ¿Funciona en Frida? |
| --- | --- |
| **Tools**, **providers**, **hooks de eventos** | ✅ Completo |
| UI por **diálogos** (`ctx.ui.confirm/select/input`, modo `rpc`) | ✅ Se rutea al webview |
| **Renderers** (`registerEntryRenderer`, `registerMessageRenderer`) y **commands/shortcuts** del TUI (Ink) | ⚠️ **No aparecen** en el webview — son para la consola. Para UI rica propia en Frida, se necesita bridging (no incluido). |

Regla práctica: si tu extensión **no importa nada de Ink/TUI** y se basa en
tools/hooks/diálogos, funcionará en Frida tal cual.

## Ver también

- [README §Herramientas](../../README.md#herramientas)
- [Referencia de extensiones de Pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) (`docs/extensions.md` en el paquete)
- Ejemplos: `…/@earendil-works/pi-coding-agent/examples/extensions/` (hello, confirm-destructive, custom-provider, …)
- [ADR-0010](../adr/) — `agentDir` propio en `~/.frida`.

## Estado y madurez

- ✅ **Global** (`~/.frida/extensions/`): heredado de Pi, funciona.
- ✅ **Proyecto** (`.frida/extensions/`): cableado vía `additionalExtensionPaths`.
- ✅ **Hot-reload** con `/reload`.
- ⚠️ Extensiones con UI TUI/Ink no se renderizan en el webview (necesitarían bridging).
- ○ Sesiones hijas (workflows) no cargan `.frida/extensions` por ahora (sólo skills globales).
