import { AsyncLocalStorage } from "node:async_hooks";

const operationSignalContext = new AsyncLocalStorage<AbortSignal>();

/** Run one command with a cancellation signal inherited by nested operations. */
export function withOperationSignal<T>(
	signal: AbortSignal | undefined,
	operation: () => Promise<T>,
): Promise<T> {
	return signal ? operationSignalContext.run(signal, operation) : operation();
}

/** Return the cancellation signal for the active command, when one exists. */
export function getOperationSignal(): AbortSignal | undefined {
	return operationSignalContext.getStore();
}
