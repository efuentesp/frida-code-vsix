import { describe, it, expect } from "vitest";
import {
	classifyFailureCategory,
	classifySuccessCategory,
	buildCategoryDetails,
} from "../../src/tools/frida-agent-browser/results/categories";
import {
	compareRefIds,
	renderRefList,
	renderSnapshot,
} from "../../src/tools/frida-agent-browser/results/snapshot";
import { buildNextActions } from "../../src/tools/frida-agent-browser/results/next-actions";
import {
	commandOf,
	presentAgentBrowserResult,
} from "../../src/tools/frida-agent-browser/results/presentation";

describe("categories — classifySuccessCategory", () => {
	it("inspection / artifact / completed", () => {
		expect(classifySuccessCategory({ inspection: true })).toBe("inspection");
		expect(classifySuccessCategory({ artifacts: [{ exists: true }] })).toBe(
			"artifact-saved",
		);
		expect(classifySuccessCategory({ artifacts: [{ exists: false }] })).toBe(
			"artifact-unverified",
		);
		expect(classifySuccessCategory({ savedFile: "/x.png" })).toBe(
			"artifact-saved",
		);
		expect(classifySuccessCategory({})).toBe("completed");
	});
});

describe("categories — classifyFailureCategory", () => {
	const F = (
		errorText: string,
		opts: { command?: string; args?: string[] } = {},
	) => classifyFailureCategory({ errorText, ...opts });

	it("selector-not-found (locator miss con hint)", () => {
		expect(
			F("Element not found: @e1. Verify the selector, role, or name is correct."),
		).toBe("selector-not-found");
		expect(F("No element found: role=button")).toBe("selector-not-found");
	});
	it("timeout (explícito, no palabra suelta)", () => {
		expect(F("Operation timed out")).toBe("timeout");
		expect(classifyFailureCategory({ timedOut: true })).toBe("timeout");
		expect(F("The timeout page loaded")).not.toBe("timeout"); // palabra suelta no cuenta
	});
	it("missing-binary", () => {
		expect(F("agent-browser is required but was not found on PATH")).toBe(
			"missing-binary",
		);
		expect(F("spawn ENOENT")).toBe("missing-binary");
	});
	it("parse-failure", () => {
		expect(classifyFailureCategory({ parseError: true })).toBe("parse-failure");
	});
	it("stale-ref (explícito)", () => {
		expect(F("@ref may be stale")).toBe("stale-ref");
		expect(F("Unknown ref: @e5")).toBe("stale-ref");
	});
	it("stale-ref inferido: ref usado + element not found", () => {
		expect(F("element not found", { args: ["click", "@e3"] })).toBe("stale-ref");
	});
	it("upstream-error por defecto", () => {
		expect(F("something broke")).toBe("upstream-error");
	});
	it("tab-gone (prefijo canónico 0.34.0, se evalúa primero)", () => {
		expect(F("tab_gone: pinned tab vanished")).toBe("tab-gone");
		// El lastUrl arrastrado (about:blank) no debe reclasificar el fallo.
		expect(F("tab_gone: gone (lastUrl: about:blank)")).toBe("tab-gone");
	});
});

describe("categories — buildCategoryDetails", () => {
	it("éxito → success", () => {
		expect(buildCategoryDetails(true, {})).toEqual({
			resultCategory: "success",
			successCategory: "completed",
		});
	});
	it("fallo → failure + categoría", () => {
		const d = buildCategoryDetails(false, { errorText: "Operation timed out" });
		expect(d.resultCategory).toBe("failure");
		expect(d.failureCategory).toBe("timeout");
	});
});

describe("snapshot — refs", () => {
	it("compareRefIds numérico (no lexicográfico)", () => {
		expect(["e10", "e2", "e1"].sort(compareRefIds)).toEqual(["e1", "e2", "e10"]);
	});
	it('renderRefList: @eN role "name"', () => {
		const list = renderRefList({
			refs: {
				e2: { name: "Go", role: "link" },
				e1: { name: "Hi", role: "heading" },
			},
		});
		expect(list).toEqual(['- @e1 heading "Hi"', '- @e2 link "Go"']);
	});
	it("renderSnapshot combina cuerpo del binario + tabla de refs", () => {
		const txt = renderSnapshot({
			snapshot: '- heading "Hi" [ref=e1]',
			refs: { e1: { name: "Hi", role: "heading" } },
		});
		expect(txt).toContain("[ref=e1]");
		expect(txt).toMatch(/Refs \(1\):/);
		expect(txt).toMatch(/@e1 heading "Hi"/);
	});
	it("renderSnapshot sin cuerpo → sólo refs (o placeholder)", () => {
		expect(renderSnapshot({ refs: {} })).toMatch(/no content/);
	});
});

describe("next-actions", () => {
	it("éxito tras navegación → snapshot-after-navigation", () => {
		const a = buildNextActions({ succeeded: true, command: "open" });
		expect(a).toHaveLength(1);
		expect(a[0].id).toBe("snapshot-after-navigation");
		expect(a[0].params.args).toEqual(["snapshot", "-i"]);
	});
	it("éxito sin navegación → sin acciones", () => {
		expect(buildNextActions({ succeeded: true, command: "snapshot" })).toEqual(
			[],
		);
	});
	it("selector-not-found → refresh-interactive-refs", () => {
		const a = buildNextActions({
			succeeded: false,
			failureCategory: "selector-not-found",
		});
		expect(a[0].id).toBe("refresh-interactive-refs");
	});
	it("stale-ref → refresh-interactive-refs", () => {
		expect(
			buildNextActions({ succeeded: false, failureCategory: "stale-ref" })[0].id,
		).toBe("refresh-interactive-refs");
	});
	it("timeout → recover-after-timeout", () => {
		expect(
			buildNextActions({ succeeded: false, failureCategory: "timeout" })[0].id,
		).toBe("recover-after-timeout");
	});
	it("missing-binary → sin acciones", () => {
		expect(
			buildNextActions({ succeeded: false, failureCategory: "missing-binary" }),
		).toEqual([]);
	});
	it("dedupe por id", () => {
		const a = buildNextActions({
			succeeded: false,
			failureCategory: "stale-ref",
		});
		expect(
			a.filter((x: { id: string }) => x.id === "refresh-interactive-refs"),
		).toHaveLength(1);
	});
});

describe("commandOf", () => {
	it("salta --session <val>", () => {
		expect(commandOf(["--session", "s", "open", "https://x"])).toBe("open");
	});
	it("snapshot -i", () => {
		expect(commandOf(["snapshot", "-i"])).toBe("snapshot");
	});
	it("batch --bail", () => {
		expect(commandOf(["batch", "--bail"])).toBe("batch");
	});
	it("sólo flags → undefined (inspección)", () => {
		expect(commandOf(["--help"])).toBeUndefined();
	});
	it("mirror 0.34.0: salta flags globales con payload", () => {
		expect(commandOf(["--profile", "Default", "open", "x"])).toBe("open");
		expect(commandOf(["--user-agent=X", "open", "x"])).toBe("open");
		expect(commandOf(["--args", "--headless", "open", "x"])).toBe("open");
		expect(commandOf(["--pin-tab", "snapshot", "-i"])).toBe("snapshot");
		expect(commandOf(["wait", "--state", "visible"])).toBe("wait");
		// Booleano con literal true/false: consume el valor, no lo toma como comando.
		expect(commandOf(["--headed", "false", "open", "x"])).toBe("open");
	});
});

describe("presentAgentBrowserResult", () => {
	const present = (env: object, args: string[], exitCode: number | null = 0) =>
		presentAgentBrowserResult({
			envelope: env as never,
			stdout: JSON.stringify(env),
			stderr: "",
			exitCode,
			mode: "args",
			args,
			sessionName: "s",
			cwd: process.cwd(),
		});

	it("snapshot → success + refs en details + nextActions vacío", () => {
		const r = present(
			{
				success: true,
				data: {
					origin: "https://x",
					refs: { e1: { role: "link", name: "A" } },
					snapshot: '- link "A" [ref=e1]',
				},
				error: null,
			},
			["snapshot", "-i"],
		);
		expect(r.isError).toBe(false);
		expect((r.details as { successCategory: string }).successCategory).toBe(
			"completed",
		);
		expect((r.details as { refs: object }).refs).toEqual({
			e1: { role: "link", name: "A" },
		});
	});
	it("open → nextActions sugiere snapshot-after-navigation", () => {
		const r = present(
			{ success: true, data: { url: "https://x", title: "X" }, error: null },
			["open", "https://x"],
		);
		const na = (r.details as { nextActions?: { id: string }[] }).nextActions;
		expect(na?.[0]?.id).toBe("snapshot-after-navigation");
	});
	it("fallo → isError + failureCategory + nextActions de recuperación", () => {
		const r = present(
			{
				success: false,
				data: null,
				error: "Element not found: @e1. Verify the selector, role, or name.",
			},
			["click", "@e1"],
			1,
		);
		expect(r.isError).toBe(true);
		const d = r.details as {
			failureCategory: string;
			nextActions?: { id: string }[];
		};
		expect(d.failureCategory).toBe("selector-not-found");
		expect(d.nextActions?.[0]?.id).toBe("refresh-interactive-refs");
	});
	it("tab list → resumen con selector + label + CDP targetId (0.34.0)", () => {
		const r = present(
			{
				success: true,
				data: {
					tabs: [
						{
							active: true,
							tabId: "t1",
							title: "Docs",
							url: "https://docs.x",
							targetId: "ABC123",
						},
						{
							active: false,
							label: "admin",
							title: "Admin",
							url: "https://admin.x",
						},
					],
				},
				error: null,
			},
			["tab", "list"],
		);
		expect(r.isError).toBe(false);
		const text = r.content[0].text;
		expect(text).toContain("* [t1] target=ABC123 Docs — https://docs.x");
		// Cuando el label ES el selector, no se repite (mirror de getTabSummary).
		expect(text).toContain("- [admin] Admin — https://admin.x");
	});
	it("tab_gone → failureCategory tab-gone + nextActions de rebind", () => {
		const r = present(
			{
				success: false,
				data: null,
				error: "tab_gone: pinned tab vanished (lastUrl: about:blank)",
			},
			["get", "url"],
			1,
		);
		expect(r.isError).toBe(true);
		const d = r.details as {
			failureCategory: string;
			nextActions?: { id: string; params: { args: string[] } }[];
		};
		expect(d.failureCategory).toBe("tab-gone");
		expect(d.nextActions?.map((a) => a.id)).toEqual([
			"list-tabs-after-tab-gone",
			"open-tab-after-tab-gone",
		]);
		expect(d.nextActions?.[0]?.params.args).toEqual(["tab", "list"]);
		expect(d.nextActions?.[1]?.params.args).toEqual(["tab", "new"]);
	});
});
