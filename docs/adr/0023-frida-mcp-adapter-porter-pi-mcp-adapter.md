# ADR-0023: Portear pi-mcp-adapter como frida-mcp-adapter

**Estado**: Propuesto
**Fecha**: 2025-07-31
**Autor**: Edgar F. Fuentes Perea

## Contexto

Frida Code no tiene integración con el ecosistema MCP (Model Context Protocol).
`pi-mcp-adapter` (v2.17.0) es la extensión nativa de Pi que resuelve esto: un
único tool proxy `mcp({})` (~200 tokens) da acceso a cientos de servidores MCP
sin quemar contexto. Ver documento de descubrimiento en
`.rpiv/artifacts/discover/2025-07-31_frida-mcp-adapter-porter-pi-mcp-adapter.md`.

### Restricción crítica

El patrón "cero dependencias npm nuevas" usado en ADR-0020/0021/0022 **no es
viable**: `@modelcontextprotocol/sdk` (5.9 MB) es la implementación oficial del
protocolo MCP y no hay alternativa. Sin este SDK no hay MCP.

### Decisión del usuario

Se eligió **"Port nativo + bundling"**: añadir las dependencias como
`devDependencies`, bundlear todo con esbuild en `dist/extension.js`, VSIX
autocontenido sin dependencias en runtime (excepto módulos nativos).

## Decisiones

### D1: Nombre `frida-mcp-adapter`

Espeja `pi-mcp-adapter`. Espacio: `src/tools/frida-mcp-adapter/`.

### D2: Wrapper delgado sobre el upstream (no re-implementación)

Portear 17K líneas y 50 archivos manualmente es inviable en tiempo razonable y
crea deuda de mantenimiento. En su lugar:

1. Instalar `pi-mcp-adapter` como `devDependency`
2. `import { createMcpAdapter } from "pi-mcp-adapter"` en el wrapper de Frida
3. esbuild bundlea el upstream + todas sus deps puras en `dist/extension.js`
4. El wrapper adapta paths (`PI_CODING_AGENT_DIR` → `~/.frida/`) y registra la
   extensión en `pi-session.ts`

**Ventaja**: acceso a toda la funcionalidad upstream (OAuth, UI, sampling,
elicitation, direct tools, etc.) sin reimplementar.
**Riesgo**: acoplamiento a la versión upstream. Mitigado por `devDependency`
con versión fijada.

### D3: MCP SDK bundeado, @napi-rs/keyring external

| Dep | Estrategia |
| ----- | ----------- |
| `@modelcontextprotocol/sdk` | `devDep` + esbuild bundle |
| `@modelcontextprotocol/ext-apps` | `devDep` + esbuild bundle |
| `recheck` | `devDep` + esbuild bundle |
| `smol-toml` | `devDep` + esbuild bundle |
| `ajv-formats` | `devDep` + esbuild bundle |
| `@napi-rs/keyring` | **External** en esbuild + ship `.node` en VSIX |

`@napi-rs/keyring` es un módulo nativo N-API. Se mantiene en `external` de
esbuild (como `@mariozechner/clipboard-*`) y se empaquetan los `.node` en el
VSIX. pi-mcp-adapter ya maneja carga dinámica con fallbacks por plataforma.

### D4: PI_CODING_AGENT_DIR apunta a ~/.frida

El wrapper setea `process.env.PI_CODING_AGENT_DIR = defaultAgentDir()` antes de
crear el adapter. Esto redirige metadata cache, OAuth legacy y override global
a `~/.frida/`. Los paths MCP estándar (`.mcp.json`, `~/.config/mcp/mcp.json`)
no cambian — son formato compartido.

### D5: Registro en pi-session.ts DESPUÉS de frida-pipeline/frida-subagents

El adapter registra su tool `mcp` y commands `/mcp` + `/mcp-auth`. Se carga
después de las extensiones internas para que el tool `mcp` no interfiera con
el registro de tools nativos.

### D6: Mismas opciones de configuración que el upstream

Frida-mcp-adapter respeta la misma config que pi-mcp-adapter:

- `.mcp.json` (proyecto)
- `~/.config/mcp/mcp.json` (global compartido)
- `~/.agents/mcp.json` (global tool-agnostic)
- `~/.frida/mcp.json` (override global Frida, antes `~/.pi/agent/mcp.json`)
- `.frida/mcp.json` (override proyecto Frida, antes `.pi/mcp.json`)
- Mismas settings (`toolPrefix`, `idleTimeout`, `directTools`, etc.)

### D7: Sin Glimpse (macOS native window)

`glimpseui` es una dependencia opcional de pi-mcp-adapter para ventanas nativas
macOS. Frida no la incluye. El adapter usa browser como fallback automáticamente.
Si el usuario instala Glimpse manualmente, funciona sin cambios.

## Plan de implementación (7 fases)

### Fase 0: Dependencias + esbuild

- [ ] Añadir `devDependencies`: `pi-mcp-adapter`, `@modelcontextprotocol/sdk`,
      `@modelcontextprotocol/ext-apps`, `recheck`, `smol-toml`, `ajv-formats`
- [ ] Añadir `@napi-rs/keyring` + `@napi-rs/keyring-darwin-arm64` a `external`
      en `esbuild.js`
- [ ] Verificar que esbuild resuelve y bundlea todo desde `node_modules`
- [ ] Confirmar `dist/extension.js` incluye el código de MCP SDK
- [ ] **Gate**: build exitoso, `dist/extension.js` contiene referencias a
      `@modelcontextprotocol/sdk`

### Fase 1: Wrapper de Frida

- [ ] `src/tools/frida-mcp-adapter/index.ts`:
  - Importar `createMcpAdapter` del upstream
  - Setear `PI_CODING_AGENT_DIR` si no está seteado
  - Exportar `createFridaMcpAdapter()` factory
- [ ] `src/tools/frida-mcp-adapter/constants.ts`: MSG types, paths
- [ ] **Gate**: `import { createFridaMcpAdapter }` resuelve sin errores

### Fase 2: Integración en pi-session.ts

- [ ] Añadir `createFridaMcpAdapter()` al array de factories en `pi-session.ts`
- [ ] Verificar que el tool `mcp({})` aparece en la tool list
- [ ] Verificar que `/mcp` responde con status
- [ ] **Gate**: crear `.mcp.json` con un server de prueba y conectar vía
      `mcp({ connect: "test-server" })`

### Fase 3: Módulo nativo @napi-rs/keyring

- [ ] Confirmar que el keyring carga en runtime (o cae al fallback gracefully)
- [ ] Si no carga: documentar OAuth usa almacenamiento en archivo
- [ ] Verificar `MCP_DIRECT_TOOLS`, `MCP_OUTPUT_GUARD` env vars funcionan
- [ ] **Gate**: `mcp({ })` muestra status sin errores de keyring

### Fase 4: Documentación

- [ ] `docs/tools/frida-mcp-adapter.md` con guía de uso
- [ ] Actualizar README con sección MCP
- [ ] Ejemplo de `.mcp.json` para proyecto Frida

### Fase 5: Tests

- [ ] Test: wrapper factory crea sin errores
- [ ] Test: PI_CODING_AGENT_DIR se setea correctamente
- [ ] Test: config carga desde paths de Frida
- [ ] **Gate**: `npx vitest run` pasa todos los tests existentes + nuevos

### Fase 6: Release

- [ ] Version bump en `package.json`
- [ ] CHANGELOG
- [ ] `.vscodeignore` — incluir `.node` files de keyring
- [ ] Construir VSIX
- [ ] **Gate**: VSIX instala y `/mcp` funciona en VS Code

## Riesgos y mitigaciones

| Riesgo | Probabilidad | Mitigación |
| -------- | ------------- | ------------ |
| `@napi-rs/keyring` no carga en VS Code extension host | Media | Fallback automático a archivo; OAuth funciona pero menos seguro |
| Bundle demasiado grande (+8 MB) | Alta | Aceptado — el SDK de Pi ya suma 15 MB |
| `strip-json-comments` v2 vs v5 incompatibilidad | Baja | esbuild bundleará la versión del upstream |
| Cambios breaking en upstream | Media | Versión fijada en devDependency |
| OAuth callback port conflictúa con Pi CLI | Baja | Distinto process; callback usa puerto efímero por defecto |
