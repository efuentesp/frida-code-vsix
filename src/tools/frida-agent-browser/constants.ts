/**
 * frida-agent-browser — constantes (porte nativo de pi-agent-browser-native).
 *
 * Valores canónicos tomados del paquete referencia
 * (dist/extensions/agent-browser/lib/input-modes/types.js). Se replican aquí para
 * que los enums del schema y las validaciones de los compiladores coincidan 1:1
 * con el contrato del binario upstream `agent-browser`.
 */

/** Modo de sesión por defecto. `auto` reutiliza la sesión implícita gestionada. */
export const DEFAULT_SESSION_MODE = "auto" as const;

/** Acciones soportadas por `semanticAction`. */
export const SEMANTIC_ACTIONS = ["check", "click", "fill", "select"] as const;

/** Familias de locator para `semanticAction` (find …). */
export const SEMANTIC_LOCATORS = [
	"alt",
	"label",
	"placeholder",
	"role",
	"testid",
	"text",
	"title",
] as const;

/** Acciones soportadas en cada paso de un `job` (batch). */
export const JOB_STEP_ACTIONS = [
	"open",
	"click",
	"fill",
	"type",
	"select",
	"wait",
	"assertText",
	"assertUrl",
	"waitForDownload",
	"screenshot",
	"snapshot",
] as const;

/** Estados de carga legibles para `qa.loadState` y `job` open.loadState. */
export const QA_LOAD_STATES = [
	"domcontentloaded",
	"load",
	"networkidle",
] as const;

/** Tope de caracteres para `type` con delayMs (typing por carácter). */
export const JOB_TYPE_DELAYED_TEXT_MAX_CHARACTERS = 200;

/** Timeout del predicado de texto-visible en QA (wait --fn). */
export const QA_VISIBLE_TEXT_TIMEOUT_MS = 5_000;

/** Flags launch-scoped: si aparecen en `args`, requieren una sesión fresh. */
export const LAUNCH_SCOPED_FLAGS = [
	"--namespace",
	"--restore",
	"--restore-save",
	"--profile",
	"--executable-path",
	"--webgpu",
	"--session-name",
	"--cdp",
	"--state",
	"--auto-connect",
	"--init-script",
	"--enable",
	"-p",
	"--provider",
	"--device",
] as const;

/** Etiqueta compacta de flags launch-scoped (para mensajes al agente). */
export const LAUNCH_SCOPED_FLAG_LABEL =
	"--profile, --restore, --executable-path, --webgpu, --session-name, --cdp, --state, --auto-connect, --init-script, --enable, -p/--provider, --device";

/** Nombre del binario upstream que se resuelve desde PATH. */
export const AGENT_BROWSER_BINARY = "agent-browser";
