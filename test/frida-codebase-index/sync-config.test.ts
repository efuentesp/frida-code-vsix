import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import {
	readAutoIndexEnabled,
	readEnterpriseEmbeddingsCredential,
	setAutoIndexEnabled,
	syncCodebaseIndexConfig,
} from "../../src/tools/frida-codebase-index/host-setup";
import { pingEmbeddingsProvider } from "../../src/tools/frida-codebase-index/ping";

const dirs: string[] = [];
function tmpWs(): string {
	const d = fs.mkdtempSync(path.join(os.tmpdir(), "frida-sync-cfg-"));
	dirs.push(d);
	return d;
}
afterAll(() => {
	for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

function readCfg(ws: string): any {
	return JSON.parse(
		fs.readFileSync(path.join(ws, ".codebase-index", "config.json"), "utf8"),
	);
}

describe("syncCodebaseIndexConfig (#116)", () => {
	it("frida-enterprise → customProvider con baseUrl/v1, model, apiKey y dimensions", () => {
		const ws = tmpWs();
		const res = syncCodebaseIndexConfig(ws, {
			provider: "frida-enterprise",
			enterpriseBaseUrl: "https://ent.softtek.com/api",
			enterpriseToken: "Bearer-token-xyz",
			enterpriseModel: "azure-embeddings-default",
			enterpriseDimensions: 1536,
		});
		expect(res.written).toBe(true);
		const cfg = readCfg(ws);
		expect(cfg.embeddingProvider).toBe("custom");
		expect(cfg.customProvider).toEqual({
			baseUrl: "https://ent.softtek.com/api/v1",
			model: "azure-embeddings-default",
			apiKey: "Bearer-token-xyz",
			dimensions: 1536,
		});
	});

	it("enterprise sin dimensions (ping pendiente) NO escribe — evita config inválida del upstream", () => {
		const ws = tmpWs();
		const res = syncCodebaseIndexConfig(ws, {
			provider: "frida-enterprise",
			enterpriseBaseUrl: "https://ent.softtek.com/api",
			enterpriseToken: "t",
			enterpriseModel: "azure-embeddings-default",
			enterpriseDimensions: 0,
		});
		expect(res.written).toBe(false);
		expect(res.skipped).toBe("missing-dimensions");
		expect(fs.existsSync(path.join(ws, ".codebase-index", "config.json"))).toBe(
			false,
		);
	});

	it("ollama → embeddingProvider ollama + modelo", () => {
		const ws = tmpWs();
		syncCodebaseIndexConfig(ws, {
			provider: "ollama",
			ollamaModel: "nomic-embed-text",
		});
		const cfg = readCfg(ws);
		expect(cfg.embeddingProvider).toBe("ollama");
		expect(cfg.embeddingModel).toBe("nomic-embed-text");
		expect(cfg.customProvider).toBeUndefined();
	});

	it("openai → embeddingProvider openai + modelo (la key va por auth.json sync existente)", () => {
		const ws = tmpWs();
		syncCodebaseIndexConfig(ws, {
			provider: "openai",
			openaiModel: "text-embedding-3-small",
		});
		const cfg = readCfg(ws);
		expect(cfg.embeddingProvider).toBe("openai");
		expect(cfg.embeddingModel).toBe("text-embedding-3-small");
	});

	it("custom → customProvider con baseUrl/model/dimensions del setting", () => {
		const ws = tmpWs();
		syncCodebaseIndexConfig(ws, {
			provider: "custom",
			customBaseUrl: "http://mi-endpoint:8080/v1",
			customModel: "mi-modelo",
			customDimensions: 768,
		});
		const cfg = readCfg(ws);
		expect(cfg.embeddingProvider).toBe("custom");
		expect(cfg.customProvider.model).toBe("mi-modelo");
		expect(cfg.customProvider.dimensions).toBe(768);
		expect(cfg.customProvider.baseUrl).toBe("http://mi-endpoint:8080/v1");
	});

	it("auto → NO escribe (el upstream autodetecta)", () => {
		const ws = tmpWs();
		const res = syncCodebaseIndexConfig(ws, { provider: "auto" });
		expect(res.written).toBe(false);
		expect(res.skipped).toBe("auto");
	});

	it("merge defensivo: preserva claves existentes del config.json", () => {
		const ws = tmpWs();
		const dir = path.join(ws, ".codebase-index");
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(
			path.join(dir, "config.json"),
			JSON.stringify({
				scope: "project",
				exclude: ["vendor/**"],
				indexing: { autoIndex: false },
				embeddingProvider: "ollama",
				embeddingModel: "viejo",
			}),
		);
		syncCodebaseIndexConfig(ws, {
			provider: "ollama",
			ollamaModel: "mxbai-embed-large",
		});
		const cfg = readCfg(ws);
		// actualiza las claves de embeddings…
		expect(cfg.embeddingModel).toBe("mxbai-embed-large");
		// …y PRESERVA el resto
		expect(cfg.scope).toBe("project");
		expect(cfg.exclude).toEqual(["vendor/**"]);
		expect(cfg.indexing).toEqual({ autoIndex: false });
	});

	it("custom sin baseUrl/model/dimensions → skipped missing-config", () => {
		const ws = tmpWs();
		const res = syncCodebaseIndexConfig(ws, { provider: "custom" });
		expect(res.written).toBe(false);
		expect(res.skipped).toBe("missing-config");
	});
});

describe("pingEmbeddingsProvider (#116)", () => {
	it("ok: mide latencia y deduce dimensions del vector de respuesta", async () => {
		const fetchImpl = vi.fn().mockImplementation(async () => ({
			ok: true,
			status: 200,
			json: async () => ({
				data: [{ embedding: new Array(1536).fill(0.1) }],
			}),
		}));
		const res = await pingEmbeddingsProvider({
			baseUrl: "https://ent.example.com/v1",
			model: "azure-embeddings-default",
			apiKey: "tok",
			fetchImpl: fetchImpl as any,
		});
		expect(res.ok).toBe(true);
		expect(res.dimensions).toBe(1536);
		expect(typeof res.latencyMs).toBe("number");
		const [url, init] = fetchImpl.mock.calls[0];
		expect(url).toBe("https://ent.example.com/v1/embeddings");
		expect(init.method).toBe("POST");
		expect(JSON.parse(init.body).input).toBe("ping");
		expect((init.headers as any).Authorization).toBe("Bearer tok");
	});

	it("error HTTP: ok false con status legible", async () => {
		const fetchImpl = vi.fn().mockImplementation(async () => ({
			ok: false,
			status: 401,
			json: async () => ({}),
		}));
		const res = await pingEmbeddingsProvider({
			baseUrl: "http://localhost:11434/v1",
			model: "nomic-embed-text",
			fetchImpl: fetchImpl as any,
		});
		expect(res.ok).toBe(false);
		expect(res.error).toContain("401");
	});

	it("sin Authorization cuando no hay apiKey (Ollama local)", async () => {
		const fetchImpl = vi.fn().mockImplementation(async () => ({
			ok: true,
			status: 200,
			json: async () => ({ data: [{ embedding: [0.1, 0.2, 0.3] }] }),
		}));
		await pingEmbeddingsProvider({
			baseUrl: "http://localhost:11434/v1",
			model: "nomic-embed-text",
			fetchImpl: fetchImpl as any,
		});
		const init = fetchImpl.mock.calls[0][1];
		expect((init.headers as any).Authorization).toBeUndefined();
	});

	it("respuesta malformada (sin embedding) → error claro", async () => {
		const fetchImpl = vi.fn().mockImplementation(async () => ({
			ok: true,
			status: 200,
			json: async () => ({ data: [{}] }),
		}));
		const res = await pingEmbeddingsProvider({
			baseUrl: "http://x/v1",
			model: "m",
			fetchImpl: fetchImpl as any,
		});
		expect(res.ok).toBe(false);
		expect(res.error).toContain("embedding");
	});
});

describe("readEnterpriseEmbeddingsCredential (#116)", () => {
	it("lee compatibleApiUrl/token/expiry de auth.json y detecta expiración", () => {
		const d = tmpWs();
		fs.writeFileSync(
			path.join(d, "auth.json"),
			JSON.stringify({
				"frida-enterprise": {
					access: "tok-abc",
					compatibleApiUrl: "https://frida.azure-api.net/compatible/",
					expires: Date.now() + 3_600_000,
				},
				"github-copilot": { type: "oauth" },
			}),
		);
		const cred = readEnterpriseEmbeddingsCredential(d);
		expect(cred).not.toBeNull();
		expect(cred?.baseUrl).toBe("https://frida.azure-api.net/compatible");
		expect(cred?.token).toBe("tok-abc");
		expect(cred?.expired).toBe(false);
	});

	it("expirado → expired true; sin credencial → null", () => {
		const d = tmpWs();
		fs.writeFileSync(
			path.join(d, "auth.json"),
			JSON.stringify({
				"frida-enterprise": {
					access: "t",
					compatibleApiUrl: "https://x",
					expires: Date.now() - 1000,
				},
			}),
		);
		expect(readEnterpriseEmbeddingsCredential(d)?.expired).toBe(true);
		expect(readEnterpriseEmbeddingsCredential(tmpWs())).toBeNull();
	});
});

describe("readAutoIndexEnabled / setAutoIndexEnabled (#120)", () => {
	it("default false sin config; set ON escribe y preserva claves existentes", () => {
		const ws = tmpWs();
		expect(readAutoIndexEnabled(ws)).toBe(false);
		// config previo con claves del usuario
		const dir = path.join(ws, ".codebase-index");
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(
			path.join(dir, "config.json"),
			JSON.stringify({
				scope: "project",
				embeddingProvider: "ollama",
				indexing: { autoIndex: false, watchFiles: true },
			}),
		);
		expect(setAutoIndexEnabled(ws, true)).toBe(true);
		expect(readAutoIndexEnabled(ws)).toBe(true);
		const cfg = JSON.parse(
			fs.readFileSync(path.join(dir, "config.json"), "utf8"),
		);
		// merge defensivo: solo indexing.autoIndex cambia; el resto queda
		expect(cfg.scope).toBe("project");
		expect(cfg.embeddingProvider).toBe("ollama");
		expect(cfg.indexing).toEqual({ autoIndex: true, watchFiles: true });
	});

	it("set OFF regresa a false; sin .codebase-index lo crea", () => {
		const ws = tmpWs();
		expect(setAutoIndexEnabled(ws, true)).toBe(true);
		expect(setAutoIndexEnabled(ws, false)).toBe(true);
		expect(readAutoIndexEnabled(ws)).toBe(false);
	});
});
