// ExtensionUIContext de Frida: implementa el slice data-oriented del contrato
// `pi.ui` del SDK (select/input/confirm/notify/editor) enrutándolo al webview,
// y deja como no-op las factories Ink (setFooter/setHeader/custom/...) — igual
// que hace el modo RPC del propio SDK (rpc-mode.js).
//
// El cableado (pi-session.ts) llama:
//   session.bindExtensions({ uiContext: createFridaUiContext(...), mode: "rpc" })
// Así el runner expone este objeto como `pi.ui` y fija `pi.mode = "rpc"`. Las
// extensiones nativas que respetan el patrón RPC (rpiv-ask-user-question vía
// runRpcQuestionnaire) detectan ctx.mode==="rpc" + hasDialogUI(ctx.ui) y caminan
// las preguntas con select/input en vez de la factory Ink del TUI.
//
// `custom()` NO se define (ADR-0058): frida no renderiza TUI. Las
// extensiones upstream que protegen su UI con `typeof ctx.ui.custom !==
// "function"` degradan solas a texto (ej. /memory-skills de pi-hermes-memory);
// rpiv-ask-user-question enruta por `ctx.mode === "rpc"` + hasDialogUI
// (dialog walker) y jamás alcanza custom en frida. Definirlo como no-op
// ROMPE esa degradación: la guarda pasa, no hay texto y no hay modal —
// comando mudo. UI rica de extensión en frida = fridaWeb/fridaWebMount.

import { randomUUID } from "node:crypto";
import type { ReactElement } from "react";
import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import type {
	QuestionnaireBridge,
	WebQuestionSpec,
	WebQuestionnaireResult,
} from "./questionnaire-bridge";
import type { UiBridge } from "./ui-bridge";
import type { WebBridge } from "./web-bridge";

type NotifyLevel = "info" | "warning" | "error";

const noop = () => {};

/**
 * Construye el ExtensionUIContext de Frida.
 * @param bridge  puente de diálogos (select/input/confirm) al webview.
 * @param onNotify callback fire-and-forget para ui.notify() → toast en el webview.
 * @param webBridge puente Remote React (pi.ui.fridaWeb) — UI rica con React remoto.
 */
export function createFridaUiContext(
	bridge: UiBridge,
	onNotify: (message: string, level: NotifyLevel) => void,
	webBridge: WebBridge,
	questionnaireBridge: QuestionnaireBridge,
): ExtensionUIContext {
	const select: ExtensionUIContext["select"] = async (title, options, opts) => {
		const resp = await bridge.request(
			{ id: randomUUID(), method: "select", title, options: options.slice() },
			opts?.signal,
		);
		return resp.cancelled ? undefined : resp.value;
	};

	const confirm: ExtensionUIContext["confirm"] = async (
		title,
		message,
		opts,
	) => {
		const resp = await bridge.request(
			{ id: randomUUID(), method: "confirm", title, message },
			opts?.signal,
		);
		return resp.cancelled ? false : resp.value === "true";
	};

	const input: ExtensionUIContext["input"] = async (
		title,
		placeholder,
		opts,
	) => {
		const resp = await bridge.request(
			{ id: randomUUID(), method: "input", title, placeholder },
			opts?.signal,
		);
		return resp.cancelled ? undefined : resp.value;
	};

	// editor() es un input multilínea: reusamos el diálogo input (sin separador
	// visual multiline por ahora — el webview puede renderizar un <textarea>).
	const editor: ExtensionUIContext["editor"] = async (title, prefill) => {
		const resp = await bridge.request(
			{ id: randomUUID(), method: "input", title, placeholder: prefill },
			undefined,
		);
		return resp.cancelled ? undefined : resp.value;
	};

	// El resto del contrato es TUI/Ink y no aplica al webview: no-ops.
	// OJO: custom NO está — ver ADR-0058 (degradación por guarda upstream).
	const ctx = {
		select,
		confirm,
		input,
		editor,
		notify: ((message: string, type?: NotifyLevel) =>
			onNotify(message, type ?? "info")) as ExtensionUIContext["notify"],
		onTerminalInput: () => noop,
		setStatus: noop,
		setWorkingMessage: noop,
		setWorkingVisible: noop,
		setWorkingIndicator: noop,
		setHiddenThinkingLabel: noop,
		setWidget: noop,
		setFooter: noop,
		setHeader: noop,
		setTitle: noop,
		pasteToEditor: noop,
		setEditorText: noop,
		getEditorText: () => "",
		addAutocompleteProvider: noop,
		setEditorComponent: noop,
		getEditorComponent: () => undefined,
		// Opción A (Remote React): UI rica de extensión con React remoto. NO es parte
		// del contrato ExtensionUIContext del SDK (es una extensión propia de Frida);
		// las extensiones web lo usan vía (pi.ui as FridaUIContext).fridaWeb(factory).
		// factory recibe done(result) y devuelve el ReactElement raíz a renderizar.
		fridaWeb: (<T = void>(
			factory: (done: (result: T) => void) => ReactElement,
			placement?: import("./web-protocol").WebPlacement,
		) => webBridge.render(factory, placement)) as any,
		// Variante PERSISTENTE de fridaWeb (ADR-0014): para paneles que viven toda
		// la sesión y se re-renderizan ante estado cambiante (tool `todo`), no
		// diálogos. Devuelve un handle para desmontar. El componente se suscribe a
		// su fuente de estado (useState/useSyncExternalStore) y cada commit se publica.
		fridaWebMount: ((
			factory: () => ReactElement,
			placement?: import("./web-protocol").WebPlacement,
		) => webBridge.mountPersistent(factory, placement)) as any,
		// ask_user_question nativo (ADR-0027): reemplaza fridaWeb para el
		// cuestionario. El webview lo renderiza como QuestionsPanel (componente
		// nativo con selección por teclado, parity con ApprovalCard). Resuelve al
		// cerrar (enviar/cancelar) o al abortar el turn (→ decline).
		askUserQuestion: ((
			questions: WebQuestionSpec[],
		): Promise<WebQuestionnaireResult> =>
			questionnaireBridge
				.request({ id: randomUUID(), questions })
				.then((r) => ({ answers: r.answers, cancelled: r.cancelled }))) as any,
	};

	return ctx as unknown as ExtensionUIContext;
}
