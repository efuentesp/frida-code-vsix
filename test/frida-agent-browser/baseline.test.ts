import { describe, it, expect, beforeEach } from "vitest";
import {
	checkBinaryBaseline,
	classifyDrift,
	parseLooseSemver,
	resetBaselineCache,
} from "../../src/tools/frida-agent-browser/baseline";
import { PORTED_BINARY_CONTRACT } from "../../src/tools/frida-agent-browser/constants";
import type { RunResult } from "../../src/tools/frida-agent-browser/run";

/** runFn fake: simula `agent-browser --version` con el stdout dado. */
function fakeVersionRun(stdout: string, exitCode = 0) {
	return async (): Promise<RunResult> => ({
		stdout,
		stderr: "",
		exitCode,
		timedOut: false,
	});
}

beforeEach(() => resetBaselineCache());

describe("parseLooseSemver", () => {
	it("extrae x.y.z de salidas con prefijo/sufijo", () => {
		expect(parseLooseSemver("0.34.0")).toEqual({
			major: 0,
			minor: 34,
			patch: 0,
		});
		expect(parseLooseSemver("agent-browser v1.2.3\n")).toEqual({
			major: 1,
			minor: 2,
			patch: 3,
		});
	});

	it("undefined ante texto sin versión", () => {
		expect(parseLooseSemver("no version here")).toBeUndefined();
		expect(parseLooseSemver("")).toBeUndefined();
	});
});

describe("classifyDrift (contrato portado: 0.33.2)", () => {
	it("clasifica match/patch/minor/major correctamente", () => {
		expect(classifyDrift(PORTED_BINARY_CONTRACT, "0.33.2")).toBe("match");
		expect(classifyDrift(PORTED_BINARY_CONTRACT, "0.33.1")).toBe("patch");
		expect(classifyDrift(PORTED_BINARY_CONTRACT, "0.34.0")).toBe("minor");
		expect(classifyDrift(PORTED_BINARY_CONTRACT, "0.33.9")).toBe("patch");
		expect(classifyDrift(PORTED_BINARY_CONTRACT, "1.0.0")).toBe("major");
	});

	it("unknown ante versiones no parseables", () => {
		expect(classifyDrift(PORTED_BINARY_CONTRACT, "banana")).toBe("unknown");
	});
});

describe("checkBinaryBaseline", () => {
	it("drift patch → sin notice (ruido aceptado por diseño)", async () => {
		const r = await checkBinaryBaseline({
			runFn: fakeVersionRun("0.33.1") as never,
		});
		expect(r.drift).toBe("patch");
		expect(r.version).toBe("0.33.1");
		expect(r.notice).toBeUndefined();
	});

	it("drift minor (binario 0.34.0 real) → notice visible con guía", async () => {
		const r = await checkBinaryBaseline({
			runFn: fakeVersionRun("0.34.0") as never,
		});
		expect(r.drift).toBe("minor");
		expect(r.version).toBe("0.34.0");
		expect(r.notice).toContain("0.33.2");
		expect(r.notice).toContain("upstream-drift");
	});

	it("drift major → notice visible", async () => {
		const r = await checkBinaryBaseline({
			runFn: fakeVersionRun("2.0.0") as never,
		});
		expect(r.drift).toBe("major");
		expect(r.notice).toBeTruthy();
	});

	it("binario lanza/ENOENT → unknown sin notice (missing-binary reporta aparte)", async () => {
		const r = await checkBinaryBaseline({
			runFn: (async () => {
				throw new Error("spawn ENOENT");
			}) as never,
		});
		expect(r.drift).toBe("unknown");
		expect(r.notice).toBeUndefined();
	});

	it("stdout no parseable → unknown", async () => {
		const r = await checkBinaryBaseline({
			runFn: fakeVersionRun("garbage") as never,
		});
		expect(r.drift).toBe("unknown");
	});

	it("cache por proceso: segunda llamada no re-spawnea", async () => {
		let calls = 0;
		const counting = (async () => {
			calls++;
			return {
				stdout: "0.33.2",
				stderr: "",
				exitCode: 0,
				timedOut: false,
			} as RunResult;
		}) as never;
		await checkBinaryBaseline({ runFn: counting });
		await checkBinaryBaseline({ runFn: counting });
		expect(calls).toBe(1);
		// force lo invalida
		await checkBinaryBaseline({ runFn: counting, force: true });
		expect(calls).toBe(2);
	});
});
