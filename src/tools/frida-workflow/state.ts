// frida-workflow — RunState (estado en memoria que el runner hilvana).

import type { RunState } from "./types";

export function freshRunState(
	runId: string,
	workflow: string,
	input: string,
): RunState {
	return {
		runId,
		workflow,
		originalInput: input,
		primaryHandle: undefined,
		lastOutput: undefined,
		named: {},
		maxIterations: 32,
		visited: new Set<string>(),
		stagesCompleted: 0,
		termination: { status: "running" },
	};
}
