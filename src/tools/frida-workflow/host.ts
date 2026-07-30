// frida-workflow — host: adapta una FridaSession (con createChildSession) al
// port WorkflowHost que consume el runner. El SDK de Pi nunca aparece en el
// runner — sólo aquí, detrás del port.
//
// spawnChild: crea la sesión hija (loader curado: provider hooks + gates, ver
// FridaSession.createChildSession en pi-session.ts), le envía el prompt, espera
// a que termine el turno y entrega el ctx al collector. Luego dispone la hija.

import type {
	SpawnChildOptions,
	WorkflowHost,
	WorkflowSessionContext,
} from "./types";

/** Lo que la FridaSession expone para crear hijas (método aditivo de Fase 1). */
export interface ChildSessionHost {
	createChildSession(opts: {
		prompt: string;
		sessionDir: string;
		signal?: AbortSignal;
	}): Promise<{ session: ChildSession; sessionManager: ChildSessionManager }>;
}

export interface ChildSession {
	prompt(text: string, options?: Record<string, unknown>): Promise<void>;
	dispose?(): void;
	agent?: { state?: { messages?: unknown[] } };
	id?: string;
	sessionFile?: string;
}

export interface ChildSessionManager {
	getBranch?(): unknown[];
	getSessionId?(): string;
}

export interface FridaWorkflowHostDeps {
	frida: ChildSessionHost;
	cwd: string;
	notify: (message: string, level?: "info" | "warning" | "error") => void;
}

export function createFridaWorkflowHost(
	deps: FridaWorkflowHostDeps,
): WorkflowHost {
	return {
		cwd: deps.cwd,
		notify: deps.notify,
		async spawnChild(opts: SpawnChildOptions): Promise<void> {
			const { session, sessionManager } = await deps.frida.createChildSession({
				prompt: opts.prompt,
				sessionDir: opts.sessionDir,
				signal: opts.signal,
			});
			try {
				// prompt() resuelve al terminar el turno (incl. tools/gates). El auth se
				// valida aquí (la hija se creó sin llamar al modelo).
				await session.prompt(opts.prompt);
				const child: WorkflowSessionContext = {
					getMessages: () =>
						sessionManager.getBranch?.() ??
						session.agent?.state?.messages ??
						[],
					getSessionId: () =>
						sessionManager.getSessionId?.() ?? session.id ?? "",
					getSessionFile: () => session.sessionFile,
				};
				await opts.withSession(child);
			} finally {
				session.dispose?.();
			}
		},
	};
}
