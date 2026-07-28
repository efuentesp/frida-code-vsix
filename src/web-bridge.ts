// WebBridge — gestiona los renderers Remote React activos (uno por llamada a
// pi.ui.fridaWeb). Mantiene un Map rootId→WebRenderer para enrutar los eventos
// que llegan del webview (web_event) al renderer correcto, y publica los commits
// (web_commit) al webview vía onCommit.
//
// El ciclo por UI remota:
//   1. fridaWeb(factory) crea un WebRenderer (rootId único) y lo registra aquí.
//   2. El renderer monta el ReactElement → commits → onCommit(rootId, tree) →
//      el host publica web_commit al webview.
//   3. El usuario interactúa → webview envía web_event{rootId, handlerId} →
//      el host llama webBridge.fireEvent(rootId, handlerId, payload).
//   4. El renderer ejecuta el handler → React re-renderiza → nuevo commit.
//   5. La factory llama done(result) → el renderer se desmonta, se quita del Map,
//      se publica tree:null y fridaWeb resuelve con result.

import { randomUUID } from "node:crypto";
import type { WebNode } from "./web-protocol";
import { createWebRenderer, type WebRenderer } from "./web-renderer";
import type { ReactElement } from "react";

/** Callback que publica un commit al webview (post web_commit). */
export type WebCommitSender = (rootId: string, tree: WebNode | null) => void;

export class WebBridge {
	private renderers = new Map<string, WebRenderer>();

	constructor(private readonly onCommit: WebCommitSender) {}

	/**
	 * Monta una UI React remota. La factory recibe `done(result)` para cerrar y
	 * resolver la promesa con el resultado (opcional). Mientras tanto, cada commit
	 * se publica al webview y los eventos vuelven por fireEvent().
	 */
	render<T = void>(
		factory: (done: (result: T) => void) => ReactElement,
	): Promise<T> {
		return new Promise<T>((resolve) => {
			const rootId = randomUUID();
			let settled = false;
			const renderer = createWebRenderer(
				factory((result: T) => {
					if (settled) return;
					settled = true;
					renderer.unmount();
					this.renderers.delete(rootId);
					resolve(result);
				}),
				(tree) => this.onCommit(rootId, tree),
			);
			this.renderers.set(rootId, renderer);
			renderer.mount();
		});
	}

	/** El webview disparó un evento → enrutar al renderer activo. */
	fireEvent(
		rootId: string,
		handlerId: string,
		payload: { value?: string; checked?: boolean },
	): void {
		this.renderers.get(rootId)?.fireEvent(handlerId, payload);
	}

	/** ¿Hay UI remota activa? (para diagnóstico). */
	get activeCount(): number {
		return this.renderers.size;
	}
}
