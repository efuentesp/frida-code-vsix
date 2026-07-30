import { describe, it, expect } from "vitest";
import {
	guardRefMutation,
	isCloseCommand,
	isMutationCommand,
	isNavigateCommand,
	isRefMutation,
	findRefToken,
	type GuardState,
} from "../../src/tools/frida-agent-browser/ref-guard";
import { ManagedSession } from "../../src/tools/frida-agent-browser/session";

// ── detección de comandos ──

describe("ref-guard — detección", () => {
	it("isMutationCommand", () => {
		expect(isMutationCommand(["click", "@e1"])).toBe(true);
		expect(isMutationCommand(["fill", "@e1", "x"])).toBe(true);
		expect(isMutationCommand(["--session", "s", "click", "@e1"])).toBe(true); // salta --session <val>
		expect(isMutationCommand(["snapshot", "-i"])).toBe(false);
		expect(isMutationCommand(["open", "https://x"])).toBe(false);
	});
	it("findRefToken normaliza @e1 → e1", () => {
		expect(findRefToken(["click", "@e1"])).toBe("e1");
		expect(findRefToken(["snapshot", "-i"])).toBeUndefined();
	});
	it("isRefMutation = mutación + @ref", () => {
		expect(isRefMutation(["click", "@e1"])).toBe(true);
		expect(isRefMutation(["click", "#css"])).toBe(false); // mutación sin @ref
		expect(isRefMutation(["snapshot", "@e1"])).toBe(false); // @ref pero no mutación
	});
	it("isNavigateCommand / isCloseCommand", () => {
		expect(isNavigateCommand(["open", "https://x"])).toBe(true);
		expect(isNavigateCommand(["pushstate", "/x"])).toBe(true);
		expect(isNavigateCommand(["click", "@e1"])).toBe(false);
		expect(isCloseCommand(["close"])).toBe(true);
		expect(isCloseCommand(["quit"])).toBe(true);
		expect(isCloseCommand(["snapshot"])).toBe(false);
	});
});

// ── guardRefMutation ──

const state = (
	origin: string | null,
	refs: string[],
	stale: boolean,
): GuardState =>
	origin === null
		? { refSnapshot: null, stale }
		: { refSnapshot: { origin, refs: new Set(refs) }, stale };

describe("ref-guard — guardRefMutation", () => {
	it("sin snapshot → ALLOW (no hay con qué validar)", () => {
		expect(guardRefMutation(state(null, [], false), ["click", "@e1"]).ok).toBe(
			true,
		);
	});
	it("ref presente y no stale → ALLOW", () => {
		expect(
			guardRefMutation(state("https://x", ["e1", "e2"], false), [
				"click",
				"@e1",
			]).ok,
		).toBe(true);
	});
	it("stale (navegó) → REFUSE stale-ref", () => {
		const g = guardRefMutation(state("https://x", ["e1"], true), [
			"click",
			"@e1",
		]);
		expect(g.ok).toBe(false);
		expect((g as { reason: string }).reason).toMatch(/stale/);
	});
	it("ref desconocido → REFUSE stale-ref", () => {
		const g = guardRefMutation(state("https://x", ["e1"], false), [
			"click",
			"@e99",
		]);
		expect(g.ok).toBe(false);
		expect((g as { ref: string }).ref).toBe("e99");
		expect((g as { reason: string }).reason).toMatch(
			/not in the last snapshot/,
		);
	});
});

// ── ManagedSession lifecycle de refSnapshot ──

describe("ManagedSession — refSnapshot lifecycle", () => {
	it("sin snapshot → guard ALLOW", () => {
		const s = new ManagedSession("/tmp");
		expect(s.guardRefMutation(["click", "@e1"]).ok).toBe(true);
	});
	it("tras snapshot → ref conocido ALLOW, desconocido REFUSE", () => {
		const s = new ManagedSession("/tmp");
		s.updateRefsFromSnapshot("https://x", ["e1", "e2"]);
		expect(s.guardRefMutation(["click", "@e1"]).ok).toBe(true);
		expect(s.guardRefMutation(["click", "@e9"]).ok).toBe(false);
	});
	it("invalidateRefs (navegación) → todo @ref REFUSE", () => {
		const s = new ManagedSession("/tmp");
		s.updateRefsFromSnapshot("https://x", ["e1"]);
		s.invalidateRefs();
		expect(s.guardRefMutation(["click", "@e1"]).ok).toBe(false); // aunque existía
	});
	it("clearRefs → vuelve a ALLOW (no snapshot)", () => {
		const s = new ManagedSession("/tmp");
		s.updateRefsFromSnapshot("https://x", ["e1"]);
		s.clearRefs();
		expect(s.guardRefMutation(["click", "@e1"]).ok).toBe(true);
	});
	it("invalidateIfOriginChanged: mismo origin no invalida, distinto sí", () => {
		const s = new ManagedSession("/tmp");
		s.updateRefsFromSnapshot("https://x", ["e1"]);
		s.invalidateIfOriginChanged("https://x"); // mismo
		expect(s.guardRefMutation(["click", "@e1"]).ok).toBe(true);
		s.invalidateIfOriginChanged("https://y"); // drift
		expect(s.guardRefMutation(["click", "@e1"]).ok).toBe(false);
	});
	it("snapshotOrigin refleja el último origin", () => {
		const s = new ManagedSession("/tmp");
		expect(s.snapshotOrigin).toBeUndefined();
		s.updateRefsFromSnapshot("https://a", ["e1"]);
		expect(s.snapshotOrigin).toBe("https://a");
	});
});
