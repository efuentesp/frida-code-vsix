/**
 * frida-knowledge-base — factory del wrapper (issue #29, ADR-0040).
 *
 * Corre la factory del upstream @zosmaai/pi-llm-wiki (MIT) contra el
 * ExtensionAPI REAL de la sesión — passthrough completo de sus 11 tools
 * wiki_* + hooks del lifecycle (before_agent_start = recall layering,
 * guardrails sobre wiki/**). Encima, la parte que el package loader de pi
 * haría y que el wrapper on-demand NO tiene (ADR-0040 D2/D6):
 *
 *  - Comandos /wiki-* + skill llm-wiki: el upstream los define como
 *    prompts/*.md y skills/llm-wiki (los carga el package loader vía
 *    pi.prompts/pi.skills del manifest, no la factory) → los
 *    MATERIALIZAMOS como symlinks en <agentDir>/prompts y <agentDir>/skills:
 *    el dispatcher nativo del SDK (session.prompt con
 *    expandPromptTemplates, mismo canal que /worktree) se encarga del
 *    $ARGUMENTS y del autocompletado. Cero re-implementación.
 *  - Aliases frida kb_*: el issue #29 pide kb_search/kb_neighbors sobre el
 *    modelo del upstream. kb_search delega a searchWikiHybrid (recall
 *    híbrido, fast-path léxico sin embeddings); kb_neighbors explora las
 *    aristas del grafo OKF v0.2 — que son links markdown/wikilinks con el
 *    `type` OKF del destino (OKF v0.2 no define aristas tipadas en
 *    frontmatter; ver docs/tools/frida-knowledge-base.md) — out-edges vía
 *    extractKnowledgeLinks + in-edges escaneando el vault.
 *
 * Flujo (idéntico a frida-hermes-memory):
 *  1. PI_CODING_AGENT_DIR=~/.frida si no está seteado — ANTES del import:
 *     host.ts del upstream resuelve config con getAgentDir() (y es la base
 *     de los dirs prompts/ y skills/ del SDK).
 *  2. Paquete ausente al pin → tool guía kb_search + instalación en
 *     BACKGROUND (fire-and-forget; estado vía onStateChange para notificar
 *     y sugerir /reload).
 *  3. Paquete presente → jiti(entry, alias) → factory(pi) → materializar
 *     prompts/skill + registrar aliases kb_*.
 *
 * El gate (frida.knowledgeBase.enabled, default true) lo aplica el caller
 * en pi-session.ts. La capa HUMANA (grafo/backlinks/plantillas) es Foam
 * vía extensionDependencies (ADR-0040 D3) — nada de eso vive aquí.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { createJiti } from "jiti";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import {
	KNOWLEDGE_BASE_FACTORY_NAME,
	KNOWLEDGE_BASE_PIN,
	KNOWLEDGE_BASE_SPEC,
	upstreamEntryPath,
	upstreamPeerAliases,
} from "./constants";
import { ensureInstalled, isInstalledAtPin } from "./installer";

export interface CreateKnowledgeBaseOpts {
	/** Agent dir de Frida (~/.frida). */
	agentDir: string;
	/** Dir del bundle de frida (dist/) — base para resolver los peer-deps. */
	distDir: string;
	/** Log de diagnóstico (PoC/Debug). */
	onLog?: (line: string) => void;
	/** cwd del workspace (para resolver el vault del proyecto). */
	cwd?: string;
	/** Inyectable para tests (instalación on-demand). */
	deps?: {
		ensureInstalled?: typeof ensureInstalled;
	};
}

/** Estado del wrapper para el host (notificaciones/sugerir /reload). */
export interface KnowledgeBaseState {
	installed: boolean;
	version?: string;
	/** Instalación background en curso (paquete ausente al arrancar). */
	installing?: boolean;
	/** Error de instalación o carga, si ocurrió. */
	error?: string;
}

/** Raíz del paquete instalado (<agentDir>/npm/node_modules/@zosmaai/pi-llm-wiki). */
export function packageRoot(agentDir: string): string {
	return path.join(agentDir, "npm", "node_modules", "@zosmaai", "pi-llm-wiki");
}

function unwrapDefault(mod: unknown): unknown {
	if (mod && typeof mod === "object" && "default" in mod) {
		const d = (mod as { default: unknown }).default;
		if (typeof d === "function") return d;
	}
	return mod;
}

/** Shape del resultado de tool (AgentToolResult: content + details + isError). */
type ToolResult = {
	content: { type: "text"; text: string }[];
	details: Record<string, unknown>;
	isError?: boolean;
};

/** Tool guía cuando el paquete upstream no está disponible. */
function guideKbTool(guideText: string) {
	return {
		name: "kb_search",
		label: "kb_search",
		description:
			"Base de conocimiento OKF del proyecto (frida-knowledge-base). Si el paquete upstream no está instalado, responde con la guía de instalación.",
		parameters: {
			type: "object",
			properties: {},
			additionalProperties: true,
		},
		async execute(): Promise<ToolResult> {
			return {
				content: [{ type: "text", text: guideText }],
				details: { failureCategory: "knowledge-base-guide" },
				isError: true,
			};
		},
	};
}

/** Frontmatter mínimo: llaves clave: valor (para `type`/`title` OKF). */
function parseFrontmatter(raw: string): {
	fm: Record<string, string>;
	body: string;
} {
	if (!raw.startsWith("---")) return { fm: {}, body: raw };
	const end = raw.indexOf("\n---", 3);
	if (end < 0) return { fm: {}, body: raw };
	const block = raw.slice(3, end);
	const body = raw.slice(end + 4).replace(/^\n+/, "");
	const fm: Record<string, string> = {};
	for (const line of block.split("\n")) {
		const m = /^([a-zA-Z_-]+):\s*(.*)$/.exec(line.trim());
		if (m) fm[m[1]] = m[2].replace(/^["']|["']$/g, "");
	}
	return { fm, body };
}

/**
 * Materializa prompts/*.md y skills/llm-wiki del paquete como symlinks bajo
 * <agentDir>/prompts y <agentDir>/skills — los dirs que el resource loader
 * del SDK escanea (prompt-templates.js: agentDir/prompts; skills igual).
 * El dispatcher nativo se encarga de /wiki-* con $ARGUMENTS (expandPromptTemplates
 * default true en session.prompt). Idempotente: recrea symlinks ausentes o
 * rotos (p. ej. tras reinstalar el paquete). Fallback a copia si el FS no
 * soporta symlink (permisos en win32).
 * Devuelve { prompts, skill } con la cantidad materializada de cada uno.
 */
function materializePackageSurface(
	agentDir: string,
	pkgRoot: string,
): { prompts: number; skill: boolean } {
	const link = (target: string, dest: string): void => {
		fs.mkdirSync(path.dirname(dest), { recursive: true });
		const exists = (() => {
			try {
				fs.lstatSync(dest);
				return true;
			} catch {
				return false; // ENOENT: no existe (ni roto)
			}
		})();
		try {
			// Recrear si existe pero apunta a otro lado o está roto.
			if (exists) {
				const st = fs.lstatSync(dest);
				if (st.isSymbolicLink()) fs.rmSync(dest);
				else if (st.isFile())
					return; // copia previa vigente — no pisar
				else fs.rmSync(dest, { recursive: true, force: true });
			}
			fs.symlinkSync(target, dest, "file");
		} catch {
			// Sin permisos de symlink (win32 sin dev mode) → copiar.
			try {
				fs.copyFileSync(target, dest);
			} catch {
				/* best-effort */
			}
		}
	};

	let prompts = 0;
	const promptsSrc = path.join(pkgRoot, "prompts");
	if (fs.existsSync(promptsSrc)) {
		for (const f of fs.readdirSync(promptsSrc)) {
			if (!f.endsWith(".md")) continue;
			// PLANO en <agentDir>/prompts: el loader de prompts de pi es
			// NO-recursivo (loadTemplatesFromDir solo escanea *.md del primer
			// nivel — hallazgo ADR-0057 D4). Los archivos upstream ya traen
			// el prefijo wiki-*, sin riesgo de colisión con prompts del usuario.
			link(path.join(promptsSrc, f), path.join(agentDir, "prompts", f));
			prompts++;
		}
	}

	// Skill completa (dir) — mismo mecanismo, junction/dir symlink.
	let skill = false;
	const skillSrc = path.join(pkgRoot, "skills", "llm-wiki");
	if (fs.existsSync(skillSrc)) {
		const dest = path.join(agentDir, "skills", "llm-wiki");
		const skillExists = (() => {
			try {
				fs.lstatSync(dest);
				return true;
			} catch {
				return false;
			}
		})();
		try {
			fs.mkdirSync(path.dirname(dest), { recursive: true });
			if (skillExists) {
				const st = fs.lstatSync(dest);
				if (!st.isSymbolicLink()) fs.rmSync(dest, { recursive: true, force: true });
				else if (fs.realpathSync(dest) === fs.realpathSync(skillSrc))
					return { prompts, skill: true };
				else fs.rmSync(dest);
			}
			fs.symlinkSync(skillSrc, dest, "dir");
			skill = true;
		} catch {
			try {
				fs.cpSync(skillSrc, dest, { recursive: true });
				skill = true;
			} catch {
				/* best-effort */
			}
		}
	}
	return { prompts, skill };
}

/** Tipos mínimos de los módulos lib del upstream que cargamos vía jiti. */
type UpstreamRecall = {
	searchWikiHybrid: (
		primaryPaths: { wiki: string; root: string },
		query: string,
		maxResults?: number,
		minScore?: number,
		includePersonal?: boolean,
	) => Promise<
		{
			id: string;
			title: string;
			type: string;
			preview: string;
			path: string;
			vaultLabel?: string;
		}[]
	>;
};
type UpstreamLinks = {
	extractKnowledgeLinks: (body: string) => {
		markdown: { target: string }[];
		wikilinks: { target: string }[];
	};
};
type UpstreamUtils = {
	resolveVaultPaths: (cwd: string) => { wiki: string; root: string };
};

/** Registra los aliases frida kb_search/kb_neighbors (delegan en lib del upstream). */
function registerKbAliases(
	pi: ExtensionAPI,
	jiti: ReturnType<typeof createJiti>,
	pkgRoot: string,
	cwd: string,
	onLog?: (line: string) => void,
): void {
	const lib = (m: string) =>
		path.join(pkgRoot, "extensions", "llm-wiki", "lib", m);
	const recall = jiti(lib("recall.ts")) as UpstreamRecall;
	const links = jiti(lib("knowledge-links.ts")) as UpstreamLinks;
	const utils = jiti(lib("utils.ts")) as UpstreamUtils;

	// ── kb_search: recall híbrido (léxico puro si no hay embeddings) ──
	pi.registerTool({
		name: "kb_search",
		label: "kb_search",
		description:
			"Busca en la base de conocimiento OKF del proyecto (alias frida de la búsqueda híbrida del wiki: léxico + embeddings si están configurados). Devuelve páginas con id, tipo, preview y path absoluto.",
		parameters: {
			type: "object",
			properties: {
				query: { type: "string", description: "Consulta de búsqueda" },
				max_results: {
					type: "number",
					description: "Máximo de resultados (default 5)",
				},
			},
			required: ["query"],
		},
		async execute(
			_args: string,
			args: { query?: string; max_results?: number },
		): Promise<ToolResult> {
			const query = args?.query?.trim();
			if (!query) {
				return {
					content: [{ type: "text", text: "kb_search: falta 'query'." }],
					details: { failureCategory: "kb-search-missing-query" },
					isError: true,
				};
			}
			try {
				const paths = utils.resolveVaultPaths(cwd);
				const results = await recall.searchWikiHybrid(
					paths,
					query,
					args?.max_results ?? 5,
				);
				// #75: formato etiquetado id vs path — el id OKF PARECE ruta
				// relativa (incidente 2026-08-18: GLM-5.3 lo usó como archivo del
				// proyecto → ENOENT). Nunca imprimir líneas ambiguas sin etiqueta.
				const text = results.length
					? results
							.map(
								(r) =>
									`- [${r.type}] ${r.title}${r.vaultLabel ? ` (${r.vaultLabel})` : ""}\n` +
									`  id: ${r.id} — id de página OKF (para kb_neighbors); NO es una ruta de archivo\n` +
									`  path: ${r.path}\n` +
									`  preview: ${r.preview.slice(0, 200)}`,
							)
							.join("\n")
					: "Sin resultados en la KB. Ingiere fuentes con /wiki-ingest.";
				return {
					content: [{ type: "text", text }],
					details: { results: results.length },
				};
			} catch (e: any) {
				return {
					content: [{ type: "text", text: `kb_search falló: ${e?.message ?? e}` }],
					details: { failureCategory: "kb-search-error" },
					isError: true,
				};
			}
		},
	});

	// ── kb_neighbors: aristas del grafo OKF (links markdown/wikilinks + type) ──
	pi.registerTool({
		name: "kb_neighbors",
		label: "kb_neighbors",
		description:
			"Vecinos de una página en el grafo OKF de la KB: out-edges (links que la página hace) e in-edges (backlinks), cada uno con el type OKF del destino (source/entity/concept/synthesis/analysis...). Usa el id relativo de página (p. ej. 'concepts/rag').",
		parameters: {
			type: "object",
			properties: {
				page: { type: "string", description: "Id de la página (relativo)" },
			},
			required: ["page"],
		},
		async execute(_args: string, args: { page?: string }): Promise<ToolResult> {
			const page = args?.page?.trim()?.replace(/\.md$/, "");
			if (!page) {
				return {
					content: [{ type: "text", text: "kb_neighbors: falta 'page'." }],
					details: { failureCategory: "kb-neighbors-missing-page" },
					isError: true,
				};
			}
			try {
				const paths = utils.resolveVaultPaths(cwd);
				const norm = (s: string) => s.replace(/\\/g, "/").replace(/^\.\//, "");
				const idOf = (abs: string) =>
					norm(path.relative(paths.wiki, abs)).replace(/\.md$/, "");

				// Resolver el archivo de la página (id exacto o basename).
				const all = listMarkdown(paths.wiki);
				const file =
					all.find((f) => idOf(f) === page) ??
					all.find((f) => path.basename(idOf(f)) === page);
				if (!file) {
					return {
						content: [
							{
								type: "text",
								text: `No existe la página '${page}' en la KB (vault: ${paths.wiki}). Usa kb_search para localizar el id.`,
							},
						],
						details: { failureCategory: "kb-neighbors-page-not-found" },
						isError: true,
					};
				}
				const pageId = idOf(file);
				// selfId = id de la página EMISORA: normaliza los md-links relativos
				// contra SU dir y filtra su self-link (no el de la inspeccionada).
				const targetsOf = (body: string, selfId: string): string[] => {
					const l = links.extractKnowledgeLinks(body);
					// Wikilinks ya son ids bundle-relative; markdown links se
					// normalizan relativos al dir de la página que los emite.
					const fromMd = l.markdown.map((m) =>
						norm(
							path.posix.normalize(
								path.posix.join(path.posix.dirname(selfId), m.target),
							),
						).replace(/\.md$/, ""),
					);
					const fromWiki = l.wikilinks.map((w) => norm(w.target));
					return [...fromMd, ...fromWiki].filter(
						(t) => t && !t.startsWith("..") && t !== selfId,
					);
				};

				// type OKF de una página destino (frontmatter).
				const typeOf = (target: string): string => {
					const tf =
						all.find((f) => idOf(f) === target) ??
						all.find((f) => path.basename(idOf(f)) === path.basename(target));
					if (!tf) return "desconocido";
					const { fm } = parseFrontmatter(fs.readFileSync(tf, "utf-8"));
					return fm.type ?? "sin-type";
				};
				const out = [
					...new Set(targetsOf(fs.readFileSync(file, "utf-8"), pageId)),
				].map((t) => `[${typeOf(t)}] ${t}`);

				// In-edges: escaneo del vault buscando links hacia pageId.
				const inEdges: string[] = [];
				for (const f of all) {
					if (f === file) continue;
					const id = idOf(f);
					const ts = targetsOf(fs.readFileSync(f, "utf-8"), id);
					if (
						ts.includes(pageId) ||
						ts.some((t) => path.basename(t) === path.basename(pageId))
					) {
						inEdges.push(`[${typeOf(id)}] ${id}`);
					}
				}
				const text = [
					`Página: ${pageId} (${typeOf(pageId)})`,
					"",
					`Out-edges (${out.length}):`,
					...(out.length ? out.map((o) => `  → ${o}`) : ["  (sin links salientes)"]),
					"",
					`In-edges (${inEdges.length}):`,
					...(inEdges.length
						? [...new Set(inEdges)].map((i) => `  ← ${i}`)
						: ["  (sin backlinks)"]),
				].join("\n");
				onLog?.(
					`[knowledge-base] kb_neighbors(${pageId}): ${out.length} out / ${inEdges.length} in`,
				);
				return {
					content: [{ type: "text", text }],
					details: { page: pageId, out: out.length, in: inEdges.length },
				};
			} catch (e: any) {
				return {
					content: [
						{ type: "text", text: `kb_neighbors falló: ${e?.message ?? e}` },
					],
					details: { failureCategory: "kb-neighbors-error" },
					isError: true,
				};
			}
		},
	});
}

/** Lista recursiva de .md bajo dir (Node 20+: readdir recursive). */
function listMarkdown(dir: string): string[] {
	try {
		return fs
			.readdirSync(dir, { recursive: true, encoding: "utf-8" })
			.map((f) => path.join(dir, String(f)))
			.filter((f) => f.endsWith(".md") && fs.statSync(f).isFile());
	} catch {
		return [];
	}
}

/**
 * Factory embebida para extensionFactories (src/pi-session.ts). DEVUELVE la
 * promesa de carga: el loader hace await factory(api) (patrón
 * frida-hermes-memory) — sin race de registro.
 */
export function createFridaKnowledgeBase(
	opts: CreateKnowledgeBaseOpts & {
		onStateChange?: (s: KnowledgeBaseState) => void;
	},
) {
	const { agentDir, distDir, onLog, cwd, onStateChange } = opts;
	const doEnsureInstalled = opts.deps?.ensureInstalled ?? ensureInstalled;
	return async (pi: ExtensionAPI): Promise<void> => {
		// host.ts del upstream lee config llm-wiki.* vía getAgentDir() →
		// que apunte a ~/.frida, no a ~/.pi/agent. Antes del import.
		if (!process.env.PI_CODING_AGENT_DIR) {
			process.env.PI_CODING_AGENT_DIR = path.resolve(agentDir);
			onLog?.(
				`[knowledge-base] PI_CODING_AGENT_DIR=${process.env.PI_CODING_AGENT_DIR}`,
			);
		}
		const workCwd = cwd ?? process.cwd();

		if (!isInstalledAtPin(agentDir)) {
			// Modo guía + auto-instalación background (D6).
			const guide = [
				`frida-knowledge-base: el paquete upstream (${KNOWLEDGE_BASE_SPEC}) no está instalado.`,
				"",
				"La instalación se disparó en background; cuando termine, ejecuta /reload o reinicia la sesión.",
				"Si prefieres instalarlo manualmente:",
				`  npm install ${KNOWLEDGE_BASE_SPEC} --prefix "${path.join(agentDir, "npm")}" --legacy-peer-deps`,
			].join("\n");
			try {
				pi.registerTool(guideKbTool(guide));
			} catch (e: any) {
				onLog?.(`[knowledge-base] registerTool guía falló: ${e?.message ?? e}`);
			}
			onStateChange?.({ installed: false, installing: true });
			void doEnsureInstalled(agentDir, {
				onProgress: (line) => onLog?.(`[knowledge-base] ${line}`),
			})
				.then(() => {
					// Materializar YA los prompts/skill: tras el /reload que
					// notifica el host, /wiki-* ya debe existir.
					try {
						const m = materializePackageSurface(agentDir, packageRoot(agentDir));
						onLog?.(
							`[knowledge-base] superficie materializada: ${m.prompts} prompts, skill=${m.skill}.`,
						);
					} catch (e: any) {
						onLog?.(`[knowledge-base] materialización falló: ${e?.message ?? e}`);
					}
					onStateChange?.({ installed: true, version: KNOWLEDGE_BASE_PIN });
					onLog?.(
						`[knowledge-base] ${KNOWLEDGE_BASE_SPEC} instalado — /reload para activar la KB.`,
					);
				})
				.catch((e: any) => {
					const msg = e?.message ?? String(e);
					onStateChange?.({ installed: false, error: msg });
					onLog?.(`[knowledge-base] instalación falló: ${msg}`);
					onLog?.(e?.guide ? `[knowledge-base] guía: ${e.guide}` : "");
				});
			return;
		}

		// Paquete presente al pin: cargar factory upstream + superficie frida.
		const entry = upstreamEntryPath(agentDir);
		try {
			const jiti = createJiti(entry, {
				alias: upstreamPeerAliases(distDir),
			});
			const factory = unwrapDefault(jiti(entry));
			if (typeof factory !== "function") {
				throw new Error(
					`el entry no exporta una factory (default): ${typeof factory}`,
				);
			}
			await (factory as (api: ExtensionAPI) => unknown)(pi);

			// Superficie que el package loader de pi aportaría y el wrapper no.
			const pkgRoot = packageRoot(agentDir);
			const m = materializePackageSurface(agentDir, pkgRoot);
			registerKbAliases(pi, jiti, pkgRoot, workCwd, onLog);
			onLog?.(
				`[knowledge-base] upstream activo + ${m.prompts} prompts /wiki-* (skill=${m.skill}) + aliases kb_*.`,
			);
			onStateChange?.({ installed: true, version: KNOWLEDGE_BASE_PIN });
		} catch (e: any) {
			// Degradación con guía (D6): la sesión vive sin KB, la tool explica.
			const msg = e?.message ?? String(e);
			onStateChange?.({ installed: false, error: msg });
			onLog?.(`[knowledge-base] carga del upstream falló: ${msg}`);
			try {
				pi.registerTool(
					guideKbTool(
						[
							`frida-knowledge-base: no se pudo cargar ${KNOWLEDGE_BASE_SPEC}: ${msg}`,
							"",
							"Repara reinstalando:",
							`  rm -rf "${packageRoot(agentDir)}"`,
							`  npm install ${KNOWLEDGE_BASE_SPEC} --prefix "${path.join(agentDir, "npm")}" --legacy-peer-deps`,
							"y ejecuta /reload o reinicia la sesión.",
						].join("\n"),
					),
				);
			} catch {
				/* registerTool best-effort */
			}
		}
	};
}

export { KNOWLEDGE_BASE_FACTORY_NAME };
