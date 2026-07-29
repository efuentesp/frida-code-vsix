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
import type { WebNode, WebPlacement } from "./web-protocol";
import { createWebRenderer, type WebRenderer } from "./web-renderer";
import type { ReactElement } from "react";

/** Callback que publica un commit al webview (post web_commit). */
export type WebCommitSender = (
	rootId: string,
	tree: WebNode | null,
	placement: WebPlacement,
) => void;

interface LastTree {
	tree: WebNode | null;
	placement: WebPlacement;
}

export class WebBridge {
	private renderers = new Map<string, WebRenderer>();
	// Último árbol + zona publicado por rootId — para re-publicar tras una recarga
	// del webview (que pierde su estado) cuando hay roots persistentes ya montados.
	private lastTrees = new Map<string, LastTree>();

	constructor(private readonly onCommit: WebCommitSender) {}

	/** Publica un commit al webview y guarda el último árbol (para republish). */
	private commit(
		rootId: string,
		tree: WebNode | null,
		placement: WebPlacement,
	): void {
		this.lastTrees.set(rootId, { tree, placement });
		this.onCommit(rootId, tree, placement);
	}

	/**
	 * Monta una UI React remota. La factory recibe `done(result)` para cerrar y
	 * resolver la promesa con el resultado (opcional). Mientras tanto, cada commit
	 * se publica al webview y los eventos vuelven por fireEvent().
	 */
	render<T = void>(
		factory: (done: (result: T) => void) => ReactElement,
		placement: WebPlacement = "overlay",
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
					this.lastTrees.delete(rootId);
					resolve(result);
				}),
				(tree) => this.commit(rootId, tree, placement),
			);
			this.renderers.set(rootId, renderer);
			renderer.mount();
		});
	}

	/**
	 * Monta una UI React remota PERSISTENTE (no diálogo): vive hasta unmount().
	 * A diferencia de render(), no bloquea ni requiere done() — para paneles que
	 * deben reflejar estado cambiante toda la sesión (ej: tool `todo`). El
	 * componente se re-renderiza vía su propio estado (useState /
	 * useSyncExternalStore); cada commit se publica al webview automáticamente.
	 */
	mountPersistent(
		factory: () => ReactElement,
		placement: WebPlacement = "overlay",
	): { unmount: () => void } {
		const rootId = randomUUID();
		const renderer = createWebRenderer(factory(), (tree) =>
			this.commit(rootId, tree, placement),
		);
		this.renderers.set(rootId, renderer);
		renderer.mount();
		return {
			unmount: () => {
				renderer.unmount();
				this.renderers.delete(rootId);
				this.lastTrees.delete(rootId);
			},
		};
	}

	/**
	 * Re-publica el último árbol de cada root activo. Se llama tras una recarga
	 * del webview (que pierde su estado): los paneles persistentes ya montados
	 * (ej: tool `todo`) no reciben un session_start nuevo, así que sin esto el
	 * webview recargado los mostraría vacíos.
	 */
	republish(): void {
		for (const [rootId, { tree, placement }] of this.lastTrees) {
			this.onCommit(rootId, tree, placement);
		}
	}

	/**
	 * Desmonta TODOS los roots activos y limpia el caché. Se llama al rotar sesión
	 * (new/switch): el dispose del SDK NO emite session_shutdown, así que los
	 * paneles persistentes (todo) no se desmontan solos — sin esto, los roots del
	 * WebBridge viejo seguirían publicando al webview y se acumularían.
	 */
	dispose(): void {
		for (const renderer of this.renderers.values()) {
			renderer.unmount();
		}
		this.renderers.clear();
		this.lastTrees.clear();
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
