# `frida-mcp-adapter`

> **Estado:** ✅ Estable · [ADR-0023](../adr/0023-frida-mcp-adapter-porter-pi-mcp-adapter.md) · [análisis](../../.rpiv/artifacts/discover/2025-07-31_frida-mcp-adapter-porter-pi-mcp-adapter.md)

Integración MCP (Model Context Protocol). Un único tool proxy `mcp({})`
(~200 tokens) da acceso a cientos de servidores MCP — databases, browsers,
APIs, GitHub, Slack, Figma — sin quemar contexto con definiciones verbosas.

## ¿Qué es?

`frida-mcp-adapter` es un wrapper sobre [`pi-mcp-adapter`](https://github.com/nicobailon/pi-mcp-adapter)
v2.17.0 que conecta servidores MCP al agente de Frida. El modelo descubre y
ejecuta herramientas on-demand; los servidores sólo arrancan cuando se usan
(lazy por defecto).

**El problema que resuelve**: cada servidor MCP expone herramientas con
definiciones verbosas. Un solo servidor puede consumir 10K+ tokens. Conectar
varios = mitad del contexto perdido antes de empezar. Este adapter usa un
único proxy tool en lugar de cientos.

## ¿Cuándo usarla?

Cuando necesitas acceder a servicios externos desde el agente:

- **Bases de datos** — PostgreSQL, SQLite, MongoDB
- **APIs** — GitHub, Slack, Linear, Notion, Jira
- **Browsers** — Chrome DevTools, Playwright
- **Herramientas** — Figma, Filesystem, Memory, Time

**NO la uses si** puedes resolver la tarea con los tools nativos de Frida
(`bash`, `read`, `edit`, `web_search`). MCP agrega overhead de proceso.

## Configuración

### `.mcp.json` (proyecto)

Crea un archivo `.mcp.json` en la raíz del proyecto:

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"]
    },
    "chrome-devtools": {
      "command": "npx",
      "args": ["-y", "chrome-devtools-mcp@latest"]
    }
  }
}
```

### Config global compartida

`~/.config/mcp/mcp.json` — funciona con Claude, Cursor, Windsurf y otras
herramientas que soportan el formato MCP estándar.

### Fuentes de config (precedencia mayor → menor)

| Fuente | Propósito |
| --- | --- |
| `.frida/mcp.json` | Override de proyecto Frida |
| `.mcp.json` | Config compartida de proyecto |
| `~/.frida/mcp.json` | Override global Frida |
| `~/.agents/mcp.json` | Config global tool-agnostic |
| `~/.config/mcp/mcp.json` | Config global compartida |

## Uso del tool proxy

El modelo (o tú via prompt) invoca `mcp({})` con diferentes parámetros:

| Modo | Ejemplo | Descripción |
| --- | --- | --- |
| **Status** | `mcp({ })` | Resumen de servidores conectados |
| **Buscar** | `mcp({ search: "screenshot" })` | Encuentra tools por nombre/descripción |
| **Describir** | `mcp({ describe: "github_search_repositories" })` | Muestra parámetros de un tool |
| **Ejecutar** | `mcp({ tool: "github_search_repositories", args: { query: "frida" } })` | Llama un tool |
| **Conectar** | `mcp({ connect: "github" })` | Fuerza conexión de un servidor |
| **Instrucciones** | `mcp({ instructions: "github" })` | Guía de uso del servidor |
| **Auth start** | `mcp({ action: "auth-start", server: "linear" })` | Inicia OAuth (headless) |
| **Auth complete** | `mcp({ action: "auth-complete", server: "linear", args: { redirectUrl: "..." } })` | Completa OAuth (headless) |

**Búsqueda fuzzy**: `context7_resolve_library_id` encuentra `context7_resolve-library-id`.

## Slash commands

### `/mcp`

Panel interactivo con subcomandos:

| Subcomando | Acción |
| --- | --- |
| `/mcp` | Panel de status (conectar, reconectar, ver tools) |
| `/mcp tools` | Lista todos los tools |
| `/mcp prompts` | Lista prompts MCP registrados como slash commands |
| `/mcp reconnect` | Reconecta todos los servidores |
| `/mcp reconnect <server>` | Reconecta un servidor específico |
| `/mcp disable <server>` | Deshabilita un servidor (requiere `/reload`) |
| `/mcp enable <server>` | Habilita un servidor (requiere `/reload`) |
| `/mcp logout <server>` | Limpia credenciales OAuth |
| `/mcp setup` | Configuración guiada (imports, scaffold `.mcp.json`) |

### `/mcp-auth`

Autenticación OAuth interactiva:

- `/mcp-auth` — abre picker de servidores que necesitan auth
- `/mcp-auth <server>` — auth para un servidor específico

## Direct tools

Por defecto, todos los tools MCP se accesan via el proxy `mcp({})`. Si quieres
que tools específicos aparezcan directamente en la tool list del agente:

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "directTools": ["search_repositories", "get_file_contents"]
    }
  }
}
```

| Valor | Comportamiento |
| --- | --- |
| `true` | Todos los tools del servidor como first-class |
| `["tool_a", "tool_b"]` | Sólo estos tools (nombres originales MCP) |
| omitido / `false` | Proxy sólo (default) |

Cada direct tool cuesta ~150-300 tokens. Recomendado para conjuntos de 5-20
tools. Para servers con 75+ tools, usa el proxy.

## OAuth

Servidores HTTP que requieren autenticación:

```json
{
  "mcpServers": {
    "linear": {
      "url": "https://mcp.linear.app/mcp",
      "auth": "oauth"
    }
  }
}
```

**Flujo**: al primer uso, el adapter detecta que necesita auth → abre browser
para OAuth → callback en localhost → token persistido en el keyring del SO
(macOS Keychain / Windows Credential Manager / Linux Secret Service).

**Headless/SSH**: usa `mcp({ action: "auth-start", server: "linear" })` para
obtener la URL de autorización, ábrela en tu browser local, y completa con
`mcp({ action: "auth-complete", server: "linear", args: { redirectUrl: "..." } })`.

## Lifecycle modes

| Modo | Comportamiento |
| --- | --- |
| `lazy` (default) | No conecta al arranque. Conecta al primer uso. Desconecta tras idle timeout (10 min). |
| `eager` | Conecta al arranque. No auto-reconecta. |
| `keep-alive` | Conecta al arranque. Auto-reconecta via health checks. Sin idle timeout. |
| `lazy-keep-alive` | No conecta al arranque. Al primer uso, se queda residente y auto-reconecta. |

## Settings avanzados

```json
{
  "settings": {
    "toolPrefix": "server",
    "idleTimeout": 10,
    "requestTimeoutMs": 30000,
    "directTools": false,
    "disableProxyTool": false,
    "autoAuth": false,
    "outputGuard": true,
    "trace": { "enabled": false }
  },
  "mcpServers": { }
}
```

| Setting | Default | Descripción |
| --- | --- | --- |
| `toolPrefix` | `"server"` | Prefijo de nombres: `"server"`, `"short"`, `"none"`, `"mcp"` |
| `idleTimeout` | `10` | Minutos antes de idle disconnect (0 = deshabilitado) |
| `requestTimeoutMs` | SDK default | Timeout para calls MCP en vivo |
| `outputGuard` | `true` | Protege contexto: 50 KiB / 2000 líneas inline, resto a temp file |
| `disableProxyTool` | `false` | Oculta `mcp({})` si todos los direct tools están disponibles |
| `autoAuth` | `false` | Auto-ejecutar OAuth cuando un servidor lo necesita |
| `sampling` | `true` (con UI) | Permite que MCP servers usen modelos de Frida |
| `elicitation` | `true` (con UI) | Permite que MCP servers pidan input al usuario |

### Env vars

| Variable | Efecto |
| --- | --- |
| `MCP_OUTPUT_GUARD=0` | Deshabilita output guard |
| `MCP_DIRECT_TOOLS=server1,server2` | Override direct tools por env |
| `MCP_OAUTH_CALLBACK_PORT=19876` | Override puerto de callback OAuth |
| `MCP_OAUTH_DIR` | Directorio legacy de import de tokens |
| `MCP_UI_VIEWER=browser\|glimpse\|none` | Override viewer de UIs MCP |

## Importar configs de otros agentes

```json
{
  "imports": ["cursor", "claude-code", "claude-desktop", "codex", "windsurf", "vscode", "opencode"],
  "mcpServers": { }
}
```

Ejecuta `/mcp setup` para detectar y adoptar configs existentes de otros
agentes de forma interactiva.

## Arquitectura

```
src/tools/frida-mcp-adapter/index.ts
├── import { createMcpAdapter } from "pi-mcp-adapter"  ← devDep, bundleado por esbuild
├── set PI_CODING_AGENT_DIR = ~/.frida/                 ← redirige paths internos
└── export createFridaMcpAdapter()                      ← factory para pi-session.ts
```

**Wrapper delgado** (ADR-0023 D2): no reimplementa los 17K líneas del upstream.
Importa `createMcpAdapter()`, adapta paths, y registra la extensión.

**Bundling**: `@modelcontextprotocol/sdk` (5.9 MB) + `ext-apps` + `recheck` +
`smol-toml` se bundlean en `dist/extension.js`. `@napi-rs/keyring` (módulo
nativo) se shipea como `.node` en el VSIX.

**Sampling deshabilitado** (ADR-0023): `pi-ai` v0.81+ removió la función
`complete` que el sampling handler del upstream usa. El handler se stubbeó
como no-op. La mayoría de servidores MCP no usan sampling.
