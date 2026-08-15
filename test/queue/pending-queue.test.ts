/**
 * Tests de PendingQueueStore (issue #45).
 *
 * Fake SDK que registra las llamadas para verificar el patrón de
 * sincronización clearQueue + re-prompt de supervivientes.
 *
 * Refs #45.
 */
import { describe, expect, it } from "vitest";
import {
	createPendingQueueStore,
	type SdkQueuePort,
} from "../../src/queue/pending-queue";

interface SdkCall {
	kind: "clearQueue" | "prompt";
	text?: string;
	mode?: string;
}

function fakeSdk(streaming = true) {
	const calls: SdkCall[] = [];
	let isStreaming = streaming;
	const sdk: SdkQueuePort = {
		isStreaming: () => isStreaming,
		clearQueue: () => calls.push({ kind: "clearQueue" }),
		prompt: async (text, options) => {
			calls.push({ kind: "prompt", text, mode: options.streamingBehavior });
		},
	};
	return {
		sdk,
		calls,
		setStreaming: (v: boolean) => {
			isStreaming = v;
		},
	};
}

describe("PendingQueueStore (issue #45)", () => {
	it("add encola en orden y notifica a los suscriptores", () => {
		const { sdk } = fakeSdk();
		const store = createPendingQueueStore(() => sdk);
		const seen: number[] = [];
		store.subscribe((items) => seen.push(items.length));

		store.add("uno", "steer");
		store.add("dos", "followUp");

		expect(store.snapshot().map((q) => q.text)).toEqual(["uno", "dos"]);
		expect(store.snapshot()[1].mode).toBe("followUp");
		expect(seen).toEqual([1, 2]);
	});

	it("add NO toca el SDK (el llamador encola aparte)", () => {
		const { sdk, calls } = fakeSdk();
		const store = createPendingQueueStore(() => sdk);
		store.add("uno", "steer");
		expect(calls).toEqual([]);
	});

	it("remove quita por id y sincroniza con clearQueue + re-prompt de supervivientes", async () => {
		const { sdk, calls } = fakeSdk();
		const store = createPendingQueueStore(() => sdk);
		const a = store.add("a", "steer");
		store.add("b", "followUp");
		store.add("c", "steer");

		const removed = await store.remove(a.id);

		expect(removed?.text).toBe("a");
		expect(store.snapshot().map((q) => q.text)).toEqual(["b", "c"]);
		// Un solo clearQueue y re-prompt de los 2 supervivientes en orden y con su modo
		expect(calls).toEqual([
			{ kind: "clearQueue" },
			{ kind: "prompt", text: "b", mode: "followUp" },
			{ kind: "prompt", text: "c", mode: "steer" },
		]);
	});

	it("remove con id inexistente es inofensivo y no sincroniza", async () => {
		const { sdk, calls } = fakeSdk();
		const store = createPendingQueueStore(() => sdk);
		store.add("a", "steer");
		const removed = await store.remove("no-existe");
		expect(removed).toBeUndefined();
		expect(calls).toEqual([]);
	});

	it("takeout quita y devuelve el entry (para edición en composer)", async () => {
		const { sdk } = fakeSdk();
		const store = createPendingQueueStore(() => sdk);
		const e = store.add("editable", "steer");
		const out = await store.takeout(e.id);
		expect(out).toMatchObject({ id: e.id, text: "editable", mode: "steer" });
		expect(store.snapshot()).toHaveLength(0);
	});

	it("move sube/baja una posición y sincroniza", async () => {
		const { sdk, calls } = fakeSdk();
		const store = createPendingQueueStore(() => sdk);
		store.add("a", "steer");
		const b = store.add("b", "steer");
		store.add("c", "steer");

		await store.move(b.id, 1); // a c b
		expect(store.snapshot().map((q) => q.text)).toEqual(["a", "c", "b"]);

		await store.move(b.id, -1); // a b c
		expect(store.snapshot().map((q) => q.text)).toEqual(["a", "b", "c"]);

		// Límites: mover la cabeza hacia arriba / la cola hacia abajo no hace nada
		const a0 = store.snapshot()[0];
		expect(await store.move(a0.id, -1)).toBe(false);
		const c2 = store.snapshot()[2];
		expect(await store.move(c2.id, 1)).toBe(false);

		// Cada move válido = 1 clearQueue + N re-prompts
		expect(calls.filter((c) => c.kind === "clearQueue")).toHaveLength(2);
	});

	it("shift entrega la cabeza sin tocar el SDK (ya la consumió)", () => {
		const { sdk, calls } = fakeSdk();
		const store = createPendingQueueStore(() => sdk);
		store.add("a", "steer");
		store.add("b", "steer");
		const head = store.shift();
		expect(head?.text).toBe("a");
		expect(store.snapshot().map((q) => q.text)).toEqual(["b"]);
		expect(calls).toEqual([]);
	});

	it("restoreAll vacía y devuelve textos (abort) sin tocar el SDK", () => {
		const { sdk, calls } = fakeSdk();
		const store = createPendingQueueStore(() => sdk);
		store.add("a", "steer");
		store.add("b", "followUp");
		const texts = store.restoreAll();
		expect(texts).toEqual(["a", "b"]);
		expect(store.snapshot()).toHaveLength(0);
		expect(calls).toEqual([]);
	});

	it("removeLastByText quita la última coincidencia (fallback de error de prompt)", () => {
		const { sdk } = fakeSdk();
		const store = createPendingQueueStore(() => sdk);
		store.add("dup", "steer");
		store.add("otro", "steer");
		store.add("dup", "followUp");
		const removed = store.removeLastByText("dup");
		expect(removed?.mode).toBe("followUp");
		expect(store.snapshot().map((q) => q.text)).toEqual(["dup", "otro"]);
	});

	it("remove sin run activo (isStreaming=false) no sincroniza: el SDK ya drenó", async () => {
		const { sdk, calls } = fakeSdk(false);
		const store = createPendingQueueStore(() => sdk);
		store.add("a", "steer");
		await store.remove(store.snapshot()[0].id);
		expect(calls).toEqual([]);
	});

	it("resync corta si el run termina a mitad (isStreaming pasa a false)", async () => {
		const { sdk, calls, setStreaming } = fakeSdk(true);
		const store = createPendingQueueStore(() => sdk);
		store.add("a", "steer");
		store.add("b", "steer");
		// El primer re-prompt del fake SDK apaga el run (entrega simulada)
		const origPrompt = sdk.prompt.bind(sdk);
		let n = 0;
		sdk.prompt = async (text, options) => {
			n++;
			if (n === 1) setStreaming(false);
			await origPrompt(text, options);
		};
		await store.remove(store.snapshot()[0].id);
		// Sólo llegó a re-encolar "b" una vez antes del corte
		const prompts = calls.filter((c) => c.kind === "prompt");
		expect(prompts).toEqual([{ kind: "prompt", text: "b", mode: "steer" }]);
	});

	it("unsubscribe deja de recibir notificaciones", () => {
		const { sdk } = fakeSdk();
		const store = createPendingQueueStore(() => sdk);
		const seen: number[] = [];
		const off = store.subscribe((items) => seen.push(items.length));
		store.add("a", "steer");
		off();
		store.add("b", "steer");
		expect(seen).toEqual([1]);
	});
});
