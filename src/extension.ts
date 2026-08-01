import path from "node:path";
import * as fs from "node:fs/promises";
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as vscode from "vscode";
import { registerBunOAuthFlows } from "@earendil-works/pi-ai/bun-oauth";
import {
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import {
	createFridaSession,
	defaultAgentDir,
	type FridaSession,
} from "./pi-session";
import type { ApprovalRequest } from "./approval-bridge";
import type { PermissionMode } from "./tools/frida-permission-system";
import { readAuditLog } from "./tools/frida-permission-system/audit-log";
import { createAuditPanelElement } from "./tools/frida-permission-system/AuditPanel";
import { createConfigPanelElement } from "./tools/frida-permission-system/ConfigPanel";
import {
	DEVENGINE_BASE_URL,
	SOFTTEK_PROVIDER,
	SOFTTEK_PROVIDER_DISPLAY,
} from "./providers/softtek-provider";
import {
	API_KEY_PROVIDERS,
	API_KEY_PROVIDER_IDS,
	getApiKeyProvider,
} from "./providers/api-key-providers";
import { ZAI_PROVIDER, ZAI_PROVIDER_DISPLAY } from "./providers/z-ai-provider";
import { getWebviewHtml } from "./webview-html";
import { analyzeContext } from "./tools/frida-context/analysis";
import { createContextReportElement } from "./tools/frida-context/ContextReport";
import {
	getCachedActiveTools,
	getCachedAllTools,
	getCachedPromptOptions,
	getCachedSystemPrompt,
} from "./tools/frida-context/store";
import { getTodoState } from "./tools/todo-web/store";
import { createFridaWorkflowHost, handleWfSlash } from "./tools/frida-workflow";
import { wireWorkflowPanel } from "./tools/frida-workflow/panel";
import {
	computePipelineStatus,
	formatPipelineStatus,
	wirePipelinePanel,
	getModelsConfigPath,
	loadModelsConfig,
	invalidateModelsConfigCache,
	modelsConfigTemplate,
	syncBundledAgents,
	formatSyncReport,
	getBundledSkillNames,
} from "./tools/frida-pipeline";
import { listAgents, getAvailableTypes } from "./tools/frida-subagents";
import { wireAgentWidget } from "./tools/frida-subagents/panel";
import { loadSettings, formatSettings } from "./tools/frida-subagents/settings";
import { createWebDemoElement } from "./demo/web-demo";
import { createPersistentDemoElement } from "./demo/persistent-demo";
import { createWebQuestionnaireElement } from "./web-questionnaire";
import {
	isAskUserQuestionEnabled,
	isContextEnabled,
	isTodoEnabled,
	readGatePatterns,
	readToolToggles,
	writeToolToggle,
} from "./settings";
import {
	classifySeverity,
	type LensDiagnosticsPayload,
} from "./lens-diagnostics-bridge";

const execFileP = promisify(execFile);

const ACTIVE_MODEL_KEY = "frida.activeModel";
// ADR-0017: secret por proveedor (itera el registry de API-key providers). El id
// de Copilot se añade por separado (OAuth, sin secret propio).
const SUPPORTED_PROVIDERS = [...API_KEY_PROVIDER_IDS, "github-copilot"];

// ¿El proveedor está autenticado? getProviderAuthStatus revisa storedProviders
// (auth.json persistido) → confiable para OAuth (Copilot) incluso tras reinicios.
// hasConfiguredAuth sólo ve el snapshot en memoria, que se vacía al recrear la
// sesión hasta la siguiente petición (por eso Copilot respondía pero aparecía como
// “Disponible”). Fallback a hasConfiguredAuth si getProviderAuthStatus no existe.
function isProviderAuthed(mr: any, id: string): boolean {
	const status = mr?.getProviderAuthStatus?.(id);
	return status ? !!status.configured : !!mr?.hasConfiguredAuth?.(id);
}

// Repositorio de distribución del .vsix (GitHub Releases) para /version y /update.
// Coincide con el campo `repository` de package.json.
const UPDATE_REPO = "efuentesp/frida-code-vsix";
const RELEASES_URL = `https://github.com/${UPDATE_REPO}/releases`;

// Compara dos versiones semver (con o sin 'v' inicial): <0 si a<b, 0 si iguales, >0 si a>b.
function compareSemver(a: string, b: string): number {
	const pa = a
		.replace(/^v/, "")
		.split(".")
		.map((n) => parseInt(n, 10) || 0);
	const pb = b
		.replace(/^v/, "")
		.split(".")
		.map((n) => parseInt(n, 10) || 0);
	for (let i = 0; i < 3; i++) {
		const da = pa[i] ?? 0;
		const db = pb[i] ?? 0;
		if (da !== db) return da - db;
	}
	return 0;
}

const BINARY_EXT = new Set([
	"png",
	"jpg",
	"jpeg",
	"gif",
	"webp",
	"bmp",
	"ico",
	"pdf",
	"zip",
	"gz",
	"tar",
	"woff",
	"woff2",
	"ttf",
	"otf",
	"node",
	"wasm",
	"mp3",
	"mp4",
	"class",
	"exe",
	"dll",
	"so",
	"dylib",
]);

/** Puntaje fuzzy (subsequence) para rankear archivos @. Mayor = mejor. */
function fuzzyScore(text: string, query: string): number {
	const t = text.toLowerCase();
	const q = query.toLowerCase();
	if (!q) return 0;
	let score = 0,
		ti = 0,
		qi = 0,
		consecutive = 0;
	while (ti < t.length && qi < q.length) {
		if (t[ti] === q[qi]) {
			consecutive++;
			score += 1 + consecutive;
			if (ti === 0 || /[/._\- ]/.test(t[ti - 1])) score += 5; // inicio de palabra
			qi++;
		} else {
			consecutive = 0;
		}
		ti++;
	}
	if (qi < q.length) return -1; // no es subsequence → descartar
	const base = text.split("/").pop() ?? text;
	if (base.toLowerCase().includes(q)) score += 10; // match en el nombre
	score -= (text.match(/\//g)?.length ?? 0) * 0.5; // menos profundo = mejor
	return score;
}

// Caché corto de la lista de archivos del repo (evita llamar a git en cada tecla).
let repoFilesCache: { cwd: string; files: string[]; at: number } | null = null;
const REPO_FILES_TTL = 5000;

// Carpetas que se ocultan al navegar directorios (además de las que empiezan con .).
const SEARCH_HIDDEN_EXCLUDE = new Set([
	"node_modules",
	".git",
	"dist",
	"dist-webview",
	".vscode",
	".next",
	".cache",
	"build",
]);

/** Lista los archivos del workspace respetando .gitignore (trackeados + no
 *  ignorados vía git), relativos al workspace folder. Fallback a findFiles. */
async function listRepoFiles(cwd: string): Promise<string[]> {
	if (
		repoFilesCache &&
		repoFilesCache.cwd === cwd &&
		Date.now() - repoFilesCache.at < REPO_FILES_TTL
	) {
		return repoFilesCache.files;
	}
	let files: string[];
	try {
		const top = await execFileP("git", ["rev-parse", "--show-toplevel"], {
			cwd,
			timeout: 3000,
		});
		const repoRoot = top.stdout.trim();
		const wsRel = path.relative(repoRoot, cwd); // "" si el workspace es la raíz
		const tracked = await execFileP("git", ["ls-files"], {
			cwd: repoRoot,
			timeout: 6000,
		});
		const others = await execFileP(
			"git",
			["ls-files", "--others", "--exclude-standard"],
			{ cwd: repoRoot, timeout: 6000 },
		);
		const all = (tracked.stdout + "\n" + others.stdout)
			.split("\n")
			.map((s) => s.trim())
			.filter(Boolean);
		files = !wsRel
			? all
			: all
					.filter((f) => f.startsWith(wsRel + "/"))
					.map((f) => f.slice(wsRel.length + 1));
	} catch {
		// Sin git: findFiles con excludes típicos.
		const exclude =
			"**/node_modules/**,**/.git/**,**/dist/**,**/dist-webview/**,**/.vscode/**";
		const uris = await vscode.workspace.findFiles(
			new vscode.RelativePattern(cwd, "**/*"),
			exclude,
			300,
		);
		files = uris.map((u) => vscode.workspace.asRelativePath(u));
	}
	repoFilesCache = { cwd, files, at: Date.now() };
	return files;
}

/** Navegación de carpeta: lista el contenido del directorio indicado por el
 *  prefijo (los directorios terminan en '/'). Filtra por el último segmento. */
async function listDirectory(prefix: string, cwd: string): Promise<string[]> {
	const hasSlash = prefix.endsWith("/");
	const slashIdx = prefix.lastIndexOf("/");
	const dir = hasSlash ? prefix.slice(0, -1) : prefix.slice(0, slashIdx);
	const filter = (hasSlash ? "" : prefix.slice(slashIdx + 1)).toLowerCase();
	const absDir = path.join(cwd, dir || ".");
	let entries: any[];
	try {
		entries = await fs.readdir(absDir, { withFileTypes: true });
	} catch {
		return [];
	}
	return entries
		.filter(
			(e) => !e.name.startsWith(".") && !SEARCH_HIDDEN_EXCLUDE.has(e.name),
		)
		.filter((e) => filter === "" || e.name.toLowerCase().includes(filter))
		.sort((a, b) => {
			if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
			return a.name.localeCompare(b.name);
		})
		.slice(0, 50)
		.map(
			(e) => (dir ? `${dir}/${e.name}` : e.name) + (e.isDirectory() ? "/" : ""),
		);
}

/** Autocompletado de archivos @: navegación de carpetas si hay '/', si no fuzzy
 *  global respetando .gitignore. */
async function searchFiles(query: string): Promise<string[]> {
	const wf = vscode.workspace.workspaceFolders?.[0];
	if (!wf) return [];
	const cwd = wf.uri.fsPath;
	const q = query.trim();
	if (q.includes("/")) return listDirectory(q, cwd); // navegación
	if (q.length === 0) return []; // '@' solo: no inundar
	const files = await listRepoFiles(cwd);
	return files
		.map((rel) => ({ rel, score: fuzzyScore(rel, q) }))
		.filter((x) => x.score >= 0)
		.sort(
			(a, b) =>
				b.score - a.score ||
				a.rel.length - b.rel.length ||
				a.rel.localeCompare(b.rel),
		)
		.slice(0, 30)
		.map((x) => x.rel);
}

/** Expande los tokens @ruta del prompt al contenido del archivo (texto), como Pi. */
async function expandAtFiles(text: string, cwd: string): Promise<string> {
	const re = /@(?:"([^"]+)"|([^\s@]+))/g;
	const matches: { index: number; full: string; rel: string }[] = [];
	let m: RegExpExecArray | null;
	while ((m = re.exec(text)) !== null)
		matches.push({ index: m.index, full: m[0], rel: m[1] ?? m[2] });
	if (matches.length === 0) return text;
	let out = text;
	for (const mt of matches.slice().reverse()) {
		const ext = path.extname(mt.rel).slice(1).toLowerCase();
		if (BINARY_EXT.has(ext)) continue; // binarios: se deja el token (no se adjunta)
		const abs = path.join(cwd, mt.rel);
		try {
			const st = await fs.stat(abs);
			if (!st.isFile()) continue;
			const content = await fs.readFile(abs, "utf8");
			const trunc =
				content.length > 200_000
					? content.slice(0, 200_000) + "\n…(truncado)"
					: content;
			const block = `\n\n\`\`\`${ext} // @${mt.rel}\n${trunc}\n\`\`\`\n`;
			out =
				out.slice(0, mt.index) + block + out.slice(mt.index + mt.full.length);
		} catch {
			/* no existe / no legible → se deja el token tal cual */
		}
	}
	return out;
}

export async function activate(
	context: vscode.ExtensionContext,
): Promise<void> {
	// Registrar los flujos OAuth de pi-ai como módulos BUNDLED (estáticos). Sin
	// esto, el login OAuth (GitHub Copilot, etc.) cae en un dynamic import opaco
	// que al empaquetar queda roto (ERR_MODULE_NOT_FOUND dist/github-copilot.js).
	// Idempotente y sincrónico; debe ir antes de cualquier login/sesión.
	try {
		registerBunOAuthFlows();
	} catch (e) {
		console.error("[frida] registerBunOAuthFlows falló:", e);
	}
	// ADR-0017: keys POR proveedor cargadas del SecretStorage al arrancar. El mapa
	// vive en memoria y se sincroniza con el runtime vía frida.setKey(id, key).
	const keyCaches: Record<string, string> = {};
	for (const def of API_KEY_PROVIDERS) {
		const k = await context.secrets.get(def.secretKey);
		if (k) keyCaches[def.id] = k;
	}
	const sessionDirPath = path.join(context.globalStorageUri.fsPath, "sessions");
	// Auditoría del gate de aprobación (Prioridad 2): JSONL append-only, chmod 0600.
	// Vive junto a las sesiones en globalStorageUri (no bajo sync en nube: lleva
	// comandos bash y paths potencialmente sensibles — ver D13).
	const approvalLogPath = path.join(
		context.globalStorageUri.fsPath,
		"approval-logs",
		"approvals.jsonl",
	);
	// Dump del último request enviado a DevEngine (para diagnosticar 500 sin body).
	const requestDumpPath = path.join(
		context.globalStorageUri.fsPath,
		"devengine-last-request.json",
	);
	let approvalMode: PermissionMode = "manual";
	let frida: FridaSession | undefined;
	// Anti-race: si ensureSession() se llama concurrentemente (ej. webview_ready +
	// onboarding al arrancar), sin esto ambas ven `!frida` y crean sesiones
	// duplicadas — la perdedora se pierde sin dispose y su WebBridge vive publicando
	// roots al webview para siempre (paneles duplicados). Ver ADR-0014.
	let fridaPromise: Promise<FridaSession> | undefined;
	let activeModel: { provider: string; modelId: string } | undefined =
		context.globalState.get(ACTIVE_MODEL_KEY);
	// Message Queue (pi): mensajes encolados mientras el agente trabaja + contador
	// de turnos dentro del agent run actual (para saber cuándo se entrega uno).
	const pendingQueue: { text: string }[] = [];
	let turnsInRun = 0;

	let view: vscode.WebviewView | undefined;
	const fridaVersion = String(context.extension.packageJSON.version ?? "0.0.0");
	const post = (msg: unknown): void => {
		view?.webview.postMessage(msg);
	};

	function workspaceCwd(): string {
		return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
	}

	// D16 — diagnósticos de pi-lens: acumulador por turno + resumen al webview.
	// No son squiggles del editor (eso lo cubre el LSP de VS Code); es visibilidad
	// en el panel del feedback que pi-lens calcula y de otro modo viaja oculto.
	type LensFileSummary = {
		path: string;
		errors: number;
		warnings: number;
		others: number;
		truncated: boolean;
	};
	const lensAccum = new Map<string, LensFileSummary>();
	let lensAnyTruncated = false;
	let lensBusy = false;
	let inRetry = false;
	let lensActive = false;
	// Fix UX #1: detectar runs que terminan SIN respuesta visible (ni texto ni
	// tools). Caso típico: el gateway DevEngine rechaza con 401 (key vencida) y el
	// SDK openai lanza AuthenticationError ANTES de onResponse → after_provider_response
	// no dispara → el 401 queda invisible y el agente cierra con mensajes vacíos.
	// Sin esto, el usuario ve "silencio" en vez de "API key inválida".
	let hadText = false;
	let hadToolCall = false;

	function lensRelative(p: string, cwd: string): string {
		try {
			return path.isAbsolute(p) ? path.relative(cwd, p) || p : p;
		} catch {
			return p;
		}
	}

	// Callback que la factory lens-diagnostics-bridge invoca por cada evento
	// `pilens:diagnostics`. Acumula por archivo (paths relativos al cwd) y, si el
	// agente NO está trabajando, publica de inmediato (cascade tardía).
	// D16 badge: ¿pi-lens está cargado como extensión? (busca su tool always-active).
	function isLensLoaded(): boolean {
		const rl: any = frida?.session?.resourceLoader;
		const exts = rl?.getExtensions?.()?.extensions ?? [];
		return exts.some((e: any) =>
			Array.from(e.tools?.keys?.() ?? []).includes("lens_diagnostics"),
		);
	}

	// Publica el estado del badge pi-lens al webview (cargado + activo).
	function postLensStatus(): void {
		post({ type: "lens_status", loaded: isLensLoaded(), active: lensActive });
	}

	function mergeLens(payload: LensDiagnosticsPayload): void {
		const cwd = payload.cwd || workspaceCwd();
		for (const f of payload.files ?? []) {
			if (!f || !f.path) continue;
			const rel = lensRelative(f.path, cwd);
			let errors = 0;
			let warnings = 0;
			let others = 0;
			for (const d of f.diagnostics ?? []) {
				const c = classifySeverity(d?.severity);
				if (c === "error") errors++;
				else if (c === "warning") warnings++;
				else others++;
			}
			if (errors === 0 && warnings === 0 && others === 0) {
				lensAccum.delete(rel); // el archivo quedó limpio
			} else {
				lensAccum.set(rel, {
					path: rel,
					errors,
					warnings,
					others,
					truncated: !!f.truncated,
				});
			}
			if (f.truncated) lensAnyTruncated = true;
		}
		if (!lensBusy) flushLens();
		// Primer evento del bus ⇒ pi-lens está corriendo: marca activo y publica el badge.
		if (!lensActive) {
			lensActive = true;
			postLensStatus();
		}
	}

	// Publica el resumen actual al webview (null si no hay diagnósticos → oculta).
	function flushLens(): void {
		const files = [...lensAccum.values()].sort(
			(a, b) => b.errors - a.errors || b.warnings - a.warnings,
		);
		const totalErrors = files.reduce((s, f) => s + f.errors, 0);
		const totalWarnings = files.reduce((s, f) => s + f.warnings, 0);
		const totalOthers = files.reduce((s, f) => s + f.others, 0);
		const summary =
			files.length === 0
				? null
				: {
						files,
						totalErrors,
						totalWarnings,
						totalOthers,
						fileCount: files.length,
						truncated: lensAnyTruncated,
					};
		post({ type: "lens_diagnostics", summary });
	}

	// DevEngine no devuelve body en el 500 → el error es opaco. Dumpea el request
	// completo a disco y da un resumen en el panel para diagnosticar qué campo lo
	// rechaza (típicamente reasoning_content — ver ADR-0009).
	function onProviderError(payload: unknown, status: number): void {
		const dir = context.globalStorageUri.fsPath;
		const dumpPath = path.join(dir, "devengine-last-error-request.json");
		try {
			mkdirSync(dir, { recursive: true });
			writeFileSync(dumpPath, JSON.stringify(payload ?? null, null, 2));
		} catch {
			/* noop */
		}
		post({
			type: "provider_error",
			text: `DevEngine respondió ${status}. ${summarizeRequestPayload(payload)}Request completo: ${dumpPath}`,
		});
	}

	function summarizeRequestPayload(payload: unknown): string {
		const p = payload as any;
		if (!p || typeof p !== "object") return "";
		const msgs: any[] = Array.isArray(p.messages) ? p.messages : [];
		let withReasoning = 0;
		let withImages = 0;
		let withToolCalls = 0;
		for (const m of msgs) {
			if (m && typeof m === "object") {
				if (m.reasoning_content) withReasoning++;
				const c = m.content;
				if (Array.isArray(c) && c.some((b: any) => b?.type === "image_url"))
					withImages++;
				if (Array.isArray(m.tool_calls) && m.tool_calls.length > 0)
					withToolCalls++;
			}
		}
		const parts = [`${msgs.length} mensajes`];
		if (withReasoning) parts.push(`${withReasoning} con reasoning_content`);
		if (withImages) parts.push(`${withImages} con imágenes`);
		if (withToolCalls) parts.push(`${withToolCalls} con tool_calls`);
		if (Array.isArray(p.tools) && p.tools.length > 0)
			parts.push(`${p.tools.length} tools`);
		return `(${parts.join(" · ")}). `;
	}

	// Copia el último dump (devengine-last-request.json) a
	// devengine-errors/<fecha-hora>__<sesión>.json para conservar los requests que
	// fallaron, identificables por cuándo y qué sesión. Ver ADR-0009.
	function rotateErrorDump(): string {
		try {
			const dir = path.join(
				context.globalStorageUri.fsPath,
				"devengine-errors",
			);
			mkdirSync(dir, { recursive: true });
			const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
			const rawName = frida?.sessionManager?.getSessionName?.() ?? "sesion";
			const safeName =
				String(rawName)
					.replace(/[^a-zA-Z0-9_-]/g, "_")
					.slice(0, 40) || "sesion";
			const namedPath = path.join(dir, `${ts}__${safeName}.json`);
			copyFileSync(requestDumpPath, namedPath);
			return namedPath;
		} catch {
			return requestDumpPath;
		}
	}

	async function ensureSession(): Promise<FridaSession> {
		if (frida) return frida;
		if (!fridaPromise) {
			// Creación en vuelo: las llamadas concurrentes esperan la MISMA promesa
			// (anti-race). Si falla, se descarta para permitir reintentar.
			fridaPromise = (async () => {
				const s = await createFridaSession({
					cwd: workspaceCwd(),
					agentDir: defaultAgentDir(),
					sessionDir: sessionDirPath,
					approvalLogPath,
					activeModel,
					getKeyFor: (id: string) => keyCaches[id],
					onUnauthorized: (id: string) => {
						delete keyCaches[id];
						void promptKey(id, "unauthorized");
					},
					onPendingApprovals: (reqs: ApprovalRequest[]) =>
						post({ type: "approvals", approvals: reqs }),
					onUiRequest: (reqs) => post({ type: "ui_requests", items: reqs }),
					onUiNotify: (message, level) =>
						post({ type: "ui_notify", message, level }),
					onWebCommit: (rootId, tree, placement) =>
						post({ type: "web_commit", rootId, tree, placement }),
					getMode: () => approvalMode,
					askUserQuestionEnabled: isAskUserQuestionEnabled,
					todoEnabled: isTodoEnabled,
					contextEnabled: isContextEnabled,
					getGatePatterns: readGatePatterns,
					onLensDiagnostics: mergeLens,
					onProviderError,
					requestDumpPath,
				});
				frida = s;
				wireSession(s.session);
				sendModelInfo();
				// Diagnóstico: si la sesión se creó pero session.model es undefined (ej. el
				// modelo guardado no se restaura), el proveedor/modelo quedarían en "---"
				// sin error visible. Lo hacemos explícito para poder depurarlo.
				if (!s.session?.model) {
					console.error(
						"[frida] session.model es undefined tras createFridaSession",
					);
					post({
						type: "info",
						text: "La sesión inició pero no hay modelo activo. Abre Ayuda → Toggle Developer Tools → Console y busca ‘[frida]’ para ver el detalle.",
						level: "warning",
					});
				}
				postResources();
				postModels();
				void postWorkspace();
				postToolToggles();
				postUsage(s.session);
				// Onboarding si NINGÚN proveedor soportado está autenticado (fase 2b:
				// crear la sesión siempre permite elegir Copilot desde el onboarding).
				const anyAuthed = SUPPORTED_PROVIDERS.some((id) =>
					isProviderAuthed(s?.modelRuntime, id),
				);
				post({ type: anyAuthed ? "session_ready" : "need_key" });
				return s;
			})().catch((e) => {
				fridaPromise = undefined;
				throw e;
			});
		}
		return fridaPromise;
	}

	// session.subscribe: observador para MOSTRAR (streaming + tarjetas de tool).
	// El BLOQUEO de tools vive en la extensión de gates (createApprovalGates).

	// Reserve de compactación cacheado (rara vez cambia; se relee al recargar la
	// ventana). Lo usa postUsage para la presión ajustada de la barra del ContextBar.
	let cachedReserveTokens: number | undefined;
	function getReserveTokens(): number {
		if (cachedReserveTokens !== undefined) return cachedReserveTokens;
		try {
			const wsCwd =
				vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
			cachedReserveTokens = SettingsManager.create(
				wsCwd,
				defaultAgentDir(),
			).getCompactionReserveTokens();
		} catch {
			cachedReserveTokens = 0;
		}
		return cachedReserveTokens;
	}

	function postUsage(session: any): void {
		try {
			const msgs: any[] = session?.agent?.state?.messages ?? [];
			let inputTotal = 0,
				outputTotal = 0,
				cacheRead = 0,
				cacheWrite = 0,
				cost = 0;
			let lastInput = 0,
				lastCacheRead = 0,
				lastCacheWrite = 0;
			for (const m of msgs) {
				if (m?.role === "assistant" && m?.usage) {
					const u = m.usage;
					inputTotal += u.input ?? 0;
					outputTotal += u.output ?? 0;
					cacheRead += u.cacheRead ?? 0;
					cacheWrite += u.cacheWrite ?? 0;
					lastInput = u.input ?? 0;
					lastCacheRead = u.cacheRead ?? 0;
					lastCacheWrite = u.cacheWrite ?? 0;
					if (typeof u.cost === "number") cost += u.cost;
				}
			}
			// Cache hit rate del último request (como la TUI de pi).
			const promptTokens = lastInput + lastCacheRead + lastCacheWrite;
			const cacheHitRate =
				promptTokens > 0 && (lastCacheRead > 0 || lastCacheWrite > 0)
					? (lastCacheRead / promptTokens) * 100
					: undefined;
			// Contexto ACTUAL: pi estima los tokens del contexto vivo (getContextUsage).
			const ctx = session?.getContextUsage?.();
			const contextTokens = ctx?.tokens ?? 0;
			const contextWindow =
				ctx?.contextWindow ?? session?.model?.contextWindow ?? 0;
			const contextPercent =
				ctx?.percent ??
				(contextWindow
					? Math.min(100, (contextTokens / contextWindow) * 100)
					: 0);
			// Presión ajustada por el reserve de compactación (paridad pressurePercent
			// de frida-context): la barra la usa para ANTICIPAR la compactación, no sólo
			// la ventana bruta. >100% ⇒ el agente debería compactar ya.
			const reserveTokens = getReserveTokens();
			const effectiveCapacity =
				contextWindow > reserveTokens
					? contextWindow - reserveTokens
					: contextWindow;
			const pressurePercent =
				effectiveCapacity > 0
					? Math.min(100, (contextTokens / effectiveCapacity) * 100)
					: contextPercent;
			post({
				type: "usage",
				inputTotal,
				outputTotal,
				cacheRead,
				cacheWrite,
				cacheHitRate,
				cost,
				contextTokens,
				contextWindow,
				contextPercent,
				pressurePercent,
				reserveTokens,
			});
		} catch {
			/* noop */
		}
	}

	function providerDisplayName(id: string): string {
		if (id === SOFTTEK_PROVIDER) return SOFTTEK_PROVIDER_DISPLAY;
		if (id === ZAI_PROVIDER) return ZAI_PROVIDER_DISPLAY;
		if (id === "github-copilot") return "GitHub Copilot";
		return frida?.modelRuntime?.getProvider?.(id)?.name ?? id;
	}

	function sendModelInfo(): void {
		const m = frida?.session?.model;
		if (m) {
			post({
				type: "model_info",
				provider: providerDisplayName(m.provider),
				model: m.name,
				thinking: frida?.session?.thinkingLevel ?? "medium",
			});
		}
	}

	// Catálogo de proveedores/modelos soportados para el selector del webview.
	function postModels(
		opts: { refreshing?: boolean; refreshErrors?: string[] } = {},
	): void {
		if (!frida) return;
		const mr = frida.modelRuntime;
		const providers = SUPPORTED_PROVIDERS.map((id) => ({
			id,
			name: providerDisplayName(id),
			oauth: !!mr.isUsingOAuth?.(id),
			apiKey: !!getApiKeyProvider(id),
			authed: isProviderAuthed(mr, id),
			models: (mr.getModels?.(id) ?? []).map((mm: any) => ({
				id: mm.id,
				name: mm.name,
				contextWindow: mm.contextWindow,
				maxTokens: mm.maxTokens,
				reasoning: mm.reasoning,
				input: mm.input,
			})),
		}));
		const m = frida.session?.model;
		post({
			type: "models",
			providers,
			active: m ? { provider: m.provider, modelId: m.id } : undefined,
			refreshing: opts.refreshing,
			refreshErrors: opts.refreshErrors,
		});
	}

	/** ADR-0018 Fase B: refresh asíncrono de catálogos. Publica el snapshot cacheado
	 *  inmediatamente (refreshing:true), ejecuta refresh() en background (timeout 15s,
	 *  degradación por proveedor) y publica el resultado. */
	async function refreshModelsAsync(): Promise<void> {
		if (!frida) return;
		postModels({ refreshing: true });
		const ctrl = new AbortController();
		const timer = setTimeout(() => ctrl.abort(), 15000);
		try {
			const result = await frida.modelRuntime.refresh({
				allowNetwork: true,
				signal: ctrl.signal,
			});
			const errors = [...(result?.errors?.keys?.() ?? [])];
			postModels({ refreshing: false, refreshErrors: errors });
		} catch {
			// Timeout/abort: dejamos el snapshot cacheado, sin alardear el error.
			postModels({ refreshing: false });
		} finally {
			clearTimeout(timer);
		}
	}

	async function selectModel(
		providerId: string,
		modelId: string,
	): Promise<void> {
		if (!frida) return;
		const m = frida.modelRuntime.getModel?.(providerId, modelId);
		if (!m) {
			post({ type: "info", text: "Modelo no disponible." });
			postModels();
			return;
		}
		try {
			await frida.session.setModel(m);
			activeModel = { provider: providerId, modelId };
			await context.globalState.update(ACTIVE_MODEL_KEY, activeModel);
			sendModelInfo();
			postModels();
			postUsage(frida.session);
		} catch (e: any) {
			post({
				type: "info",
				text: "No se pudo cambiar de modelo: " + String(e?.message ?? e),
			});
		}
	}

	// AuthInteraction (pi-ai): implementa prompt()/notify() para el login OAuth.
	// notify({device_code}) abre el navegador y publica el userCode al webview.
	function makeAuthInteraction(): any {
		return {
			prompt: async (p: any) => {
				if (p.type === "select") {
					const items = (p.options ?? []).map((o: any) => ({
						label: o.label,
						description: o.description,
						id: o.id,
					}));
					const pick = (await vscode.window.showQuickPick(items as any, {
						placeHolder: p.message,
						ignoreFocusOut: true,
					})) as any;
					return pick?.id ?? "";
				}
				const val = await vscode.window.showInputBox({
					prompt: p.message,
					password: p.type === "secret",
					placeHolder: p.placeholder,
					ignoreFocusOut: true,
				});
				return val ?? "";
			},
			notify: (e: any) => {
				if (e.type === "device_code") {
					vscode.env.openExternal(vscode.Uri.parse(e.verificationUri));
					post({
						type: "oauth_device_code",
						userCode: e.userCode,
						verificationUri: e.verificationUri,
					});
				} else if (e.type === "auth_url") {
					vscode.env.openExternal(vscode.Uri.parse(e.url));
					post({
						type: "info",
						text: "Abriendo el navegador para autenticación…",
					});
				} else if (e.type === "info" || e.type === "progress") {
					post({ type: "info", text: e.message });
				}
			},
		};
	}

	function copilotDefaultModelId(): string | undefined {
		const models: any[] =
			frida?.modelRuntime?.getModels?.("github-copilot") ?? [];
		return models.find((m: any) => m.id === "gpt-5")?.id ?? models[0]?.id;
	}

	// Serializa un error de login a texto útil — NUNCA vacío. El catch anterior
	// usaba `String(e?.message ?? e)` que devuelve "" cuando e.message es un string
	// vacío (?? no considera "" como nulo), y el toast quedaba en blanco.
	function describeLoginError(e: unknown): string {
		if (e == null) return "(sin detalle)";
		if (typeof e === "string") return e.trim() || "(error vacío)";
		const er = e as Record<string, unknown>;
		const parts: string[] = [];
		if (typeof er.name === "string" && er.name && er.name !== "Error")
			parts.push(er.name);
		if (typeof er.message === "string" && er.message.trim())
			parts.push(er.message.trim());
		if (er.code != null) parts.push(`[${er.code}]`);
		if (er.status != null) parts.push(`(HTTP ${er.status})`);
		if (parts.length === 0) {
			try {
				const j = JSON.stringify(e);
				parts.push(j && j !== "{}" ? j : String(e));
			} catch {
				parts.push(String(e));
			}
		}
		return parts.join(" — ").trim() || "(error sin mensaje)";
	}

	async function loginProvider(providerId: string): Promise<void> {
		if (!frida) return;
		try {
			await frida.modelRuntime.login?.(
				providerId,
				"oauth",
				makeAuthInteraction(),
			);
			// login() puede resolver SIN lanzar pero sin guardar credencial (éxito
			// falso silencioso). Verificamos que de verdad quedó autenticado.
			const authed = isProviderAuthed(frida.modelRuntime, providerId);
			console.log("[frida] login resolved", providerId, "authed:", authed);
			if (!authed) {
				post({
					type: "info",
					level: "warning",
					text: `El login de ${providerDisplayName(providerId)} no completó la autenticación. ¿Autorizaste en el navegador a tiempo? Si lo hiciste, revisa la consola (Developer: Toggle Developer Tools) para el detalle.`,
				});
				post({ type: "oauth_clear" });
				return;
			}
			post({
				type: "info",
				level: "success",
				text: `Sesión iniciada: ${providerDisplayName(providerId)}`,
			});
			post({ type: "oauth_clear" });
			// Primer arranque (onboarding): activar el modelo default de Copilot.
			if (!activeModel && providerId === "github-copilot") {
				const defaultId = copilotDefaultModelId();
				if (defaultId) await selectModel(providerId, defaultId);
			}
			postModels();
			post({ type: "session_ready" }); // cierra el onboarding si estaba abierto
		} catch (e: any) {
			const detail = describeLoginError(e);
			console.error("[frida] login failed", providerId, e);
			post({
				type: "info",
				level: "error",
				text: `Error al iniciar sesión (${providerDisplayName(providerId)}): ${detail}`,
			});
			post({ type: "oauth_clear" });
		}
	}

	async function logoutProvider(providerId: string): Promise<void> {
		if (!frida) return;
		try {
			await frida.modelRuntime.logout?.(providerId);
			// Para proveedores de API key, borrar TAMBIÉN la key guardada (SecretStorage
			// + caché) para que “olvidar” persista entre reinicios. (OAuth ya lo limpia
			// modelRuntime.logout; los apikey no, porque su key vive en SecretStorage.)
			const def = getApiKeyProvider(providerId);
			if (def) {
				await context.secrets.delete(def.secretKey);
				delete keyCaches[providerId];
			}
			post({
				type: "info",
				text: `Se olvidó la credencial de ${providerDisplayName(providerId)}.`,
			});
			postModels();
		} catch {
			/* noop */
		}
	}

	// Recolecta los recursos cargados por el resourceLoader de pi (extensiones,
	// skills, prompts, themes, archivos de contexto) para mostrarlos en el panel.
	// Equivalente al showLoadedResources de la TUI. Los tipos internos de pi no se
	// reexportan por el SDK, así que se tratan como any.
	function collectResources(): any {
		const session: any = frida?.session;
		const rl: any = session?.resourceLoader;
		if (!rl) return undefined;
		const ext = rl.getExtensions?.() ?? { extensions: [], errors: [] };
		const skills = rl.getSkills?.() ?? { skills: [], diagnostics: [] };
		const prompts = rl.getPrompts?.() ?? { prompts: [], diagnostics: [] };
		const themes = rl.getThemes?.() ?? { themes: [] };
		const agents = rl.getAgentsFiles?.() ?? { agentsFiles: [] };
		const errors: { path: string; error: string }[] = [];
		for (const e of ext.errors ?? [])
			errors.push({ path: String(e.path), error: String(e.error) });
		for (const d of [
			...(skills.diagnostics ?? []),
			...(prompts.diagnostics ?? []),
		]) {
			errors.push({
				path: String(d?.path ?? d?.file ?? ""),
				error: String(d?.message ?? d),
			});
		}
		// Extensiones visibles (no ocultas) con sus tools/commands. Se reutiliza
		// abajo para coleccionar los comandos de extensión en la sección Comandos.
		const extensionsData = (ext.extensions ?? [])
			.filter((e: any) => !e.hidden)
			.map((e: any) => {
				const p = String(e.path ?? "");
				return {
					path: p,
					// pi marca las factories registradas en código como "<inline:...>"
					// (resource-loader.js). Las de disco tienen un path real de archivo.
					inline: p.startsWith("<inline:"),
					tools: Array.from(e.tools?.keys?.() ?? []),
					commands: Array.from(e.commands?.keys?.() ?? []),
				};
			});
		// Nombre legible de una extensión desde su path (<inline:NAME> o basename).
		const extNameOf = (p: string): string => {
			const m = p.match(/^<inline:([^>]+)>$/);
			if (m) return m[1];
			const base = p.split(/[/\\]/).pop() ?? p;
			return base.replace(/\.(ts|js)$/, "");
		};
		// Comandos slash registrados por extensiones vía la API de Pi (e.commands).
		// Hoy frida no registra ninguno propio, pero extensiones externas/usuario
		// (en ~/.frida/extensions o .frida/extensions) sí pueden → los unificamos en
		// la sección Comandos con source "extension" para distinguirlos de los
		// built-in del host. Dedupe: si un nombre ya es built-in, gana el built-in.
		const builtinNames = new Set(BUILTIN_COMMANDS.map((c) => c.name));
		const extCommands: {
			name: string;
			description: string;
			argumentHint?: string;
			source: "extension";
			extension: string;
		}[] = [];
		for (const e of (ext.extensions ?? []).filter((e: any) => !e.hidden)) {
			const extLabel = extNameOf(String(e.path ?? ""));
			for (const name of Array.from(e.commands?.keys?.() ?? [])) {
				const n = String(name);
				if (!n || builtinNames.has(n)) continue;
				extCommands.push({
					name: n,
					description: "",
					source: "extension",
					extension: extLabel,
				});
			}
		}
		return {
			extensions: extensionsData,
			skills: (skills.skills ?? []).map((s: any) => {
				const scope = s?.sourceInfo?.scope;
				// Procedencia: las skills empaquetadas por frida-pipeline se
				// sincronizan a ~/.frida/skills/ y Pi las marca scope "user" igual
				// que las creadas a mano → cruzamos con el set empaquetado para
				// distinguir "extensión" de "global" real.
				const isBundled = getBundledSkillNames().has(String(s.name));
				const source = isBundled
					? "extension"
					: scope === "project"
						? "project"
						: scope === "user"
							? "global"
							: "path";
				return {
					name: String(s.name),
					description: String(s.description ?? ""),
					source,
					path: String(s.filePath ?? ""),
				};
			}),
			prompts: (prompts.prompts ?? []).map((p: any) => ({
				name: String(p.name),
				description: String(p.description ?? ""),
			})),
			themes: (themes.themes ?? []).map((t: any) => ({ name: String(t.name) })),
			// Comandos slash: built-in del host (fuente única: BUILTIN_COMMANDS) más
			// los registrados por extensiones vía la API de Pi. Se muestran en
			// Recursos > Comandos y alimentan el autocompletado de "/" del Composer.
			commands: [
				...BUILTIN_COMMANDS.map((c) => ({
					name: c.name,
					description: c.description,
					argumentHint: c.argumentHint,
					source: "built-in" as const,
				})),
				...extCommands,
			],
			contextFiles: (agents.agentsFiles ?? []).map((f: any) => ({
				path: String(f.path),
			})),
			errors,
		};
	}

	function postResources(): void {
		const data = collectResources();
		if (data) post({ type: "resources", data });
		// También refresca el badge pi-lens (el estado "cargado" depende de resources).
		postLensStatus();
	}

	// Toggles de Configuración (tools activos) → webview, para la vista de
	// Configuración. Se leen en vivo de los settings de VS Code.
	function postToolToggles(): void {
		post({ type: "tool_toggles", ...readToolToggles() });
	}

	// Info del workspace: carpeta de trabajo + branch git (y si hay cambios
	// sin committer). Lo ejecuta el HOST directamente (no el modelo), así que no
	// pasa por el gate de bash de D7. No depende de la extensión Git de VS Code.
	async function collectWorkspace(): Promise<{
		cwd: string;
		branch?: string;
		dirty?: boolean;
		sessionName?: string;
	}> {
		const cwd = workspaceCwd();
		const sessionName = frida?.sessionManager?.getSessionName?.() || undefined;
		try {
			const { stdout: branchOut } = await execFileP(
				"git",
				["rev-parse", "--abbrev-ref", "HEAD"],
				{ cwd, timeout: 3000 },
			);
			const branch = branchOut.trim();
			let dirty = false;
			try {
				const { stdout: status } = await execFileP(
					"git",
					["status", "--porcelain"],
					{ cwd, timeout: 3000 },
				);
				dirty = status.trim().length > 0;
			} catch {
				/* ignore */
			}
			return { cwd, branch, dirty, sessionName };
		} catch {
			return { cwd, sessionName }; // no es repo o git no disponible
		}
	}

	async function postWorkspace(): Promise<void> {
		try {
			const ws = await collectWorkspace();
			post({ type: "workspace", ...ws });
		} catch {
			/* ignore */
		}
	}

	// Crea la sesión en segundo plano (onboarding/listo/inicio) para poder mostrar
	// los recursos cuanto antes. Captura errores para no dejar promesas sin manejar.
	function bootstrapSession(): void {
		void ensureSession().catch((e: any) => {
			console.error("[frida] No se pudo iniciar la sesión:", e);
			post({
				type: "info",
				text: "No se pudo iniciar la sesión: " + String(e?.message ?? e),
				level: "error",
			});
		});
	}

	function postQueued(): void {
		post({ type: "queued", items: pendingQueue.map((q) => q.text) });
	}

	function resetQueue(): void {
		pendingQueue.length = 0;
		turnsInRun = 0;
		postQueued();
	}

	function wireSession(session: any): void {
		session.subscribe((event: any) => {
			switch (event?.type) {
				case "agent_start":
					turnsInRun = 0;
					hadText = false;
					hadToolCall = false;
					lensBusy = true;
					post({ type: "agent_busy", busy: true });
					post({ type: "turn_active" });
					break;
				case "agent_end":
					postUsage(session);
					post({ type: "agent_busy", busy: false });
					// Error terminal del provider que NO se reintenta (los retriables van por auto_retry_end).
					if (event.errorMessage && !event.willRetry) {
						post({ type: "provider_error", text: String(event.errorMessage) });
					} else if (!hadText && !hadToolCall) {
						// Fix UX #1: el agente terminó sin generar texto ni llamar tools, y sin
						// errorMessage explícito. El caso más común es un 401 del gateway
						// (API key vencida/inválida) que el SDK openai lanza antes de
						// onResponse, así que after_provider_response no lo atrapa y queda
						// invisible. Avisamos al usuario en vez de dejarlo en silencio.
						post({
							type: "provider_error",
							text:
								"El modelo no generó respuesta. Causa probable: API key inválida o vencida (401), o el gateway DevEngine no respondió. " +
								"Renueva tu API key o ejecuta “Frida: Diagnosticar gateway DevEngine”.",
						});
					}
					// El agente terminó: a partir de aquí los diagnósticos tardíos (cascade)
					// se publican solos (mergeLens comprueba lensBusy).
					lensBusy = false;
					flushLens();
					break;
				case "turn_start": {
					// turn_start tras el primero (turnsInRun>0) = entrega de un mensaje
					// encolado: creamos su turno aquí para que los deltas caigan en él.
					if (turnsInRun > 0 && pendingQueue.length > 0) {
						post({ type: "user", text: pendingQueue.shift()!.text });
						postQueued();
					}
					turnsInRun++;
					// Nuevo turno: reinicia el acumulador para reflejar solo lo que pi-lens
					// encuentre en ESTE turno.
					lensAccum.clear();
					lensAnyTruncated = false;
					post({ type: "turn_active" });
					break;
				}
				case "turn_end":
					// Fin de turno del agente: publica el resumen de diagnósticos acumulados.
					flushLens();
					break;
				case "auto_retry_start":
					// El provider falló con un error retriable: el SDK reintentará. Mostramos
					// indicador + countdown (como el RetryStatusIndicator del TUI) y permitimos
					// cancelar con abortRetry (doble Esc).
					inRetry = true;
					post({
						type: "retry_start",
						attempt: Number(event.attempt) || 1,
						maxAttempts: Number(event.maxAttempts) || 3,
						delayMs: Number(event.delayMs) || 0,
					});
					break;
				case "auto_retry_end":
					inRetry = false;
					post({ type: "retry_end", success: !!event.success });
					// Fallo final (reintentos agotados): muestra el error concreto del gateway.
					if (!event.success) {
						post({
							type: "provider_error",
							text: `Reintento fallido tras ${Number(event.attempt) || 0} intento(s): ${event.finalError || "Error desconocido"}. Request completo: ${rotateErrorDump()}`,
						});
					}
					break;
				case "message_update": {
					const ae = event.assistantMessageEvent;
					if (ae?.type === "text_delta") {
						hadText = true;
						post({ type: "delta", text: ae.delta });
					} else if (ae?.type === "thinking_delta") {
						post({
							type: "thinking_delta",
							text: ae.delta,
						});
					}
					break;
				}
				case "message_end":
					if (
						event.message?.role === "assistant" &&
						event.message?.stopReason === "aborted"
					) {
						post({ type: "info", text: "Operación cancelada" });
					}
					break;
				case "tool_execution_start":
					hadToolCall = true;
					post({
						type: "tool_start",
						toolCallId: event.toolCallId,
						tool: event.toolName,
						args: compactArgs(enrichTodoArgs(event.args)),
					});
					break;
				case "tool_execution_update": {
					// Progreso parcial de un tool largo (extensiones/MCP). Se acumula en el
					// segmento del tool (por toolCallId) y se muestra mientras sigue running.
					const partial = summarizeResult(event.partialResult);
					if (partial) {
						post({
							type: "tool_update",
							toolCallId: event.toolCallId,
							tool: event.toolName,
							partial,
						});
					}
					break;
				}
				case "tool_execution_end":
					post({
						type: "tool_end",
						toolCallId: event.toolCallId,
						tool: event.toolName,
						isError: !!event.isError,
						result: summarizeResult(event.result),
						diff:
							typeof event.result?.details?.diff === "string"
								? event.result.details.diff
								: undefined,
					});
					// El tool `todo` muta el store reactivo y el panel Remote React se
					// re-renderiza solo (ADR-0014): nada que publicar aquí.
					break;
				case "compaction_start":
					post({ type: "compact_start", reason: event.reason });
					break;
				case "compaction_end":
					post({
						type: "compact_end",
						reason: event.reason,
						aborted: !!event.aborted,
						tokensBefore: event.result?.tokensBefore,
						summary: event.result?.summary,
						errorMessage: event.errorMessage,
					});
					// La compactación reescribió los mensajes y el contexto.
					postHistory();
					postUsage(session);
					void postWorkspace();
					break;
				case "summarization_retry_scheduled":
					// La compactación (o branch-summary) falló con error retriable: el SDK
					// reintentará tras el backoff. Reusamos el countdown del retry del agente
					// (state.retry) — el proc-bar de compactación lo muestra apropiadamente.
					post({
						type: "retry_start",
						attempt: Number(event.attempt) || 1,
						maxAttempts: Number(event.maxAttempts) || 3,
						delayMs: Number(event.delayMs) || 0,
					});
					break;
				case "summarization_retry_attempt_start":
					// Empieza el intento de sumarización: de vuelta a "Compactando…".
					post({ type: "retry_end", success: true });
					break;
				case "summarization_retry_finished":
					post({ type: "retry_end", success: true });
					break;
				case "session_info_changed":
					// El nombre de sesión cambió (p. ej. auto-título) → refrescar la barra.
					void postWorkspace();
					break;
				case "thinking_level_changed":
					// El thinking cambió (selector o settings) → sincroniza el selector del webview.
					sendModelInfo();
					break;
			}
		});
	}

	// Frida Code vive en una vista lateral (webview view) registrada en la barra de
	// actividad (viewsContainers.activitybar → frida-sidebar). resolveFridaView la
	// monta la primera vez que se muestra; equivale al createWebviewPanel anterior,
	// pero como vista lateral (no tab de editor). retainContextWhenHidden se fija en
	// el provider (registerWebviewViewProvider) para preservar el estado al ocultarla.
	function resolveFridaView(webviewView: vscode.WebviewView): void {
		view = webviewView;
		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [
				vscode.Uri.joinPath(context.extensionUri, "dist-webview"),
				vscode.Uri.joinPath(context.extensionUri, "media"),
			],
		};
		webviewView.webview.html = getWebviewHtml(
			webviewView.webview,
			context.extensionUri,
		);
		webviewView.onDidDispose(() => {
			view = undefined;
		});
		webviewView.onDidChangeVisibility(() => {
			if (view?.visible) void postWorkspace();
		});
		webviewView.webview.onDidReceiveMessage((msg: any) => {
			void handleWebviewMessage(msg);
		});
	}

	async function handleWebviewMessage(msg: any): Promise<void> {
		switch (msg?.type) {
			case "webview_ready":
				post({ type: "mode", mode: approvalMode });
				post({ type: "version", version: fridaVersion });
				postToolToggles();
				bootstrapSession(); // crea la sesión siempre (incluso sin key) → modelRuntime disponible para OAuth
				{
					// Si la sesión YA existía (webview recreado, o sesión restaurada al
					// arrancar), ensureSession la devuelve sin re-postear model_info/
					// models → el webview nuevo se quedaría con proveedor/modelo en "---"
					// y la pestaña Proveedores vacía, aunque el chat funcionase. Re-posteamos
					// el estado (idempotente).
					const s = await ensureSession();
					s.webBridge.republish();
					sendModelInfo();
					postResources();
					postModels();
					void postWorkspace();
					postUsage(s.session);
				}
				break;
			case "submit":
				await runPrompt(
					String(msg.text ?? ""),
					msg.mode === "followUp" ? "followUp" : "steer",
					msg.images,
				);
				break;
			case "approval_response":
				(await ensureSession()).bridge.resolve({
					id: msg.id,
					decision: msg.decision === "accept" ? "accept" : "reject",
					acceptAll: !!msg.acceptAll,
					pattern: typeof msg.pattern === "string" ? msg.pattern : undefined,
				});
				break;
			case "ui_response":
				// Respuesta del webview a un diálogo ExtensionUIContext (select/input/confirm).
				(await ensureSession()).uiBridge.resolve({
					id: String(msg.id ?? ""),
					value: typeof msg.value === "string" ? msg.value : undefined,
					cancelled: !!msg.cancelled,
				});
				break;
			case "web_event":
				// Remote React (opción A): el usuario interactuó con la UI remota → disparar
				// el handler del renderer activo, que re-renderiza y publica un nuevo commit.
				(await ensureSession()).webBridge.fireEvent(
					String(msg.rootId ?? ""),
					String(msg.handlerId ?? ""),
					{
						value:
							typeof msg.payload?.value === "string"
								? msg.payload.value
								: undefined,
						checked:
							typeof msg.payload?.checked === "boolean"
								? msg.payload.checked
								: undefined,
					},
				);
				break;
			case "set_key":
				await setKey(
					String(msg.provider ?? SOFTTEK_PROVIDER),
					String(msg.key ?? ""),
				);
				break;
			case "discover_models":
				await discoverModels(String(msg.provider ?? ""));
				break;
			case "copy_text":
				try {
					await vscode.env.clipboard.writeText(String(msg.text ?? ""));
				} catch {
					/* noop */
				}
				break;
			case "rotate_key": {
				const pid =
					typeof msg.provider === "string" && msg.provider
						? msg.provider
						: undefined;
				if (pid) await promptKey(pid, "manual");
				else await pickApiKeyProvider();
				break;
			}
			case "compact":
				await compactContext();
				break;
			case "cancel_compaction":
				await cancelCompaction();
				break;
			case "abort":
				await abortRun();
				break;
			case "reload":
				await reloadResources();
				break;
			case "list_resources":
				postResources();
				break;
			case "list_models":
				postModels();
				void refreshModelsAsync(); // Fase B: refresh en background al abrir el selector
				break;
			case "refresh_models":
				void refreshModelsAsync();
				break;
			case "select_model":
				await selectModel(String(msg.provider ?? ""), String(msg.model ?? ""));
				break;
			case "login_provider":
				await loginProvider(String(msg.provider ?? ""));
				break;
			case "logout_provider":
				await logoutProvider(String(msg.provider ?? ""));
				break;
			case "fork":
				await forkSession();
				break;
			case "fork_at":
				await forkAt(String(msg.entryId ?? ""));
				break;
			case "workspace":
				await postWorkspace();
				break;
			case "new_session":
				await newSession();
				break;
			case "search_files": {
				const q = String(msg.query ?? "");
				const items = await searchFiles(q);
				post({ type: "files", query: q, items });
				break;
			}
			case "list_sessions":
				await sendSessions();
				break;
			case "switch_session":
				await switchSession(String(msg.path ?? ""));
				break;
			case "rename_session":
				await renameSession(String(msg.path ?? ""), String(msg.name ?? ""));
				break;
			case "delete_session":
				await deleteSession(String(msg.path ?? ""));
				break;
			case "set_mode":
				approvalMode =
					msg.mode === "auto-edit" || msg.mode === "auto" ? msg.mode : "manual";
				post({ type: "mode", mode: approvalMode });
				break;
			case "set_tool_toggle":
				await writeToolToggle(msg.key, !!msg.enabled);
				postToolToggles();
				// Re-ejecuta las factories para activar/desactivar el tool en caliente
				// (frida.askUserQuestion.enabled / frida.todo.enabled). Igual que /reload,
				// no pierde el historial; el estado de `todo` se recupera por replay.
				await reloadResources();
				break;
			case "set_thinking":
				try {
					frida?.session?.setThinkingLevel?.(String(msg.level ?? "medium"));
				} catch {
					/* noop */
				}
				sendModelInfo();
				break;
		}
	}

	// Built-in slash commands del composer (estilo TUI de pi). Se interceptan
	// en runPrompt ANTES de enviar al agente.
	//
	// FUENTE ÚNICA DE VERDAD: BUILTIN_COMMANDS describe los 22 comandos (name +
	// description + argumentHint). Se envían al webview vía ResourceSummary.commands
	// para que aparezcan TANTO en Configuración > Recursos > Comandos COMO en el
	// autocompletado de "/" del Composer. Así host y client nunca divergen
	// (bug anterior: 22 en el host vs 15 hardcodeados en App.tsx → /wf y 6 más
	// sólo funcionaban escribiéndolos a mano).
	const BUILTIN_COMMANDS: {
		name: string;
		description: string;
		argumentHint?: string;
	}[] = [
		{ name: "compact", description: "Compactar el contexto de la sesión" },
		{ name: "reload", description: "Recargar extensiones, skills y prompts" },
		{ name: "new", description: "Iniciar una sesión nueva" },
		{
			name: "model",
			description: "Abrir el selector de modelo/proveedor",
			argumentHint: "<provider/model>",
		},
		{
			name: "login",
			description: "Iniciar sesión con un proveedor (suscripción)",
			argumentHint: "<provider>",
		},
		{
			name: "logout",
			description: "Cerrar sesión de un proveedor",
			argumentHint: "<provider>",
		},
		{
			name: "name",
			description: "Renombrar la sesión actual",
			argumentHint: "<nombre>",
		},
		{ name: "copy", description: "Copiar el último mensaje al portapapeles" },
		{
			name: "help",
			description: "Mostrar atajos y comandos",
			argumentHint: "[herramienta]",
		},
		{ name: "clone", description: "Duplicar la sesión actual" },
		{ name: "fork", description: "Bifurcar desde un mensaje anterior" },
		{
			name: "todos",
			description: "Mostrar la lista de tareas agrupada por estado",
		},
		{
			name: "context",
			description:
				"Reporte de uso del contexto (presión, categorías, system prompt)",
		},
		{
			name: "gates",
			description: "Auditoría de permisos (decisiones allow/block del gate)",
		},
		{
			name: "gates-config",
			description: "Editor de permisos (allow/ask/deny por tool)",
		},
		{
			name: "wf",
			description: "Lanzar o reanudar un workflow",
			argumentHint: '<nombre> "<input>" | @<ref>',
		},
		{
			name: "pipeline",
			description: "Estado del orquestador frida-pipeline",
		},
		{
			name: "agents",
			description: "Listar sub-agentes corriendo y disponibles",
		},
		{
			name: "frida-models",
			description: "Editor de overrides de modelo por skill (models.json)",
		},
		{
			name: "frida-update-agents",
			description: "Re-sincronizar los agentes empaquetados",
		},
		{
			name: "version",
			description: "Mostrar la versión instalada de Frida",
		},
		{ name: "update", description: "Comprobar si hay una versión nueva" },
	];
	// Allowlist de ejecución (runBuiltinSlash): un comando es built-in si está
	// aquí. Derivado de BUILTIN_COMMANDS para no mantener dos listas.
	const BUILTIN_SLASH = new Set(BUILTIN_COMMANDS.map((c) => c.name));

	async function runBuiltinSlash(text: string): Promise<boolean> {
		const m = text.match(/^\/([\w-]+)(?:\s+([\s\S]*))?$/);
		if (!m) return false;
		const cmd = m[1];
		const arg = (m[2] ?? "").trim();
		if (!BUILTIN_SLASH.has(cmd)) return false; // /skill:... y prompts → al agente
		switch (cmd) {
			case "compact":
				void compactContext();
				break;
			case "reload":
				void reloadResources();
				break;
			case "new":
				void newSession();
				break;
			case "model": {
				const slash = arg ? arg.indexOf("/") : -1;
				if (arg) {
					if (slash > 0)
						await selectModel(arg.slice(0, slash), arg.slice(slash + 1));
					else
						post({
							type: "info",
							text: "Uso: /model <provider/model>  (ej. github-copilot/gpt-5)",
						});
				} else {
					post({ type: "open_models" });
				}
				break;
			}
			case "login":
				if (arg) void loginProvider(arg);
				else
					post({
						type: "info",
						text: "Uso: /login <provider>  (ej. github-copilot)",
					});
				break;
			case "logout":
				if (arg) void logoutProvider(arg);
				else
					post({
						type: "info",
						text: "Uso: /logout <provider>  (ej. github-copilot)",
					});
				break;
			case "name":
				if (arg) await renameCurrentSession(arg);
				else post({ type: "info", text: "Uso: /name <nombre de la sesión>" });
				break;
			case "copy":
				await copyLastMessage();
				break;
			case "help":
				postHelp(arg);
				break;
			case "clone":
				await cloneSession();
				break;
			case "fork":
				await forkSession();
				break;
			case "todos":
				postTodosCommand();
				break;
			case "context":
				postContextCommand(arg);
				break;
			case "gates":
				postGatesCommand();
				break;
			case "gates-config":
				postGatesConfigCommand();
				break;
			case "wf":
				postWfCommand(arg);
				break;
			case "pipeline":
				void postPipelineCommand();
				break;
			case "frida-models":
				void postFridaModelsCommand();
				break;
			case "frida-update-agents":
				void postFridaUpdateAgentsCommand();
				break;
			case "agents":
				void postAgentsCommand();
				break;
			case "version":
				post({
					type: "info",
					text: `Frida Code v${fridaVersion} · usa /update para comprobar si hay versión nueva · ${RELEASES_URL}`,
				});
				break;
			case "update":
				void checkForUpdate();
				break;
		}
		return true;
	}

	// /update: consulta la última release en GitHub y avisa si hay versión nueva.
	// El repo es privado → 404 sin token; soporta GITHUB_TOKEN/GH_TOKEN para autenticar.
	async function checkForUpdate(): Promise<void> {
		const current = fridaVersion;
		const url = `https://api.github.com/repos/${UPDATE_REPO}/releases/latest`;
		try {
			const headers: Record<string, string> = {
				Accept: "application/vnd.github+json",
				"User-Agent": "frida-code",
			};
			const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
			if (token) headers.Authorization = `Bearer ${token}`;
			const r = await fetch(url, { headers });
			if (r.status === 404) {
				post({
					type: "info",
					text: `No se pudo comprobar actualizaciones (${UPDATE_REPO}). ¿Repo privado o sin releases? Si es privado, define GITHUB_TOKEN; si aún no hay, publica el .vsix en ${RELEASES_URL}.`,
				});
				return;
			}
			if (!r.ok) {
				post({
					type: "info",
					text: `No se pudo comprobar actualizaciones (HTTP ${r.status}).`,
				});
				return;
			}
			const data: any = await r.json();
			const latest = String(data?.tag_name ?? "").replace(/^v/, "");
			if (!latest) {
				post({
					type: "info",
					text: "La release más reciente no tiene tag de versión.",
				});
				return;
			}
			const htmlUrl: string =
				data?.html_url ?? `https://github.com/${UPDATE_REPO}/releases`;
			if (compareSemver(current, latest) < 0) {
				post({
					type: "info",
					text: `Hay una versión nueva: v${latest} (tienes v${current}). Descarga: ${htmlUrl}`,
				});
			} else {
				post({
					type: "info",
					text: `Estás al día (v${current}). Última release: v${latest}.`,
				});
			}
		} catch (e: any) {
			post({
				type: "info",
				text: `No se pudo comprobar actualizaciones: ${String(e?.message ?? e)}`,
			});
		}
	}

	async function renameCurrentSession(name: string): Promise<void> {
		const pathStr = frida?.session?.sessionFile;
		if (!pathStr) {
			post({ type: "info", text: "No hay sesión activa para renombrar." });
			return;
		}
		await renameSession(pathStr, name);
	}

	async function copyLastMessage(): Promise<void> {
		const msgs: any[] = frida?.session?.agent?.state?.messages ?? [];
		for (let i = msgs.length - 1; i >= 0; i--) {
			if (msgs[i]?.role === "assistant") {
				const t = extractText(msgs[i]);
				if (t) {
					await vscode.env.clipboard.writeText(t);
					post({
						type: "info",
						text: "Último mensaje copiado al portapapeles.",
					});
					return;
				}
			}
		}
		post({ type: "info", text: "No hay mensaje del asistente para copiar." });
	}

	// /help: abre el README o la doc de una herramienta en markdown preview.
	// Índice de herramientas con sus alias de match (para /help <alias>).
	const HELP_TOOLS: { match: string[]; file: string; label: string }[] = [
		{
			match: ["workflow", "wf", "frida-workflow"],
			file: "docs/tools/frida-workflow.md",
			label: "frida-workflow",
		},
		{
			match: [
				"pipeline",
				"frida-pipeline",
				"orquestador",
				"frida-models",
				"models",
			],
			file: "docs/tools/frida-pipeline.md",
			label: "frida-pipeline",
		},
		{
			match: ["permission", "gates", "frida-permission-system"],
			file: "docs/tools/frida-permission-system.md",
			label: "frida-permission-system",
		},
		{
			match: ["context"],
			file: "docs/tools/frida-context.md",
			label: "frida-context",
		},
		{
			match: [
				"browser",
				"agent-browser",
				"agent_browser",
				"web-search",
				"web_search",
				"electron",
			],
			file: "docs/tools/frida-agent-browser.md",
			label: "frida-agent-browser",
		},
		{
			match: [
				"args",
				"frida-args",
				"skill-args",
				"argumentos",
				"placeholders",
				"shell-substitution",
			],
			file: "docs/tools/frida-args.md",
			label: "frida-args",
		},
		{
			match: ["extension", "extensions", "ext"],
			file: "docs/tools/extensions.md",
			label: "extensiones",
		},
		{
			match: ["ask", "question", "ask-user-question-web"],
			file: "docs/tools/ask-user-question-web.md",
			label: "ask-user-question-web",
		},
		{ match: ["todo", "todos"], file: "docs/tools/todo.md", label: "todo" },
		{ match: ["todo-web"], file: "docs/tools/todo-web.md", label: "todo-web" },
	];

	async function openHelpDoc(
		relPath: string,
		fragment?: string,
	): Promise<void> {
		const full = path.join(context.extensionPath, relPath);
		let uri = vscode.Uri.file(full);
		if (fragment) uri = uri.with({ fragment });
		await vscode.commands.executeCommand("markdown.showPreview", uri);
	}

	async function postHelp(arg: string): Promise<void> {
		const a = arg.trim();
		if (!a) {
			await openHelpDoc("README.md");
			return;
		}
		const [head, ...rest] = a.split("#");
		const frag = rest.join("#") || undefined;
		const needle = head.trim().toLowerCase();
		const tool = HELP_TOOLS.find(
			(t) =>
				t.match.some((m) => m.toLowerCase() === needle) ||
				t.label.toLowerCase().includes(needle),
		);
		if (tool) {
			await openHelpDoc(tool.file, frag);
			return;
		}
		await openHelpDoc("README.md");
		post({
			type: "info",
			text: `No encontré "${arg}". Abriendo el índice (README). Herramientas: ${HELP_TOOLS.map((t) => t.label).join(", ")}.`,
		});
	}

	// /todos: imprime la lista de tareas agrupada por estado (estilo /todos de la
	// TUI de pi/rpiv). Lee el store reactivo del tool `todo` (todo-web/store).
	function postTodosCommand(): void {
		const s = getTodoState();
		const visible = s.tasks.filter((t) => t.status !== "deleted");
		if (visible.length === 0) {
			post({ type: "notice", text: "No hay tareas todavía." });
			return;
		}
		const fmt = (t: any) =>
			`  #${t.id} ${t.subject}` +
			(t.status === "in_progress" && t.activeForm ? ` (${t.activeForm})` : "") +
			(t.blockedBy?.length
				? ` ⛓ ${t.blockedBy.map((id: number) => `#${id}`).join(",")}`
				: "");
		const pending = visible.filter((t) => t.status === "pending");
		const inProg = visible.filter((t) => t.status === "in_progress");
		const done = visible.filter((t) => t.status === "completed");
		const lines: string[] = [`Tareas: ${done.length}/${visible.length}`];
		if (inProg.length) {
			lines.push("── En progreso ──");
			for (const t of inProg) lines.push(fmt(t));
		}
		if (pending.length) {
			lines.push("── Pendientes ──");
			for (const t of pending) lines.push(fmt(t));
		}
		if (done.length) {
			lines.push("── Completadas ──");
			for (const t of done) lines.push(fmt(t));
		}
		post({ type: "notice", text: lines.join("\n") });
	}

	// /context: reporte de uso del contexto como panel overlay (barra segmentada
	// estilo Claude Code + leyenda + métricas). Porte de /supi-context (fase B,
	// ADR-0015). Lee frida.session + el cache de before_agent_start (frida-context).
	let contextReportHandle: { unmount: () => void } | undefined;
	function postContextCommand(_arg: string): void {
		if (!frida?.session) {
			post({
				type: "info",
				text: "No hay sesión activa para analizar el contexto.",
			});
			return;
		}
		try {
			const wsCwd =
				vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
			const settings = SettingsManager.create(wsCwd, defaultAgentDir());
			// ADR-0015 fix: leer systemPrompt/options/tools EN TIEMPO REAL de la sesión
			// (con fallback al cache de before_agent_start). El cache sólo se puebla en
			// un turno del agente; si el usuario da /context sin turno previo (ej. reabre
			// VS Code + sesión existente), el cache estaba vacío y la composición del SP
			// salía toda en 0. La sesión expone `systemPrompt` (getter público),
			// `getAllTools()` (público), `_baseSystemPromptOptions` y `getActiveToolNames()`
			// (internos) — ya poblados al configurar los tools, antes del primer turno.
			const ctxSess: any = frida.session;
			const analysis = analyzeContext({
				usage: ctxSess?.getContextUsage?.(),
				branch: frida.sessionManager?.getBranch?.() ?? [],
				systemPromptText: ctxSess?.systemPrompt ?? getCachedSystemPrompt(),
				options: ctxSess?._baseSystemPromptOptions ?? getCachedPromptOptions(),
				modelName:
					frida.session.model?.name ??
					frida.session.model?.id ??
					"No model selected",
				compactionEnabled: settings.getCompactionEnabled(),
				reserveTokens: settings.getCompactionReserveTokens(),
				allTools: ctxSess?.getAllTools?.() ?? getCachedAllTools(),
				activeTools: ctxSess?.getActiveToolNames?.() ?? getCachedActiveTools(),
			});
			// Reemplaza el reporte anterior si aún está abierto.
			contextReportHandle?.unmount();
			contextReportHandle = frida.webBridge.mountPersistent(
				() =>
					createContextReportElement(analysis, () =>
						contextReportHandle?.unmount(),
					),
				"overlay",
			);
		} catch (e) {
			post({ type: "info", text: `No se pudo analizar el contexto: ${e}` });
		}
	}

	// /wf: lanza un workflow (ADR-0020/D32). Corre en sesiones hijas desprendidas; el
	// chat sigue usable y notifica por toast al terminar (panel llega en Fase 5).
	async function postWfCommand(arg: string): Promise<void> {
		const s = await ensureSession();
		// Fase 5: montar el WorkflowPanel (footer) + registrar el lifecycle listener
		// (idempotente). Antes de handleWfSlash para que los fire del runner lo pueblen.
		wireWorkflowPanel(s.webBridge);
		const host = createFridaWorkflowHost({
			frida: s,
			cwd: workspaceCwd(),
			notify: (message) => post({ type: "info", text: message }),
		});
		await handleWfSlash(arg, {
			host,
			runsDirBase: path.join(context.globalStorageUri.fsPath, "workflows"),
			cwd: workspaceCwd(),
			agentDir: defaultAgentDir(),
			dslBundlePath: path.join(
				context.extensionPath,
				"dist",
				"frida-workflow.js",
			),
		});
	}

	// /pipeline: estado del orquestador frida-pipeline (ADR-0021). Fase 1: monta el
	// banner persistente en el footer y postea el status actual al chat. Las
	// Fases 2+ añadirán el resto de slash commands (/frida-models, /frida-update-agents,
	// /frida-lanes) sin tocar este entry point.
	async function postPipelineCommand(): Promise<void> {
		const s = await ensureSession();
		// Idempotente: si el panel ya está montado, retorna el mismo handle.
		wirePipelinePanel(s.webBridge);
		const status = computePipelineStatus();
		const text = formatPipelineStatus(status);
		post({
			type: status.siblings.allPresent ? "info" : "warning",
			text,
		});
	}

	// /frida-models: editor de overrides de modelo por skill (ADR-0021 Fase 3).
	// Muestra el config actual (overrides activos) y abre ~/.frida/models.json
	// en el editor de VS Code. Si el archivo no existe, lo crea con un template.
	// Tras editar, el usuario debe correr /frida-models de nuevo o reiniciar la
	// sesión para que el cache se invalide.
	async function postFridaModelsCommand(): Promise<void> {
		await ensureSession();
		const configPath = getModelsConfigPath();
		const config = loadModelsConfig();

		// Reportar el estado actual al chat.
		const lines: string[] = [];
		lines.push(`Config de modelos: ${configPath}`);
		lines.push("");

		if (config.defaults) {
			lines.push(
				`Defaults: ${config.defaults.model ?? "-"}${config.defaults.thinking ? ` (thinking: ${config.defaults.thinking})` : ""}`,
			);
		}
		if (config.skills && Object.keys(config.skills).length > 0) {
			lines.push("Skills:");
			for (const [name, entry] of Object.entries(config.skills)) {
				lines.push(
					`  ${name}: ${entry.model ?? "-"}${entry.thinking ? ` (thinking: ${entry.thinking})` : ""}`,
				);
			}
		}
		if (
			!config.defaults &&
			!config.skills &&
			!config.agents &&
			!config.stages
		) {
			lines.push("(sin overrides configurados)");
		}
		lines.push("");
		lines.push("Abriendo el editor…");
		post({ type: "info", text: lines.join("\n") });

		// Crear con template si no existe.
		if (!existsSync(configPath)) {
			await fs.mkdir(path.dirname(configPath), { recursive: true });
			await fs.writeFile(configPath, modelsConfigTemplate(), "utf8");
		}

		// Abrir en el editor de VS Code.
		const doc = await vscode.workspace.openTextDocument(configPath);
		await vscode.window.showTextDocument(doc);

		// Invalidar el cache para que la próxima invocación de skill-bracket
		// lea el config actualizado.
		invalidateModelsConfigCache();
	}

	// /frida-update-agents: sincroniza los 15 agentes empaquetados al agentDir
	// global (~/.frida/global/agents/) con tracking sha256 (ADR-0021 Fase 5).
	// Fuerza overwrite de archivos gestionados (apply=true), incluyendo los que
	// el usuario editó a mano. Reporta el resultado al chat.
	async function postFridaUpdateAgentsCommand(): Promise<void> {
		await ensureSession();
		const result = syncBundledAgents(true, defaultAgentDir());
		post({
			type: result.errors.length > 0 ? "warning" : "info",
			text: formatSyncReport(result),
		});
	}

	// /agents: gestión de sub-agentes (ADR-0022 Fase 4+6). Muestra agentes
	// corriendo, tipos disponibles, settings y monta el widget del webview.
	async function postAgentsCommand(): Promise<void> {
		const s = await ensureSession();
		wireAgentWidget(s.webBridge);
		const cwd = workspaceCwd();
		const lines: string[] = [];

		// Agentes corriendo.
		const agents = listAgents();
		const running = agents.filter(
			(a) => a.status === "running" || a.status === "queued",
		);
		if (running.length > 0) {
			lines.push(`Agentes corriendo (${running.length}):`);
			for (const a of running) {
				lines.push(`  ● ${a.type}  ${a.description}  (${a.status})`);
			}
			lines.push("");
		}

		// Tipos disponibles.
		const types = getAvailableTypes(cwd);
		lines.push(`Tipos disponibles (${types.length}):`);
		for (const t of types) {
			lines.push(`  • ${t}`);
		}
		lines.push("");

		// Settings.
		const settings = loadSettings(cwd);
		lines.push(formatSettings(settings));

		post({ type: "info", text: lines.join("\n") });
	}

	// /gates: auditoría navegable de permisos (overlay Remote React, ADR-0016 Fase 2).
	// Lee el JSONL de approvals y lo muestra con filtros + colores. Snapshot puntual
	// (no streaming): re-ejecutar /gates refresca.
	let auditPanelHandle: { unmount: () => void } | undefined;
	function postGatesCommand(): void {
		if (!frida) {
			post({
				type: "info",
				text: "No hay sesión activa. La auditoría necesita una sesión iniciada.",
			});
			return;
		}
		try {
			const entries = readAuditLog(approvalLogPath);
			auditPanelHandle?.unmount();
			auditPanelHandle = frida.webBridge.mountPersistent(
				() =>
					createAuditPanelElement(entries, () => auditPanelHandle?.unmount()),
				"overlay",
			);
		} catch (e) {
			post({ type: "info", text: `No se pudo leer la auditoría: ${e}` });
		}
	}

	// /gates-config: editor visual de permisos (overlay Remote React, ADR-0016 Fase 5).
	// El panel edita la política allow/ask/deny por tool y guarda en permission.json;
	// el gate lee la policy fresca del config-store en el próximo tool_call.
	let configPanelHandle: { unmount: () => void } | undefined;
	function postGatesConfigCommand(): void {
		if (!frida) {
			post({
				type: "info",
				text: "No hay sesión activa para editar permisos.",
			});
			return;
		}
		configPanelHandle?.unmount();
		configPanelHandle = frida.webBridge.mountPersistent(
			() => createConfigPanelElement(() => configPanelHandle?.unmount()),
			"overlay",
		);
	}

	// Duplica la sesión actual en un nuevo archivo y la abre (createBranchedSession
	// en la hoja actual = copia completa). Equivalente al /clone de la TUI.
	async function cloneSession(): Promise<void> {
		if (!frida) return;
		const sm = frida.sessionManager;
		const leafId = sm?.getLeafId?.();
		if (!leafId) {
			post({ type: "info", text: "Nada que clonar todavía." });
			return;
		}
		const newPath = sm?.createBranchedSession?.(leafId);
		if (!newPath) {
			post({
				type: "info",
				text: "No se pudo clonar la sesión (espera al primer mensaje del asistente).",
			});
			return;
		}
		post({ type: "info", text: "Sesión clonada." });
		await switchSession(newPath);
	}

	// Bifurcar desde un mensaje anterior: publica los puntos (mensajes del usuario)
	// para que el webview muestre un selector. Equivalente al /fork de la TUI.
	async function forkSession(): Promise<void> {
		if (!frida) return;
		const points: any[] = frida.session?.getUserMessagesForForking?.() ?? [];
		if (points.length === 0) {
			post({ type: "info", text: "No hay mensajes para bifurcar." });
			return;
		}
		post({
			type: "fork_points",
			points: points.map((p) => ({ entryId: p.entryId, text: p.text })),
		});
	}

	// Crea la rama desde el padre del mensaje elegido (igual que runtime.fork "before").
	async function forkAt(entryId: string): Promise<void> {
		if (!frida || !entryId) return;
		const sm = frida.sessionManager;
		const entry = sm?.getEntry?.(entryId);
		if (!entry) {
			post({ type: "info", text: "Punto de bifurcación no encontrado." });
			return;
		}
		const target = entry.parentId ?? entryId;
		const newPath = sm?.createBranchedSession?.(target);
		if (!newPath) {
			post({ type: "info", text: "No se pudo bifurcar la sesión." });
			return;
		}
		post({ type: "info", text: "Sesión bifurcada desde el punto elegido." });
		await switchSession(newPath);
	}

	async function runPrompt(
		text: string,
		mode: "steer" | "followUp" = "steer",
		images?: { data: string; mimeType: string }[],
	): Promise<void> {
		const trimmed = text.trim();
		if (!trimmed) return;

		// Built-in slash commands (/compact, /reload, /model, /login, /name, …).
		// Se interceptan ANTES de pedir auth: no todos requieren sesión/modelo.
		if (trimmed.startsWith("/")) {
			if (await runBuiltinSlash(trimmed)) return;
		}

		// Modo bash del usuario: "!comando" ejecuta y envía el output al LLM;
		// "!!comando" ejecuta sin enviarlo (solo se muestra en el panel).
		// Es ejecución directa del usuario (no pasa por el gate de bash de D7).
		if (trimmed.startsWith("!")) {
			const exclude = trimmed.startsWith("!!");
			const command = (exclude ? trimmed.slice(2) : trimmed.slice(1)).trim();
			if (!command) return; // "!" a secas → se ignora
			await runBashShortcut(command, exclude, trimmed);
			return;
		}

		let session: FridaSession;
		try {
			session = await ensureSession();
		} catch (e: any) {
			post({ type: "error", text: String(e?.message ?? e) });
			return;
		}
		// Auth global: API key de Softtek o login de suscripción (Copilot).
		const anyAuthed = SUPPORTED_PROVIDERS.some((id) =>
			isProviderAuthed(session.modelRuntime, id),
		);
		if (!anyAuthed) {
			post({ type: "need_key" });
			return;
		}
		const expanded = await expandAtFiles(trimmed, workspaceCwd());

		// Normaliza imágenes adjuntas (paste de imagen) al formato del SDK.
		const imgs =
			images && images.length > 0
				? images.map((i) => ({
						type: "image" as const,
						data: i.data,
						mimeType: i.mimeType,
					}))
				: undefined;

		// Si el agente está ocupado, encolamos (Message Queue de pi): el turno de
		// este mensaje NO se crea ahora, sino cuando el agente lo entregue
		// (turn_start>0 en wireSession), para que los deltas del turno en curso
		// sigan cayendo en su propio turno y no se mezclen.
		if (session.session?.isStreaming) {
			pendingQueue.push({ text: trimmed });
			postQueued();
			try {
				await session.session.prompt(expanded, {
					streamingBehavior: mode,
					images: imgs,
				});
			} catch (e: any) {
				const idx = pendingQueue.findIndex((q) => q.text === trimmed);
				if (idx >= 0) pendingQueue.splice(idx, 1);
				postQueued();
				post({ type: "error", text: String(e?.message ?? e) });
			}
			return;
		}

		// Agente libre: turno normal. El busy lo marcan los eventos agent_start/end
		// reales de pi (no turn_start/turn_end manuales).
		post({
			type: "user",
			text: trimmed,
			images: imgs?.map((i) => ({ data: i.data, mimeType: i.mimeType })),
		});
		try {
			await session.session.prompt(
				expanded,
				imgs ? { images: imgs } : undefined,
			);
		} catch (e: any) {
			post({ type: "error", text: String(e?.message ?? e) });
		}
	}

	// Ejecuta un atajo de bash del usuario (!comando / !!comando).
	// Usa session.executeBash del SDK: si excludeFromContext=false, el resultado
	// queda registrado en el contexto del LLM (igual que la TUI de pi).
	async function runBashShortcut(
		command: string,
		exclude: boolean,
		raw: string,
	): Promise<void> {
		let session: FridaSession;
		try {
			session = await ensureSession();
		} catch (e: any) {
			post({ type: "error", text: String(e?.message ?? e) });
			return;
		}
		if (session.session?.isBashRunning) {
			post({
				type: "error",
				text: "Ya hay un comando bash en ejecución. Cancela primero.",
			});
			return;
		}
		if (session.session?.isStreaming) {
			// El atajo de bash directo del usuario compite con el agent run por el
			// indicador de “busy”; pídele que espere (como hace pi con el bash).
			post({
				type: "error",
				text: "Espera a que Frida termine de procesar para ejecutar bash directo (!).",
			});
			return;
		}
		post({ type: "user", text: raw });
		post({ type: "bash_start", command, excludeFromContext: exclude });
		try {
			const result: any = await session.session.executeBash(
				command,
				(chunk: string) => post({ type: "bash_chunk", text: chunk }),
				{ excludeFromContext: exclude },
			);
			post({
				type: "bash_end",
				exitCode: result?.exitCode,
				cancelled: !!result?.cancelled,
				truncated: !!result?.truncated,
				fullOutputPath: result?.fullOutputPath,
			});
		} catch (e: any) {
			post({ type: "bash_end", exitCode: undefined, cancelled: false });
			post({ type: "error", text: String(e?.message ?? e) });
		}
		// El comando pudo cambiar el branch/estado de git (p. ej. !git checkout).
		void postWorkspace();
	}

	async function compactContext(): Promise<void> {
		try {
			const { session } = await ensureSession();
			// El feedback (estado + resumen + tokens) lo dan los eventos
			// compaction_start / compaction_end del SDK, tanto para la compactación
			// manual como para la automática (threshold / overflow).
			await session.compact();
		} catch (e: any) {
			post({
				type: "info",
				level: "error",
				text: "Error al compactar: " + String(e?.message ?? e),
			});
		}
	}

	async function cancelCompaction(): Promise<void> {
		try {
			const { session } = await ensureSession();
			session.abortCompaction?.();
		} catch {
			/* noop */
		}
	}

	async function abortRun(): Promise<void> {
		try {
			const { session } = await ensureSession();
			if (session.session?.isBashRunning) {
				await session.session.abortBash?.();
				return;
			}
			if (inRetry) {
				await session.session.abortRetry?.();
				return;
			}
			await session.session.abort();
		} catch {
			/* noop */
		}
	}

	// Recarga en caliente de extensiones, skills, prompts, themes, archivos de
	// contexto y settings (equivalente al /reload de la TUI de pi). No pierde el
	// historial ni la sesión; re-ejecuta las factories (gates, provider hooks,
	// ask_user_question) y reescanea el descubrimiento abierto (ADR-0005).
	async function reloadResources(): Promise<void> {
		let sess: FridaSession;
		try {
			sess = await ensureSession();
		} catch (e: any) {
			post({
				type: "info",
				level: "error",
				text: "Error al recargar: " + String(e?.message ?? e),
			});
			return;
		}
		const session = sess.session;
		if (session?.isStreaming) {
			post({
				type: "info",
				text: "Espera a que termine la respuesta actual antes de recargar.",
			});
			return;
		}
		if (session?.isCompacting) {
			post({
				type: "info",
				text: "Espera a que termine la compactación antes de recargar.",
			});
			return;
		}
		post({
			type: "info",
			text: "Recargando extensiones, skills, prompts, themes y contexto…",
		});
		try {
			await session.reload();
			sendModelInfo(); // por si settings cambió el thinking level
			// ⚠ Verificar en runtime: la key inyectada (setRuntimeApiKey) vive en el
			// ModelRuntime, que el reload no toca; debería persistir. Si llegara a
			// fallar la autenticación tras un reload, reinyectar con sess.setKey(keyCache).
			const rl: any = session?.resourceLoader;
			const extCount = rl?.getExtensions?.()?.extensions?.length;
			const skillCount = rl?.getSkills?.()?.skills?.length;
			const counts =
				extCount !== undefined || skillCount !== undefined
					? ` · ${extCount ?? 0} extensiones, ${skillCount ?? 0} skills`
					: "";
			post({ type: "info", text: "Recarga completada" + counts });
			postResources();
		} catch (e: any) {
			post({
				type: "info",
				level: "error",
				text: "Error al recargar: " + String(e?.message ?? e),
			});
		}
	}

	async function newSession(): Promise<void> {
		if (frida) {
			try {
				await frida.session.dispose?.();
			} catch {
				/* noop */
			}
			// El dispose del SDK NO emite session_shutdown → los paneles web persistentes
			// (todo) no se desmontan solos. Limpiar los roots del WebBridge viejo antes
			// de soltar la referencia, y resetear la Promise anti-race.
			frida.gateStats.reset(); // Fase 3: contadores a cero en el webview.
			frida.sessionApprovals.clear(); // Fase 4: olvida patrones aprobados.
			frida.webBridge.dispose();
			frida = undefined;
			fridaPromise = undefined;
		}
		post({ type: "cleared" });
		lensActive = false;
		lensAccum.clear();
		lensAnyTruncated = false;
		flushLens();
		resetQueue();
		post({ type: "info", text: "Nueva sesión iniciada." });
		if (Object.keys(keyCaches).length > 0) bootstrapSession(); // recrea la sesión para mostrar recursos
	}

	async function sendSessions(): Promise<void> {
		try {
			const infos = await SessionManager.listAll(sessionDirPath);
			const items = infos
				.map((i: any) => ({
					path: String(i.path),
					name: i.name as string | undefined,
					firstMessage: String(i.firstMessage ?? "").slice(0, 160),
					messageCount: Number(i.messageCount ?? 0),
					modified:
						i.modified instanceof Date
							? i.modified.getTime()
							: Number(i.modified) || 0,
				}))
				.sort((a: any, b: any) => b.modified - a.modified);
			post({
				type: "sessions",
				items,
				currentPath: frida?.session?.sessionFile,
			});
		} catch (e: any) {
			post({
				type: "info",
				level: "error",
				text: "Error al listar sesiones: " + String(e?.message ?? e),
			});
		}
	}

	async function switchSession(pathStr: string): Promise<void> {
		if (!pathStr) return;
		if (frida) {
			try {
				await frida.session.dispose?.();
			} catch {
				/* noop */
			}
			frida.webBridge.dispose();
			frida = undefined;
			fridaPromise = undefined;
		}
		resetQueue();
		try {
			frida = await createFridaSession({
				cwd: workspaceCwd(),
				agentDir: defaultAgentDir(),
				sessionDir: sessionDirPath,
				approvalLogPath,
				openPath: pathStr,
				getKeyFor: (id: string) => keyCaches[id],
				onUnauthorized: (id: string) => {
					delete keyCaches[id];
					void promptKey(id, "unauthorized");
				},
				onPendingApprovals: (reqs: ApprovalRequest[]) => {
					post({ type: "approvals", approvals: reqs });
				},
				onUiRequest: (reqs) => post({ type: "ui_requests", items: reqs }),
				onUiNotify: (message, level) =>
					post({ type: "ui_notify", message, level }),
				onWebCommit: (rootId, tree, placement) =>
					post({ type: "web_commit", rootId, tree, placement }),
				onGateStats: (s) => post({ type: "gate_stats", stats: s }),
				getMode: () => approvalMode,
				askUserQuestionEnabled: isAskUserQuestionEnabled,
				todoEnabled: isTodoEnabled,
				contextEnabled: isContextEnabled,
				getGatePatterns: readGatePatterns,
				onLensDiagnostics: mergeLens,
				onProviderError,
				requestDumpPath,
			});
			wireSession(frida.session);
			// Sesión abierta por switch: el acumulador lens es stale → limpiar y ocultar.
			lensAccum.clear();
			lensAnyTruncated = false;
			flushLens();
			postHistory();
			sendModelInfo();
			postResources();
			postModels();
			postUsage(frida.session);
			void postWorkspace();
			postToolToggles();
		} catch (e: any) {
			post({
				type: "info",
				level: "error",
				text: "Error al abrir sesión: " + String(e?.message ?? e),
			});
		}
	}

	async function renameSession(pathStr: string, name: string): Promise<void> {
		const clean = name.trim();
		if (!pathStr || !clean) return;
		try {
			if (frida && frida.session?.sessionFile === pathStr) {
				frida.sessionManager?.appendSessionInfo?.(clean);
			} else {
				const sm = SessionManager.open(pathStr, sessionDirPath, workspaceCwd());
				sm.appendSessionInfo(clean);
			}
			post({ type: "info", text: "Sesión renombrada: " + clean });
			await sendSessions();
			void postWorkspace();
		} catch (e: any) {
			post({
				type: "info",
				level: "error",
				text: "Error al renombrar: " + String(e?.message ?? e),
			});
		}
	}

	// Elimina una sesión borrando su archivo JSONL. SessionManager no expone
	// delete, pero no hace falta: listAll lee los archivos del disco cada vez.
	// La sesión activa se bloquea para no romper el agente en curso.
	async function deleteSession(pathStr: string): Promise<void> {
		if (!pathStr) return;
		if (frida && frida.session?.sessionFile === pathStr) {
			post({ type: "info", text: "No puedes eliminar la sesión activa." });
			return;
		}
		try {
			await fs.unlink(pathStr);
			post({ type: "info", text: "Sesión eliminada." });
			await sendSessions();
		} catch (e: any) {
			post({
				type: "info",
				level: "error",
				text: "Error al eliminar: " + String(e?.message ?? e),
			});
		}
	}

	function postHistory(): void {
		try {
			const msgs: any[] = frida?.session?.agent?.state?.messages ?? [];
			const items: any[] = [];
			const branchSummaries: { summary: string }[] = [];
			const pendingTools = new Map<string, any>(); // toolCallId → segment tool
			for (const m of msgs) {
				const role = String(m?.role ?? "");
				const content = m?.content;
				const parts: any[] = Array.isArray(content)
					? content
					: typeof content === "string"
						? [{ type: "text", text: content }]
						: [];
				if (role === "user") {
					items.push({ role: "user", text: extractText(m) });
				} else if (role === "assistant") {
					const segs: any[] = [];
					for (const p of parts) {
						if (p?.type === "text" && p.text)
							segs.push({ kind: "text", text: String(p.text) });
						else if (p?.type === "thinking" && p.thinking)
							segs.push({ kind: "thinking", text: String(p.thinking) });
						else if (p?.type === "toolCall") {
							const seg: any = {
								kind: "tool",
								tool: String(p.name ?? ""),
								args: compactArgs(enrichTodoArgs(p.arguments)),
								state: "running",
							};
							segs.push(seg);
							if (p.id) pendingTools.set(String(p.id), seg);
						}
					}
					if (segs.length > 0)
						items.push({ role: "assistant", segments: segs });
				} else if (role === "toolResult") {
					// ToolResultMessage (pi-ai): role "toolResult" con toolCallId/isError/content
					// a nivel de MENSAJE (no como content part). Empareja con su toolCall pendiente.
					// (Antes se checaba role==="tool" + part type==="toolResult" → nunca matcheaba
					// → los tools cargados quedaban en state "running" para siempre.)
					const tcId = String(m?.toolCallId ?? "");
					const seg = tcId ? pendingTools.get(tcId) : null;
					if (seg) {
						seg.state = m?.isError ? "error" : "ok";
						seg.result = summarizeToolResultContent(m?.content);
						if (typeof m?.details?.diff === "string") seg.diff = m.details.diff;
						pendingTools.delete(tcId);
					}
				} else if (role === "branchSummary") {
					branchSummaries.push({ summary: String(m?.summary ?? "") });
				}
			}
			const name = frida?.sessionManager?.getSessionName?.();
			post({
				type: "history",
				name,
				items: items.slice(-200),
				branchSummaries,
			});
		} catch {
			/* noop */
		}
	}

	async function setKey(providerId: string, key: string): Promise<void> {
		const trimmed = key.trim();
		if (!trimmed) return;
		const def = getApiKeyProvider(providerId);
		if (!def) return; // provider desconocido: no-op
		await context.secrets.store(def.secretKey, trimmed);
		keyCaches[providerId] = trimmed;
		if (frida) {
			await frida.setKey(providerId, trimmed); // setRuntimeApiKey en el runtime
			// z.ai: explorar modelos tras autenticar. Si el fetch falla, se queda con
			// los defaults (best-effort). Refresca el selector del webview.
			if (providerId === ZAI_PROVIDER) {
				void frida.discoverModels(providerId).finally(postModels);
			}
			postResources();
		} else {
			bootstrapSession(); // crea sesión y publica recursos al terminar el onboarding
		}
		post({ type: "key_set" });
		post({ type: "session_ready" });
	}

	async function promptKey(
		providerId: string,
		reason: "initial" | "manual" | "unauthorized" = "initial",
	): Promise<void> {
		const def = getApiKeyProvider(providerId);
		const display = def?.displayName ?? providerId;
		const authLabel =
			def?.authMode === "x-api-key" ? "X-Api-Key" : "Authorization: Bearer";
		const messages = {
			initial: `Introduce tu API key de ${display} (se envía como ${authLabel}).`,
			manual: `Actualiza tu API key de ${display} (se envía como ${authLabel}).`,
			unauthorized: `Tu API key de ${display} fue rechazada o venció. Vuelve a introducirla.`,
		};
		const key = await vscode.window.showInputBox({
			prompt: messages[reason],
			password: true,
			ignoreFocusOut: true,
		});
		if (key) {
			await setKey(providerId, key);
		} else {
			post({ type: "need_key" });
		}
	}

	/** QuickPick del proveedor de API-key (DevEngine / z.ai) → luego pide la key.
	 *  Para el comando `frida.setKey` cuando hay más de un proveedor. */
	async function pickApiKeyProvider(): Promise<void> {
		if (API_KEY_PROVIDERS.length === 1) {
			void promptKey(API_KEY_PROVIDERS[0].id, "manual");
			return;
		}
		const pick = await vscode.window.showQuickPick(
			API_KEY_PROVIDERS.map((p) => ({
				label: p.displayName,
				description: p.id,
				id: p.id,
			})),
			{
				placeHolder: "Selecciona el proveedor cuya API key quieres actualizar",
			},
		);
		if (pick) void promptKey(pick.id, "manual");
	}

	/** Explora modelos del proveedor (GET {baseUrl}/models) y re-registra el
	 *  ProviderConfig con los descubiertos (ADR-0017). Refresca el selector. */
	async function discoverModels(providerId: string): Promise<void> {
		if (!frida) return;
		try {
			await frida.discoverModels(providerId);
			postModels();
		} catch (e: any) {
			post({
				type: "info",
				text: `No se pudieron explorar los modelos: ${e?.message ?? e}`,
			});
		}
	}

	// Diagnóstico del gateway DevEngine: prueba los endpoints de descubrimiento
	// (/models, /v1/models, /models/{id}) con la key en memoria y vuelca el resultado
	// a un canal de salida — sin exponer la key. Útil para verificar qué expone el
	// router (modelos, context_window) y depurar 500s. Ver fix-frida-gateway.md.
	const diagChannel = vscode.window.createOutputChannel("Frida DevEngine");
	async function diagnoseGateway(): Promise<void> {
		const key = keyCaches[SOFTTEK_PROVIDER];
		diagChannel.clear();
		diagChannel.show(true);
		diagChannel.appendLine(
			"=== Diagnóstico del gateway DevEngine (compat OpenAI/OpenRouter) ===",
		);
		diagChannel.appendLine(`Base URL: ${DEVENGINE_BASE_URL}`);
		if (!key) {
			diagChannel.appendLine(
				"No hay API key configurada (usa 'Frida: Actualizar API key').",
			);
			return;
		}
		diagChannel.appendLine(
			`API key: presente (longitud ${key.length}, no se imprime)`,
		);

		// Probes para verificar compatibilidad OpenAI/OpenRouter.
		type Probe = {
			label: string;
			method: "GET" | "POST";
			path: string;
			body?: unknown;
			expectFields?: string[]; // campos esperados en la respuesta (check ✅/❌)
		};
		const probes: Probe[] = [
			{
				label: "Listar modelos",
				method: "GET",
				path: "/models",
				expectFields: ["context_length", "context_window"],
			},
			{
				label: "Detalle por alias (gpt-5.4-mini)",
				method: "GET",
				path: "/models/gpt-5.4-mini",
			},
			{
				label: "Detalle por id (azure-chat-default)",
				method: "GET",
				path: "/models/azure-chat-default",
			},
			{ label: "Info de la key (cuota)", method: "GET", path: "/key" },
			{ label: "Créditos (OpenRouter)", method: "GET", path: "/credits" },
			{
				label: "Chat (ping, consume ~1 token)",
				method: "POST",
				path: "/chat/completions",
				body: {
					model: "gpt-5.4-mini",
					messages: [{ role: "user", content: "ping" }],
					max_tokens: 1,
					stream: false,
				},
			},
			{
				label: "Embeddings (ping)",
				method: "POST",
				path: "/embeddings",
				body: { model: "azure-embeddings-default", input: "ping" },
			},
		];

		const summary: string[] = [];
		for (const p of probes) {
			diagChannel.appendLine("");
			diagChannel.appendLine(`--- ${p.method} ${p.path}  (${p.label}) ---`);
			try {
				const ctrl = new AbortController();
				const timer = setTimeout(() => ctrl.abort(), 15000);
				const headers: Record<string, string> = { "X-Api-Key": key };
				if (p.method === "POST") headers["Content-Type"] = "application/json";
				const init: RequestInit = {
					method: p.method,
					headers,
					signal: ctrl.signal,
				};
				if (p.body !== undefined) init.body = JSON.stringify(p.body);
				const r = await fetch(`${DEVENGINE_BASE_URL}${p.path}`, init);
				clearTimeout(timer);
				const body = await r.text();
				diagChannel.appendLine(
					`HTTP ${r.status}  (${r.headers.get("content-type") ?? "?"})`,
				);
				diagChannel.appendLine(body.slice(0, 2000));
				let check = "";
				if (p.expectFields && body) {
					try {
						const j = JSON.parse(body);
						const arr: unknown[] = Array.isArray((j as any)?.data)
							? (j as any).data
							: [j];
						const hit = arr.some((m: any) =>
							p.expectFields!.some((f) => m && typeof m === "object" && f in m),
						);
						check = hit
							? `  ✅ incluye ${p.expectFields.join("/")}`
							: `  ❌ falta ${p.expectFields.join("/")}`;
					} catch {
						check = `  ❌ (respuesta no JSON; no se pudo verificar ${p.expectFields.join("/")})`;
					}
				}
				summary.push(
					`${r.status === 200 ? "✅" : "❌"} ${p.method} ${p.path} → ${r.status}${check}`,
				);
			} catch (e: any) {
				diagChannel.appendLine(`ERROR: ${String(e?.message ?? e)}`);
				summary.push(
					`❌ ${p.method} ${p.path} → ERROR (${String(e?.message ?? e)})`,
				);
			}
		}
		diagChannel.appendLine("");
		diagChannel.appendLine(
			"=== RESUMEN DE COMPATIBILIDAD (objetivo: OpenAI/OpenRouter) ===",
		);
		for (const s of summary) diagChannel.appendLine(s);
		diagChannel.appendLine("");
		diagChannel.appendLine(
			"Para 100% compat faltaría: /models con context_length, /models/{id} con aliases,",
		);
		diagChannel.appendLine(
			"manejo de overflow como 400 (no 500), y aceptar content:null + reasoning_content.",
		);
		diagChannel.appendLine("Ver fix-frida-gateway.md.");
	}

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(
			"frida.codeView",
			{ resolveWebviewView: resolveFridaView },
			{ webviewOptions: { retainContextWhenHidden: true } },
		),
		vscode.commands.registerCommand("frida.openPanel", () => {
			// Enfoca la vista lateral (frida.codeView.focus es auto-generado por VS Code
			// para la vista contribuida). Si la cerraron, se vuelve a resolver.
			vscode.commands.executeCommand("frida.codeView.focus");
		}),
		vscode.commands.registerCommand("frida.openHelp", async () => {
			// /help desde la paleta: picker de README + herramientas.
			type HelpItem = vscode.QuickPickItem & { rel?: string };
			const items: HelpItem[] = [
				{ label: "Frida Code — Índice general (README)", rel: "README.md" },
				...HELP_TOOLS.map((t) => ({
					label: t.label,
					description: "herramienta",
					rel: t.file,
				})),
			];
			const pick = await vscode.window.showQuickPick(items, {
				placeHolder: "Abrir ayuda de…",
			});
			if (pick?.rel) await openHelpDoc(pick.rel);
		}),
		vscode.commands.registerCommand(
			"frida.diagnoseGateway",
			() => void diagnoseGateway(),
		),
		vscode.commands.registerCommand(
			"frida.setKey",
			() => void pickApiKeyProvider(),
		),
		vscode.commands.registerCommand(
			"frida.compact",
			() => void compactContext(),
		),
		vscode.commands.registerCommand(
			"frida.reload",
			() => void reloadResources(),
		),
		vscode.commands.registerCommand("frida.abort", () => void abortRun()),
		vscode.commands.registerCommand(
			"frida.newSession",
			() => void newSession(),
		),
		vscode.commands.registerCommand("frida.approvalMode", () => {
			approvalMode =
				approvalMode === "manual"
					? "auto-edit"
					: approvalMode === "auto-edit"
						? "auto"
						: "manual";
			post({ type: "mode", mode: approvalMode });
		}),
		vscode.commands.registerCommand("frida.demoWebReact", async () => {
			// Demo Remote React (opción A): monta un contador interactivo en el host,
			// lo serializa al webview y re-renderiza ante cada click. Valida el ciclo
			// completo commit↔event↔re-render.
			try {
				const s = await ensureSession();
				const result = await s.webBridge.render<number>((done) =>
					createWebDemoElement(done),
				);
				post({
					type: "info",
					text: `Demo Remote React: resultado final ${result}`,
				});
			} catch (e) {
				console.error("[frida-web] demoWebReact ERROR:", e);
				post({
					type: "error",
					text: `Demo Remote React falló: ${e instanceof Error ? e.message : String(e)}`,
				});
			}
		}),
		vscode.commands.registerCommand("frida.demoWebPersistent", async () => {
			// Demo Remote React PERSISTENTE (Fase A, ADR-0014): valida montaje
			// no-bloqueante + re-render ante un STORE EXTERNO (timer 2s + botón).
			// A diferencia de demoWebReact, no bloquea ni devuelve resultado: el panel
			// vive hasta que el usuario hace clic en "Detener demo" o se recarga la
			// ventana. Patrón exacto del tool `todo` (store reactivo + panel).
			try {
				const s = await ensureSession();
				let handle!: { unmount: () => void };
				handle = s.webBridge.mountPersistent(() =>
					createPersistentDemoElement(() => handle.unmount()),
				);
			} catch (e) {
				console.error("[frida-web] demoWebPersistent ERROR:", e);
				post({
					type: "error",
					text: `Demo Persistente falló: ${e instanceof Error ? e.message : String(e)}`,
				});
			}
		}),
		vscode.commands.registerCommand("frida.diagnoseThinking", async () => {
			// Diagnóstico del thinking del proveedor (ADR-0009): envía un mensaje de
			// prueba que debe elicitar razonamiento y mide si el gateway devuelve
			// reasoning (thinking_delta en el stream + usage.reasoning). Reporta ✅/❌.
			// Útil para confirmar cuándo el proveedor corrige el round-trip de
			// reasoning_content: al correr esta demo se verá ✅.
			try {
				const s = await ensureSession();
				const anyAuthed = SUPPORTED_PROVIDERS.some((id) =>
					isProviderAuthed(s.modelRuntime, id),
				);
				if (!anyAuthed) {
					post({ type: "need_key" });
					return;
				}
				post({
					type: "notice",
					text: "🧪 Diagnosticando thinking: envío un mensaje de prueba al proveedor y mido si devuelve razonamiento…",
				});
				let thinkingDeltas = 0;
				let settled = false;
				const cleanup = s.session.subscribe((event: any) => {
					if (
						event?.type === "message_update" &&
						event.assistantMessageEvent?.type === "thinking_delta"
					) {
						thinkingDeltas++;
					}
					if (event?.type === "agent_end" && !settled) {
						settled = true;
						queueMicrotask(() => cleanup());
						if (event.errorMessage) {
							post({
								type: "notice",
								text: `⚠️ El mensaje de prueba falló (${event.errorMessage}); no se pudo medir el razonamiento.`,
							});
							return;
						}
						const msgs: any[] = s.session?.agent?.state?.messages ?? [];
						const last = [...msgs]
							.reverse()
							.find((m: any) => m?.role === "assistant");
						const reasoning = last?.usage?.reasoning;
						const ok =
							thinkingDeltas > 0 ||
							(typeof reasoning === "number" && reasoning > 0);
						post({
							type: "notice",
							text: ok
								? `✅ El proveedor SÍ devuelve razonamiento (thinking_deltas=${thinkingDeltas}, usage.reasoning=${reasoning ?? "n/a"}). El botón "ver razonamiento" debería mostrarlo.`
								: `❌ El proveedor NO devuelve razonamiento (thinking_deltas=${thinkingDeltas}, usage.reasoning=${reasoning ?? "n/a"}). No es un bug de Frida: el gateway/modelo no genera reasoning_content.`,
						});
					}
				});
				// Mensaje de prueba (aparece en la conversación): fuerza razonamiento.
				await runPrompt(
					"Razona paso a paso mostrando tu razonamiento, y responde al final: ¿cuánto es 17 × 3?",
					"steer",
				);
			} catch (e) {
				post({
					type: "provider_error",
					text: `Diagnóstico de thinking falló: ${e instanceof Error ? e.message : String(e)}`,
				});
			}
		}),
		vscode.commands.registerCommand("frida.demoWebQuestionnaire", async () => {
			// Demo del ask_user_question sobre Remote React: monta el WebQuestionnaire con
			// datos de prueba, sin depender del modelo ni del gateway (útil para validar la
			// UI rica: tabs, opciones, texto libre, multiSelect).
			const sample = [
				{
					question: "¿Qué layout de UI prefieres?",
					header: "Layout",
					options: [
						{
							label: "Lista vertical",
							description: "Opciones apiladas, simple",
							preview: "# Lista vertical\n\n```\n[ A ]\n[ B ]\n[ C ]\n```",
						},
						{
							label: "Grid 2 columnas",
							description: "Más denso, usa el ancho",
							preview: "# Grid\n\n```\n[ A ] [ B ]\n[ C ] [ D ]\n```",
						},
						{
							label: "Tarjetas",
							description: "Cada opción como card",
							preview:
								"# Tarjetas\n\n```\n┌───┐ ┌───┐\n│ A │ │ B │\n└───┘ └───┘\n```",
						},
					],
				},
				{
					question: "¿Qué características activas?",
					header: "Features",
					multiSelect: true,
					options: [
						{ label: "Auth", description: "Login/OAuth" },
						{ label: "WebSockets", description: "Tiempo real" },
						{ label: "Cache Redis", description: "Cache de respuestas" },
					],
				},
			];
			try {
				const s = await ensureSession();
				const result = await s.webBridge.render<{
					answers: unknown[];
					cancelled: boolean;
				}>((done) => createWebQuestionnaireElement(sample, done));
				post({
					type: "info",
					text: `WebQuestionnaire: ${JSON.stringify(result)}`,
				});
			} catch (e) {
				console.error("[frida-web] demoWebQuestionnaire ERROR:", e);
				post({
					type: "error",
					text: `Demo WebQuestionnaire falló: ${e instanceof Error ? e.message : String(e)}`,
				});
			}
		}),
	);
}

function extractText(m: any): string {
	const c = m?.content;
	if (typeof c === "string") return c;
	if (Array.isArray(c))
		return c
			.filter((b: any) => b?.type === "text")
			.map((b: any) => b?.text ?? "")
			.join("");
	return "";
}

// Compacta los args de un tool a un objeto legible, truncando strings largos
// (content/oldText/newText…) para no inflar el postMessage. El webview usa
// solo los campos clave (path, command, pattern, edits.length) para la cabecera.
/** Enriquece los args del tool `todo` con el subject resuelto del store, para que
 *  el ToolCard del webview muestre `→ #id Subject` (paridad renderTodoCall de
 *  rpiv-todo). El store del todo vive en el host; el webview no tiene acceso. */
function enrichTodoArgs(args: unknown): unknown {
	if (args == null || typeof args !== "object") return args;
	const a = args as Record<string, unknown>;
	const action = String(a.action ?? "");
	const id = a.id;
	if (
		(action === "update" || action === "get" || action === "delete") &&
		id != null
	) {
		const subject = getTodoState().tasks.find(
			(t) => t.id === Number(id),
		)?.subject;
		if (subject) return { ...a, _subject: subject };
	}
	return args;
}

function compactArgs(args: unknown): unknown {
	if (args == null || typeof args !== "object") return args;
	try {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(args as Record<string, unknown>)) {
			if (typeof v === "string") {
				out[k] = v.length > 120 ? v.slice(0, 120) + "…" : v;
			} else if (Array.isArray(v)) {
				out[k] = v.map((item) =>
					item && typeof item === "object" ? compactArgs(item) : item,
				);
			} else if (v && typeof v === "object") {
				out[k] = compactArgs(v);
			} else {
				out[k] = v;
			}
		}
		return out;
	} catch {
		return args;
	}
}

// Extrae el texto del resultado de un tool (result.content = bloques text/image)
// y lo trunca para mostrarlo en el cuerpo plegable de la tarjeta.
function summarizeResult(result: any): string {
	if (!result) return "";
	try {
		let text = "";
		const content = result.content;
		if (Array.isArray(content)) {
			text = content
				.filter((b: any) => b?.type === "text")
				.map((b: any) => String(b?.text ?? ""))
				.join("");
		} else if (typeof result === "string") {
			text = result;
		} else if (typeof result.details === "string") {
			text = result.details;
		}
		// Límite alto: el webview hace scroll en vez de cortar a mitad línea.
		return text.length > 100000 ? text.slice(0, 100000) : text;
	} catch {
		return "";
	}
}

// Texto del contenido de un toolResult (mensaje role "tool") para el historial.
function summarizeToolResultContent(content: any): string {
	if (!content) return "";
	if (typeof content === "string") return content.slice(0, 100000);
	if (Array.isArray(content)) {
		const text = content
			.filter((b: any) => b?.type === "text")
			.map((b: any) => String(b?.text ?? ""))
			.join("");
		return text.slice(0, 100000);
	}
	return "";
}

export function deactivate(): void {
	/* sin cleanup especial por ahora */
}
