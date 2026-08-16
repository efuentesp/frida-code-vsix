# Toggles de extensiones (Configuración > Herramientas)

> **Estado:** ✅ v1 (issue [#53](https://github.com/efuentesp/frida-code-vsix/issues/53))
> · registro central: `src/tool-toggles.ts`

Frida embebe ~22 factories de extensiones al armar cada sesión. La mayoría
aportan superficie para el agente (tools, comandos, hooks) y **pueden
encienderse/apagarse desde la UI** — Configuración (⚙) > **Herramientas** — sin
desinstalar nada. Default: **todas activas**; la selección se guarda en los
settings globales de VS Code y **recuerda entre sesiones**.

## Cómo funciona

1. **Registro central** (`src/tool-toggles.ts`): lista de descriptores
   `{ key, setting, title, desc }` — fuente única de verdad. El host publica
   valores + descriptores al webview (`tool_toggles`); la pestaña Herramientas
   renderiza desde ese estado (la UI no duplica la lista).
2. **Persistencia**: setting `frida.<key>.enabled` (boolean, default `true`,
   scope global → `settings.json` del usuario).
3. **Aplicación en caliente**: escribir el toggle dispara
   `reloadResources()` — las factories se re-ejecutan y re-leen los getters,
   sin perder el historial de la sesión.

## Toggles disponibles (15)

| Toggle | Setting | Qué apaga |
| --- | --- | --- |
| Preguntar al usuario | `frida.askUserQuestion.enabled` | Tool `ask_user_question` |
| Lista de tareas | `frida.todo.enabled` | Tool `todo` + panel de Tareas |
| Snapshot de contexto | `frida.context.enabled` | Tool `context` (la ContextBar del footer sigue) |
| Índice semántico | `frida.codebaseIndex.enabled` | 6 tools del codebase-index |
| Memoria (Hermes) | `frida.hermesMemory.enabled` | `memory_*`/`session_search` + background learning |
| Base de conocimiento | `frida.knowledgeBase.enabled` | 11 tools `wiki_*` + `/wiki-*` |
| Plugins de Claude Code | `frida.ccPlugins.enabled` | `/ccplugin` + resources convertidos |
| Sandboxes Docker | `frida.sandboxes.enabled` | `sandbox_*` + `/sandbox` |
| Sub-agentes | `frida.subagents.enabled` | `Agent`/`get_subagent_result`/`steer_subagent` + detached |
| Navegador del agente | `frida.agentBrowser.enabled` | `agent_browser` |
| Web y docs | `frida.supiWeb.enabled` | `web_fetch_md` + `web_docs_*` |
| MCP | `frida.mcpAdapter.enabled` | Tool proxy `mcp` + `/mcp` |
| Workflows | `frida.extensibleWorkflows.enabled` | Tool `workflow` |
| Sync de ~/.frida | `frida.gitSync.enabled` | `/fridasync` |
| Worktrees | `frida.worktree.enabled` | `/worktree` + botón SCM (avisa si está apagado) |

## No conmutables (por diseño)

- **softtek-provider / z-ai-provider** — sin ellos no hay LLM.
- **frida-permission-system** — la seguridad (gates de aprobación). Su control
  legítimo son los modos: manual / auto-edit / auto.
- **frida-args + frida-multi-skills** — motor de skills (una skill sin
  placeholders emite bytes idénticos; apagarlas rompería la expansión de
  `/skill:` en vivo).
- **frida-pipeline** — 0 tools; hooks de guidance/git-context del flujo RPIV.
- **lens-diagnostics-bridge** — pasivo (solo escucha el bus de pi-lens).

## Agregar un toggle nuevo

1. Descriptor en `src/tool-toggles.ts` (title/desc visibles en la UI).
2. Setting en `contributes.configuration` del `package.json`
   (`frida.<key>.enabled`, default `true`).
3. Gate en la factory (`pi-session.ts`): patrón
   `(pi) => (opts.XEnabled?.() ?? true) ? factory(pi) : undefined`.
4. Getter en `settings.ts` + wiring en `extension.ts` (los DOS sitios de
   creación de sesión).
5. El test de paridad (`test/tool-toggles.test.ts`) te avisa si olvidaste el
   paso 2.

## Ver también

- Issue [#53](https://github.com/efuentesp/frida-code-vsix/issues/53).
- `docs/adr/0007-todo-nativo-configuracion-conmutable.md` — el patrón original
  (toggle askUserQuestion/todo, la primera iteración de esta UI).
