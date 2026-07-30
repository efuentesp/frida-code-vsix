import { describe, it, expect } from "vitest";
import {
	BRAVE_ADAPTER,
	EXA_ADAPTER,
	formatSearchResults,
	normalizeBraveResult,
	normalizeExaResult,
} from "../../src/tools/frida-agent-browser/web-search/providers";
import {
	buildMissingCredentialError,
	canRegisterWebSearch,
	getProviderOrder,
	getWebSearchCredentialSource,
	resolveCredentialSource,
	resolvePreferredCredential,
} from "../../src/tools/frida-agent-browser/web-search/credentials";
import { createWebSearchTool } from "../../src/tools/frida-agent-browser/web-search/tool";
import type { ConfigState } from "../../src/tools/frida-agent-browser/config/load";

function mkState(
	partial: Partial<ConfigState> & { webSearch?: Record<string, unknown> },
): ConfigState {
	const ws = partial.webSearch as
		| {
				enabled?: boolean;
				exaApiKey?: string;
				braveApiKey?: string;
				preferredProvider?: string;
		  }
		| undefined;
	const derived = ws ? ws.enabled !== false : true;
	return {
		config: { webSearch: partial.webSearch as never },
		errors: [],
		warnings: [],
		layers: [],
		webSearchEnabled: partial.webSearchEnabled ?? derived,
		...partial,
	};
}

// ── providers ──

describe("providers — builders", () => {
	it("Brave URL lleva q/count/country", () => {
		const req = BRAVE_ADAPTER.buildRequest({
			query: "hello world",
			count: 3,
			offset: 0,
			country: "us",
		});
		expect(req.method).toBe("GET");
		expect(req.keyHeader).toBe("X-Subscription-Token");
		expect(req.url).toContain("q=hello+world");
		expect(req.url).toContain("count=3");
		expect(req.url).toContain("country=US");
	});
	it("Exa body lleva numResults/type", () => {
		const req = EXA_ADAPTER.buildRequest({ query: "x", count: 5, offset: 2 });
		expect(req.method).toBe("POST");
		expect(req.keyHeader).toBe("x-api-key");
		const body = JSON.parse(req.body!);
		expect(body.numResults).toBe(7);
		expect(body.type).toBe("auto");
	});
	it("Exa deep searchType → timeout mayor", () => {
		const req = EXA_ADAPTER.buildRequest({
			query: "x",
			count: 5,
			offset: 0,
			searchType: "deep",
		});
		expect(req.timeoutMs).toBeGreaterThan(20000);
	});
});

describe("providers — normalize", () => {
	it("Brave result", () => {
		const r = normalizeBraveResult({
			title: "T",
			url: "https://x.com/a",
			description: "d",
			profile: { name: "X" },
		})!;
		expect(r.title).toBe("T");
		expect(r.url).toBe("https://x.com/a");
		expect(r.source).toBe("X");
	});
	it("Exa result con highlights", () => {
		const r = normalizeExaResult({
			title: "T",
			url: "https://y.com",
			summary: "s",
			author: "A",
		})!;
		expect(r.description).toBe("s");
		expect(r.source).toBe("A");
	});
	it("descarta sin title o url inválido", () => {
		expect(normalizeBraveResult({ url: "https://x.com" })).toBeUndefined();
		expect(
			normalizeBraveResult({ title: "T", url: "ftp://x" }),
		).toBeUndefined();
	});
});

describe("providers — formatSearchResults", () => {
	it("lista numerada con URL", () => {
		const txt = formatSearchResults("brave", "q", [
			{ title: "T", url: "https://x.com" },
		]);
		expect(txt).toMatch(/1\. T/);
		expect(txt).toMatch(/URL: https:\/\/x\.com/);
	});
	it("vacío → mensaje", () => {
		expect(formatSearchResults("exa", "q", [])).toMatch(/No Exa web results/);
	});
});

// ── credentials ──

describe("credentials", () => {
	it("resolveCredentialSource: literal/env/command", async () => {
		expect(
			await resolveCredentialSource({ kind: "literal", rawValue: "k" }),
		).toBe("k");
		expect(
			await resolveCredentialSource(
				{ kind: "env", rawValue: "$MYK" },
				{ env: { MYK: "v" } },
			),
		).toBe("v");
		const cmd = await resolveCredentialSource(
			{ kind: "command", rawValue: "!echo secret" },
			{
				commandResolver: async () => "resolved",
			},
		);
		expect(cmd).toBe("resolved");
	});
	it("getProviderOrder: requested gana; sino preferred", () => {
		expect(
			getProviderOrder(
				mkState({ webSearch: { preferredProvider: "brave" } }),
				"exa",
			),
		).toEqual(["exa"]);
		expect(
			getProviderOrder(
				mkState({ webSearch: { preferredProvider: "brave" } }),
				"auto",
			),
		).toEqual(["brave", "exa"]);
		expect(getProviderOrder(mkState({}), undefined)).toEqual(["exa", "brave"]); // default exa
	});
	it("getWebSearchCredentialSource: config key y env fallback", () => {
		const s = mkState({ webSearch: { exaApiKey: "$K" } });
		expect(getWebSearchCredentialSource(s, "exa", {})?.kind).toBe("env");
		expect(
			getWebSearchCredentialSource(s, "exa", { EXA_API_KEY: "lit" })?.kind,
		).toBe("env"); // config tiene prioridad
		expect(
			getWebSearchCredentialSource(mkState({}), "brave", {
				BRAVE_API_KEY: "lit",
			})?.kind,
		).toBe("literal");
		expect(
			getWebSearchCredentialSource(mkState({}), "exa", {}),
		).toBeUndefined();
	});
	it("canRegisterWebSearch: true con credencial, false sin/disabled/errores", () => {
		expect(
			canRegisterWebSearch(mkState({ webSearch: { exaApiKey: "k" } }), {}),
		).toBe(true);
		expect(canRegisterWebSearch(mkState({}), { EXA_API_KEY: "k" })).toBe(true);
		expect(canRegisterWebSearch(mkState({}), {})).toBe(false);
		expect(
			canRegisterWebSearch(
				mkState({ webSearch: { enabled: false, exaApiKey: "k" } }),
				{},
			),
		).toBe(false);
	});
	it("resolvePreferredCredential: resuelve el preferido disponible", async () => {
		const s = mkState({
			webSearch: { exaApiKey: "key-exa", braveApiKey: "key-brave" },
		});
		const r = await resolvePreferredCredential(s, { provider: "auto" });
		expect(r?.provider).toBe("exa"); // default
		expect(r?.credential.value).toBe("key-exa");
	});
	it("buildMissingCredentialError menciona config + env", () => {
		expect(buildMissingCredentialError("auto")).toMatch(
			/exaApiKey.*EXA_API_KEY/,
		);
	});
});

// ── tool ──

function fakeFetch(json: unknown, ok = true) {
	return async () => ({
		ok,
		status: ok ? 200 : 429,
		statusText: ok ? "OK" : "Too Many Requests",
		text: async () => (typeof json === "string" ? json : JSON.stringify(json)),
	});
}

describe("createWebSearchTool — execute", () => {
	it("Brave: fetch + normalize + format", async () => {
		const state = mkState({ webSearch: { braveApiKey: "brave-key" } });
		const tool = createWebSearchTool({
			configState: state,
			fetchFn: fakeFetch({
				web: {
					results: [{ title: "R", url: "https://r.com", description: "d" }],
				},
				query: { original: "q" },
			}) as never,
		});
		const r = await tool.execute(
			"c",
			{ query: "q", provider: "brave", count: 1 },
			undefined,
		);
		expect(r.content[0].text).toMatch(/1\. R/);
		expect(r.content[0].text).toMatch(/https:\/\/r\.com/);
		expect((r.details as { provider: string }).provider).toBe("brave");
	});

	it("Exa: fetch POST + normalize", async () => {
		const state = mkState({ webSearch: { exaApiKey: "exa-key" } });
		const tool = createWebSearchTool({
			configState: state,
			fetchFn: fakeFetch({
				results: [{ title: "E", url: "https://e.com", summary: "s" }],
			}) as never,
		});
		const r = await tool.execute(
			"c",
			{ query: "q", provider: "exa" },
			undefined,
		);
		expect(r.content[0].text).toMatch(/1\. E/);
	});

	it("sin credencial → throw con guía", async () => {
		const tool = createWebSearchTool({
			configState: mkState({}),
			fetchFn: fakeFetch({}) as never,
		});
		await expect(tool.execute("c", { query: "q" }, undefined)).rejects.toThrow(
			/not configured/,
		);
	});

	it("disabled → throw", async () => {
		const tool = createWebSearchTool({
			configState: mkState({
				webSearch: { enabled: false, exaApiKey: "k" },
				webSearchEnabled: false,
			}),
			fetchFn: fakeFetch({}) as never,
		});
		await expect(tool.execute("c", { query: "q" }, undefined)).rejects.toThrow(
			/disabled/,
		);
	});

	it("config inválida → throw", async () => {
		const tool = createWebSearchTool({
			configState: mkState({ webSearch: { exaApiKey: "k" }, errors: ["bad"] }),
			fetchFn: fakeFetch({}) as never,
		});
		await expect(tool.execute("c", { query: "q" }, undefined)).rejects.toThrow(
			/config is invalid/,
		);
	});

	it("HTTP 429 → throw", async () => {
		const state = mkState({ webSearch: { braveApiKey: "k" } });
		const tool = createWebSearchTool({
			configState: state,
			fetchFn: fakeFetch("rate limited", false) as never,
		});
		await expect(
			tool.execute("c", { query: "q", provider: "brave" }, undefined),
		).rejects.toThrow(/HTTP 429/);
	});

	it("loadConfigState se re-evalúa por llamada (disable en caliente)", async () => {
		let enabled = true;
		const state = mkState({ webSearch: { braveApiKey: "k" } });
		const tool = createWebSearchTool({
			configState: state,
			loadConfigState: () =>
				mkState({
					webSearch: { enabled, braveApiKey: "k" },
					webSearchEnabled: enabled,
				}),
			fetchFn: fakeFetch({}) as never,
		});
		await expect(
			tool.execute("c", { query: "q", provider: "brave" }, undefined),
		).resolves.toBeTruthy();
		enabled = false;
		await expect(
			tool.execute("c", { query: "q", provider: "brave" }, undefined),
		).rejects.toThrow(/disabled/);
	});
});
