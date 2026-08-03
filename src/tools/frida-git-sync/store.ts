// frida-git-sync — store reactivo para el widget de estado de sincronización.
//
// Patrón de frida-subagents/store.ts: store simple con subscribe/getSnapshot
// para useSyncExternalStore. La lógica de sync (index.ts handleFridaSync) llama
// a las funciones de mutación; el widget (GitSyncWidget.tsx) se suscribe.
//
// El cancel manual (botón del panel) se conecta aquí: operation-runner invoca
// host.onCancel(cancel) al arrancar y registramos esa función; el botón Cancel
// del widget la invoca → el runner aborta → pi.exec cancela el proceso git.

export type SyncWidgetStatus =
	| "idle"
	| "running"
	| "stopping"
	| "cancelled"
	| "done"
	| "error";

export interface SyncWidgetState {
	status: SyncWidgetStatus;
	message: string;
	elapsedMs: number;
	/** Función de cancelación registrada por operation-runner (undefined = no cancelable). */
	cancelFn?: () => void;
}

const IDLE: SyncWidgetState = { status: "idle", message: "", elapsedMs: 0 };

let state: SyncWidgetState = IDLE;
const listeners = new Set<() => void>();

function emit(): void {
	for (const l of listeners) l();
}

export const syncWidgetStore = {
	subscribe(l: () => void): () => void {
		listeners.add(l);
		return () => listeners.delete(l);
	},
	getSnapshot(): SyncWidgetState {
		return state;
	},

	/** Inicia una operación de sync (la llama handleFridaSync al entrar a run()). */
	start(): void {
		state = { status: "running", message: "Starting…", elapsedMs: 0 };
		emit();
	},

	/** Actualiza progreso (phase/elapsed). operation-runner llama formatProgress. */
	update(partial: Partial<SyncWidgetState>): void {
		state = { ...state, ...partial };
		emit();
	},

	/** Registra/desregistra la función de cancelación (host.onCancel del runner). */
	setCancellable(cancelFn: (() => void) | undefined): void {
		state = { ...state, cancelFn };
		emit();
	},

	/** El runner está deteniéndose tras un cancel (host.onStopping). */
	setStopping(): void {
		state = { ...state, status: "stopping" };
		emit();
	},

	/** La operación fue cancelada por el usuario (host.onCancelled). */
	setCancelled(): void {
		state = {
			status: "cancelled",
			message: "Cancelled",
			elapsedMs: 0,
			cancelFn: undefined,
		};
		emit();
	},

	/** La operación terminó (ok, error o cancelada lógicamente). El widget se oculta tras unos segundos. */
	done(result: "done" | "error" | "cancelled"): void {
		state = { status: result, message: "", elapsedMs: 0, cancelFn: undefined };
		emit();
	},

	/** Invoca la cancelación registrada (la llama el botón Cancel del widget). */
	cancel(): void {
		state.cancelFn?.();
	},

	/** Sólo tests. */
	_reset(): void {
		state = IDLE;
		listeners.clear();
	},
};

/** Vuelve a idle tras un breve delay (para que el usuario vea el resultado). */
export function scheduleIdleHide(delayMs = 4000): ReturnType<typeof setTimeout> {
	return setTimeout(() => {
		if (state.status === "done" || state.status === "error" || state.status === "cancelled") {
			state = IDLE;
			emit();
		}
	}, delayMs);
}
