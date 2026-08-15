/**
 * PendingQueueStore — cola de mensajes encolados durante una ejecución (issue #45).
 *
 * El host mantiene la cola en DOS sitios: este store (fuente de verdad para la
 * UI) y las colas internas del SDK (steer/followUp, que gobiernan la entrega).
 * El SDK no expone remoción/reordenamiento individual, así que remove/takeout/
 * move sincronizan con el patrón clearQueue + re-prompt de los supervivientes
 * (cada uno con su modo original). add NO sincroniza: el llamador (runPrompt)
 * ya hace session.prompt() que encola en el SDK; shift tampoco: el SDK ya
 * consumió el mensaje al entregarlo; restoreAll tampoco: abortRun limpia el
 * SDK por su cuenta (s.clearQueue()).
 *
 * Contratos de la UI (issue #45):
 *  - remove(id): quita el mensaje; no se entrega.
 *  - takeout(id): quita y devuelve el entry — la UI lo manda al composer para
 *    editar; al re-enviar se encola AL FINAL (mismo contrato que alt+up de la
 *    TUI de pi).
 *  - move(id, ±1): reordena la entrega futura.
 *
 * Refs #45.
 */

export type QueueMode = "steer" | "followUp";

export interface QueueEntry {
	id: string;
	text: string;
	mode: QueueMode;
}

/** Superficie del SDK que necesita el store para sincronizar. */
export interface SdkQueuePort {
	isStreaming(): boolean;
	clearQueue(): void;
	prompt(
		text: string,
		options: { streamingBehavior: QueueMode },
	): Promise<unknown>;
}

type Listener = (items: readonly QueueEntry[]) => void;

export interface PendingQueueStore {
	/** Encola localmente (el llamador encola en el SDK aparte). Emite change. */
	add(text: string, mode: QueueMode): QueueEntry;
	/** Quita por id y sincroniza el SDK (clearQueue + re-prompt supervivientes). */
	remove(id: string): Promise<QueueEntry | undefined>;
	/** Igual que remove, pero pensado para editar: devuelve el entry. */
	takeout(id: string): Promise<QueueEntry | undefined>;
	/** Mueve una entrada una posición (dir -1 arriba / +1 abajo) y sincroniza. */
	move(id: string, dir: -1 | 1): Promise<boolean>;
	/** Entrega: saca la cabeza (el SDK ya la consumió). Emite change. */
	shift(): QueueEntry | undefined;
	/** Abort: devuelve los textos, vacía local (sin tocar el SDK). No emite. */
	restoreAll(): string[];
	/** Quita localmente la ÚLTIMA entrada con ese texto (fallback de error de
	 * prompt: el SDK nunca la encoló). Emite change. */
	removeLastByText(text: string): QueueEntry | undefined;
	/** Vacía local sin SDK ni emit (resetQueue de abortRun posts aparte). */
	clearLocal(): void;
	snapshot(): readonly QueueEntry[];
	subscribe(listener: Listener): () => void;
}

export function createPendingQueueStore(
	getSdk: () => SdkQueuePort | undefined,
): PendingQueueStore {
	let items: QueueEntry[] = [];
	let seq = 0;
	const listeners = new Set<Listener>();

	function emit(): void {
		for (const l of listeners) l(items);
	}

	function findIndex(id: string): number {
		return items.findIndex((q) => q.id === id);
	}

	/**
	 * Reconstruye las colas del SDK con el estado local: clearQueue + re-prompt
	 * de cada superviviente con su modo original, en orden. Si no hay run activo
	 * (isStreaming=false) el SDK ya drenó sus colas antes de quedar idle — no
	 * hay nada que sincronizar. Si el run termina a mitad de la resincronización
	 * (isStreaming pasa a false), el resto ya no existe en el SDK: cortamos.
	 */
	async function resyncSdk(): Promise<void> {
		const sdk = getSdk();
		if (!sdk || !sdk.isStreaming()) return;
		sdk.clearQueue();
		for (const q of items) {
			if (!sdk.isStreaming()) break;
			await sdk.prompt(q.text, { streamingBehavior: q.mode });
		}
	}

	const store: PendingQueueStore = {
		add(text, mode) {
			const entry: QueueEntry = {
				id: `q-${Date.now().toString(36)}-${++seq}`,
				text,
				mode,
			};
			items = [...items, entry];
			emit();
			return entry;
		},
		async remove(id) {
			const idx = findIndex(id);
			if (idx < 0) return undefined;
			const [removed] = items.splice(idx, 1);
			items = [...items];
			emit();
			await resyncSdk();
			return removed;
		},
		async takeout(id) {
			return store.remove(id);
		},
		async move(id, dir) {
			const idx = findIndex(id);
			const target = idx + dir;
			if (idx < 0 || target < 0 || target >= items.length) return false;
			const next = [...items];
			const [moved] = next.splice(idx, 1);
			next.splice(target, 0, moved);
			items = next;
			emit();
			await resyncSdk();
			return true;
		},
		shift() {
			if (items.length === 0) return undefined;
			const [head, ...rest] = items;
			items = rest;
			emit();
			return head;
		},
		restoreAll() {
			const texts = items.map((q) => q.text);
			items = [];
			return texts;
		},
		removeLastByText(text) {
			for (let i = items.length - 1; i >= 0; i--) {
				if (items[i].text === text) {
					const [removed] = items.splice(i, 1);
					items = [...items];
					emit();
					return removed;
				}
			}
			return undefined;
		},
		clearLocal() {
			items = [];
		},
		snapshot() {
			return items;
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
	return store;
}
