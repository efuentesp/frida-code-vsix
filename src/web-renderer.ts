// Host renderer de Remote React (opción A): monta un ReactElement en el HOST con
// un custom renderer de react-reconciler. Las "instancias" son WebNode (objetos
// planos {type, props, children}), NO DOM. En cada commit, serializa el árbol raíz
// (reemplazando handlers por IDs en una tabla) y lo envía al webview vía `send`.
//
// Los eventos del webview llegan por fireEvent(handlerId, payload): se busca en la
// tabla del ÚLTIMO commit y se invoca → React re-renderiza → nuevo commit → diff.
//
// Nota: enviamos SNAPSHOT completo por commit (no diff). Suficiente para UIs de
// extensión (pequeñas). El diffing incremental es mejora futura.

import type React from "react";
import ReactReconciler from "react-reconciler";
import type { WebNode } from "./web-protocol";

/** Instancia interna del renderer: un nodo del árbol con props ORIGINALES (con fns). */
interface Instance extends WebNode {
	// hereda type/props/children; props puede llevar funciones (handlers).
}

/** Container raíz: react-reconciler necesita un "host root". */
interface Container {
	firstChild: Instance | TextInstance | null;
}
interface TextInstance {
	__text: true;
	value: string;
}

type AnyInstance = Instance | TextInstance;

/** Tabla handlerId → fn del último commit. El webview envía handlerIds; aquí se resuelven. */
export type HandlerTable = Map<string, (...args: any[]) => void>;

export interface WebRenderer {
	/** Monta el árbol y envía el primer commit. */
	mount(): void;
	/** Desmonta y envía tree:null (el webview limpia). */
	unmount(): void;
	/** El webview disparó un evento → ejecuta el handler de la tabla vigente. */
	fireEvent(
		handlerId: string,
		payload: { value?: string; checked?: boolean },
	): void;
	/** Tabla actual (para inspección/diagnóstico). */
	readonly handlers: HandlerTable;
}

/**
 * Crea un renderer para un ReactElement. `send` recibe el árbol serializado (o null
 * al desmontar) y debe publicarlo al webview.
 */
export function createWebRenderer(
	rootElement: React.ReactElement,
	send: (tree: WebNode | null) => void,
): WebRenderer {
	const handlers: HandlerTable = new Map();
	let handlerCounter = 0;
	const container: Container = { firstChild: null };

	// Serializa un instancia interna → WebNode con handlers reemplazados por IDs.
	// Reconstruye la tabla en cada flush (el webview siempre usa el último commit).
	function serialize(node: AnyInstance | null): WebNode | string | null {
		if (node === null) return null;
		if ((node as TextInstance).__text) {
			return (node as TextInstance).value;
		}
		const inst = node as Instance;
		const props: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(inst.props)) {
			if (typeof v === "function") {
				const id = `h#${handlerCounter++}`;
				handlers.set(id, v as (...args: any[]) => void);
				props[k] = id;
			} else if (v === undefined || v === null) {
				// omitir vacíos
			} else if (
				typeof v === "string" ||
				typeof v === "number" ||
				typeof v === "boolean"
			) {
				props[k] = v;
			} else if (Array.isArray(v)) {
				props[k] = v;
			} else if (typeof v === "object") {
				// objetos planos serializables (estilos, options…)
				props[k] = v;
			}
			// funciones ya tratadas; otros tipos se omiten
		}
		return {
			type: inst.type,
			props,
			children: inst.children.map(
				(c) => serialize(c as AnyInstance) as WebNode | string,
			),
		};
	}

	function flush(): void {
		handlers.clear();
		handlerCounter = 0;
		const tree = serialize(container.firstChild);
		send(tree as WebNode | null);
	}

	const hostConfig = {
		supportsMutation: true,
		supportsPersistence: false,
		supportsHydration: false,
		isPrimaryRenderer: true,
		noTimeout: undefined as any,
		scheduleTimeout: (cb: () => void, ms: number) => setTimeout(cb, ms),
		cancelTimeout: (id: any) => clearTimeout(id),
		now: Date.now,
		getRootHostContext: () => ({}),
		getChildHostContext: () => ({}),
		shouldSetTextContent: () => false,
		clearContainer: (c: Container) => {
			c.firstChild = null;
		},
		createInstance: (type: string, props: any): Instance => {
			// React pasa los children en props.children (como elementos React con
			// FiberNode/_owner) Y por separado al host config (appendChild). Los
			// excluimos de los props serializados: se gestionan via appendChild y
			// viven en instance.children. Sin esto, JSON.stringify del árbol choca
			// con la estructura circular de FiberNode (props.children → _owner → ...).
			const { children: _omitChildren, ...rest } = props ?? {};
			return { type, props: rest, children: [] };
		},
		createTextInstance: (value: string): TextInstance => ({
			__text: true,
			value,
		}),
		appendInitialChild: (parent: Instance, child: AnyInstance) => {
			parent.children.push(child as any);
		},
		finalizeInitialChildren: () => false,
		prepareForCommit: () => null,
		resetAfterCommit: () => {
			flush();
		},
		appendChild: (parent: Instance, child: AnyInstance) => {
			parent.children.push(child as any);
		},
		appendChildToContainer: (c: Container, child: AnyInstance) => {
			c.firstChild = child;
		},
		insertBefore: (
			parent: Instance,
			child: AnyInstance,
			before: AnyInstance,
		) => {
			const idx = parent.children.indexOf(before as any);
			if (idx >= 0) parent.children.splice(idx, 0, child as any);
			else parent.children.push(child as any);
		},
		insertInContainerBefore: (c: Container, child: AnyInstance) => {
			c.firstChild = child;
		},
		removeChild: (parent: Instance, child: AnyInstance) => {
			const idx = parent.children.indexOf(child as any);
			if (idx >= 0) parent.children.splice(idx, 1);
		},
		removeChildFromContainer: (c: Container) => {
			c.firstChild = null;
		},
		prepareUpdate: () => true as any,
		commitUpdate: (
			instance: Instance,
			_payload: any,
			_type: string,
			_prev: any,
			nextProps: any,
		) => {
			const { children: _omitChildren, ...rest } = nextProps ?? {};
			instance.props = rest;
		},
		commitTextUpdate: (
			textInstance: TextInstance,
			_old: string,
			newText: string,
		) => {
			textInstance.value = newText;
		},
		hideInstance: () => {},
		unhideInstance: () => {},
		hideTextInstance: () => {},
		unhideTextInstance: () => {},
		getPublicInstance: (inst: any) => inst,
		preparePortalMount: () => {},
		getInstanceFromNode: () => null,
		beforeActiveInstanceBlur: () => {},
		afterActiveInstanceBlur: () => {},
		getCurrentEventPriority: () => 16 as any, // DefaultEventPriority
		resolveUpdatePriority: () => 16 as any,
		shouldAttemptEagerHydration: () => false,
		detachDeletedInstance: () => {},
	};

	const reconciler = ReactReconciler(hostConfig as any);
	// react-reconciler 0.29.2: createContainer(containerInfo, tag, hydrationCallbacks,
	// isStrictMode, concurrentUpdatesByDefaultOverride, identifierPrefix,
	// onRecoverableError, transitionCallbacks). tag 0 = LegacyRoot (commit síncrono).
	const root = reconciler.createContainer(
		container,
		0,
		null,
		false,
		false,
		"",
		() => {},
		null,
	);

	return {
		handlers,
		mount() {
			try {
				reconciler.updateContainer(rootElement, root, null, null);
			} catch (e) {
				console.error("[frida-web] mount ERROR:", e);
			}
		},
		unmount() {
			reconciler.updateContainer(null, root, null, null);
			handlers.clear();
			send(null);
		},
		fireEvent(handlerId, payload) {
			const fn = handlers.get(handlerId);
			if (!fn) return;
			// La mayoría de handlers de frida-webview toman (value) o ningún arg.
			// onChange/onSubmit esperan value; onClick ninguno. Pasamos payload.value
			// si la fn arity > 0 (heurística); si no, sin args.
			if (fn.length > 0) fn(payload.value ?? "");
			else fn();
		},
	};
}
