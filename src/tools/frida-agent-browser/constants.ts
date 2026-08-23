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

/** Flags launch-scoped: si aparecen en `args`, requieren una sesión fresh.
 *
 *  Sincronizado con el contrato del binario 0.34.0 (upstream 0.4.2/0.4.3:
 *  rebaseline de launch-scoped-flags.js): caller `--args` y `--user-agent`
 *  pasaron a ser launch-scoped (0.34.0 trata un override vacío como nueva
 *  config de launch y reemplaza el browser), junto con --headed,
 *  --idle-timeout, --allowed-domains y la familia --restore-check-*.
 *
 *  NOTA sticky: `--pin-tab` / `--no-pin-tab` (y su env AGENT_BROWSER_PIN_TAB)
 *  NO son launch-scoped en 0.34.0 — son booleanos globales sticky que pueden
 *  activar/desactivar el binding estricto de tab sobre una sesión viva. Por
 *  eso NO están en esta lista. Véase hasLaunchScopedFlag para los matices
 *  (wait --state, --auto-connect deshabilitado). */
export const LAUNCH_SCOPED_FLAGS = [
	"--namespace",
	"--restore",
	"--restore-save",
	"--restore-check-url",
	"--restore-check-text",
	"--restore-check-fn",
	"--profile",
	"--executable-path",
	"--webgpu",
	"--session-name",
	"--cdp",
	"--state",
	"--auto-connect",
	"--init-script",
	"--enable",
	"--allowed-domains",
	"--idle-timeout",
	"--args",
	"--user-agent",
	"--headed",
	"-p",
	"--provider",
	"--device",
] as const;

/** Etiqueta compacta de flags launch-scoped (para mensajes al agente).
 *  Derivada del array para no divergir (drift de label = drift de contrato). */
export const LAUNCH_SCOPED_FLAG_LABEL = LAUNCH_SCOPED_FLAGS.join(", ");

/** Nombre del binario upstream que se resuelve desde PATH. */
export const AGENT_BROWSER_BINARY = "agent-browser";

/**
 * Versión del binario upstream contra la que se porteó el contrato de este
 * wrapper (input-modes, argv grammar, formato --json). Fuente: ledger
 * upstream-pi.json → pi-agent-browser-native@0.5.0 (contrato del binario
 * 0.34.0 — rebaseline del upstream 0.4.2/0.4.3: launch-scoped flags
 * ampliados, --pin-tab sticky, categoría tab-gone + targetId en tabs).
 * Pendiente diferido: modo `script` del upstream 0.4.0 y presentación
 * compacta (ver issues). Si actualizas el port, actualiza también esta
 * constante y la entrada del ledger.
 *
 * Consumidor: baseline.ts — clasifica el drift binario-real vs contrato
 * portado y emite un notice visible (minor/major) sin bloquear.
 */
export const PORTED_BINARY_CONTRACT = "0.34.0";
