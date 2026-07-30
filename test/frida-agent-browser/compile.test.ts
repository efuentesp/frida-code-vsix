import { describe, it, expect } from "vitest";
import {
	compileJob,
	compileQa,
	compileSemanticAction,
	resolveAgentBrowserInput,
} from "../../src/tools/frida-agent-browser/compile";

describe("compileSemanticAction", () => {
	it("selector directo: click", () => {
		const r = compileSemanticAction({ action: "click", selector: "@e1" });
		expect(r.compiled?.args).toEqual(["click", "@e1"]);
	});
	it("selector directo: fill incluye text", () => {
		const r = compileSemanticAction({
			action: "fill",
			selector: "@e2",
			text: "a@b.com",
		});
		expect(r.compiled?.args).toEqual(["fill", "@e2", "a@b.com"]);
	});
	it("find locator: fill con label", () => {
		const r = compileSemanticAction({
			action: "fill",
			locator: "label",
			value: "Email",
			text: "x",
		});
		expect(r.compiled?.args).toEqual(["find", "label", "Email", "fill", "x"]);
	});
	it("select con value único", () => {
		const r = compileSemanticAction({
			action: "select",
			selector: "#flavor",
			value: "chocolate",
		});
		expect(r.compiled?.args).toEqual(["select", "#flavor", "chocolate"]);
	});
	it("select con values múltiples", () => {
		const r = compileSemanticAction({
			action: "select",
			selector: "#f",
			values: ["a", "b"],
		});
		expect(r.compiled?.args).toEqual(["select", "#f", "a", "b"]);
	});
	it("prefija --session cuando se da session", () => {
		const r = compileSemanticAction({
			action: "click",
			selector: "@e1",
			session: "mine",
		});
		expect(r.compiled?.args).toEqual(["--session", "mine", "click", "@e1"]);
	});
	it("role con name", () => {
		const r = compileSemanticAction({
			action: "click",
			locator: "role",
			role: "button",
			name: "Send",
		});
		expect(r.compiled?.args).toEqual([
			"find",
			"role",
			"button",
			"click",
			"--name",
			"Send",
		]);
	});
	it("errores de validación", () => {
		expect(compileSemanticAction({ selector: "@e1" }).error).toMatch(
			/action must be one of/,
		);
		expect(
			compileSemanticAction({ action: "fill", selector: "@e1" }).error,
		).toMatch(/text is required/);
		expect(
			compileSemanticAction({
				action: "click",
				selector: "@e1",
				locator: "text",
			}).error,
		).toMatch(/cannot be combined/);
		expect(
			compileSemanticAction({ action: "select", selector: "" }).error,
		).toMatch(/selector is required/);
		expect(
			compileSemanticAction({ action: "fill", locator: "label" }).error,
		).toMatch(/value must be/);
	});
});

describe("compileJob", () => {
	it("batch --bail + stdin JSON de los args de cada step", () => {
		const r = compileJob({
			steps: [{ action: "open", url: "https://x" }, { action: "snapshot" }],
		});
		expect(r.compiled?.args).toEqual(["batch", "--bail"]);
		expect(JSON.parse(r.compiled!.stdin)).toEqual([
			["open", "https://x"],
			["snapshot", "-i"],
		]);
		expect(r.compiled?.failFast).toBe(true);
	});
	it("failFast:false → batch sin --bail", () => {
		const r = compileJob({
			failFast: false,
			steps: [{ action: "click", selector: "@e1" }],
		});
		expect(r.compiled?.args).toEqual(["batch"]);
		expect(JSON.parse(r.compiled!.stdin)).toEqual([["click", "@e1"]]);
	});
	it("assertText/assertUrl/screenshot/wait/waitForDownload", () => {
		const r = compileJob({
			steps: [
				{ action: "assertText", text: "Hi" },
				{ action: "assertUrl", url: "**/ship" },
				{ action: "screenshot", path: "a.png" },
				{ action: "waitForDownload", path: "d.zip" },
				{ action: "wait", milliseconds: 500 },
			],
		});
		expect(JSON.parse(r.compiled!.stdin)).toEqual([
			["wait", "--text", "Hi"],
			["wait", "--url", "**/ship"],
			["screenshot", "a.png"],
			["wait", "--download", "d.zip"],
			["wait", "500"],
		]);
	});
	it("type sin delay → un solo step type", () => {
		const r = compileJob({
			steps: [{ action: "type", selector: "#i", text: "hi" }],
		});
		expect(JSON.parse(r.compiled!.stdin)).toEqual([["type", "#i", "hi"]]);
	});
	it("type con delayMs → focus + per-char + waits", () => {
		const r = compileJob({
			steps: [
				{
					action: "type",
					selector: "#i",
					text: "ab",
					delayMs: 10,
					press: "Enter",
				},
			],
		});
		const steps = JSON.parse(r.compiled!.stdin) as string[][];
		expect(steps[0]).toEqual(["focus", "#i"]);
		expect(steps.at(-1)).toEqual(["press", "Enter"]);
		expect(
			steps.filter((s) => s[0] === "keyboard" && s[1] === "type"),
		).toHaveLength(2);
	});
	it("select en job", () => {
		const r = compileJob({
			steps: [{ action: "select", selector: "#f", values: ["x"] }],
		});
		expect(JSON.parse(r.compiled!.stdin)).toEqual([["select", "#f", "x"]]);
	});
	it("open con loadState añade wait --load", () => {
		const r = compileJob({
			steps: [{ action: "open", url: "u", loadState: "networkidle" }],
		});
		const steps = JSON.parse(r.compiled!.stdin) as string[][];
		expect(steps).toEqual([
			["open", "u"],
			["wait", "--load", "networkidle"],
		]);
	});
	it("errores de validación", () => {
		expect(compileJob({ steps: [] }).error).toMatch(/non-empty array/);
		expect(compileJob({ steps: [{ action: "nope" }] }).error).toMatch(
			/action must be one of/,
		);
		expect(compileJob({ steps: [{ action: "open", url: "" }] }).error).toMatch(
			/non-empty url/,
		);
		expect(
			compileJob({
				steps: [{ action: "click", selector: "@e1", role: "button" }],
			}).error,
		).toMatch(/not both/);
		expect(
			compileJob({ steps: [{ action: "click", extra: 1 }] }).error,
		).toMatch(/does not support extra/);
	});
});

describe("compileQa", () => {
	it("qa con url → batch --bail, resets + open + wait load + predicado + checks", () => {
		const r = compileQa({ url: "https://x", expectedText: "Hi" });
		expect(r.compiled?.args).toEqual(["batch", "--bail"]);
		const steps = JSON.parse(r.compiled!.stdin) as string[][];
		expect(steps[0]).toEqual(["network", "requests", "--clear"]);
		expect(steps.find((s) => s[0] === "open")).toEqual(["open", "https://x"]);
		expect(
			steps.find((s) => s[0] === "wait" && s[1] === "--load"),
		).toBeTruthy();
		const fnStep = steps.find((s) => s[1] === "--fn");
		expect(fnStep?.[2]).toMatch(/expected/);
		expect(steps.at(-1)).toEqual(["errors"]); // último check (checkErrors default true)
	});
	it("qa.attached → sin open ni resets", () => {
		const r = compileQa({ attached: true, expectedText: "X" });
		const steps = JSON.parse(r.compiled!.stdin) as string[][];
		expect(steps.find((s) => s[0] === "open")).toBeUndefined();
		expect(steps.find((s) => s.includes("--clear"))).toBeUndefined();
	});
	it("errores de validación", () => {
		expect(compileQa({}).error).toMatch(/url must be a non-empty string/);
		expect(compileQa({ attached: true, url: "x" }).error).toMatch(
			/omitted when .*attached/,
		);
		expect(compileQa({ url: "x", loadState: "nope" }).error).toMatch(
			/loadState must be one of/,
		);
	});
});

describe("resolveAgentBrowserInput", () => {
	it("args mode", () => {
		const r = resolveAgentBrowserInput({ args: ["open", "https://x"] });
		expect("args" in r && r.args).toEqual(["open", "https://x"]);
	});
	it("job mode", () => {
		const r = resolveAgentBrowserInput({
			job: { steps: [{ action: "snapshot" }] },
		});
		expect("mode" in r && r.mode).toBe("job");
	});
	it("propaga stdin en args", () => {
		const r = resolveAgentBrowserInput({
			args: ["eval", "--stdin"],
			stdin: "document.title",
		});
		expect("stdin" in r && r.stdin).toBe("document.title");
	});
	it("0 modos → error", () => {
		expect("error" in resolveAgentBrowserInput({})).toBe(true);
	});
	it("2 modos → error (exclusión mutua)", () => {
		expect(
			"error" in resolveAgentBrowserInput({ args: ["x"], qa: { url: "y" } }),
		).toBe(true);
	});
	it("valida args no-string", () => {
		expect(
			"error" in resolveAgentBrowserInput({ args: [1 as unknown as string] }),
		).toBe(true);
	});
});
