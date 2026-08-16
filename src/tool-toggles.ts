/**
 * Registro central de toggles de extensiones (issue #53).
 *
 * Fuente única de verdad para Configuración > Herramientas: qué módulos son
 * conmutables, con qué setting de VS Code (frida.<key>.enabled, default true,
 * persistencia global → recuerda entre sesiones) y con qué título/desc se
 * muestran en el webview. El host publica valores + descriptores por el
 * mensaje `tool_toggles`; SettingsHub renderiza DESDE ese estado — la UI no
 * duplica la lista (agregar un toggle aquí + su gate lo hace visible).
 *
 * SIN import de vscode: este módulo debe ser importable por tests de paridad
 * contra package.json (contributes.configuration) sin host de VS Code.
 *
 * No conmutables por diseño (ver issue #53): softtek-provider / z-ai-provider
 * (sin ellos no hay LLM), frida-permission-system (la seguridad; su control
 * son los modos de aprobación), frida-args + frida-multi-skills (acopladas al
 * pipeline de skills), frida-pipeline (0 tools, hooks del flujo RPIV) y
 * lens-diagnostics-bridge (pasivo).
 */

/** Descriptor de un toggle conmutable. */
export interface ToolToggleDef {
	/** Key corta (mayúsculaCamel) usada en el registro y el mensaje al webview. */
	key: string;
	/** Setting completo en la config de VS Code: `frida.<key>.enabled`. */
	setting: string;
	/** Título visible en Configuración > Herramientas. */
	title: string;
	/** Descripción visible (qué aporta el módulo / por qué apagarlo). */
	desc: string;
	/** Fase #53: 1 = gate ya existente expuesto a la UI; 2 = gate nuevo. */
	phase: 1 | 2;
}

/** Todos los módulos conmutables, en el orden de render de la pestaña. */
export const TOOL_TOGGLES: ToolToggleDef[] = [
	// === Fase 1: gates existentes (antes ocultos en settings.json) ===
	{
		key: "askUserQuestion",
		setting: "askUserQuestion.enabled",
		title: "Preguntar al usuario",
		desc: "Tool ask_user_question: el agente pregunta con opciones concretas en vez de adivinar.",
		phase: 1,
	},
	{
		key: "todo",
		setting: "todo.enabled",
		title: "Lista de tareas",
		desc: "Tool todo y panel de Tareas para seguimiento multi-paso. Aplica al recargar (sin perder historial).",
		phase: 1,
	},
	{
		key: "context",
		setting: "context.enabled",
		title: "Snapshot de contexto",
		desc: "Tool context: presión del contexto para que el agente se auto-regule. El medidor humano (ContextBar) sigue visible.",
		phase: 1,
	},
	{
		key: "codebaseIndex",
		setting: "codebaseIndex.enabled",
		title: "Índice semántico",
		desc: "Búsqueda semántica + call graph (open-codebase-index, instala paquete on-demand y usa embeddings).",
		phase: 1,
	},
	{
		key: "hermesMemory",
		setting: "hermesMemory.enabled",
		title: "Memoria (Hermes)",
		desc: "Aprendizaje cross-session: el background learning consume tokens del modelo en cada turno.",
		phase: 1,
	},
	{
		key: "knowledgeBase",
		setting: "knowledgeBase.enabled",
		title: "Base de conocimiento",
		desc: "KB OKF del proyecto (pi-llm-wiki, instala paquete on-demand). Apágala en proyectos sin vault.",
		phase: 1,
	},
	{
		key: "ccPlugins",
		setting: "ccPlugins.enabled",
		title: "Plugins de Claude Code",
		desc: "Comando /ccplugin y skills/prompts de plugins instalados. Nunca instala nada solo.",
		phase: 1,
	},
	{
		key: "sandboxes",
		setting: "sandboxes.enabled",
		title: "Sandboxes Docker",
		desc: "Container local por agente (tier-2 de aislamiento). Probea Docker al arranque.",
		phase: 1,
	},
	// === Fase 2: gates nuevos (#53) ===
	{
		key: "subagents",
		setting: "subagents.enabled",
		title: "Sub-agentes",
		desc: "Tools Agent/get_subagent_result/steer_subagent, modo detached y panel /detached. Apágalo para aislar el comportamiento del agente principal.",
		phase: 2,
	},
	{
		key: "agentBrowser",
		setting: "agentBrowser.enabled",
		title: "Navegador del agente",
		desc: "Tool agent_browser: automation de navegador real (binario agent-browser).",
		phase: 2,
	},
	{
		key: "supiWeb",
		setting: "supiWeb.enabled",
		title: "Web y docs",
		desc: "Tools web_fetch_md / web_docs_search / web_docs_fetch (Context7).",
		phase: 2,
	},
	{
		key: "mcpAdapter",
		setting: "mcpAdapter.enabled",
		title: "MCP",
		desc: "Tool proxy mcp + /mcp y /mcp-auth: acceso a servidores MCP con un solo tool.",
		phase: 2,
	},
	{
		key: "extensibleWorkflows",
		setting: "extensibleWorkflows.enabled",
		title: "Workflows",
		desc: "Tool workflow: orquestación multi-agente determinista.",
		phase: 2,
	},
	{
		key: "gitSync",
		setting: "gitSync.enabled",
		title: "Sync de ~/.frida",
		desc: "Comando /fridasync: sincroniza el agentDir entre máquinas vía repo Git privado.",
		phase: 2,
	},
	{
		key: "worktree",
		setting: "worktree.enabled",
		title: "Worktrees",
		desc: "Comando /worktree y botón SCM: worktrees Git ligeros. Si lo apagas, el botón avisa en vez de fallar.",
		phase: 2,
	},
];

/** Mapa key → def para lookup O(1) (readToolToggles / writeToolToggle). */
export const TOOL_TOGGLE_BY_KEY: ReadonlyMap<string, ToolToggleDef> = new Map(
	TOOL_TOGGLES.map((t) => [t.key, t]),
);
