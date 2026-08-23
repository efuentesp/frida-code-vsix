/**
 * Consulta read-only de los archivos presentes en el índice (#112).
 *
 * El índice del upstream vive en `<ws>/.codebase-index/index/codebase.db`
 * (SQLite; tabla `chunks` con `file_path`, `language`). Los chunks que
 * fallaron al vectorizar persisten en `.failed-batches*.json*` (JSONL: un
 * batch por línea, cada chunk trae `metadata.filePath`).
 *
 * Estrategia de lectura (sin dependencias nativas nuevas):
 *   1. `node:sqlite` (feature-detect; Node 22.5+ del extension host).
 *   2. CLI `sqlite3 -readonly` (macOS lo trae de fábrica).
 *   3. null → el host responde con guía.
 *
 * `node:sqlite` se carga con especificador NO literal: los tipos del
 * @types/node del proyecto no lo incluyen y tsc fallaría al resolverlo; en
 * runtime, si el módulo no existe, el catch degrada al CLI.
 */
import { execFile as execFileCb } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);

export interface IndexedFile {
	path: string;
	chunks: number;
	language: string;
}

export interface FailedFile {
	path: string;
	chunks: number;
}

export interface IndexedFilesResult {
	files: IndexedFile[];
	failed: FailedFile[];
	engine: "node:sqlite" | "sqlite3-cli";
}

/** Metadata de embeddings persistida en el índice (#114). */
export interface IndexMeta {
	provider: string;
	model: string;
	dimensions: number;
}

const SQL_FILES =
	"SELECT file_path, COUNT(*) AS chunks, language FROM chunks GROUP BY file_path ORDER BY chunks DESC LIMIT 500";

/** Directorio del índice dentro del workspace. */
export function indexDir(cwd: string): string {
	return path.join(cwd, ".codebase-index", "index");
}

/**
 * Agrupa los chunks fallidos (JSONL de batches) por archivo. Puro.
 * #119 — recoveredIds: ids de chunks YA confirmados en la DB (recuperados por
 * un reintento posterior): se excluyen para no contarlos como fallidos
 * cuando un .failed-batches de una corrida previa sigue presente.
 */
export function aggregateFailed(
	lines: string[],
	recoveredIds?: Set<string>,
): FailedFile[] {
	const byPath = new Map<string, number>();
	for (const line of lines) {
		const t = line.trim();
		if (!t) continue;
		let batch: {
			chunks?: { id?: unknown; metadata?: { filePath?: unknown } }[];
		};
		try {
			batch = JSON.parse(t);
		} catch {
			continue; // línea malformada: ignora sin abortar
		}
		for (const chunk of batch?.chunks ?? []) {
			const fp = chunk?.metadata?.filePath;
			const p = typeof fp === "string" ? fp : undefined;
			if (typeof p !== "string" || !p) continue;
			const id = typeof chunk?.id === "string" ? chunk.id : undefined;
			if (recoveredIds && id && recoveredIds.has(id)) continue; // #119
			byPath.set(p, (byPath.get(p) ?? 0) + 1);
		}
	}
	return [...byPath.entries()]
		.map(([p, chunks]) => ({ path: p, chunks }))
		.sort((a, b) => b.chunks - a.chunks || a.path.localeCompare(b.path));
}

/** Lee los .failed-batches* del índice y los agrega por archivo.
 *  #119 — recoveredIds filtra chunks ya confirmados en la DB. */
function readFailed(dir: string, recoveredIds?: Set<string>): FailedFile[] {
	try {
		const names = fs
			.readdirSync(dir)
			.filter((n) => n.startsWith(".failed-batches"));
		const lines = names.flatMap((n) => {
			try {
				return fs.readFileSync(path.join(dir, n), "utf8").split("\n");
			} catch {
				return [];
			}
		});
		return aggregateFailed(lines, recoveredIds);
	} catch {
		return [];
	}
}

async function queryViaNodeSqlite(
	db: string,
	sql: string,
): Promise<unknown[] | null> {
	try {
		// Especificador no literal: evita la resolución de tipos de tsc (nota
		// del encabezado). En runtime resuelve al módulo real si existe.
		const specifier = "node:sqlite";
		const mod = (await import(specifier)) as {
			DatabaseSync?: new (
				db: string,
				opts: { readOnly: boolean },
			) => {
				prepare: (sql: string) => { all: () => unknown[] };
				close: () => void;
			};
		};
		if (typeof mod.DatabaseSync !== "function") return null;
		const database = new mod.DatabaseSync(db, { readOnly: true });
		try {
			return database.prepare(sql).all();
		} finally {
			database.close();
		}
	} catch {
		return null;
	}
}

async function queryViaCli(db: string, sql: string): Promise<unknown[] | null> {
	try {
		const { stdout } = await execFile("sqlite3", ["-readonly", db, sql], {
			maxBuffer: 8 * 1024 * 1024,
		});
		return stdout
			.split("\n")
			.filter((l) => l.length > 0)
			.map((l) => l.split("|"));
	} catch {
		return null;
	}
}

/**
 * Lee provider/modelo/dimensiones de embeddings de la metadata del índice
 * (#114). null si no hay índice o faltan las claves (índice sin embeddings).
 */
export async function readIndexMeta(cwd: string): Promise<IndexMeta | null> {
	const db = path.join(indexDir(cwd), "codebase.db");
	if (!fs.existsSync(db)) return null;

	const SQL_META =
		"SELECT key, value FROM metadata WHERE key IN ('index.embeddingProvider','index.embeddingModel','index.embeddingDimensions')";
	let rows: unknown[] | null = await queryViaNodeSqlite(db, SQL_META);
	if (!rows) rows = await queryViaCli(db, SQL_META);
	if (!rows) return null;

	const map = new Map<string, string>();
	for (const r of rows) {
		const row = r as Record<string, unknown> | string[];
		const k = String(Array.isArray(row) ? row[0] : row.key);
		const v = Array.isArray(row) ? row[1] : row.value;
		if (v !== null && v !== undefined) map.set(k, String(v));
	}
	const provider = map.get("index.embeddingProvider");
	const model = map.get("index.embeddingModel");
	const dims = Number(map.get("index.embeddingDimensions"));
	if (!provider || !model) return null;
	return {
		provider,
		model,
		dimensions: Number.isFinite(dims) ? dims : 0,
	};
}
export async function readIndexedFiles(
	cwd: string,
): Promise<IndexedFilesResult | null> {
	const db = path.join(indexDir(cwd), "codebase.db");
	if (!fs.existsSync(db)) return null;

	let rows: unknown[] | null = null;
	let engine: IndexedFilesResult["engine"] | null = null;
	rows = await queryViaNodeSqlite(db, SQL_FILES);
	if (rows) {
		engine = "node:sqlite";
	} else {
		rows = await queryViaCli(db, SQL_FILES);
		if (rows) engine = "sqlite3-cli";
	}
	if (!rows || !engine) return null;

	const files: IndexedFile[] = rows
		.map((r) => {
			// node:sqlite devuelve objetos; el CLI devuelve arrays [path, n, lang]
			const row = r as Record<string, unknown> | string[];
			const p = Array.isArray(row) ? row[0] : row.file_path;
			const n = Array.isArray(row) ? Number(row[1]) : Number(row.chunks);
			const lang = Array.isArray(row) ? row[2] : row.language;
			return {
				path: String(p ?? ""),
				chunks: Number.isFinite(n) ? n : 0,
				language: String(lang ?? "—"),
			};
		})
		.filter((f) => f.path.length > 0);

	// #119 — ids de chunks YA confirmados: los .failed-batches de corridas
	// previas pueden seguir presentes aunque sus chunks ya se recuperaron.
	const idRows =
		(await queryViaNodeSqlite(db, "SELECT chunk_id FROM chunks")) ??
		(await queryViaCli(db, "SELECT chunk_id FROM chunks"));
	const recoveredIds = idRows
		? new Set(
				idRows.map((r) => {
					const row = r as Record<string, unknown> | string[];
					const id = Array.isArray(row) ? row[0] : row.chunk_id;
					return typeof id === "string" ? id : "";
				}),
			)
		: undefined;

	return {
		files,
		failed: readFailed(indexDir(cwd), recoveredIds),
		engine,
	};
}

/**
 * Último archivo confirmado en el índice (#118): el chunk con mayor rowid
 * (orden de inserción → confirmación más reciente). Read-only, mismo
 * mecanismo que readIndexMeta. null sin índice o sin chunks.
 */
export async function readLastIndexedFile(cwd: string): Promise<string | null> {
	const db = path.join(indexDir(cwd), "codebase.db");
	if (!fs.existsSync(db)) return null;
	const SQL_LAST = "SELECT file_path FROM chunks ORDER BY rowid DESC LIMIT 1";
	let rows: unknown[] | null = await queryViaNodeSqlite(db, SQL_LAST);
	if (!rows) rows = await queryViaCli(db, SQL_LAST);
	if (!rows || rows.length === 0) return null;
	const row = rows[0] as Record<string, unknown> | string[];
	const p = Array.isArray(row) ? row[0] : row.file_path;
	return typeof p === "string" && p.length > 0 ? p : null;
}
