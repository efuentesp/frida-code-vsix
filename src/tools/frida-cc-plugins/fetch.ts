/**
 * frida-cc-plugins — materialización de sources remotos (issue #50, ADR-0057).
 *
 * Trae el contenido de un plugin según su source a un directorio staging:
 *
 *  - git (github/url/git-subdir): `git clone --depth 1 [--branch ref]` +
 *    verificación de `sha` (pin exacto de 40 hex — si ref y sha están, sha
 *    manda, paridad Claude). git-subdir copia el subdirectorio.
 *  - npm: `npm install <pkg>[@<version>] --prefix <staging> [--registry R]`
 *    (registry https, sin credenciales embebidas — validado en el reader).
 *  - archive: GET https (límite 256 MiB, sin redirects a http) + verificación
 *    sha256 + unzip MÍNIMO implementado sobre zlib (stored + deflate raw,
 *    protección zip-slip) — cero dependencias nuevas (yauzl del árbol es
 *    transitive de vsce/dev, no usable en runtime).
 *
 * Todo con spawn/https inyectables para tests (`deps`), sin tocar nada fuera
 * del staging que el caller provee.
 */
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";
import type { PluginSource } from "./readers";

/** Máximo tamaño de zip (paridad Claude: 256 MiB). */
const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;

/** Spawn local (mismo patrón que installer.defaultRun; win32 via shell). */
async function spawnLocal(
	bin: string,
	args: string[],
	cwd: string,
): Promise<{ code: number | null; stderr: string }> {
	const { spawn } = await import("node:child_process");
	return new Promise((resolve, reject) => {
		const child = spawn(bin, args, {
			cwd,
			shell: process.platform === "win32",
			env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "echo" },
		});
		let stderr = "";
		child.stderr?.on("data", (d) => {
			stderr += String(d);
		});
		child.on("error", reject);
		child.on("close", (code) => resolve({ code, stderr }));
		const killer = setTimeout(() => {
			stderr += "\n[timeout 120s]";
			child.kill();
		}, 120_000);
		child.on("close", () => clearTimeout(killer));
	});
}

/** Deps inyectables (git/npm spawn + https fetch) para tests. */
export interface FetchDeps {
	gitRun?: (
		args: string[],
		cwd: string,
	) => Promise<{ code: number | null; stderr: string }>;
	npmRun?: (
		args: string[],
		cwd: string,
	) => Promise<{ code: number | null; stderr: string }>;
	/** Impl real: GET https → Buffer (respeta https-only + límite). */
	fetchArchive?: (url: string) => Promise<Buffer>;
}

export interface MaterializedSource {
	/** Directorio con el contenido COMPLETO del plugin (raíz del plugin). */
	dir: string;
	/** Revisión/versión resuelta (short sha git, versión npm, sha corto zip). */
	rev: string;
	/** Limpieza opcional del staging padre cuando ya no se necesita. */
}

/** Ejecuta git (inyectable). */
async function runGit(
	deps: FetchDeps | undefined,
	args: string[],
	cwd: string,
): Promise<void> {
	const run =
		deps?.gitRun ?? ((a: string[], c: string) => spawnLocal("git", a, c));
	const res = await run(args, cwd);
	if (res.code !== 0) {
		throw new Error(
			`git ${args[0]} falló (exit ${res.code}): ${res.stderr.slice(0, 300)}`,
		);
	}
}

/** HEAD sha completo del repo clonado. */
async function headSha(
	deps: FetchDeps | undefined,
	dir: string,
): Promise<string> {
	const run =
		deps?.gitRun ?? ((a: string[], c: string) => spawnLocal("git", a, c));
	// rev-parse por process spawn no da stdout en el deps tipo estándar;
	// usamos git rev-parse vía archivo: se escribe en .git/HEAD → refs.
	// Simplificación robusta: leer .git/HEAD y resolver la ref manualmente.
	const head = fs.readFileSync(path.join(dir, ".git", "HEAD"), "utf-8").trim();
	if (head.startsWith("ref: ")) {
		const refFile = path.join(dir, ".git", head.slice(5));
		if (fs.existsSync(refFile)) {
			return fs.readFileSync(refFile, "utf-8").trim();
		}
		// packed-refs (clone --depth puede empaquetar).
		const packed = path.join(dir, ".git", "packed-refs");
		if (fs.existsSync(packed)) {
			const ref = head.slice(5);
			for (const line of fs.readFileSync(packed, "utf-8").split("\n")) {
				const m = /^([0-9a-f]{40}) (\S+)$/.exec(line.trim());
				if (m && m[2] === ref) return m[1];
			}
		}
		throw new Error(`No se pudo resolver ${head} en ${dir}`);
	}
	return head; // SHA detached
}

// ─── Unzip mínimo (EOCD + central directory + stored/deflate) ────────────

/** Descomprime un buffer zip en destDir. Protegido contra zip-slip. */
export function unzipSync(zip: Buffer, destDir: string): void {
	// 1. End of Central Directory (desde el final; comentario ≤ 65535).
	let eocd = -1;
	for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 65535); i--) {
		if (zip.readUInt32LE(i) === 0x06054b50) {
			eocd = i;
			break;
		}
	}
	if (eocd < 0)
		throw new Error("zip: EOCD no encontrado (¿archivo zip válido?)");
	const entries = zip.readUInt16LE(eocd + 10);
	let ptr = zip.readUInt32LE(eocd + 16); // offset del central directory

	fs.mkdirSync(destDir, { recursive: true });
	for (let n = 0; n < entries; n++) {
		if (zip.readUInt32LE(ptr) !== 0x02014b50) {
			throw new Error(`zip: central directory corrupto (entrada ${n})`);
		}
		const method = zip.readUInt16LE(ptr + 10);
		const compSize = zip.readUInt32LE(ptr + 20);
		const nameLen = zip.readUInt16LE(ptr + 28);
		const extraLen = zip.readUInt16LE(ptr + 30);
		const commentLen = zip.readUInt16LE(ptr + 32);
		const localOff = zip.readUInt32LE(ptr + 42);
		const name = zip.subarray(ptr + 46, ptr + 46 + nameLen).toString("utf-8");
		ptr += 46 + nameLen + extraLen + commentLen;

		if (name.endsWith("/")) continue; // directorio
		// zip-slip: nombres absolutos o con .. → rechazar.
		const safe = path.normalize(name).replace(/^([/\\])+/, "");
		if (safe.startsWith("..") || path.isAbsolute(name)) {
			throw new Error(`zip: entrada insegura '${name}' (zip-slip)`);
		}

		// 2. Local header: SUS lens (el extra local ≠ central).
		if (zip.readUInt32LE(localOff) !== 0x04034b50) {
			throw new Error(`zip: local header corrupto para '${name}'`);
		}
		const lNameLen = zip.readUInt16LE(localOff + 26);
		const lExtraLen = zip.readUInt16LE(localOff + 28);
		const dataStart = localOff + 30 + lNameLen + lExtraLen;
		const comp = zip.subarray(dataStart, dataStart + compSize);

		const outPath = path.join(destDir, safe);
		fs.mkdirSync(path.dirname(outPath), { recursive: true });
		if (method === 0) {
			fs.writeFileSync(outPath, comp);
		} else if (method === 8) {
			fs.writeFileSync(outPath, zlib.inflateRawSync(comp));
		} else {
			throw new Error(
				`zip: método de compresión ${method} no soportado ('${name}')`,
			);
		}
	}
}

/** Descarga https con límite de tamaño. Impl por defecto (node:https). */
async function defaultFetchArchive(url: string): Promise<Buffer> {
	if (!/^https:\/\//.test(url)) {
		throw new Error(`archive url debe ser https://: ${url}`);
	}
	const { get } = await import("node:https");
	const chunks: Buffer[] = [];
	let total = 0;
	return new Promise<Buffer>((resolve, reject) => {
		get(url, { timeout: 120_000 }, (res) => {
			if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
				// Seguir redirects SOLO https.
				const loc = res.headers.location;
				if (
					loc &&
					res.statusCode >= 300 &&
					res.statusCode < 400 &&
					/^https:\/\//.test(new URL(loc, url).href)
				) {
					defaultFetchArchive(new URL(loc, url).href).then(resolve, reject);
					return;
				}
				reject(new Error(`archive: HTTP ${res.statusCode} para ${url}`));
				return;
			}
			res.on("data", (c: Buffer) => {
				total += c.length;
				if (total > MAX_ARCHIVE_BYTES) {
					reject(new Error(`archive: supera ${MAX_ARCHIVE_BYTES} bytes`));
					res.destroy();
					return;
				}
				chunks.push(c);
			});
			res.on("end", () => resolve(Buffer.concat(chunks)));
			res.on("error", reject);
		}).on("error", reject);
	});
}

/**
 * Detecta la raíz del plugin en un zip extraído: `.claude-plugin/` al tope,
 * o dentro de UNA carpeta de primer nivel (paridad Claude, no más profundo).
 */
export function findPluginRootInDir(extractDir: string): string {
	if (fs.existsSync(path.join(extractDir, ".claude-plugin"))) return extractDir;
	const dirs = fs
		.readdirSync(extractDir, { withFileTypes: true })
		.filter((d) => d.isDirectory() && !d.name.startsWith("."));
	for (const d of dirs) {
		if (fs.existsSync(path.join(extractDir, d.name, ".claude-plugin"))) {
			return path.join(extractDir, d.name);
		}
	}
	throw new Error(
		"archive: no se encontró .claude-plugin/ al tope ni a un nivel del zip",
	);
}

// ─── Materialización por source ──────────────────────────────────────────

/** git: clone --depth 1 [+--branch] [+checkout sha] a stagingDir. */
export async function materializeGit(
	stagingDir: string,
	url: string,
	opts: { ref?: string; sha?: string; subdir?: string },
	deps?: FetchDeps,
): Promise<{ dir: string; rev: string }> {
	fs.mkdirSync(stagingDir, { recursive: true });
	await runGit(
		deps,
		[
			"clone",
			"--depth",
			"1",
			...(opts.ref ? ["--branch", opts.ref] : []),
			url,
			stagingDir,
		],
		stagingDir,
	);
	if (opts.sha) {
		// Pin exacto: fetch del sha (alcanzable en hosts normales) + checkout.
		await runGit(deps, ["fetch", "--depth", "1", "origin", opts.sha], stagingDir);
		await runGit(deps, ["checkout", "--quiet", opts.sha], stagingDir);
	}
	const full = await headSha(deps, stagingDir);
	if (opts.sha && full !== opts.sha.toLowerCase()) {
		throw new Error(`sha no coincide: esperado ${opts.sha}, resuelto ${full}`);
	}
	const rev = (opts.sha ?? full).slice(0, 12);
	const dir = opts.subdir ? path.join(stagingDir, opts.subdir) : stagingDir;
	if (!fs.existsSync(dir)) {
		throw new Error(
			`subdirectorio del plugin inexistente en el repo: ${opts.subdir}`,
		);
	}
	return { dir, rev };
}

/** npm: install del paquete a stagingDir; devuelve el dir del paquete. */
export async function materializeNpm(
	stagingDir: string,
	pkg: string,
	opts: { version?: string; registry?: string },
	deps?: FetchDeps,
): Promise<{ dir: string; rev: string }> {
	const run =
		deps?.npmRun ?? ((a: string[], c: string) => spawnLocal("npm", a, c));
	fs.mkdirSync(stagingDir, { recursive: true });
	const spec = opts.version ? `${pkg}@${opts.version}` : pkg;
	const res = await run(
		[
			"install",
			spec,
			"--no-audit",
			"--no-fund",
			...(opts.registry ? ["--registry", opts.registry] : []),
		],
		stagingDir,
	);
	if (res.code !== 0) {
		throw new Error(
			`npm install ${spec} falló (exit ${res.code}): ${res.stderr.slice(0, 300)}`,
		);
	}
	// Scoped: node_modules/@org/pkg — tomar del nombre.
	const pkgDir = path.join(stagingDir, "node_modules", ...pkg.split("/"));
	if (!fs.existsSync(pkgDir)) {
		throw new Error(`npm: paquete no encontrado tras install: ${pkg}`);
	}
	const version = (() => {
		try {
			return (
				JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf-8")) as {
					version?: string;
				}
			).version;
		} catch {
			return undefined;
		}
	})();
	return { dir: pkgDir, rev: version ?? `npm-${pkg}` };
}

/** archive: download + sha256 + unzip; raíz del plugin detectada. */
export async function materializeArchive(
	stagingDir: string,
	url: string,
	opts: { sha256?: string },
	deps?: FetchDeps,
): Promise<{ dir: string; rev: string }> {
	const fetchFn = deps?.fetchArchive ?? defaultFetchArchive;
	const buf = await fetchFn(url);
	if (opts.sha256) {
		const actual = crypto.createHash("sha256").update(buf).digest("hex");
		if (actual !== opts.sha256.toLowerCase()) {
			throw new Error(
				`archive: integridad sha256 no coincide (esperado ${opts.sha256}, obtenido ${actual})`,
			);
		}
	}
	const extractDir = path.join(stagingDir, "extract");
	unzipSync(buf, extractDir);
	const root = findPluginRootInDir(extractDir);
	const rev = opts.sha256
		? `zip-${opts.sha256.slice(0, 12)}`
		: `zip-${crypto.createHash("sha256").update(buf).digest("hex").slice(0, 12)}`;
	return { dir: root, rev };
}

/** Materializa cualquier source a staging. Devuelve {dir, rev, kind}. */
export async function materializeSource(
	agentDirStaging: string,
	source: PluginSource,
	deps?: FetchDeps,
): Promise<MaterializedSource> {
	switch (source.kind) {
		case "github":
			return materializeGit(
				agentDirStaging,
				`https://github.com/${source.repo}.git`,
				{
					ref: source.ref,
					sha: source.sha,
				},
				deps,
			);
		case "url":
			return materializeGit(
				agentDirStaging,
				source.url,
				{
					ref: source.ref,
					sha: source.sha,
				},
				deps,
			);
		case "git-subdir":
			return materializeGit(
				agentDirStaging,
				source.url,
				{
					ref: source.ref,
					sha: source.sha,
					subdir: source.path,
				},
				deps,
			);
		case "npm":
			return materializeNpm(
				agentDirStaging,
				source.package,
				{
					version: source.version,
					registry: source.registry,
				},
				deps,
			);
		case "archive":
			return materializeArchive(
				agentDirStaging,
				source.url,
				{ sha256: source.sha256 },
				deps,
			);
		default:
			throw new Error(
				`source no materializable: ${(source as { kind: string }).kind}`,
			);
	}
}
