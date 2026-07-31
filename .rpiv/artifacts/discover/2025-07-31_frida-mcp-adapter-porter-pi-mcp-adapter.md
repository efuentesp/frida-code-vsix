# Discovery: Portear pi-mcp-adapter como frida-mcp-adapter

**Fecha**: 2025-07-31
**Autor**: Edgar F. Fuentes Perea
**Estado**: Análisis completo — plan listo para revisión

## Resumen

`pi-mcp-adapter` (v2.17.0, por Nico Bailon) es una extensión nativa de Pi que
conecta servidores MCP (Model Context Protocol) al agente **sin quemar contexto**.
Un único tool proxy `mcp({})` (~200 tokens) reemplaza cientos de definiciones de
herramientas. El agente descubre y ejecuta herramientas on-demand; los servidores
sólo arrancan cuando se usan (lazy por defecto).

## Funcionalidad (50 archivos, 17K líneas)

### Núcleo

- **Proxy tool `mcp({})`** — 10 modos: `status`, `list`, `search`, `describe`,
  `call`, `connect`, `instructions`, `auth-start`, `auth-complete`, `ui-messages`
- **Server lifecycle** — lazy / eager / keep-alive / lazy-keep-alive, idle timeout
  (10 min default), health checks, auto-reconnect
- **Config jerárquica** — `.mcp.json` > `~/.config/mcp/mcp.json` >
  `~/.agents/mcp.json` > Pi global override > `.pi/mcp.json`
- **Metadata cache** — caché en disco de tools/resources/prompts para que
  search/list/describe funcionen sin conexiones activas
- **Direct tools** — registrar tools MCP específicos como first-class tools de Pi
  (visibles en la tool list del agente)
- **Host config imports** — Cursor, Claude Code, Claude Desktop, Codex, Windsurf,
  VS Code, OpenCode

### Seguridad

- **OAuth 2.1 completo** — PKCE, dynamic client registration, callback server
  HTTP en localhost, `WWW-Authenticate` discovery, RFC 9207 `iss` binding
- **Keyring nativo del SO** — macOS Keychain / Windows Credential Manager /
  Linux Secret Service (vía `@napi-rs/keyring`)
- **URL-bound credentials** — credenciales invalidadas si cambia la URL del server
- **Output guard** — protege contexto de responses oversized (50 KiB / 2000 líneas)

### Avanzado

- **MCP resources** — expuestos como tools (`read_<resource>`)
- **MCP prompts** — registrados como slash commands (`/mcp__<server>__<prompt>`)
- **Sampling** — MCP servers pueden invocar modelos de Pi
- **Elicitation** — MCP servers pueden pedir input estructurado al usuario
- **MCP UI integration** — UIs interactivas via Glimpse (ventana nativa macOS) o
  browser, con comunicación bidireccional
- **Protocol tracing** — JSONL metadata-only (sin payloads ni credenciales)
- **Unix socket transport** — rmcp-mux para compartir servidores entre sesiones
- **npx-resolver** — resuelve binarios npx a paths directos (evita proceso padre
  npm de ~143 MB)

## Beneficio para usuarios de Frida

1. **Acceso al ecosistema MCP** — databases, browsers, APIs, GitHub, Slack,
   Figma, Linear, Notion, y cientos de servidores MCP disponibles
2. **Contexto eficiente** — un proxy tool vs cientos de definiciones verbosas
3. **Servidores lazy** — no arrancan hasta que se necesitan (ahorra memoria/CPU)
4. **Config estándar** — lee `.mcp.json` (formato compartido con Claude, Cursor,
   Windsurf, etc.) sin configuración adicional
5. **OAuth persistente** — tokens en el keyring del SO, no en texto plano
6. **Direct tools** — herramientas de uso frecuente como first-class citizens

## Arquitectura de implementación

```
index.ts              → createMcpAdapter(options) → factory (pi: ExtensionAPI) => void
├── proxy-modes.ts    → executeStatus/List/Search/Describe/Call/Connect/Auth/UiMessages
├── direct-tools.ts   → resolveDirectTools, createDirectToolExecutor
├── config.ts         → loadMcpConfig (merge jerárquico 6 fuentes + imports host)
├── server-manager.ts → McpServerManager (stdio/HTTP/Unix socket, single-flight, OAuth)
├── lifecycle.ts      → McpLifecycleManager (keep-alive, idle, health checks)
├── init.ts           → initializeMcp (orquestación, caché bootstrap, failure tracking)
├── metadata-cache.ts → loadMetadataCache/saveMetadataCache/computeServerHash
├── mcp-auth*.ts (4)  → keyring nativo + OAuth PKCE flow + callback server + provider
├── ui-*.ts (3)       → servidor HTTP UI + sesión + Glimpse (ventana nativa macOS)
├── sampling-handler  → MCP servers invocan modelos Pi via complete()
├── elicitation       → MCP servers piden input estructurado (forms/URL)
├── output-guard      → guardMcpOutput (50 KiB / 2000 líneas / spill to temp)
├── prompts.ts        → createPromptCommand (slash commands /mcp__<server>__<prompt>)
├── commands.ts       → /mcp (status/reconnect/setup/tools/prompts/disable/enable/logout)
│                       /mcp-auth (OAuth interactivo)
├── consent-manager   → never / once-per-server / always
├── npx-resolver      → resolveNpxBinary (evita proceso padre npm)
├── session-recovery  → withSessionRecovery (reconectar si token expira mid-flight)
└── runtime-owner     → McpRuntimeOwner (ownership + cleanup + abort fencing)
```

## Dependencias

### Requeridas (NO en Frida actualmente)

| Paquete | Versión upstream | Tamaño | Tipo | ¿Bundeable? |
| --------- | ----------------- | -------- | ------ | ------------- |
| `@modelcontextprotocol/sdk` | 1.30.0 | 5.9 MB | Pure JS (ESM) | ✅ esbuild |
| `@modelcontextprotocol/ext-apps` | 1.7.5 | ~408 KB | Pure JS (ESM) | ✅ esbuild |
| `@napi-rs/keyring` | 1.3.0 | ~2 MB | **Nativo (N-API)** | ❌ external |
| `recheck` | 4.5.0 | ~2 MB | Pure JS/WASM | ✅ esbuild |
| `smol-toml` | 1.7.1 | ~30 KB | Pure JS | ✅ esbuild |
| `ajv-formats` | 3.0.1 | ~10 KB | Pure JS | ✅ esbuild |

### Ya disponibles en Frida

| Paquete | Dónde | Notas |
| --------- | ------- | ------- |
| `ajv` | Frida node_modules (8.20.0) | ✅ |
| `open` | Frida node_modules | ✅ |
| `cross-spawn` | nested en pi-coding-agent | ✅ (vía nodePaths) |
| `zod` | nested en pi-coding-agent | ✅ (vía nodePaths) |
| `strip-json-comments` | Frida node_modules (2.0.1) | ⚠️ v2 (adapter quiere ^5) |

## Restricción: @napi-rs/keyring

`@napi-rs/keyring` es un módulo nativo (N-API) con dependencias opcionales
específicas por plataforma:

- `@napi-rs/keyring-darwin-arm64`
- `@napi-rs/keyring-darwin-x64`
- `@napi-rs/keyring-linux-x64-gnu`
- `@napi-rs/keyring-win32-x64-msvc`
- (etc.)

**No puede ser bundleado por esbuild.** Opciones:

1. **Mantener external + ship en VSIX** — añadir al `external` de esbuild,
   empaquetar `.node` files en el VSIX (estilo `@mariozechner/clipboard-*`)
2. **Fallback a archivo** — si el keyring no está disponible, usar almacenamiento
   en archivo (menos seguro, pero pi-mcp-adapter ya tiene `unavailableAuthSecretStore`)
3. **Resolución dinámica desde Pi** — pi-mcp-adapter ya usa `createRequire` para
   cargar el keyring dinámicamente con fallbacks a bindings específicos

## Paths de Frida

pi-mcp-adapter usa `getAgentPath()` que lee `PI_CODING_AGENT_DIR` o defaultea a
`~/.pi/agent/`. Frida usa `~/.frida/` como agentDir.

**Estrategia**: setear `process.env.PI_CODING_AGENT_DIR = defaultAgentDir()`
(`~/.frida/`) antes de inicializar el adapter. Esto redirige:

- Metadata cache: `~/.pi/agent/mcp-cache.json` → `~/.frida/mcp-cache.json`
- OAuth legacy: `~/.pi/agent/mcp-oauth/` → `~/.frida/mcp-oauth/`
- Pi global override: `~/.pi/agent/mcp.json` → `~/.frida/mcp.json`

Los paths estándar MCP (`.mcp.json`, `~/.config/mcp/mcp.json`) **no cambian** —
son formato compartido entre herramientas.
