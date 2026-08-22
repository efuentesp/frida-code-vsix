import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
	aggregateFailed,
	readIndexedFiles,
	readIndexMeta,
} from "../src/tools/frida-codebase-index/files";

function tmpdir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "frida-idx-files-"));
}

describe("codebase-index/files — lista de archivos indexados (#112)", () => {
	const dirs: string[] = [];
	afterAll(() => {
		for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
	});

	it("aggregateFailed: agrupa batches JSONL por filePath y ordena por chunks", () => {
		const batch = (file: string, n: number) =>
			JSON.stringify({
				version: 1,
				chunks: Array.from({ length: n }, () => ({
					id: "x",
					texts: [],
					metadata: { filePath: file, language: "markdown" },
				})),
			});
		const failed = aggregateFailed([
			batch("docs/adr-0051.md", 48),
			batch("docs/adr-0051.md", 2), // acumula
			batch("README.md", 5),
			"no-es-json", // línea malformada: se ignora
			JSON.stringify({ version: 1, chunks: [] }), // sin chunks
			"", // vacía
		]);
		expect(failed).toEqual([
			{ path: "docs/adr-0051.md", chunks: 50 },
			{ path: "README.md", chunks: 5 },
		]);
	});

	it("aggregateFailed: chunks sin metadata.filePath se descartan", () => {
		const failed = aggregateFailed([
			JSON.stringify({ chunks: [{ id: "x", metadata: { language: "ts" } }] }),
		]);
		expect(failed).toEqual([]);
	});

	it("readIndexedFiles: null si no existe el índice", async () => {
		const d = tmpdir();
		dirs.push(d);
		expect(await readIndexedFiles(d)).toBeNull();
	});

	it("readIndexedFiles: consulta la DB real y agrupa por archivo (skip si no hay sqlite3)", async () => {
		try {
			execFileSync("sqlite3", ["--version"]);
		} catch {
			return; // entorno sin CLI: cubierto por el fallback en runtime
		}
		const d = tmpdir();
		dirs.push(d);
		const idx = path.join(d, ".codebase-index", "index");
		fs.mkdirSync(idx, { recursive: true });
		const db = path.join(idx, "codebase.db");
		execFileSync("sqlite3", [
			db,
			`
			CREATE TABLE chunks (chunk_id TEXT PRIMARY KEY, file_path TEXT NOT NULL, language TEXT NOT NULL);
			INSERT INTO chunks VALUES ('c1', 'src/a.ts', 'typescript');
			INSERT INTO chunks VALUES ('c2', 'src/a.ts', 'typescript');
			INSERT INTO chunks VALUES ('c3', 'webview/b.tsx', 'tsx');
		`,
		]);
		fs.writeFileSync(
			path.join(idx, ".failed-batches.abc.json.tmp"),
			JSON.stringify({
				chunks: [{ id: "f1", metadata: { filePath: "docs/g.md" } }],
			}) + "\n",
		);

		const res = await readIndexedFiles(d);
		expect(res).not.toBeNull();
		expect(res?.files).toEqual([
			{ path: "src/a.ts", chunks: 2, language: "typescript" },
			{ path: "webview/b.tsx", chunks: 1, language: "tsx" },
		]);
		expect(res?.failed).toEqual([{ path: "docs/g.md", chunks: 1 }]);
		expect(["node:sqlite", "sqlite3-cli"]).toContain(res?.engine);
	});
});

describe("codebase-index/files — metadata de embeddings del índice (#114)", () => {
	const dirs: string[] = [];
	afterAll(() => {
		for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
	});

	function mkIndex(metaSQL: string): string {
		const d = tmpdir();
		dirs.push(d);
		const idx = path.join(d, ".codebase-index", "index");
		fs.mkdirSync(idx, { recursive: true });
		execFileSync("sqlite3", [
			path.join(idx, "codebase.db"),
			`CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT); ${metaSQL}`,
		]);
		return d;
	}

	it("readIndexMeta: lee provider/modelo/dimensiones de la metadata real", async () => {
		try {
			execFileSync("sqlite3", ["--version"]);
		} catch {
			return; // sin CLI: cubierto por fallback
		}
		const d = mkIndex(
			`INSERT INTO metadata VALUES ('index.embeddingProvider','github-copilot'),('index.embeddingModel','text-embedding-3-small'),('index.embeddingDimensions','1536');`,
		);
		const meta = await readIndexMeta(d);
		expect(meta).toEqual({
			provider: "github-copilot",
			model: "text-embedding-3-small",
			dimensions: 1536,
		});
	});

	it("readIndexMeta: null si no hay índice o faltan claves de embedding", async () => {
		expect(await readIndexMeta(tmpdir())).toBeNull(); // sin DB
		try {
			execFileSync("sqlite3", ["--version"]);
		} catch {
			return;
		}
		const d = mkIndex(`INSERT INTO metadata VALUES ('schema_version','7');`);
		expect(await readIndexMeta(d)).toBeNull(); // DB sin claves embedding
	});
});
