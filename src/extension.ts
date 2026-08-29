import { createPendingQueueStore } from "./queue/pending-queue";
import { agentEndFallbackText } from "./agent-end-fallback";
import { ABORT_GATE_TTL_MS, createAbortGate } from "./abort-gate";
import { abortRun as abortRunWithDeps } from "./abort-run";
import path from "node:path";
import * as fs from "node:fs/promises";
import { realpathSync } from "node:fs";
import {
	appendFileSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as vscode from "vscode";
import { registerBunOAuthFlows } from "@earendil-works/pi-ai/bun-oauth";
import {
	createAgentSession,
	DefaultResourceLoader,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import {
	createFridaSession,
	defaultAgentDir,
	type FridaSession,
} from "./pi-session";
import { runGenerateCommitMessage } from "./commit-message";
import { runWorktreeCommand } from "./worktree";
import type { ApprovalRequest } from "./approval-bridge";
import { ModelChangeBridge } from "./model-change-bridge";
import type { PermissionMode } from "./tools/frida-permission-system";
import type { PermissionState } from "./tools/frida-permission-system/types";
import { readAuditLog } from "./tools/frida-permission-system/audit-log";
import { createAuditPanelElement } from "./tools/frida-permission-system/AuditPanel";
import {
	getConfig,
	removeBashPattern,
	removePathPattern,
	resetConfig,
	saveConfig,
	setAuditLog,
	setBashPattern,
	setExternalDirectory,
	setMode as setStoredMode,
	setPathPattern,
	setTool,
} from "./tools/frida-permission-system/config-store";
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
import {
	createFridaEnterpriseHooks,
	FRIDA_ENTERPRISE_PROVIDER,
	FRIDA_ENTERPRISE_PROVIDER_DISPLAY,
} from "./providers/frida-enterprise";
import {
	ANTIGRAVITY_PROVIDER,
	ANTIGRAVITY_PROVIDER_DISPLAY,
} from "./providers/frida-antigravity";
import { createVscodePresenter as createCcPluginsPresenter } from "./tools/frida-cc-plugins/presenter";
import {
	createForensicAppender,
	forensicLine,
	forensicLogPath,
	formatModelRef,
	type ForensicAppender,
} from "./tools/frida-forensics";
import {
	MOONSHOT_PROVIDER,
	MOONSHOT_PROVIDER_DISPLAY,
} from "./providers/moonshot-provider";
import {
	OPENAI_PROVIDER,
	OPENAI_PROVIDER_DISPLAY,
} from "./providers/openai-provider";
import { getWebviewHtml } from "./webview-html";
import { analyzeContext } from "./tools/frida-context/analysis";
import { readSessionStats } from "./session-stats";
import { indexUsage } from "./usage/indexer";
import { buildReport } from "./usage/report-builder";
import { resolveIdentity } from "./usage/identity";
import { createContextReportElement } from "./tools/frida-context/ContextReport";
import {
	getCachedActiveTools,
	getCachedAllTools,
	getCachedPromptOptions,
	getCachedSystemPrompt,
} from "./tools/frida-context/store";
import { getTodoState } from "./tools/todo-web/store";
import { expandAskPrompt } from "./tools/ask-user-question-web";
import {
	createFridaWorkflowHost,
	handleWfSlash,
	validateWorkflow,
} from "./tools/frida-workflow";
import type {
	LoadedWorkflows,
	Workflow,
	WorkflowOrigin,
} from "./tools/frida-workflow";
import { wireWorkflowPanel } from "./tools/frida-workflow/panel";
import { wireExtensibleWorkflowPanel } from "./tools/frida-extensible-workflows/panel";
import {
	findBuiltinPattern,
	builtinPatternsCatalog,
} from "./tools/frida-extensible-workflows/builtin-patterns";
import {
	getWorkflowRuns,
	requestPanelShow,
	subscribeWorkflowRuns,
} from "./tools/frida-extensible-workflows/store";
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
import {
	listAgents,
	getAvailableTypes,
	setAgentWidgetListener,
	pruneAllWorktrees,
} from "./tools/frida-subagents";
import { expandSkillText } from "./tools/frida-args";
import {
	expandMultiSkillText,
	type ExpandMultiSkillResult,
} from "./tools/frida-multi-skills";
import { createSkillsPanelElement } from "./tools/frida-multi-skills/SkillsPanel";
import {
	wireAgentWidget,
	unmountAgentWidget,
} from "./tools/frida-subagents/panel";
import {
	buildDetachedPanel,
	type DetachedPanelData,
} from "./tools/frida-subagents/detached-panel";
import { stopDetachedRun } from "./tools/frida-subagents/detached-runner";
import { wireGitSyncWidget } from "./tools/frida-git-sync";
import { loadSettings, formatSettings } from "./tools/frida-subagents/settings";
import {
	ensureInstalled,
	installedVersion,
	isInstalledAtPin,
} from "./tools/frida-codebase-index/installer";
import { loadUpstreamTools } from "./tools/frida-codebase-index/shim";
import { upstreamEntryPath } from "./tools/frida-codebase-index/constants";
import {
	parseAutoIndexProgress,
	type IndexProgress,
} from "./tools/frida-codebase-index/progress";
import {
	readIndexedFiles,
	readIndexMeta,
	readLastIndexedFile,
} from "./tools/frida-codebase-index/files";
import type { IndexMeta } from "./tools/frida-codebase-index/files";
import { pingEmbeddingsProvider } from "./tools/frida-codebase-index/ping";
import {
	readAutoIndexEnabled,
	readEnterpriseEmbeddingsCredential,
	syncCodebaseIndexConfig,
	setAutoIndexEnabled,
} from "./tools/frida-codebase-index/host-setup";
import { readModelRolesConfig } from "./settings";
import {
	OLLAMA_PROVIDER_DISPLAY,
	filterVisibleChatProviders,
} from "./providers/frida-ollama-local/catalog";
import { OLLAMA_CLOUD_DISPLAY } from "./providers/frida-ollama-cloud/catalog";
import { checkEnvironment } from "./environment/doctor";
import { createWebDemoElement } from "./demo/web-demo";
import { createPersistentDemoElement } from "./demo/persistent-demo";
import { notifyCompletion } from "./notify";
import { notifyAttention } from "./notify";
import {
	isAskUserQuestionEnabled,
	isCodebaseIndexEnabled,
	isContextEnabled,
	isHermesMemoryEnabled,
	isKnowledgeBaseEnabled,
	isCcPluginsEnabled,
	readCcPluginsExtraMarketplaces,
	isSandboxesEnabled,
	readSandboxesDefaultImage,
	readSandboxesAllowDomains,
	isSubagentsEnabled,
	isAgentBrowserEnabled,
	isSupiWebEnabled,
	isMcpAdapterEnabled,
	isExtensibleWorkflowsEnabled,
	isGitSyncEnabled,
	isWorktreeEnabled,
	readCcPluginsEnabledPlugins,
	isTelemetryOptIn,
	isTodoEnabled,
	readCodebaseIndexConfig,
	readGatePatterns,
	readToolToggles,
	setTelemetryOptIn,
	writeToolToggle,
} from "./settings";
import {
	TOOL_TOGGLES,
	TOOL_TOGGLE_BASES,
	TOOL_TOGGLE_KEY_BY_FACTORY,
} from "./tool-toggles";
import {
	attributeResources,
	resolveSkillSource,
	type AttribSkill,
} from "./module-attribution";
import { loadRegistry } from "./tools/frida-cc-plugins/registry";
import {
	classifySeverity,
	type LensDiagnosticsPayload,
} from "./lens-diagnostics-bridge";
import {
	loadFunctionalMap,
	readScreenshotDataUri,
	safeResolveWithin,
	type ProjectMapHostState,
} from "./project-map/functional-inventory";
// ══ Fase 3: mapa Técnico (pi-lens) — seam lens-engine.js ══
import {
	loadTechnicalMap,
	TECH_POLL_DELAYS_MS,
} from "./project-map/lens-project-report";
// ══ Fase 4: cruce técnico↔funcional (matriz M9) ══
import { loadCrossMap } from "./project-map/matrix-cross";

const execFileP = promisify(execFile);

const ACTIVE_MODEL_KEY = "frida.activeModel";
// ADR-0017: secret por proveedor (itera el registry de API-key providers). El id
// de Copilot se añade por separado (OAuth, sin secret propio).
const SUPPORTED_PROVIDERS = [
	...API_KEY_PROVIDER_IDS,
	FRIDA_ENTERPRISE_PROVIDER,
	"github-copilot",
	ANTIGRAVITY_PROVIDER,
	"ollama", // #123 — daemon local; modelos descubiertos al crear sesión
];

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
		files = wsRel
			? all
					.filter((f) => f.startsWith(wsRel + "/"))
					.map((f) => f.slice(wsRel.length + 1))
			: all;
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
		.filter((e) => !e.name.startsWith(".") && !SEARCH_HIDDEN_EXCLUDE.has(e.name))
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
			out = out.slice(0, mt.index) + block + out.slice(mt.index + mt.full.length);
		} catch {
			/* no existe / no legible → se deja el token tal cual */
		}
	}
	return out;
}

// --- Parseo de `git status --porcelain -b` (rama + sync + diff en 1 llamada) ---

/** Cuenta archivos added/modified/deleted a partir de las líneas porcelain (XY path). */
function parseGitDiff(porcelain: string): {
	added: number;
	modified: number;
	deleted: number;
} {
	let added = 0;
	let modified = 0;
	let deleted = 0;
	for (const raw of porcelain.split("\n")) {
		if (!raw) continue; // línea vacía (trailing newline)
		const x = raw[0];
		const y = raw[1];
		if (x === "?" && y === "?")
			added++; // sin seguimiento → nuevo
		else if (x === "!" && y === "!")
			continue; // ignorado
		else if (x === "D" || y === "D")
			deleted++; // eliminado
		else if (x === "A" || y === "A")
			added++; // agregado
		else modified++; // M/R/C/T/U-conflict → modificado
	}
	return { added, modified, deleted };
}

/** Parsea la 1ª línea de `git status -b`: `## branch...up [ahead N, behind M]`. */
function parseStatusHead(line: string): {
	branch?: string;
	ahead?: number;
	behind?: number;
} {
	if (!line.startsWith("## ")) return {};
	const rest = line.slice(3);
	if (rest.startsWith("HEAD ")) return {}; // detaché: "## HEAD (no branch)"
	const fresh = rest.match(/^No commits yet on (.+)$/); // repo sin commits
	if (fresh) return { branch: fresh[1].trim() };
	const bracket = rest.indexOf(" [");
	const tracking = bracket >= 0 ? rest.slice(0, bracket) : rest;
	const branch = tracking.split("...")[0].trim();
	const out: { branch?: string; ahead?: number; behind?: number } = { branch };
	if (bracket >= 0) {
		const note = rest.slice(bracket + 2).replace(/\]\s*$/, "");
		const a = note.match(/ahead (\d+)/);
		const b = note.match(/behind (\d+)/);
		if (a) out.ahead = Number(a[1]);
		if (b) out.behind = Number(b[1]);
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
	// frida-supi-web: API key de Context7 en SecretStorage (patrón ADR-0017
	// aplicado a un servicio NO-LLM). Cache síncrono + fallback a env para sesiones
	// hijas/offline. Se gestiona con `/login context7` y `/logout context7`.
	const CONTEXT7_SECRET_KEY = "frida.context7Key";
	let context7KeyCache = (await context.secrets.get(CONTEXT7_SECRET_KEY)) ?? "";
	const getContext7Key = (): string | undefined =>
		context7KeyCache || process.env.CONTEXT7_API_KEY;
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
	// H-2/H-3: diagnóstico del último 500 opaco decodificado (re-probe stream:false).
	const diagnosticDumpPath = path.join(
		context.globalStorageUri.fsPath,
		"devengine-gateway-diagnosis.json",
	);
	// Estado de frida-codebase-index para el tab Index del webview (ADR-0036).
	// Se alimenta del onCodebaseIndexState de la sesión (factory del wrapper) y
	// de las acciones del host (install/index/rebuild/status).
	let ciUi: import("./tools/frida-codebase-index").CodebaseIndexState = {
		installed: false,
		capturedTools: [],
	};
	let ciBusy: "install" | "index" | null = null;
	let ciLastLine: string | undefined;
	// #109 — progreso en vivo de la indexación (sondeo de index_status cada 2s
	// mientras index/rebuild corren en este mismo proceso → mismo coordinador).
	let ciProgress: IndexProgress | null = null;
	// #118 — último archivo confirmado durante la indexación (línea en vivo).
	let ciLastFile: string | null = null;
	// #120 — indexación automática del proyecto (indexing.autoIndex).
	// (let: se recarga en webview_ready y se asigna en el toggle del tab.)
	let ciAutoIndex = readAutoIndexEnabled(workspaceCwd());
	// #111 — epoch ms del inicio de la acción: el reloj del tab deriva de aquí
	// y sobrevive cambios de pestaña (remount del componente).
	let ciBusySince: number | null = null;
	// #114 — metadata REAL de embeddings del índice (provider/modelo/dims).
	// Async (SQLite read-only): se cachea y se refresca al montar el webview
	// y al terminar index/rebuild/status. undefined = aún no consultado.
	let ciIndexMeta: IndexMeta | null | undefined;
	// #117 (Fase B) — ¿hay API key de OpenAI en el SecretStorage? Caché
	// async refrescada en webview_ready y tras guardar/borrar keys.
	let ciOpenAiAuthed: boolean | undefined;
	// Tab pendiente del comando frida.codebaseIndex: el post() inmediato se
	// pierde en arranque frío (el listener del webview monta en webview_ready).
	let pendingSettingsTab: string | undefined;
	// ¿El webview ya montó su listener (llegó webview_ready)? Distingue apertura
	// en caliente (post directo confiable) de arranque frío (flush diferido).
	let webviewReady = false;
	// M2 (#143) — estado del tab "Mapa del proyecto" (lib src/project-map/*).
	// La verdad vive en el host (#111): busySince sobrevive re-montes del tab;
	// la vista activa NO vive aquí (estado local del componente).
	let pmState: ProjectMapHostState = {};
	// M2 (#143) — epoch del re-poll técnico: invalida corridas previas (Recargar
	// o cambio de límite mata el loop en su siguiente checkpoint sin tocar
	// estado — sin timers huérfanos: el setTimeout pendiente (≤10 s) resuelve y
	// el guard de epoch sale sin mutar).
	let pmTechEpoch = 0;

	function postCodebaseIndexState(): void {
		const cfg = readCodebaseIndexConfig();
		post({
			type: "codebase_index_state",
			state: {
				...ciUi,
				version: ciUi.installed ? installedVersion(defaultAgentDir()) : undefined,
				busy: ciBusy,
				busySince: ciBusySince,
				lastLine: ciLastLine,
				progress: ciProgress,
				lastFile: ciLastFile,
				autoIndex: ciAutoIndex,
				indexMeta: ciIndexMeta ?? undefined,
				config: {
					provider: cfg.provider,
					// Fase B (#117): señales de autenticación para los semáforos de
					// las tarjetas de proveedor (enterprise lee auth.json; openai
					// lee el SecretStorage de forma síncrona-cached — best-effort).
					enterpriseAuthed: (() => {
						const c = readEnterpriseEmbeddingsCredential(defaultAgentDir());
						return !!c && !c.expired;
					})(),
					fridaEnterpriseModel: cfg.fridaEnterpriseModel,
					ollamaModel: cfg.ollamaModel,
					openaiModel: cfg.openaiModel,
					openaiAuthed: ciOpenAiAuthed,
					customBaseUrl: cfg.customBaseUrl || undefined,
					customModel: cfg.customModel || undefined,
					customDimensions: cfg.customDimensions || undefined,
				},
			},
		});
	}

	// M2 (#143) — publica el estado del tab Mapa al webview (re-posteado en
	// webview_ready para re-montes fríos del tab).
	function postProjectMapState(): void {
		post({ type: "project_map_state", state: pmState });
	}

	// M2 (#143) — carga del mapa Técnico (pi-lens). Cache fría → re-poll con
	// backoff acotado (TECH_POLL_DELAYS_MS: 2s→5s→10s, 10 intentos ≈ 69 s de
	// sleeps); size-skip → paro inmediato (lo decide loadTechnicalMap devolviendo
	// empty/disabled — NO se re-polea: reintentar "shortly" sería guía
	// activamente errónea, project-report.js:512-515). #111: busySince vive aquí.
	// (Fase 4: la rama ready/empty añade refreshPmCross() — ver Changes de esa fase.)
	function startTechnicalLoad(limit: number): void {
		const epoch = ++pmTechEpoch;
		pmState = {
			...pmState,
			technical: { status: "loading" },
			busy: "technical",
			busySince: Date.now(),
		};
		postProjectMapState();
		void (async () => {
			try {
				for (let attempt = 0; ; attempt++) {
					if (epoch !== pmTechEpoch) return; // suplantada — no tocar estado
					const st = await loadTechnicalMap(
						workspaceCwd(),
						defaultAgentDir(),
						limit,
					);
					if (epoch !== pmTechEpoch) return;
					// Terminal todo lo que no sea building: ready/empty (y loading, que
					// loadTechnicalMap nunca emite pero la unión PmTechnicalState incluye —
					// sin esto el narrowing deja `loading|building` y st.hint no existe).
					if (st.status !== "building") {
						pmState = { ...pmState, technical: st, busy: null, busySince: null };
						refreshPmCross(); // ══ Fase 4: dirs disponibles → join técnico ══
						postProjectMapState();
						return;
					}
					if (attempt >= TECH_POLL_DELAYS_MS.length) {
						pmState = {
							...pmState,
							technical: { status: "empty", reason: "exhausted", hint: st.hint },
							busy: null,
							busySince: null,
						};
						postProjectMapState();
						return;
					}
					pmState = {
						...pmState,
						technical: { ...st, attempts: attempt + 1 },
					};
					postProjectMapState();
					await new Promise((r) => setTimeout(r, TECH_POLL_DELAYS_MS[attempt]));
				}
			} catch (e: any) {
				if (epoch !== pmTechEpoch) return;
				pmState = {
					...pmState,
					technical: {
						status: "empty",
						reason: "error",
						hint: String(e?.message ?? e),
					},
					busy: null,
					busySince: null,
				};
				postProjectMapState();
			}
		})();
	}

	// ══ Fase 4: cruce técnico↔funcional (matriz M9) ══
	// Se recalcula con los insumos disponibles en cada completion: pantallas
	// M8 al terminar la carga funcional, subsystems al terminar la técnica.
	// Lectura síncrona barata (un JSON) — sin busy propio; viaja en el
	// SIEMPRE-posteado project_map_state. Sin Técnica cargada el join por
	// directorio queda vacío y el cruce por pantalla funciona igual (FR-8
	// antes de abrir Técnica).
	function refreshPmCross(): void {
		const fn = pmState.functional;
		const tech = pmState.technical;
		pmState = {
			...pmState,
			cross: loadCrossMap(
				workspaceCwd(),
				fn?.status === "ready" ? fn.data.screens.map((s) => s.id) : [],
				tech?.status === "ready" ? tech.data.subsystems.directories : [],
			),
		};
	}

	/** #114 — Refresca la metadata de embeddings del índice (read-only) y la
	 *  publica. Best-effort: errores de lectura dejan la metadata anterior. */
	async function refreshCiIndexMeta(): Promise<void> {
		try {
			ciIndexMeta = await readIndexMeta(workspaceCwd());
		} catch {
			ciIndexMeta = null;
		}
		postCodebaseIndexState();
	}

	// frida-hermes-memory (#21): estado del wrapper. La instalación background
	// corre fire-and-forget desde la factory; cuando completa, el usuario debe
	// /reload (o reiniciar la sesión) para que la memoria se active — sin la
	// notificación el install queda invisible. Errores con warning visible:
	// sin memoria cross-session el producto degrada silenciosamente.
	let hermesMemoryWasInstalling = false;
	function handleHermesMemoryState(
		s: import("./tools/frida-hermes-memory").HermesMemoryState,
	): void {
		if (s.installing) {
			hermesMemoryWasInstalling = true;
			return;
		}
		if (s.installed && hermesMemoryWasInstalling) {
			hermesMemoryWasInstalling = false;
			void vscode.window.showInformationMessage(
				"Memoria del agente instalada (pi-hermes-memory). Ejecuta /reload o reinicia la sesión para activarla.",
			);
			return;
		}
		if (s.error) {
			hermesMemoryWasInstalling = false;
			void vscode.window.showWarningMessage(
				`frida-hermes-memory no se pudo activar: ${s.error}`,
			);
		}
	}

	// frida-knowledge-base (#29): estado del wrapper (mismo patrón que
	// hermes-memory): instalación background → notificar + sugerir /reload
	// (los /wiki-* se materializan en el agentDir y aparecen tras recargar).
	let knowledgeBaseWasInstalling = false;
	function handleKnowledgeBaseState(
		s: import("./tools/frida-knowledge-base").KnowledgeBaseState,
	): void {
		if (s.installing) {
			knowledgeBaseWasInstalling = true;
			return;
		}
		if (s.installed && knowledgeBaseWasInstalling) {
			knowledgeBaseWasInstalling = false;
			void vscode.window.showInformationMessage(
				"Base de conocimiento instalada (pi-llm-wiki). Ejecuta /reload o reinicia la sesión para activarla (/wiki-init para empezar).",
			);
			return;
		}
		if (s.error) {
			knowledgeBaseWasInstalling = false;
			void vscode.window.showWarningMessage(
				`frida-knowledge-base no se pudo activar: ${s.error}`,
			);
		}
	}

	// frida-cc-plugins (#49): estado leve — los errores de /ccplugin ya se
	// notifican por la UI de la sesión; aquí solo se registra disponibilidad.
	function handleCcPluginsState(
		s: import("./tools/frida-cc-plugins").CcPluginsState,
	): void {
		if (s.error) {
			void vscode.window.showWarningMessage(`frida-cc-plugins: ${s.error}`);
		}
		// Avisos del setup background (bootstrap auto/equipo/auto-update).
		if (s.notice) {
			void vscode.window.showInformationMessage(s.notice);
		}
	}

	// Dependencia blanda de la vista humana del KB (ADR-0040 D3, revisado):
	// VS Code NO auto-instala extensionDependencies en VSIX/Dev Host y
	// RECHAZA activar frida si falta una — bloqueo duro de activación.
	// Con dependencia blanda frida activa siempre; sin Foam la capa agente
	// del KB funciona igual y avisamos cómo instalar la vista de grafo.
	function checkKnowledgeBaseViewDeps(): void {
		const faltan: string[] = [];
		if (!vscode.extensions.getExtension("foam.foam-vscode")) {
			faltan.push("Foam (foam.foam-vscode) — grafo/backlinks del vault");
		}
		if (!vscode.extensions.getExtension("bierner.markdown-mermaid")) {
			faltan.push("bierner.markdown-mermaid — render de diagramas");
		}
		if (faltan.length === 0) return;
		void vscode.window
			.showInformationMessage(
				`frida-knowledge-base: falta${faltan.length > 1 ? "n" : ""} la vista humana: ${faltan.join(" · ")}. La KB del agente funciona igual; instálal${faltan.length > 1 ? "as" : "a"} para ver el grafo.`,
				"Instalar Foam",
			)
			.then((choice) => {
				if (choice === "Instalar Foam") {
					void vscode.commands.executeCommand("extension.open", "foam.foam-vscode");
				}
			});
	}

	/** Resume el resultado de un tool upstream (content[0].text, primeras líneas). */
	function ciSummarize(res: any): string {
		const t = res?.content?.[0]?.text;
		if (typeof t === "string") return t.split("\n").slice(0, 12).join("\n");
		return JSON.stringify(res).slice(0, 400);
	}
	// Modo vivo del gate. Se inicializa del permission.json persistido (#55): el
	// modo configurado en Configuración > Auto-aprobación sobrevive recargas.
	let approvalMode: PermissionMode = getConfig().mode;
	let frida: FridaSession | undefined;
	// Anti-race: si ensureSession() se llama concurrentemente (ej. webview_ready +
	// onboarding al arrancar), sin esto ambas ven `!frida` y crean sesiones
	// duplicadas — la perdedora se pierde sin dispose y su WebBridge vive publicando
	// roots al webview para siempre (paneles duplicados). Ver ADR-0014.
	let fridaPromise: Promise<FridaSession> | undefined;
	let activeModel: { provider: string; modelId: string } | undefined =
		context.globalState.get(ACTIVE_MODEL_KEY);
	// Puente de confirmación de cambio de proveedor/modelo (red de seguridad anti
	// cambio silencioso). El host llama request() y espera; el webview responde vía
	// model_change_response → resolve().
	let modelChangeBridge: ModelChangeBridge | undefined;
	// Message Queue (pi): mensajes encolados mientras el agente trabaja + contador
	// de turnos dentro del agent run actual (para saber cuándo se entrega uno).
	// Issue #45: store testeable (src/queue) — fuente de verdad de la UI del panel
	// de cola; sincroniza el SDK en remove/takeout/move. subscribe → postQueued.
	const queueStore = createPendingQueueStore(() => frida?.session as any);
	queueStore.subscribe(postQueued);
	let turnsInRun = 0;
	// Baseline de usage al iniciar el turno (agent_start) para calcular el delta
	// (input+output) que consumió el turno y repartirlo entre sus tarjetas (~llm).
	let turnUsageBaseline: { input: number; output: number } | undefined;

	let view: vscode.WebviewView | undefined;
	const fridaVersion = String(context.extension.packageJSON.version ?? "0.0.0");
	const post = (msg: unknown): void => {
		view?.webview.postMessage(msg);
	};

	// Canal de diagnóstico del flujo de Detener (botón / doble-Esc). Persistente
	// y filtrable: Command Palette → "Output: Show Output Channels" → "Frida Abort".
	// Registra ambos extremos: el webview reenvía vía {type:"abort_diag"} y el host
	// loguea abortRun() + el ciclo de vida del agente, todo en una sola línea de
	// tiempo para localizar dónde se rompe la cadena.
	const abortChannel = vscode.window.createOutputChannel("Frida Abort");
	// [frida-abort] Persistencia a archivo del mismo diagnóstico, para que el agente
	// (frida-code) pueda leer la traza con sus herramientas sin depender del panel
	// Output. Rotación por tamaño con un único backup (.1); tamaño máx. 1 MB.
	const abortLogPath = path.join(homedir(), ".frida", "logs", "abort.log");
	const abortLogMax = 1024 * 1024;
	let abortLogReady = false;
	let abortLogBytes = -1;
	// Tag de sesión (issue #2): TODAS las ventanas VS Code (y sus Frida) escriben al
	// mismo abort.log global. Sin tag, líneas de sesiones distintas se intercalan
	// y el diagnóstico confunde agent_start/abort de una ventana con la otra.
	// Tag = basename del workspace + sufijo corto estable por instancia de la extensión.
	const abortSessionTag = `${path
		.basename(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd())
		.slice(0, 24)}-${Math.random().toString(16).slice(2, 6)}`;

	// #85/#86: appender forense provider-audit.log (compartido con todos los caminos
	// de cambio de proveedor: BASELINE sesión, REQUEST per-call, HTTP errors, MANUAL
	// UI, AUTO-CHANGE divergencia). El tag es el mismo abortSessionTag (ventanas VS
	// Code concurrentes en el mismo log global).
	const providerAuditAppender = createForensicAppender({
		file: forensicLogPath("provider-audit.log"),
		maxBytes: 1024 * 1024,
	});
	// Storage forense: último error HTTP de provider (para AUTO-CHANGE causality).
	let lastProviderHttpError:
		| { status: number; atMs: number; message?: string }
		| undefined;
	function appendAbortLog(line: string): void {
		try {
			if (!abortLogReady) {
				mkdirSync(path.dirname(abortLogPath), { recursive: true });
				abortLogReady = true;
			}
			if (abortLogBytes < 0) {
				try {
					abortLogBytes = statSync(abortLogPath).size;
				} catch {
					abortLogBytes = 0;
				}
			}
			if (abortLogBytes >= abortLogMax) {
				try {
					copyFileSync(abortLogPath, `${abortLogPath}.1`);
				} catch {
					/* noop */
				}
				try {
					writeFileSync(abortLogPath, "");
				} catch {
					/* noop */
				}
				abortLogBytes = 0;
			}
			appendFileSync(abortLogPath, line + "\n");
			abortLogBytes += Buffer.byteLength(line) + 1;
		} catch {
			/* noop */
		}
	}
	function abortDiag(msg: string): void {
		const line = `[${new Date().toISOString()}] [${abortSessionTag}] ${msg}`;
		try {
			abortChannel.appendLine(line);
		} catch {
			/* noop */
		}
		appendAbortLog(line);
		console.log("[frida-abort]", msg);
	}

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
	// #90: gate de re-abort — session.abort() cae en el GAP entre runs del SDK
	// (tool→LLM) y resuelve como no-op; el siguiente run arranca libre. El gate
	// re-aborta ese run en agent_start hasta que haya settle real (isIdle=true).
	const abortGate = createAbortGate();
	let lensActive = false;
	// ¿Tiene el foco la ventana de VS Code? Se actualiza con
	// onDidChangeWindowState. Sirve para emitir el sonido/notificación de fin de
	// petición sólo cuando el usuario está en otra aplicación (no mientras mira
	// a Frida, que sería molesto).
	let vscodeWindowFocused = true;
	// Conteo previo de pendientes, para emitir el sonido de atención sólo en la
	// transición 0 → ≥1 (no en cada reenvío del callback mientras la misma
	// aprobación/pregunta sigue esperando).
	let lastApprovalCount = 0;
	let lastUiCount = 0;
	// Fix UX #1: detectar runs que terminan SIN respuesta visible (ni texto ni
	// tools). Caso típico: el gateway DevEngine rechaza con 401 (key vencida) y el
	// SDK openai lanza AuthenticationError ANTES de onResponse → after_provider_response
	// no dispara → el 401 queda invisible y el agente cierra con mensajes vacíos.
	// Sin esto, el usuario ve "silencio" en vez de "API key inválida".
	let hadText = false;
	let hadToolCall = false;
	// issue #6: error que pi-ai deja en el mensaje (stopReason="error" →
	// message.errorMessage) y NO propaga al evento agent_end. Se captura en
	// message_end y se surfacea en agent_end; sin esto el error real del provider
	// (p. ej. "Invalid API key" de Moonshot) se traga.
	let lastMessageError: string | undefined;

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

	// #20 — publica el snapshot del goal (chip 🎯) y lo cachea para re-enviar
	// en webview_ready (si el webview monta tras el último evento del runtime).
	let lastGoalState: unknown;
	function postGoalState(goal: unknown): void {
		lastGoalState = goal;
		post({ type: "goal_state", goal: goal ?? null });
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
				if (Array.isArray(m.tool_calls) && m.tool_calls.length > 0) withToolCalls++;
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

	// H-2/H-3 (HALLAZGOS-GATEWAY): el 500 opaco del gateway se decodifica con un
	// re-probe stream:false desde el provider (message_end con stopReason error).
	// Aquí solo publicamos el mensaje ACCIONABLE al panel; la evidencia completa
	// queda en diagnosticDumpPath.
	function onGatewayDiagnosis(diagnosis: {
		actionableMessage: string;
		probeStatus: number | null;
	}): void {
		post({
			type: "provider_error",
			text: `${diagnosis.actionableMessage} Diagnóstico: ${diagnosticDumpPath}`,
		});
	}

	// Copia el último dump (devengine-last-request.json) a
	// devengine-errors/<fecha-hora>__<sesión>.json para conservar los requests que
	// fallaron, identificables por cuándo y qué sesión. Ver ADR-0009.
	function rotateErrorDump(): string {
		try {
			const dir = path.join(context.globalStorageUri.fsPath, "devengine-errors");
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
					onPendingApprovals: (reqs: ApprovalRequest[]) => {
						post({ type: "approvals", approvals: reqs });
						// Aviso sonoro de atención (Ping) al llegar un NUEVO permiso pendiente
						// (transición 0 → ≥1). Evita repetir mientras la misma aprobación está
						// esperando, ya que este callback puede dispararse varias veces.
						if (reqs.length > 0 && lastApprovalCount === 0) {
							void notifyAttention(vscodeWindowFocused, "approval");
						}
						lastApprovalCount = reqs.length;
					},
					onUiRequest: (reqs) => {
						post({ type: "ui_requests", items: reqs });
						// Igual que con approvals: sonar sólo al llegar una NUEVA pregunta.
						if (reqs.length > 0 && lastUiCount === 0) {
							void notifyAttention(vscodeWindowFocused, "ui");
						}
						lastUiCount = reqs.length;
					},
					onUiNotify: (message, level) =>
						post({ type: "ui_notify", message, level }),
					onWebCommit: (rootId, tree, placement) =>
						post({ type: "web_commit", rootId, tree, placement }),
					onQuestionnaire: (reqs) =>
						post({ type: "questionnaire", req: reqs[0] ?? null }),
					getMode: () => approvalMode,
					askUserQuestionEnabled: isAskUserQuestionEnabled,
					todoEnabled: isTodoEnabled,
					contextEnabled: isContextEnabled,
					getGatePatterns: readGatePatterns,
					onLensDiagnostics: mergeLens,
					// #20 — chip 🎯 del footer + avisos del runtime de frida-goal.
					onGoalState: (goal) => postGoalState(goal),
					onGoalNotify: (_level, text) => post({ type: "info", text }),
					getContext7Key,
					onProviderError,
					// #86: deps del provider-audit (extensión frida-provider-audit vía pi.on).
					providerAudit: {
						append: (line) => providerAuditAppender.append(line),
						tag: () => abortSessionTag,
						// Storage para AUTO-CHANGE: el último error HTTP reciente (<2 min) se
						// incluye como disparador cuando agent_end detecta divergencia.
						onHttpError: (status, modelRef) => {
							lastProviderHttpError = {
								status,
								atMs: Date.now(),
								message: modelRef,
							};
						},
					},
					requestDumpPath,
					diagnosticDumpPath,
					onGatewayDiagnosis,
					codebaseIndexEnabled: isCodebaseIndexEnabled,
					hermesMemoryEnabled: isHermesMemoryEnabled,
					onHermesMemoryState: handleHermesMemoryState,
					knowledgeBaseEnabled: isKnowledgeBaseEnabled,
					onKnowledgeBaseState: handleKnowledgeBaseState,
					ccPluginsEnabled: isCcPluginsEnabled,
					onCcPluginsState: handleCcPluginsState,
					ccPluginsExtraMarketplaces: readCcPluginsExtraMarketplaces,
					ccPluginsEnabledPlugins: readCcPluginsEnabledPlugins,
					ccPluginsPresenter: createCcPluginsPresenter(),
					ccPluginsPanel: handleCcPanel,
					sandboxesEnabled: isSandboxesEnabled,
					sandboxesDefaultImage: readSandboxesDefaultImage,
					sandboxesAllowDomains: readSandboxesAllowDomains,
					sandboxesPanel: handleSandboxPanel,
					detachedPanel: handleDetachedPanel,
					// Toggles Fase 2 (#53): gates de módulos conmutables.
					subagentsEnabled: isSubagentsEnabled,
					agentBrowserEnabled: isAgentBrowserEnabled,
					supiWebEnabled: isSupiWebEnabled,
					mcpAdapterEnabled: isMcpAdapterEnabled,
					extensibleWorkflowsEnabled: isExtensibleWorkflowsEnabled,
					gitSyncEnabled: isGitSyncEnabled,
					worktreeEnabled: isWorktreeEnabled,
					onCodebaseIndexState: (s) => {
						ciUi = s;
						postCodebaseIndexState();
					},
				});
				frida = s;
				// Aviso de Foam solo si la KB está habilitada — con el setting en
				// false no hay vault y el aviso sería ruido (Refs #29).
				if (isKnowledgeBaseEnabled()) checkKnowledgeBaseViewDeps();
				wireSession(s.session);
				// Monta el widget de agentes en el footer (idempotente) y publica el conteo
				// de subagentes en background al webview. Así el indicador de procesamiento
				// persiste ("N subagentes en curso…") aunque el agente principal termine y
				// queden subagentes corriendo; el widget del footer da el detalle por agente.
				wireAgentWidget(s.webBridge);
				// Widget de estado de frida-git-sync en el footer (sync en curso + botón
				// Cancel). Idempotente; se actualiza vía syncWidgetStore.
				wireGitSyncWidget(s.webBridge);
				// WorkflowPanel de frida-extensible-workflows (issue #7): panel de progreso
				// del tool `workflow`. Idempotente; se monta una vez por sesión para que
				// cualquier workflow lanzado por el agente (no sólo vía /wf) sea visible.
				wireExtensibleWorkflowPanel(s.webBridge);
				setAgentWidgetListener((snapshot) => {
					const n = snapshot.filter(
						(a) => a.status === "running" || a.status === "queued",
					).length;
					post({ type: "agents_running", count: n });
				});
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
						text:
							"La sesión inició pero no hay modelo activo. Abre Ayuda → Toggle Developer Tools → Console y busca ‘[frida]’ para ver el detalle.",
						level: "warning",
					});
				}
				postResources();
				postModels();
				postUiPrefs();
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

	function sumUsage(session: any): { input: number; output: number } {
		try {
			const msgs: any[] = session?.agent?.state?.messages ?? [];
			let input = 0,
				output = 0;
			for (const m of msgs) {
				if (m?.role === "assistant" && m?.usage) {
					input += m.usage.input ?? 0;
					output += m.usage.output ?? 0;
				}
			}
			return { input, output };
		} catch {
			return { input: 0, output: 0 };
		}
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
			// Timestamps de los mensajes en memoria (epoch ms): para el tiempo de
			// sesión, combinado luego con los del JSONL en disco (que es más robusto
			// ante compactación/reload, pero puede ir un turno atrás antes del flush).
			let memFirstTs = Infinity,
				memLastTs = 0;
			for (const m of msgs) {
				const mts = typeof m?.timestamp === "number" ? m.timestamp : 0;
				if (mts) {
					if (mts < memFirstTs) memFirstTs = mts;
					if (mts > memLastTs) memLastTs = mts;
				}
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
			// Tras una compactación devuelve {tokens:null,percent:null} hasta la próxima
			// respuesta del modelo (tamaño real desconocido); propagamos null para que la
			// barra muestre "?" en vez de un 0% engañoso (paridad con el footer de la TUI).
			const ctx = session?.getContextUsage?.();
			const contextWindow =
				ctx?.contextWindow ?? session?.model?.contextWindow ?? 0;
			const unknown = ctx == null || ctx.tokens == null || ctx.percent == null;
			const contextTokens = unknown ? 0 : (ctx?.tokens ?? 0);
			const contextPercent = unknown
				? null
				: (ctx?.percent ??
					(contextWindow
						? Math.min(100, (contextTokens / contextWindow) * 100)
						: 0));
			// Presión ajustada por el reserve de compactación (paridad pressurePercent
			// de frida-context): la barra la usa para ANTICIPAR la compactación, no sólo
			// la ventana bruta. >100% ⇒ el agente debería compactar ya.
			const reserveTokens = getReserveTokens();
			const effectiveCapacity =
				contextWindow > reserveTokens
					? contextWindow - reserveTokens
					: contextWindow;
			const pressurePercent = unknown
				? null
				: effectiveCapacity > 0
					? Math.min(100, (contextTokens / effectiveCapacity) * 100)
					: contextPercent;
			// Refuerzo desde el JSONL en disco (fuente de verdad: conserva TODO el
			// histórico, incluso tras compactación, cuando el estado en memoria puede
			// estar truncado). Combinamos con max/min para ser robustos en cualquier
			// caso (turno nuevo antes del flush, reload de sesión compactada, …):
			//   firstTs = el más antiguo (memoria pierde los primeros al compactar)
			//   lastTs  = el más reciente (disco va un turno atrás antes del flush)
			//   tokens  = max(disco, memoria)
			// Totales de MEMORIA (antes de combinar con disco): para el delta del turno
			// vs el baseline (agent_start), que también es de memoria → consistencia.
			const memInputTotal = inputTotal;
			const memOutputTotal = outputTotal;
			const disk = readSessionStats(
				session?.sessionFile ?? session?.sessionManager?.getSessionFile?.(),
			);
			const firstTs =
				memFirstTs === Infinity
					? (disk?.firstTs ?? 0)
					: disk?.firstTs
						? Math.min(memFirstTs, disk.firstTs)
						: memFirstTs;
			const lastTs = Math.max(memLastTs, disk?.lastTs ?? 0);
			if (disk) {
				inputTotal = Math.max(inputTotal, disk.inputTotal);
				outputTotal = Math.max(outputTotal, disk.outputTotal);
				cacheRead = Math.max(cacheRead, disk.cacheRead);
				cacheWrite = Math.max(cacheWrite, disk.cacheWrite);
				cost = Math.max(cost, disk.cost);
			}
			const sessionDurationMs = firstTs && lastTs ? lastTs - firstTs : 0;
			// #107 — Tiempo activo por turnos: preferir el JSONL (fuente de
			// verdad con histórico completo); max con memoria como salvaguarda
			// ante el lag de flush del disco (mismo criterio que tokens).
			const activeMs = Math.max(disk?.activeMs ?? 0, 0);
			const turnCount = Math.max(disk?.turnCount ?? 0, 0);
			const turnDurations = (disk?.turns ?? []).map((t) => t.endMs - t.startMs);
			// Delta de usage del turno actual (memoria) vs el baseline de agent_start.
			// Se reparte entre las tarjetas del último turno como ~llm (atribución).
			const turnInput = turnUsageBaseline
				? Math.max(0, memInputTotal - turnUsageBaseline.input)
				: undefined;
			const turnOutput = turnUsageBaseline
				? Math.max(0, memOutputTotal - turnUsageBaseline.output)
				: undefined;
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
				sessionDurationMs,
				activeMs,
				turnCount,
				turnDurations,
				turnInput,
				turnOutput,
			});
		} catch {
			/* noop */
		}
	}

	function providerDisplayName(id: string): string {
		if (id === SOFTTEK_PROVIDER) return SOFTTEK_PROVIDER_DISPLAY;
		if (id === ZAI_PROVIDER) return ZAI_PROVIDER_DISPLAY;
		if (id === MOONSHOT_PROVIDER) return MOONSHOT_PROVIDER_DISPLAY;
		if (id === OPENAI_PROVIDER) return OPENAI_PROVIDER_DISPLAY;
		if (id === FRIDA_ENTERPRISE_PROVIDER) {
			return FRIDA_ENTERPRISE_PROVIDER_DISPLAY;
		}
		if (id === ANTIGRAVITY_PROVIDER) {
			return ANTIGRAVITY_PROVIDER_DISPLAY;
		}
		// #123 — distinguir del cloud (#122): "Ollama (local)" vs "Ollama Cloud".
		if (id === "ollama") return OLLAMA_PROVIDER_DISPLAY;
		if (id === "ollama-cloud") return OLLAMA_CLOUD_DISPLAY;
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
		// #123 — ollama local sin modelos de chat descargados no aparece en
		// ninguna lista de selección del chat (ModelPanel/Proveedores/Roles):
		// sin modelos no hay nada que elegir y el bloque es ruido. La guía
		// (ollama pull) vive en el doctor de Entorno (#110).
		const visibleProviders = filterVisibleChatProviders(
			SUPPORTED_PROVIDERS,
			(id) => (mr.getModels?.(id) ?? []).length > 0,
		);
		const providers = visibleProviders.map((id) => ({
			id,
			name: providerDisplayName(id),
			// Errata-3 (#58): isUsingOAuth sólo reporta con credential guardada; el
			// flag pre-login sale del Provider registrado (auth.oauth), para que el
			// webview renderice el botón de OAuth y no el campo de API key.
			oauth: !!mr.isUsingOAuth?.(id) || !!mr.getProvider?.(id)?.auth?.oauth,
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
		// #121 (F7) — snapshot de roles para la sección Roles del panel.
		const rolesCfg = readModelRolesConfig(m ? m.provider : "", m ? m.id : "");
		post({
			type: "models",
			providers,
			active: m ? { provider: m.provider, modelId: m.id } : undefined,
			refreshing: opts.refreshing,
			refreshErrors: opts.refreshErrors,
			roles: {
				enabled: rolesCfg.enabled ?? false,
				smol: rolesCfg.smol ?? null,
				commit: rolesCfg.commit ?? null,
				fallbackEnabled: rolesCfg.fallback != null,
			},
		});
	}

	/** #121 — publica preferencias de UI persistidas (Transcript). */
	function postUiPrefs(): void {
		post({
			type: "ui_prefs",
			hideThinking: vscode.workspace
				.getConfiguration("frida")
				.get<boolean>("ui.hideThinking", false),
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
		// #98: SIN re-confirmación aquí. El único emisor de {type:"select_model"}
		// es el onConfirm del ModelConfirmDialog del webview (comparación actual →
		// nuevo): toda petición manual YA fue confirmada explícitamente por el
		// usuario. La tarjeta vieja (model_changes vía ModelChangeBridge) duplicaba
		// la confirmación en esta ruta. El puente sigue vivo SOLO para la vigilancia
		// auto-detected en agent_end (divergencia session.model vs activeModel).
		try {
			await frida.session.setModel(m);
			activeModel = { provider: providerId, modelId };
			await context.globalState.update(ACTIVE_MODEL_KEY, activeModel);
			// #86: provider-audit MANUAL — confirmación de intención del usuario.
			providerAuditAppender.append(
				forensicLine(
					abortSessionTag,
					`MANUAL setModel=${formatModelRef(providerId, modelId)}`,
				),
			);
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

	// Moonshot AI (Kimi): modelo default del provider. El catálogo built-in trae
	// kimi-k3, kimi-k2.6, kimi-k2-thinking…; fijamos kimi-k3 como pre-selección al
	// configurar por primera vez (mismo patrón que copilotDefaultModelId).
	function moonshotDefaultModelId(): string | undefined {
		const models: any[] =
			frida?.modelRuntime?.getModels?.(MOONSHOT_PROVIDER) ?? [];
		return models.find((m: any) => m.id === "kimi-k3")?.id ?? models[0]?.id;
	}

	// OpenAI (ChatGPT): modelo default del provider. El catálogo built-in trae
	// gpt-4o, gpt-5, gpt-5.1…gpt-5.6, o3, o4-mini…; fijamos gpt-5 como
	// pre-selección al configurar por primera vez (mismo patrón que
	// copilotDefaultModelId / moonshotDefaultModelId).
	function openaiDefaultModelId(): string | undefined {
		const models: any[] = frida?.modelRuntime?.getModels?.(OPENAI_PROVIDER) ?? [];
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
			await frida.modelRuntime.login?.(providerId, "oauth", makeAuthInteraction());
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
		const allSkills: AttribSkill[] = (skills.skills ?? []).map(
			(s: any): AttribSkill => {
				const p = String(s.filePath ?? "");
				let realPath = p;
				try {
					realPath = realpathSync(p);
				} catch {
					/* sin realpath (archivo normal o ausente) → path */
				}
				return {
					name: String(s.name),
					path: p,
					realPath,
					description: String(s.description ?? ""),
					source: String(s?.sourceInfo?.scope ?? "path"),
				};
			},
		);
		const allPrompts = (prompts.prompts ?? []).map((p: any) => ({
			name: String(p.name),
			description: String(p.description ?? ""),
		}));
		const bundledSkillNames = getBundledSkillNames();
		const ccSkillNames = (() => {
			const names = new Set<string>();
			try {
				const reg = loadRegistry(defaultAgentDir());
				const plugins: any[] = Object.values(reg.plugins ?? {});
				for (const p of plugins)
					for (const s of p?.skills ?? []) names.add(String(s));
			} catch {
				/* sin registry → sin atribución cc-plugins */
			}
			return names;
		})();

		// #54 — Atribución de recursos a módulos (toggles #53 + bases): los
		// tools/comandos/skills/prompts/errores de cada módulo frida se muestran
		// en el acordeón de Configuración > Herramientas; Recursos queda con lo
		// general (extensiones externas, skills globales/proyecto, built-ins).
		const attribution = attributeResources({
			extensions: extensionsData,
			skills: allSkills,
			prompts: allPrompts,
			errors,
			bundledSkillNames,
			ccSkillNames,
			kbRealPathPrefixes: [
				path.join(
					defaultAgentDir(),
					"npm",
					"node_modules",
					"@zosmaai",
					"pi-llm-wiki",
				),
			],
		});
		const factoryEsModulo = (f: string): boolean =>
			TOOL_TOGGLE_KEY_BY_FACTORY.has(f) ||
			TOOL_TOGGLE_BASES.some((b) => b.factory === f);
		const extCommands: {
			name: string;
			description: string;
			argumentHint?: string;
			source: "extension";
			extension: string;
		}[] = [];
		for (const e of (ext.extensions ?? []).filter((e: any) => !e.hidden)) {
			const extLabel = extNameOf(String(e.path ?? ""));
			// #54: los comandos de módulos frida (toggles/base) van al acordeón de
			// Herramientas; aquí solo quedan los de extensiones externas.
			if (factoryEsModulo(extLabel)) continue;
			for (const name of Array.from(e.commands?.keys?.() ?? [])) {
				const n = String(name);
				if (!n || builtinNames.has(n)) continue;
				extCommands.push({
					name: n,
					// #140 (D9): el Map del SDK (Map<string, RegisteredCommand>)
					// expone description opcional — el "" hardcodeado dejaba TODO
					// comando de extensión sin descripción en el autocompletado "/"
					// del Composer y en Recursos > Comandos.
					description: String(e.commands?.get?.(n)?.description ?? ""),
					source: "extension",
					extension: extLabel,
				});
			}
		}
		return {
			extensions: attribution.general.extensions,
			// #92: ResourceSummary.skills alimenta el autocompletado de "/" y "$"
			// del Composer y la sección Skills de Recursos. Debe contener la
			// totalidad de las skills descubiertas (atribuyendo su origen como
			// extension, global, project o path).
			skills: allSkills.map((s) => ({
				name: s.name,
				description: s.description,
				source: resolveSkillSource(s, bundledSkillNames, ccSkillNames),
				path: s.path,
			})),
			prompts: allPrompts,
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
			errors: attribution.general.errors,
			// #54: recursos por módulo para el acordeón de Herramientas.
			modules: attribution.modules,
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
		// #53: valores + descriptores desde el registro central — la UI renderiza
		// desde este estado y no duplica la lista de toggles.
		post({
			type: "tool_toggles",
			values: readToolToggles(),
			defs: TOOL_TOGGLES.map(({ key, title, desc }) => ({ key, title, desc })),
		});
	}

	// Snapshot del panel de auto-aprobación (#55): política declarativa (el mismo
	// config-store que lee el gate en cada tool_call — cambios aplican en vivo) +
	// patrones aprobados en la sesión. Refresca el panel sin recargar nada.
	function postPermissionsConfig(): void {
		const c = getConfig();
		post({
			type: "permissions_config",
			config: {
				mode: approvalMode, // modo VIVO (el del footer), siempre sincronizado
				auditLog: c.auditLog !== false,
				tool: { ...c.policy.tool },
				path: { ...c.policy.path },
				bash: { ...c.policy.bash },
				externalDirectory: c.policy.external_directory,
			},
			sessionPatterns: frida?.sessionApprovals.list() ?? [],
		});
	}

	/** Coerce el estado que llega del webview a allow/ask/deny (default ask). */
	function permState(v: unknown): PermissionState {
		return v === "allow" || v === "deny" ? v : "ask";
	}

	// Info del workspace: carpeta de trabajo + branch git, conteo de cambios
	// (added/modified/deleted) y commits ahead/behind vs origin. Una sola llamada
	// `git status --porcelain -b` da los tres. La ejecuta el HOST directamente
	// Detecta si cwd es un worktree vinculado (no el checkout principal) y
	// devuelve su NOMBRE (el badge del footer lo muestra). El git-dir de un
	// worktree vinculado vive bajo <common>/.git/worktrees/<name>; el del
	// principal es <repo>/.git. El nombre sale gratis del mismo rev-parse que
	// ya corría la detección booleana. Issue #13.
	async function detectWorktreeName(cwd: string): Promise<string | undefined> {
		try {
			const { stdout } = await execFileP(
				"git",
				["rev-parse", "--absolute-git-dir"],
				{ cwd, timeout: 3000 },
			);
			const m = stdout.trim().match(/[/\\]\.git[/\\]worktrees[/\\]([^/\\]+)/);
			return m?.[1];
		} catch {
			return undefined;
		}
	}

	// (no el modelo), así que no pasa por el gate de bash de D7. No depende de la
	// extensión Git de VS Code.
	async function collectWorkspace(): Promise<{
		cwd: string;
		branch?: string;
		dirty?: boolean;
		sessionName?: string;
		diff?: { added: number; modified: number; deleted: number };
		ahead?: number;
		behind?: number;
		sessionPath?: string;
		worktreeName?: string;
	}> {
		const cwd = workspaceCwd();
		const sessionName = frida?.sessionManager?.getSessionName?.() || undefined;
		try {
			const { stdout } = await execFileP("git", ["status", "--porcelain", "-b"], {
				cwd,
				timeout: 3000,
			});
			const lines = stdout.split("\n");
			// 1ª línea "## branch...up [ahead N, behind M]" (o "## HEAD (no branch)").
			const head = parseStatusHead(lines[0] ?? "");
			// Resto: líneas porcelain XY path → conteo added/modified/deleted.
			const diff = parseGitDiff(lines.slice(1).join("\n"));
			const dirty = diff.added + diff.modified + diff.deleted > 0;
			const wtName = await detectWorktreeName(cwd);
			return {
				cwd,
				branch: head.branch,
				dirty,
				sessionName,
				sessionPath: frida?.session?.sessionFile,
				diff,
				ahead: head.ahead,
				behind: head.behind,
				worktreeName: wtName,
			};
		} catch {
			return {
				cwd,
				sessionName,
				sessionPath: frida?.session?.sessionFile,
			}; // no es repo o git no disponible
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

	// issue #3: debounced refresco del estado de Git durante una corrida. Antes
	// postWorkspace() sólo se llamaba en eventos puntuales (compactación,
	// visibilidad, fin de bash, switch de sesión…), así que el footer "main ~N"
	// se congelaba mientras el agente editaba/escribía archivos. Ahora, tras cada
	// edit/write (y en turn_end como red de seguridad) reagrupamos las escrituras
	// y lanzamos un único `git status --porcelain -b` a los 500 ms.
	let wsRefreshTimer: ReturnType<typeof setTimeout> | undefined;
	function scheduleWorkspaceRefresh(): void {
		if (wsRefreshTimer) clearTimeout(wsRefreshTimer);
		wsRefreshTimer = setTimeout(() => {
			wsRefreshTimer = undefined;
			void postWorkspace();
		}, 500);
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
		post({
			type: "queued",
			items: queueStore
				.snapshot()
				.map((q) => ({ id: q.id, text: q.text, mode: q.mode })),
		});
	}

	function resetQueue(): void {
		queueStore.clearLocal();
		turnsInRun = 0;
		postQueued();
	}

	function wireSession(session: any): void {
		session.subscribe((event: any) => {
			switch (event?.type) {
				case "agent_settled":
					// issue #2: el SDK asentó el run (_isAgentRunActive=false). Si esto llega
					// MIENTRAS un request sigue en vuelo (o antes de un abort pedido), el run
					// escapó al tracking del AgentSession → abort() será no-op aunque siga
					// quemando tokens (modo de fallo 1 y 2 del issue).
					// #90: settle REAL (isIdle) limpia el gate de re-abort; un settle con
					// isIdle=false (retry/ciclo vivo) lo mantiene.
					if (abortGate.isPending()) {
						abortDiag(
							`agent_settled (abortGate pendiente) — isIdle=${!!session.isIdle} isRetrying=${!!session.isRetrying} → ${session.isIdle ? "gate LIMPIO (ciclo paró)" : "gate MANTENIDO (ciclo vivo)"}`,
						);
					}
					abortGate.onAgentSettled({ isIdle: !!session.isIdle });
					abortDiag(
						`agent_settled — isIdle=${!!session.isIdle} isRetrying=${!!session.isRetrying} retryAttempt=${session.retryAttempt ?? 0}`,
					);
					break;
				case "agent_start":
					// #90: si hay un abort pendiente, este agent_start es el run ESCAPADO que
					// arrancó justo después del abort no-op (gap entre runs del SDK). Con
					// isStreaming ya true, un abort AQUÍ sí lo mata — re-abortamos.
					if (abortGate.onAgentStart({ isIdle: !!session.isIdle })) {
						abortDiag(
							`agent_start con abortGate PENDIENTE → RE-ABORT del run escapado (isStreaming=${!!session.isStreaming})`,
						);
						try {
							void session.abort?.();
						} catch {
							/* best-effort */
						}
					}
					abortDiag(
						`agent_start — isStreaming=${!!session.isStreaming} isBashRunning=${!!session.isBashRunning} queueSteer=${session.getSteeringMessages?.().length ?? "?"} queueFollow=${session.getFollowUpMessages?.().length ?? "?"} pendingLocal=${queueStore.snapshot().length}`,
					);
					turnsInRun = 0;
					// Snapshot del usage aggregate para repartir el delta del turno entre
					// las tarjetas como ~llm (atribución burda ÷ N).
					turnUsageBaseline = sumUsage(session);
					hadText = false;
					hadToolCall = false;
					lastMessageError = undefined;
					lensBusy = true;
					post({ type: "agent_busy", busy: true });
					post({ type: "turn_active" });
					break;
				case "agent_end": {
					abortDiag(
						`agent_end — errorMessage=${event.errorMessage ?? "(none)"} willRetry=${!!event.willRetry} hadText=${hadText} hadToolCall=${hadToolCall} queueSteer=${session.getSteeringMessages?.().length ?? "?"} queueFollow=${session.getFollowUpMessages?.().length ?? "?"}`,
					);
					postUsage(session);
					post({ type: "agent_busy", busy: false });
					// Vigilancia: ¿el proveedor/modelo cambió durante el turno SIN pasar por
					// selectModel? (ciclo del SDK, restore corrupto de skill-bracket,
					// failover). Comparamos activeModel (lo que Frida cree) vs session.model
					// (lo real). Si difieren, alertamos y ofrecemos revertir al anterior.
					{
						const cur = session?.model;
						if (
							cur &&
							activeModel &&
							(cur.provider !== activeModel.provider || cur.id !== activeModel.modelId)
						) {
							modelChangeBridge ??= new ModelChangeBridge((reqs) =>
								post({ type: "model_changes", items: reqs }),
							);
							const prev = { ...activeModel };
							// #86: provider-audit AUTO-CHANGE — divergencia detectada + causality.
							const httpCause =
								lastProviderHttpError &&
								Date.now() - lastProviderHttpError.atMs < 120_000
									? ` disparadoPor=HTTP ${lastProviderHttpError.status} hace ${Math.round((Date.now() - lastProviderHttpError.atMs) / 1000)}s`
									: "";
							providerAuditAppender.append(
								forensicLine(
									abortSessionTag,
									`AUTO-CHANGE from=${formatModelRef(prev.provider, prev.modelId)} to=${formatModelRef(cur.provider, cur.id)}${httpCause}`,
								),
							);
							void modelChangeBridge
								.request({
									id: `mc-${Date.now()}`,
									from: {
										provider: prev.provider,
										modelId: prev.modelId,
									},
									to: { provider: cur.provider, modelId: cur.id },
									source: "auto-detected",
									reason:
										"El proveedor cambió durante el turno sin que tú lo pidieras (¿fallo de conexión, ciclo o restore de skill?).",
								})
								.then((resp) => {
									if (resp.decision === "accept") {
										// Acepta el nuevo proveedor: sincroniza activeModel para no
										// volver a flaggear en el próximo agent_end.
										activeModel = { provider: cur.provider, modelId: cur.id };
										void context.globalState.update(ACTIVE_MODEL_KEY, activeModel);
										sendModelInfo();
									} else {
										// Revertir al proveedor anterior.
										void selectModel(prev.provider, prev.modelId);
									}
								});
						}
					}
					// Sonido + notificación al terminar (sólo si el setting está activo y la
					// ventana de VS Code perdió el foco → el usuario está en otra app).
					void notifyCompletion(vscodeWindowFocused);
					// Error terminal del provider que NO se reintenta (los retriables van por auto_retry_end).
					// El fallback genérico (rama 3) TAMBIÉN respeta willRetry: el fallo
					// retriable del intento 1 publicaba "El modelo no generó respuesta
					// (401)" y después llegaba la respuesta del auto-retry (mensaje
					// fantasma). Lógica en src/agent-end-fallback.ts (pura, testeada).
					const isDevEngine = activeModel?.provider === SOFTTEK_PROVIDER;
					const provName =
						getApiKeyProvider(activeModel?.provider ?? "")?.displayName ??
						activeModel?.provider ??
						"este proveedor";
					const fallbackText = agentEndFallbackText({
						errorMessage: event.errorMessage,
						lastMessageError,
						willRetry: !!event.willRetry,
						hadText,
						hadToolCall,
						isDevEngine,
						providerDisplayName: provName,
					});
					if (fallbackText !== null) {
						post({ type: "provider_error", text: fallbackText });
					}
					// El agente terminó: a partir de aquí los diagnósticos tardíos (cascade)
					// se publican solos (mergeLens comprueba lensBusy).
					lensBusy = false;
					flushLens();
					break;
				}
				case "turn_start": {
					// turn_start tras el primero (turnsInRun>0) = entrega de un mensaje
					// encolado: creamos su turno aquí para que los deltas caigan en él.
					if (turnsInRun > 0 && queueStore.snapshot().length > 0) {
						const delivered = queueStore.shift();
						if (delivered) post({ type: "user", text: delivered.text });
					}
					const isFirstTurn = turnsInRun === 0;
					turnsInRun++;
					// Nuevo turno: reinicia el acumulador para reflejar solo lo que pi-lens
					// encuentre en ESTE turno.
					lensAccum.clear();
					lensAnyTruncated = false;
					post({ type: "turn_active" });
					// issue #4 Parte 2: auto-título al primer mensaje de una sesión sin nombre.
					if (isFirstTurn) void maybeAutoTitle();
					break;
				}
				case "turn_end":
					// Fin de turno del agente: publica el resumen de diagnósticos acumulados.
					flushLens();
					// issue #3: red de seguridad — asegura que el footer de git refleje el
					// estado final del turno aunque falte una tool del set {edit, write}.
					scheduleWorkspaceRefresh();
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
					abortDiag(
						`message_end — role=${event.message?.role ?? "?"} stopReason=${event.message?.stopReason ?? "?"}`,
					);
					if (
						event.message?.role === "assistant" &&
						event.message?.stopReason === "aborted"
					) {
						post({ type: "info", text: "Operación cancelada" });
					}
					// issue #6: pi-ai termina el mensaje assistant con stopReason="error" y
					// deja el detalle humano en message.errorMessage (lo confirman
					// print-mode.js:106 e interactive-mode.js:2380 del SDK). Lo capturamos
					// para surfacerlo en agent_end; el SDK NO lo copia a event.errorMessage.
					if (
						event.message?.role === "assistant" &&
						event.message?.stopReason === "error"
					) {
						lastMessageError = event.message?.errorMessage || undefined;
						abortDiag(
							`message_end stopReason=error — ${lastMessageError ?? "(sin texto en message.errorMessage)"}`,
						);
					}
					// Cada respuesta del modelo actualiza los tokens reales del contexto
					// (usageTokens del último assistant). Sin esto la barra se congela en
					// medio de una corrida con muchos tools: sólo se refrescaba en agent_end.
					// Paridad con el footer de la TUI de pi, que recalcula en cada render.
					if (event.message?.role === "assistant") {
						postUsage(session);
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
					// details estructurado (p. ej. subagent_progress del tool agent /
					// get_subagent_result): se reenvía al webview para render rico. Opcional.
					const details = (event.partialResult as { details?: unknown } | undefined)
						?.details;
					if (partial || details) {
						const msg: Record<string, unknown> = {
							type: "tool_update",
							toolCallId: event.toolCallId,
							tool: event.toolName,
						};
						if (partial) msg.partial = partial;
						if (details) msg.details = details;
						post(msg);
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
					// Cada tool_result añade trailingTokens al contexto vivo: refrescamos el %
					// para que la barra crezca durante la corrida en vez de quedarse congelada
					// hasta agent_end. estimateContextTokens es local (sin red) → barato.
					postUsage(session);
					// El tool `todo` muta el store reactivo y el panel Remote React se
					// re-renderiza solo (ADR-0014): nada que publicar aquí.
					// issue #3: edit/write mutan el working tree → refrescar el footer de git
					// de forma reactiva (debounced). `bash` ya refresca por su cuenta.
					if (event.toolName === "edit" || event.toolName === "write") {
						scheduleWorkspaceRefresh();
					}
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

		// #86: provider-audit BASELINE — loggea modelo al armar cada sesión.
		// REQUEST/HTTP viven en la extensión frida-provider-audit (pi-session:
		// pi.on — los eventos de provider NO son métodos del AgentSession;
		// session.on no existe y crasheaba el arranque, regresión 6fed59a).
		const sessionModel = session?.model;
		providerAuditAppender.append(
			forensicLine(
				abortSessionTag,
				`BASELINE session.model=${formatModelRef(sessionModel?.provider, sessionModel?.id)} activeModel=${formatModelRef(activeModel?.provider, activeModel?.modelId)}`,
			),
		);
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

	// ── Panel nativo de /ccplugin (UX #49): acciones host-side por id ──
	const ccPanelActions = new Map<
		string,
		import("./tools/frida-cc-plugins/panel").CcPanelActions
	>();
	// ── Panel nativo de /sandbox (#35): acciones host-side por id ──
	const sbxPanelActions = new Map<
		string,
		import("./tools/frida-sandboxes/panel").SandboxPanelActions
	>();
	// Sink del panel /detached (#26): postea el snapshot y, mientras el panel
	// está abierto, lo refresca cada 3s (tail de logs corriendo). Al cerrar,
	// limpia el timer.
	let dtRefreshTimer: ReturnType<typeof setInterval> | undefined;
	function handleDetachedPanel(panel: DetachedPanelData | null): void {
		if (dtRefreshTimer) {
			clearInterval(dtRefreshTimer);
			dtRefreshTimer = undefined;
		}
		if (!panel) {
			post({ type: "detached_panel", panel: null });
			return;
		}
		post({
			type: "detached_panel",
			panel: { id: "detached", title: "Subagentes detached", runs: panel.runs },
		});
		dtRefreshTimer = setInterval(() => {
			post({
				type: "detached_panel",
				panel: {
					id: "detached",
					title: "Subagentes detached",
					runs: buildDetachedPanel().runs,
				},
			});
		}, 3_000);
	}

	function handleSandboxPanel(
		req: import("./tools/frida-sandboxes/panel").SandboxPanelRequest | null,
	): void {
		if (!req) {
			sbxPanelActions.delete(lastSbxPanelId);
			post({ type: "sandbox_panel", panel: null });
			return;
		}
		sbxPanelActions.set(req.id, req.actions);
		lastSbxPanelId = req.id;
		post({
			type: "sandbox_panel",
			panel: {
				id: req.id,
				title: req.title,
				sandboxes: req.sandboxes,
				docker: req.docker,
			},
		});
	}
	let lastSbxPanelId = "";

	function handleCcPanel(
		req: import("./tools/frida-cc-plugins/panel").CcPanelRequest | null,
	): void {
		if (!req) {
			ccPanelActions.clear();
			post({ type: "ccplugins_panel", panel: null });
			return;
		}
		ccPanelActions.set(req.id, req.actions);
		post({
			type: "ccplugins_panel",
			panel: {
				id: req.id,
				title: req.title,
				rows: req.rows,
				installed: req.installed,
				resources: req.resources,
				marketplaces: req.marketplaces,
				errors: req.errors,
			},
		});
	}

	async function handleWebviewMessage(msg: any): Promise<void> {
		switch (msg?.type) {
			case "webview_ready":
				webviewReady = true;
				post({ type: "mode", mode: approvalMode });
				post({ type: "version", version: fridaVersion });
				postToolToggles();
				postPermissionsConfig();
				postCodebaseIndexState();
				// M2 (#143) — re-posteo del estado del mapa para re-montes fríos del
				// tab (hueco que lensStatus NO cubre — no repetirlo).
				postProjectMapState();
				// #114 — metadata real del motor del índice (async, read-only)
				void refreshCiIndexMeta();
				// #117 — semáforo OpenAI de las tarjetas (async, best-effort)
				void Promise.resolve(context.secrets.get("frida.openaiKey"))
					.then((k) => {
						ciOpenAiAuthed = !!k;
						postCodebaseIndexState();
					})
					.catch(() => {});
				// #20 — re-envía el último snapshot del goal si el webview montó
				// después del evento (cacheado en postGoalState).
				if (lastGoalState !== undefined) {
					post({ type: "goal_state", goal: lastGoalState ?? null });
				}
				if (pendingSettingsTab) {
					post({ type: "open_settings", tab: pendingSettingsTab });
					pendingSettingsTab = undefined;
				}
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
				// #90: trabajo nuevo INTENCIONAL del usuario → limpia el gate de re-abort
				// (no queremos re-abortar el run que el usuario acaba de pedir).
				abortGate.onUserPrompt();
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
					reason: typeof msg.reason === "string" ? msg.reason : undefined,
				});
				break;
			case "questionnaire_answer":
				// ask_user_question nativo (ADR-0027): el webview (QuestionsPanel) cerró.
				(await ensureSession()).questionnaireBridge.resolve({
					id: String(msg.id ?? ""),
					cancelled: !!msg.cancelled,
					answers: Array.isArray(msg.answers) ? msg.answers : [],
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
			case "ccplugins_panel_action": {
				// Acción del panel /ccplugin: ejecutar host-side y confirmar con
				// toast CORTO (confirmación de una línea — no listas).
				const actions = ccPanelActions.get(String(msg.id ?? ""));
				if (!actions) break;
				const ref = typeof msg.ref === "string" ? msg.ref : "";
				void (async () => {
					try {
						let result: string;
						switch (msg.action) {
							case "install":
								if (!ref) return;
								result = await actions.install(ref);
								break;
							case "uninstall":
								if (!ref) return;
								result = await actions.uninstall(ref);
								break;
							case "enable":
								if (!ref) return;
								result = await actions.toggle(ref, true);
								break;
							case "disable":
								if (!ref) return;
								result = await actions.toggle(ref, false);
								break;
							case "mkt_add":
								result = await actions.marketplaceAdd(String(msg.value ?? ""));
								break;
							case "mkt_remove":
								result = await actions.marketplaceRemove(String(msg.name ?? ""));
								break;
							case "mkt_update":
								result = await actions.marketplaceUpdate(
									msg.name ? String(msg.name) : undefined,
								);
								break;
							case "retry": {
								const s = String(msg.source ?? "");
								if (s !== "bootstrap" && s !== "marketplace" && s !== "install") return;
								result = await actions.retry(s);
								break;
							}
							default:
								return;
						}
						post({ type: "info", text: result });
					} catch (e: any) {
						post({
							type: "info",
							text: `cc-plugins: ${e?.message ?? e}`,
							level: "error",
						});
						// Re-emitir igual: el ⏳ optimista del webview se limpia
						// con el refresh (mismo id), éxito O error.
						actions.refresh();
					}
				})();
				break;
			}
			case "ccplugins_row_meta": {
				// "Last updated" de la fila enfocada: git log cacheado host-side;
				// el patch viaja solo si hay valor (evita renders vacíos).
				const actions = ccPanelActions.get(String(msg.id ?? ""));
				const ref = String(msg.ref ?? "");
				if (!actions || !ref) break;
				void actions.rowMeta(ref).then((lastUpdated) => {
					if (lastUpdated)
						post({
							type: "ccplugins_row_meta",
							id: String(msg.id ?? ""),
							ref,
							lastUpdated,
						});
				});
				break;
			}
			case "ccplugins_panel_close":
				handleCcPanel(null);
				break;
			case "detached_panel_action":
			case "detached_panel_close": {
				// Acciones del panel /detached (#26). El confirm de Detener vive en el
				// webview (doble-⏎); el host ejecuta y el toast de UNA línea confirma.
				if (msg.type === "detached_panel_close") {
					handleDetachedPanel(null);
					break;
				}
				const dtRun = typeof msg.runId === "string" ? msg.runId : "";
				void (async () => {
					try {
						if (msg.action === "stop" && dtRun) {
							const ok = stopDetachedRun(dtRun);
							post({
								type: "info",
								text: ok
									? `⏹ Detached ${dtRun} detenido (SIGTERM al grupo)`
									: `Detached ${dtRun} no existe o ya terminó`,
							});
						}
					} finally {
						// refresh siempre (la acción ya mutó el registry).
						handleDetachedPanel(buildDetachedPanel());
					}
				})();
				break;
			}
			case "sandbox_panel_action":
			case "sandbox_panel_changes":
			case "sandbox_panel_merge":
			case "sandbox_panel_terminal":
			case "sandbox_panel_close": {
				// Acciones del panel /sandbox (#35). El confirm de destroy vive
				// en el webview (doble click); el host ejecuta y el toast de UNA
				// línea confirma (regla de UI: listas en webview, toasts cortos).
				if (msg.type === "sandbox_panel_close") {
					handleSandboxPanel(null);
					break;
				}
				const actions = sbxPanelActions.get(String(msg.id ?? ""));
				if (!actions) break;
				const name = typeof msg.name === "string" ? msg.name : "";
				void (async () => {
					try {
						if (msg.type === "sandbox_panel_action") {
							switch (msg.action) {
								case "refresh":
									await actions.refresh();
									break;
								case "reprobe":
									await actions.reprobe();
									break;
								case "pause":
								case "resume":
								case "destroy": {
									if (!name) return;
									const out =
										msg.action === "pause"
											? await actions.pause(name)
											: msg.action === "resume"
												? await actions.resume(name)
												: await actions.destroy(name);
									post({ type: "info", text: out });
									break;
								}
							}
						} else if (msg.type === "sandbox_panel_changes") {
							if (!name) return;
							const files = await actions.changes(name);
							post({
								type: "info",
								text: files.length
									? `${name}: ${files.length} cambio(s) sin mergear — pide el merge al agente (sandbox_merge) o desde la sesión.`
									: `${name}: sin cambios (árbol limpio).`,
							});
						} else if (msg.type === "sandbox_panel_merge") {
							if (!name || !Array.isArray(msg.files)) return;
							const out = await actions.mergeFiles(name, msg.files);
							post({ type: "info", text: out });
						} else if (msg.type === "sandbox_panel_terminal") {
							// Terminal interactiva del container (docker exec -it)
							// en la terminal integrada de VS Code.
							if (!name) return;
							if (actions.terminal) await actions.terminal(name);
							else {
								const term = vscode.window.createTerminal({
									name: `sandbox:${name}`,
									shellPath: "docker",
									shellArgs: [
										"exec",
										"-it",
										"-w",
										"/workspace",
										`frida-sbx-${name}`,
										"bash",
										"-l",
									],
								});
								term.show();
							}
						}
					} catch (e: any) {
						await actions.refresh().catch(() => {});
						post({
							type: "info",
							level: "error",
							text: `sandbox: ${e?.message ?? e}`,
						});
					}
				})();
				break;
			}
			case "model_change_response":
				// Respuesta del diálogo de confirmación de cambio de proveedor.
				modelChangeBridge?.resolve({
					id: String(msg.id ?? ""),
					decision: msg.decision === "accept" ? "accept" : "cancel",
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
							typeof msg.payload?.value === "string" ? msg.payload.value : undefined,
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
				abortDiag(`host ← webview {type:"abort"} recibido`);
				await abortRun();
				break;
			// Acciones del panel de cola (issue #45). El store sincroniza el SDK
			// (clearQueue + re-prompt) y notifica → postQueued actualiza la UI.
			case "queue_remove":
				await queueStore.remove(String(msg.id ?? "")).catch(() => undefined);
				break;
			case "queue_edit": {
				const entry = await queueStore
					.takeout(String(msg.id ?? ""))
					.catch(() => undefined);
				if (entry) post({ type: "composer_insert", text: entry.text });
				break;
			}
			case "queue_move":
				await queueStore
					.move(String(msg.id ?? ""), msg.dir === -1 ? -1 : 1)
					.catch(() => undefined);
				break;
			case "abort_diag":
				// Trazado reenviado desde el webview (Esc / botón) para unificar el timeline
				// en el canal "Frida Abort". text ya incluye el prefijo del origen.
				abortDiag(String(msg.text ?? "(abort_diag sin texto)"));
				break;
			case "clear_provider_error":
				// El usuario cerró el banner del error del provider (botón X): eco al
				// webview para que su reducer limpie providerError (persistente por
				// diseño — ya no se auto-limpia con delta/turn_active/user).
				post({ type: "clear_provider_error" });
				break;
			case "reload":
				await reloadResources();
				break;
			case "list_resources":
				postResources();
				break;
			case "list_usage": {
				const period: "today" | "7d" | "30d" | "all" =
					msg.period === "today" ||
					msg.period === "7d" ||
					msg.period === "30d" ||
					msg.period === "all"
						? msg.period
						: "all";
				const scope = msg.scope === "all" ? "all" : "project";
				const projectCwd = scope === "project" ? workspaceCwd() : undefined;
				const { snapshot, periodFrom, periodTo } = indexUsage({
					sessionsDir: sessionDirPath,
					period,
					projectCwd,
				});
				// Enriquecer top sesiones con el name (renombrado por el usuario) del SDK,
				// igual que la lista de sesiones (SessionManager). Best-effort: si falla,
				// sessionLabel cae a firstMessage.
				try {
					const items = await SessionManager.listAll(sessionDirPath);
					const nameByPath = new Map(
						items.map((i: any) => [String(i.path), i.name as string | undefined]),
					);
					for (const s of snapshot.sessions) s.name = nameByPath.get(s.path);
				} catch {
					/* noop */
				}
				post({
					type: "usage_report",
					report: snapshot,
					period,
					scope,
					periodFrom,
					periodTo,
				});
				break;
			}
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
			case "tree":
				await postTreeCommand();
				break;
			// /tree (#126): el TreePanel confirmó la navegación. Delegamos en
			// session.navigateTree (misma API que la TUI de Pi): mueve la hoja EN EL
			// MISMO ARCHIVO (sin createBranchedSession), opcionalmente resume la rama
			// abandonada y devuelve editorText si el destino era mensaje de usuario
			// (ese texto regresa al Composer para editarlo y reenviar → rama hermana).
			case "tree_navigate": {
				const entryId = String(msg.entryId ?? "");
				if (!frida?.session?.session || !entryId) return;
				const s: any = frida.session.session;
				if (s.isStreaming) {
					post({
						type: "info",
						level: "warning",
						text:
							"Espera a que termine la respuesta en curso para navegar el árbol (o pulsa Esc para detenerla).",
					});
					return;
				}
				const summarize = !!msg.summarize;
				const custom =
					typeof msg.customInstructions === "string" && msg.customInstructions.trim()
						? msg.customInstructions.trim()
						: undefined;
				try {
					const result = await s.navigateTree(entryId, {
						summarize,
						customInstructions: custom,
					});
					if (result?.cancelled) {
						post({ type: "info", text: "Navegación cancelada." });
						return;
					}
					// Igual que compaction_end: la hoja se movió → reconstruir transcript
					// + barras de contexto/workspace desde la nueva posición.
					postHistory();
					postUsage(frida.session);
					void postWorkspace();
					if (result?.editorText) {
						// Mensaje de usuario seleccionado: su texto regresa al Composer
						// (nonce propio para disparar el useEffect aun con texto igual).
						post({ type: "composer_insert", text: String(result.editorText) });
					}
					post({
						type: "info",
						text: "Navegación en el árbol completada (misma sesión).",
					});
				} catch (e: any) {
					post({
						type: "error",
						text: "No se pudo navegar: " + String(e?.message ?? e),
					});
				}
				break;
			}
			// /tree (#126): etiqueta de checkpoint (paridad Shift+L de Pi). El SDK la
			// persiste como entrada label (targetId + texto); re-publicamos el árbol
			// para que la fila refleje el cambio.
			case "tree_label": {
				const entryId = String(msg.entryId ?? "");
				if (!frida?.session?.sessionManager || !entryId) return;
				const label =
					typeof msg.label === "string" && msg.label.trim()
						? msg.label.trim().slice(0, 40)
						: undefined;
				try {
					frida.session.sessionManager.appendLabelChange(entryId, label);
					await postTreeCommand();
				} catch (e: any) {
					post({
						type: "error",
						text: "No se pudo guardar la etiqueta: " + String(e?.message ?? e),
					});
				}
				break;
			}
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
				await sendSessions(msg.scope === "all" ? "all" : "project");
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
			case "set_mode": {
				const next: PermissionMode =
					msg.mode === "auto-edit" || msg.mode === "auto" ? msg.mode : "manual";
				// Gate YOLO: pedir confirmación al entrar a un modo sin permisos desde manual.
				if (next !== "manual" && approvalMode === "manual") {
					const ok = await requestYoloGate();
					if (!ok) {
						post({ type: "mode", mode: approvalMode });
						break;
					}
				}
				approvalMode = next;
				// Persiste en permission.json (#55): el modo elegido en el panel de
				// auto-aprobación (o el footer) sobrevive recargas de ventana.
				setStoredMode(next);
				saveConfig();
				post({ type: "mode", mode: approvalMode });
				postPermissionsConfig();
				break;
			}
			case "set_tool_toggle":
				await writeToolToggle(msg.key, !!msg.enabled);
				postToolToggles();
				// Re-ejecuta las factories para activar/desactivar el tool en caliente
				// (frida.askUserQuestion.enabled / frida.todo.enabled). Igual que /reload,
				// no pierde el historial; el estado de `todo` se recupera por replay.
				await reloadResources();
				break;
			// ── Panel de auto-aprobación (#55): puente webview → config-store ──
			// Cada cambio persiste de inmediato y el gate lee el cache fresco en el
			// próximo tool_call. Los tools con deny se ocultan del catálogo al inicio
			// del próximo turno (before_agent_start), sin recargar la sesión.
			case "get_permissions_config":
				postPermissionsConfig();
				break;
			case "perm_set_tool":
				setTool(String(msg.tool ?? ""), permState(msg.state));
				saveConfig();
				postPermissionsConfig();
				break;
			case "perm_set_path":
				setPathPattern(String(msg.pattern ?? ""), permState(msg.state));
				saveConfig();
				postPermissionsConfig();
				break;
			case "perm_remove_path":
				removePathPattern(String(msg.pattern ?? ""));
				saveConfig();
				postPermissionsConfig();
				break;
			case "perm_set_bash":
				setBashPattern(String(msg.pattern ?? ""), permState(msg.state));
				saveConfig();
				postPermissionsConfig();
				break;
			case "perm_remove_bash":
				removeBashPattern(String(msg.pattern ?? ""));
				saveConfig();
				postPermissionsConfig();
				break;
			case "perm_set_external":
				setExternalDirectory(permState(msg.state));
				saveConfig();
				postPermissionsConfig();
				break;
			case "perm_set_audit":
				setAuditLog(msg.enabled !== false);
				saveConfig();
				postPermissionsConfig();
				break;
			case "perm_reset":
				resetConfig();
				setStoredMode("manual");
				approvalMode = "manual"; // el reset vuelve a manual también en vivo
				saveConfig();
				post({ type: "mode", mode: approvalMode });
				postPermissionsConfig();
				break;
			case "perm_revoke_session_pattern":
				frida?.sessionApprovals.remove(msg.kind, String(msg.pattern ?? ""));
				postPermissionsConfig();
				break;
			// #121 (F7) — cambio de config de roles desde la sección Roles del
			// panel Modelos: persiste en settings y re-publica el snapshot.
			case "model_roles_set": {
				const cfg = vscode.workspace.getConfiguration("frida");
				const target = vscode.ConfigurationTarget.Global;
				if (typeof msg.enabled === "boolean") {
					await cfg.update("modelRoles.enabled", msg.enabled, target);
				}
				if (msg.smol !== undefined) {
					await cfg.update(
						"modelRoles.smol.provider",
						msg.smol?.provider ?? "",
						target,
					);
					await cfg.update("modelRoles.smol.model", msg.smol?.modelId ?? "", target);
				}
				if (msg.commit !== undefined) {
					await cfg.update(
						"modelRoles.commit.provider",
						msg.commit?.provider ?? "",
						target,
					);
					await cfg.update(
						"modelRoles.commit.model",
						msg.commit?.modelId ?? "",
						target,
					);
				}
				if (typeof msg.fallbackEnabled === "boolean") {
					await cfg.update(
						"modelRoles.fallback.enabled",
						msg.fallbackEnabled,
						target,
					);
				}
				postModels();
				break;
			}
			case "codebase_index_action": {
				const action = msg.action as
					| "install"
					| "index"
					| "rebuild"
					| "status"
					| "files"
					| "stop"; // #112 — consulta read-only de archivos indexados: no es una acción
				// «busy» (no deshabilita botones ni arranca reloj).
				if (action === "files") {
					try {
						const res = await readIndexedFiles(workspaceCwd());
						post({
							type: "codebase_index_files",
							available: !!res,
							files: res?.files ?? [],
							failed: res?.failed ?? [],
						});
					} catch {
						post({
							type: "codebase_index_files",
							available: false,
							files: [],
							failed: [],
						});
					}
					break;
				}
				// #113 — detener la indexación: el upstream no expone cancelación
				// limpia (la tool descarta la señal de aborto), así que se corta la
				// corrida recargando el extension host. El webview ya mostró la
				// confirmación con la explicación; aquí solo se ejecuta.
				if (action === "stop") {
					await vscode.commands.executeCommand("workbench.action.reloadWindow");
					break;
				}
				ciBusy = action === "install" ? "install" : "index";
				ciLastLine = undefined;
				ciProgress = null;
				ciBusySince = Date.now(); // #111 — el reloj vive en el store, no en el tab
				postCodebaseIndexState();
				try {
					if (action === "install") {
						await ensureInstalled(defaultAgentDir(), {
							keepOtherPlatforms: readCodebaseIndexConfig().keepOtherPlatforms,
							onProgress: (line) => {
								ciLastLine = line;
								postCodebaseIndexState();
							},
						});
						ciLastLine =
							"Instalado. Recarga la sesión (Frida: Recargar extensiones y recursos) para activar las tools.";
						// Refresh inmediato del estado instalado (sin esperar recarga de
						// sesión): el tab debe dejar de mostrar "No instalado".
						ciUi = {
							installed: isInstalledAtPin(defaultAgentDir()),
							capturedTools: ciUi.capturedTools,
						};
					} else {
						// index/rebuild/status: ejecutamos el tool upstream capturado DIRECTO
						// desde el host (mismo shim que el wrapper) — sin depender del
						// agente. ctx mínimo con cwd del workspace.
						const tools = await loadUpstreamTools(
							upstreamEntryPath(defaultAgentDir()),
						);
						const toolName = action === "status" ? "index_status" : "index_codebase";
						const t = tools.get(toolName);
						if (!t) throw new Error(`${toolName} no disponible en el paquete`);
						// #109 — sondeo del progreso en vivo: el AutoIndexCoordinator
						// mantiene el progreso en memoria de ESTE proceso mientras indexa;
						// index_status lo reporta. Polling cada 2s, best-effort.
						let poll: ReturnType<typeof setInterval> | undefined;
						if (action !== "status") {
							const statusTool = tools.get("index_status");
							if (statusTool) {
								poll = setInterval(() => {
									void statusTool
										.execute("host-progress", {}, undefined, undefined, {
											cwd: workspaceCwd(),
										})
										.then(async (res: any) => {
											const txt = res?.content?.[0]?.text;
											ciProgress =
												typeof txt === "string" ? parseAutoIndexProgress(txt) : null;
											// #118 — último archivo confirmado (read-only; solo durante
											// embedding hay commits; en parsing queda el anterior/null)
											ciLastFile = await readLastIndexedFile(workspaceCwd()).catch(
												() => null,
											);
											postCodebaseIndexState();
										})
										.catch(() => {
											/* progreso best-effort */
										});
								}, 2000);
							}
						}
						try {
							// toolCallId (etiqueta del registro de la llamada), no una query:
							// acción validada por la unión de tipos del mensaje.
							const toolCallId = `host-${action}`;
							const res = await t.execute(
								toolCallId,
								{ force: action === "rebuild" },
								undefined,
								undefined,
								{ cwd: workspaceCwd() },
							);
							ciLastLine = ciSummarize(res);
						} finally {
							// #109 — el polling muere SIEMPRE con la acción (sin timers huérfanos)
							if (poll) clearInterval(poll);
							ciProgress = null;
							ciLastFile = null;
						}
					}
				} catch (e: any) {
					ciLastLine = e?.guide ?? e?.message ?? String(e);
				}
				ciBusy = null;
				ciBusySince = null;
				postCodebaseIndexState();
				// #114 — la corrida pudo cambiar el motor del índice: refresca la
				// metadata real del banner (async; publica al resolver).
				void refreshCiIndexMeta();
				break;
			}
			// #116 (Fase A) — Ping de conectividad del proveedor de embeddings:
			// POST {base}/embeddings con input "ping" (protocolo OpenAI-compatible
			// común a los 4). Deduce dimensions reales del vector de respuesta.
			case "codebase_index_ping": {
				const provider = msg.provider;
				const cfg = readCodebaseIndexConfig();
				let baseUrl = "";
				let model = msg.model?.trim() || "";
				let apiKey: string | undefined;
				if (provider === "frida-enterprise") {
					const cred = readEnterpriseEmbeddingsCredential(defaultAgentDir());
					if (!cred) {
						post({
							type: "codebase_index_ping_result",
							provider,
							ok: false,
							error: "Sin sesión de Frida Enterprise — inicia sesión primero",
						});
						break;
					}
					if (cred.expired) {
						post({
							type: "codebase_index_ping_result",
							provider,
							ok: false,
							error: "Sesión de Frida Enterprise expirada — vuelve a iniciar sesión",
						});
						break;
					}
					baseUrl = `${cred.baseUrl}/v1`;
					model = model || cfg.fridaEnterpriseModel;
					apiKey = cred.token;
				} else if (provider === "ollama") {
					const host = (process.env.OLLAMA_HOST || "http://localhost:11434").replace(
						/\/+$/,
						"",
					);
					baseUrl = host.endsWith("/v1") ? host : `${host}/v1`;
					model = model || cfg.ollamaModel;
				} else if (provider === "openai") {
					const key = await context.secrets.get("frida.openaiKey");
					if (!key) {
						post({
							type: "codebase_index_ping_result",
							provider,
							ok: false,
							error: "Sin API key de OpenAI guardada en Frida (Configuración)",
						});
						break;
					}
					baseUrl = "https://api.openai.com/v1";
					model = model || cfg.openaiModel;
					apiKey = key;
				} else {
					// custom
					if (!cfg.customBaseUrl || !cfg.customModel) {
						post({
							type: "codebase_index_ping_result",
							provider,
							ok: false,
							error:
								"Endpoint custom incompleto — configura baseUrl y modelo en settings",
						});
						break;
					}
					baseUrl = cfg.customBaseUrl;
					model = model || cfg.customModel;
				}
				const res = await pingEmbeddingsProvider({ baseUrl, model, apiKey });
				// Éxito + enterprise: persiste el config.json del upstream con las
				// dimensions deducidas (customProvider las exige enteras >0).
				if (res.ok && res.dimensions && provider === "frida-enterprise") {
					const cred = readEnterpriseEmbeddingsCredential(defaultAgentDir());
					if (cred) {
						syncCodebaseIndexConfig(workspaceCwd(), {
							provider: "frida-enterprise",
							enterpriseBaseUrl: cred.baseUrl,
							enterpriseToken: cred.token,
							enterpriseModel: model,
							enterpriseDimensions: res.dimensions,
						});
					}
				}
				post({ type: "codebase_index_ping_result", provider, ...res });
				break;
			}
			// #120 — toggle de indexación automática: escribe indexing.autoIndex
			// del config.json del proyecto (merge defensivo) y publica el estado.
			case "codebase_index_autoindex": {
				const ok = setAutoIndexEnabled(workspaceCwd(), !!msg.enabled);
				if (!ok) {
					post({
						type: "info",
						text:
							"No se pudo escribir .codebase-index/config.json (¿workspace read-only?) — la indexación automática no cambió.",
						level: "error",
					});
				}
				ciAutoIndex = readAutoIndexEnabled(workspaceCwd());
				postCodebaseIndexState();
				break;
			}
			// #117 (Fase B) — selección de proveedor/modelo: persiste el setting
			// de VS Code, materializa config.json vía sync (Fase A) y — con
			// rebuild=true (modal) — dispara la reconstrucción total del índice.
			case "codebase_index_select": {
				const cfg = vscode.workspace.getConfiguration("frida");
				const target = vscode.ConfigurationTarget.Global;
				await cfg.update("codebaseIndex.embeddings.provider", msg.provider, target);
				if (msg.model) {
					const key =
						msg.provider === "frida-enterprise"
							? "codebaseIndex.embeddings.fridaEnterprise.model"
							: msg.provider === "ollama"
								? "codebaseIndex.embeddings.ollama.model"
								: "codebaseIndex.embeddings.openai.model";
					if (key) await cfg.update(key, msg.model, target);
				}
				// sync config.json del upstream con la nueva elección
				const fresh = readCodebaseIndexConfig();
				if (msg.provider !== "auto" && msg.provider !== "openai") {
					let enterpriseDimensions = 0;
					if (msg.provider === "frida-enterprise") {
						// dimensions verificadas por el último ping exitoso guardadas
						// en el config actual (si existen) — el ping las deduce.
						const prev = await readIndexMeta(workspaceCwd());
						enterpriseDimensions = prev?.dimensions ?? 0;
					}
					const cred =
						msg.provider === "frida-enterprise"
							? readEnterpriseEmbeddingsCredential(defaultAgentDir())
							: undefined;
					syncCodebaseIndexConfig(workspaceCwd(), {
						provider: msg.provider,
						enterpriseBaseUrl: cred?.baseUrl,
						enterpriseToken: cred?.token,
						enterpriseModel: fresh.fridaEnterpriseModel,
						enterpriseDimensions,
						ollamaModel: fresh.ollamaModel,
						openaiModel: fresh.openaiModel,
						customBaseUrl: fresh.customBaseUrl,
						customModel: fresh.customModel,
						customDimensions: fresh.customDimensions,
					});
				}
				postCodebaseIndexState();
				if (msg.rebuild) {
					// Reutiliza el flujo existente de la acción rebuild
					void handleWebviewMessage({
						type: "codebase_index_action",
						action: "rebuild",
					});
				}
				break;
			}
			// M2 (#143) — carga/refresh del mapa Funcional. Read-only síncrono
			// (lectura de inventory.json M8 + derivación de journeys): try/catch
			// que SIEMPRE responde; busy/epoch para el spinner del botón (#111/#142).
			case "project_map": {
				if (msg.view === "technical") {
					startTechnicalLoad(
						typeof msg.limit === "number" && msg.limit > 0 ? msg.limit : 10,
					);
					break;
				}
				pmState = {
					...pmState,
					functional: { status: "loading" },
					busy: "functional",
					busySince: Date.now(),
				};
				postProjectMapState();
				try {
					pmState = {
						...pmState,
						functional: loadFunctionalMap(workspaceCwd()),
						busy: null,
						busySince: null,
					};
				} catch (e: any) {
					pmState = {
						...pmState,
						functional: { status: "error", hint: e?.message ?? String(e) },
						busy: null,
						busySince: null,
					};
				}
				refreshPmCross(); // ══ Fase 4: pantallas disponibles → join funcional ══
				postProjectMapState();
				break;
			}

			// M2 (#143) — abrir evidencia desde el mapa. Paths del inventory relativos
			// al cwd de la corrida → rebase + guard de contención SIEMPRE; texto vía
			// openAtLine, binario (PNG) vía vscode.open (BINARY_EXT, nivel módulo).
			// Try/catch degrada a showErrorMessage — nunca silencio.
			case "open_file": {
				const file = typeof msg.file === "string" ? msg.file : "";
				if (!file) break;
				const abs = safeResolveWithin(workspaceCwd(), file);
				if (!abs) {
					void vscode.window.showErrorMessage(
						"Frida: ruta fuera del workspace — " + file,
					);
					break;
				}
				const ext = path.extname(abs).slice(1).toLowerCase();
				void (async () => {
					try {
						if (BINARY_EXT.has(ext)) {
							await vscode.commands.executeCommand(
								"vscode.open",
								vscode.Uri.file(abs),
							);
						} else {
							await openAtLine(
								abs,
								typeof msg.line === "number" ? msg.line : undefined,
							);
						}
					} catch (e: any) {
						void vscode.window.showErrorMessage(
							"No se pudo abrir " + file + ": " + String(e?.message ?? e),
						);
					}
				})();
				break;
			}

			// M2 (#143) — screenshot on-demand: el webview manda SOLO el screenId; el
			// host resuelve el path desde el inventory YA cargado en pmState (cero
			// confianza en paths del cliente) y responde SIEMPRE (dataUri "" = sin
			// captura → la UI no reintenta; #142 sin espera eterna).
			case "project_map_shot": {
				const screenId = String(msg.screenId ?? "");
				if (!screenId) break;
				const rel =
					pmState.functional?.status === "ready"
						? (pmState.functional.data.screens.find((s) => s.id === screenId)
								?.screenshot ?? "")
						: "";
				if (!rel) {
					post({ type: "project_map_shot", screenId, dataUri: "" });
					break;
				}
				post({
					type: "project_map_shot",
					screenId,
					dataUri: readScreenshotDataUri(workspaceCwd(), rel),
				});
				break;
			}
			case "check_environment": {
				post({ type: "environment_checking", checking: true });
				try {
					// #139 (M10): agentDir real para checkScc (sonda síncrona del
					// pack — misma que CAPABILITIES.scc del patrón).
					const report = await checkEnvironment({
						agentDir: defaultAgentDir(),
					});
					post({ type: "environment_status", status: report });
				} catch (err: any) {
					post({
						type: "info",
						text: "Error al verificar dependencias: " + String(err?.message ?? err),
						level: "error",
					});
					post({ type: "environment_checking", checking: false });
				}
				break;
			}
			// #121 — toggle Transcript (Configuración → Modelos): persiste y
			// re-publica. El header ya no tiene el botón.
			case "ui_hide_thinking_set": {
				await vscode.workspace
					.getConfiguration("frida")
					.update("ui.hideThinking", !!msg.value, vscode.ConfigurationTarget.Global);
				postUiPrefs();
				break;
			}
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
		{
			name: "ask",
			description:
				"Formular preguntas o decisiones interactivas con opciones (ask_user_question)",
			argumentHint: "[pregunta o tema]",
		},
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
			name: "tree",
			description:
				"Navegar el árbol de la sesión (ramas, etiquetas, cambiar de hoja)",
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
			name: "wf",
			description: "Lanzar o reanudar un workflow",
			argumentHint: '<nombre> "<input>" | @<ref>',
		},
		{
			name: "pipeline",
			description: "Estado del orquestador frida-pipeline",
		},
		{
			name: "skills",
			description: "Listar las skills disponibles con su sintaxis $name",
		},
		{
			name: "skills-search",
			description: "Buscar skills por nombre o descripción",
			argumentHint: "<palabra>",
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
			case "ask":
				// Se delega a runPrompt para inyectar la directiva estructurada y enviarla al LLM
				return false;
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
				if (arg === "context7") void promptContext7Key();
				else if (arg) void loginProvider(arg);
				else
					post({
						type: "info",
						text: "Uso: /login <provider | context7>  (ej. github-copilot, context7)",
					});
				break;
			case "logout":
				if (arg === "context7") void clearContext7Key();
				else if (arg) void logoutProvider(arg);
				else
					post({
						type: "info",
						text:
							"Uso: /logout <provider | context7>  (ej. github-copilot, context7)",
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
			case "tree":
				await postTreeCommand();
				break;
			case "context":
				postContextCommand(arg);
				break;
			case "gates":
				postGatesCommand();
				break;
			case "wf":
				postWfCommand(arg);
				break;
			case "pipeline":
				void postPipelineCommand();
				break;
			case "skills":
				postSkillsCommand();
				break;
			case "skills-search":
				postSkillsSearchCommand(arg);
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

	// === Auto-título de sesión (issue #4 Parte 2) ===
	// Al primer mensaje de una sesión nueva (sin nombre), se genera un título
	// conciso con el modelo activo vía una sesión efímera sin tools y se aplica
	// con renameCurrentSession. Best-effort: nunca rompe el turno del usuario.

	/** Extrae el texto (unido) del último mensaje con `role` en `messages`. */
	function lastMessageText(
		messages: Array<{ role?: string; content?: unknown }> | undefined,
		role: string,
	): string | undefined {
		if (!messages) return undefined;
		for (let i = messages.length - 1; i >= 0; i--) {
			const msg = messages[i];
			if (msg?.role !== role) continue;
			const c = msg.content;
			if (typeof c === "string") return c;
			if (Array.isArray(c)) {
				const texts = c
					.filter(
						(x): x is { type: "text"; text: string } =>
							typeof x === "object" &&
							x !== null &&
							(x as { type?: string }).type === "text" &&
							typeof (x as { text?: unknown }).text === "string",
					)
					.map((x) => x.text);
				if (texts.length) return texts.join("\n");
			}
		}
		return undefined;
	}

	/** Limpia la respuesta a un título: quita comillas/prefijos, recorta a ~6 palabras. */
	function cleanTitle(raw: string | undefined): string | undefined {
		if (!raw) return undefined;
		const stripped = raw
			.replace(/^(t[ií]tulo|title)\s*[:：]\s*/i, "")
			.replace(/^["'`«»“”]+|["'`«»“”]+$/g, "")
			.replace(/[.!:;…]+$/g, "")
			.trim();
		if (!stripped) return undefined;
		const words = stripped.split(/\s+/).slice(0, 6).join(" ");
		return words.length > 60 ? `${words.slice(0, 57).trim()}…` : words;
	}

	/** Crea una sesión efímera sin tools y pide un título para el mensaje. */
	async function generateSessionTitle(
		firstMessage: string,
	): Promise<string | undefined> {
		const runtime = frida?.modelRuntime;
		const model = frida?.session?.model;
		if (!runtime) return undefined;
		const cwd = workspaceCwd();
		const agentDir = defaultAgentDir();
		const settingsManager = SettingsManager.create(cwd, agentDir);
		const resourceLoader = new DefaultResourceLoader({
			cwd,
			agentDir,
			settingsManager,
			// Errata-11 (#58): sin estas factories la sesión hija viaja SIN hooks del
			// provider → el gateway 422-ea el título (missing user_id, Errata-2).
			extensionFactories: [
				{
					name: "frida-enterprise-provider",
					factory: createFridaEnterpriseHooks({ onUnauthorized: () => {} }),
				},
			],
			systemPrompt:
				"Eres un generador de títulos de sesión. Responde SOLO con un título conciso de máximo 5 palabras que capture la intención del mensaje del usuario. Sin comillas, sin puntuación final, sin explicación, sin prefijos como «Título:».",
		});
		const { session } = await createAgentSession({
			cwd,
			agentDir,
			settingsManager,
			resourceLoader,
			modelRuntime: runtime,
			...(model ? { model } : {}),
			noTools: "all",
		});
		try {
			const snippet = firstMessage.slice(0, 1000);
			await session.prompt(
				`Genera un título de máximo 5 palabras para una sesión que empieza con este mensaje del usuario:\n\n${snippet}`,
			);
			const messages = (
				session as unknown as {
					state?: {
						messages?: Array<{ role?: string; content?: unknown }>;
					};
				}
			).state?.messages;
			return cleanTitle(lastMessageText(messages, "assistant"));
		} finally {
			await (
				session as unknown as { dispose?: () => Promise<void> | void }
			).dispose?.();
		}
	}

	/** Orquesta el auto-título: sólo si la sesión no tiene nombre y hay primer mensaje. */
	async function maybeAutoTitle(): Promise<void> {
		try {
			if (frida?.sessionManager?.getSessionName?.()) return; // ya tiene nombre
			const messages = (
				frida?.session as unknown as {
					state?: {
						messages?: Array<{ role?: string; content?: unknown }>;
					};
				}
			)?.state?.messages;
			const firstMessage = lastMessageText(messages, "user");
			if (!firstMessage || firstMessage.trim().length < 3) return;
			const title = await generateSessionTitle(firstMessage);
			if (title) await renameCurrentSession(title); // refresca el footer
		} catch {
			// Best-effort: el auto-título nunca debe romper el turno del usuario.
		}
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
	const HELP_TOOLS: {
		match: string[];
		file: string;
		/** Guía de uso (how-to) cuando existe: aterrizaje default de /help. */
		howTo?: string;
		label: string;
	}[] = [
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
			howTo: "docs/how-to-frida-permissions.md",
			label: "frida-permission-system",
		},
		{
			match: [
				"frida-enterprise",
				"enterprise",
				"proveedor",
				"provider",
				"login",
				"sso",
				"compatible-api",
				"demeter",
				"titan",
				"midas",
			],
			file: "docs/tools/frida-enterprise.md",
			label: "frida-enterprise",
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
			match: ["multi-skills", "multi-skill", "$skill", "skills", "skills-search"],
			file: "docs/tools/frida-multi-skills.md",
			label: "frida-multi-skills",
		},
		{
			match: [
				"pix-skills",
				"read_skills",
				"read skills",
				"skills.sh",
				"skill-loader",
			],
			file: "docs/tools/frida-pix-skills.md",
			label: "frida-pix-skills",
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
		{
			match: ["goal", "goals", "objetivo", "meta", "/goal"],
			file: "docs/tools/frida-goal.md",
			howTo: "docs/how-to-frida-goal.md",
			label: "frida-goal",
		},
		{
			match: ["aidd", "bmad", "sprint", "ship", "aidd-plan", "aidd-ship"],
			file: "docs/tools/frida-aidd.md",
			howTo: "docs/how-to-frida-aidd.md",
			label: "frida-aidd",
		},
		{
			match: [
				"tea",
				"testing",
				"test-design",
				"test-review",
				"automate",
				"framework",
				"qa",
				"ci",
				"nfr",
				"trace",
				"trazabilidad",
				"atdd",
				"teach",
				"academia",
				"tea-test-design",
				"tea-framework",
				"tea-automate",
				"tea-test-review",
				"tea-ci",
				"tea-nfr",
				"tea-trace",
				"tea-atdd",
				"tea-teach",
			],
			file: "docs/tools/frida-tea.md",
			howTo: "docs/how-to-frida-tea.md",
			label: "frida-tea",
		},
		{
			match: [
				"walkthrough",
				"app-walkthrough",
				"documentar",
				"documentacion",
				"documentación",
				"funcional",
				"pantallas",
			],
			file: "docs/tools/frida-app-walkthrough.md",
			howTo: "docs/how-to-frida-app-walkthrough.md",
			label: "frida-app-walkthrough",
		},
		{
			// M1 #134 — understand-app (skill pack del patrón builtin).
			// Alias deliberadamente SIN la palabra reservada del moat: ya la
			// consume la entrada frida-learn (más abajo) y HELP_TOOLS.find es
			// first-match.
			match: ["understand", "understand-app", "entender", "entendimiento"],
			file: "docs/tools/frida-understand-app.md",
			howTo: "docs/how-to-frida-understand-app.md",
			label: "frida-understand-app",
		},
		{
			// M9 #135 — traffic2api (skill pack del patrón builtin). Alias sin
			// colisiones: "api"/"openapi"/"har" no aparecen en ninguna entrada
			// previa (ni match exacto ni label.includes — HELP_TOOLS.find es
			// first-match).
			match: [
				"traffic2api",
				"traffic",
				"trafico",
				"tráfico",
				"api",
				"openapi",
				"har",
			],
			file: "docs/tools/frida-traffic2api.md",
			howTo: "docs/how-to-frida-traffic2api.md",
			label: "frida-traffic2api",
		},
		{
			// M10 #139 — size-app (skill pack del patrón builtin). Alias sin
			// colisiones: "size"/"tamaño"/"dimensionamiento"/"cocomo" no
			// aparecen en ninguna entrada previa (ni match exacto ni
			// label.includes — HELP_TOOLS.find es first-match).
			match: [
				"size-app",
				"size",
				"tamaño",
				"tamano",
				"dimensionamiento",
				"cocomo",
			],
			file: "docs/tools/frida-size-app.md",
			howTo: "docs/how-to-frida-size-app.md",
			label: "frida-size-app",
		},
		{
			match: [
				"workflows",
				"patrones",
				"patterns",
				"multi-perspective",
				"adversarial",
				"code-review-pattern",
			],
			file: "docs/tools/frida-extensible-workflows.md",
			howTo: "docs/how-to-frida-workflows.md",
			label: "frida-extensible-workflows",
		},
		{
			match: ["subagent", "subagents", "subagentes", "sub-agente", "detached"],
			file: "docs/tools/frida-subagents.md",
			howTo: "docs/how-to-frida-subagents.md",
			label: "frida-subagents",
		},
		{
			match: ["sandbox", "sandboxes", "docker", "contenedor"],
			file: "docs/tools/frida-sandboxes.md",
			howTo: "docs/how-to-frida-sandboxes.md",
			label: "frida-sandboxes",
		},
		{
			match: ["cc-plugins", "ccplugins", "claude-code", "plugins"],
			file: "docs/tools/frida-cc-plugins.md",
			howTo: "docs/how-to-cc-plugins.md",
			label: "frida-cc-plugins",
		},
		{
			match: ["hermes", "memory", "memoria"],
			file: "docs/tools/frida-hermes-memory.md",
			// How-to transversal de la pila Moat (index + hermes + knowledge-base).
			howTo: "docs/how-to-frida-learn.md",
			label: "frida-hermes-memory",
		},
		{
			match: ["knowledge", "kb", "okf", "obsidian", "conocimiento"],
			file: "docs/tools/frida-knowledge-base.md",
			howTo: "docs/how-to-frida-learn.md",
			label: "frida-knowledge-base",
		},
		{
			match: ["git-sync", "gitsync", "sync", "sincronizacion"],
			file: "docs/tools/frida-git-sync.md",
			label: "frida-git-sync",
		},
		{
			match: ["mcp", "mcp-adapter"],
			file: "docs/tools/frida-mcp-adapter.md",
			label: "frida-mcp-adapter",
		},
		{
			match: ["supi", "supi-web", "demo-web"],
			file: "docs/tools/frida-supi-web.md",
			label: "frida-supi-web",
		},
		{
			match: ["toggles", "toggle", "activar", "desactivar", "extension-toggles"],
			file: "docs/tools/extension-toggles.md",
			label: "extension-toggles",
		},
		{
			// /worktree: tutorial (sin doc técnica — el comando es la superficie).
			match: ["worktree", "worktrees", "wt"],
			file: "docs/how-to-frida-worktrees.md",
			howTo: "docs/how-to-frida-worktrees.md",
			label: "frida-worktrees",
		},
		{
			// Pila Moat: index + hermes + knowledge-base en un solo manual.
			match: ["learn", "codebase-index", "moat", "aprendizaje"],
			file: "docs/how-to-frida-learn.md",
			howTo: "docs/how-to-frida-learn.md",
			label: "frida-learn",
		},
	];

	async function openHelpDoc(relPath: string, fragment?: string): Promise<void> {
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
		// Calificador final opcional: "/help goal referencia" (doc técnica) o
		// "/help goal guia|uso" (guía). Sin calificador aterriza en el how-to
		// cuando existe — quien pide ayuda quiere el uso, y la referencia queda
		// a un click en el cross-link del encabezado del how-to.
		const words = head.trim().split(/\s+/);
		const last = words.length > 1 ? (words.at(-1) ?? "") : "";
		const qualifier = last.toLowerCase();
		const isRef = ["referencia", "ref", "tecnica", "técnica"].includes(qualifier);
		const isGuide = ["guia", "guía", "uso", "howto", "how-to", "guide"].includes(
			qualifier,
		);
		const needle = (isRef || isGuide ? words.slice(0, -1) : words)
			.join(" ")
			.toLowerCase();
		const tool = HELP_TOOLS.find(
			(t) =>
				t.match.some((m) => m.toLowerCase() === needle) ||
				t.label.toLowerCase().includes(needle),
		);
		if (tool) {
			if (isRef) await openHelpDoc(tool.file, frag);
			else if (isGuide && tool.howTo) await openHelpDoc(tool.howTo, frag);
			else await openHelpDoc(tool.howTo ?? tool.file, frag);
			return;
		}
		await openHelpDoc("README.md");
		post({
			type: "info",
			text: `No encontré "${arg}". Abriendo el índice (README). Herramientas: ${HELP_TOOLS.map((t) => t.label).join(", ")}. Tip: "/help <herramienta> referencia" abre la doc técnica.`,
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

	// /tree (#126): serializa un nodo del árbol de sesión (SessionTreeNode del
	// SDK) a la vista compacta que consume el TreePanel del webview. Sólo los
	// campos que la UI necesita — el entry completo puede traer contents grandes.
	function serializeTreeNode(node: any): any {
		const entry = node?.entry ?? {};
		const label: string | undefined =
			typeof node?.label === "string" && node.label ? node.label : undefined;
		const ts = String(entry.timestamp ?? "");
		const base = {
			id: String(entry.id ?? ""),
			parentId: entry.parentId == null ? null : String(entry.parentId),
			timestamp: ts,
			label,
			children: (Array.isArray(node?.children) ? node.children : []).map(
				serializeTreeNode,
			),
		};
		// Determinar kind + preview según el tipo de entrada. Paridad con los
		// filtros de TreeSelectorComponent (Pi TUI): default oculta bookkeeping
		// y asistentes sin texto (salvo error/abort).
		if (entry.type === "message") {
			const role = String(entry.message?.role ?? "");
			const text = extractText(entry.message);
			if (role === "user")
				return { ...base, kind: "user" as const, text: text.slice(0, 160) };
			if (role === "assistant") {
				// Los tool_calls van como partes del mensaje: contamos y armamos
				// un preview sintético para que la fila tenga contexto sin inflar.
				const c = Array.isArray(entry.message?.content)
					? entry.message.content
					: [];
				const toolCalls = c.filter((p: any) => p?.type === "toolCall").length;
				const stop = String(entry.message?.stopReason ?? "");
				return {
					...base,
					kind: "assistant" as const,
					text: text.slice(0, 160),
					hasText: text.trim().length > 0,
					toolCalls,
					stopReason: stop || undefined,
				};
			}
			if (role === "toolResult")
				return { ...base, kind: "toolResult" as const, text: text.slice(0, 160) };
			return { ...base, kind: "other" as const, text: text.slice(0, 160) };
		}
		if (entry.type === "branch_summary")
			return {
				...base,
				kind: "branchSummary" as const,
				text: String(entry.summary ?? "").slice(0, 160),
			};
		if (entry.type === "compaction")
			return {
				...base,
				kind: "compaction" as const,
				text: String(entry.summary ?? "").slice(0, 160),
			};
		if (entry.type === "model_change")
			return {
				...base,
				kind: "modelChange" as const,
				text: `${entry.provider ?? ""}/${entry.modelId ?? ""}`,
			};
		if (entry.type === "thinking_level_change")
			return {
				...base,
				kind: "thinking" as const,
				text: String(entry.thinkingLevel ?? ""),
			};
		// custom_message (#126 ruido): el wiki/git-context/pipeline inyecta una
		// por turno. El preview "⟨customType⟩" hace visible qué es; el filtro
		// Conversación las oculta (display:false = material interno del host).
		if (entry.type === "custom_message") {
			const ct = String(entry.customType ?? "");
			const content =
				typeof entry.content === "string" ? entry.content : extractText(entry);
			return {
				...base,
				kind: "customMessage" as const,
				text: `⟨${ct}⟩ ${content.slice(0, 120)}`.trim(),
				display: !!entry.display,
			};
		}
		return { ...base, kind: "other" as const, text: "" };
	}

	// /tree (#126): publica el árbol completo de la sesión + hoja activa al
	// webview (getTree/getLeafId del SessionManager). El TreePanel decide
	// filtros/plegado; la navegación regresa por tree_navigate.
	async function postTreeCommand(): Promise<void> {
		let session: FridaSession;
		try {
			session = await ensureSession();
		} catch (e: any) {
			post({ type: "error", text: String(e?.message ?? e) });
			return;
		}
		const sm = session.sessionManager;
		const roots = sm?.getTree?.() ?? [];
		if (roots.length === 0) {
			post({ type: "info", text: "No hay entradas en la sesión todavía." });
			return;
		}
		post({
			type: "tree_data",
			nodes: roots.map(serializeTreeNode),
			leafId: sm?.getLeafId?.() ?? null,
			sessionName: sm?.getSessionName?.() ?? undefined,
		});
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
					createContextReportElement(analysis, {
						onClose: () => contextReportHandle?.unmount(),
						// Compacta (compactContext) y cierra: los eventos
						// compaction_start/end del SDK dan el feedback en el chat.
						onCompact: () => {
							contextReportHandle?.unmount();
							void compactContext();
						},
					}),
				"overlay",
			);
		} catch (e) {
			post({ type: "info", text: `No se pudo analizar el contexto: ${e}` });
		}
	}

	// /wf: lanza un workflow (ADR-0020/D32 y ADR-0050/ADR-0051). Soporta tanto workflows
	// estáticos de frida-workflow (build, vet, polish) como patrones agénticos
	// de frida-extensible-workflows (aidd-plan, aidd-ship, tea-*, etc.).
	async function postWfCommand(arg: string): Promise<void> {
		const s = await ensureSession();
		const trimmed = arg.trim();

		// Si el comando especifica un patrón agéntico directamente (/wf aidd-plan ..., /wf aidd-ship, etc.)
		if (trimmed && !trimmed.startsWith("@") && trimmed !== "check") {
			const [first, ...rest] = trimmed.split(/\s+/);
			const pattern = findBuiltinPattern(first);
			if (pattern) {
				let input = rest.join(" ").trim();
				let promptText = "";
				if (pattern.name === "aidd-plan") {
					if (!input) {
						const entered = await vscode.window.showInputBox({
							title: "aidd-plan (AiDD Planning Phase)",
							prompt: "¿Cuál es la idea del producto que deseas planificar?",
							placeHolder: "Ej. Aplicación de seguimiento nutricional...",
						});
						if (!entered || !entered.trim()) return;
						input = entered.trim();
					}
					promptText = `Ejecuta el workflow '${pattern.name}' con la siguiente idea de producto:\n${input}`;
				} else if (pattern.name === "aidd-ship") {
					promptText = input
						? `Ejecuta el workflow '${pattern.name}' con los siguientes argumentos:\n${input}`
						: `Ejecuta el workflow '${pattern.name}'`;
				} else {
					if (
						!input &&
						(pattern.args.includes("string no vacío") ||
							pattern.args.includes("obligatoria"))
					) {
						const entered = await vscode.window.showInputBox({
							title: `Workflow ${pattern.name}`,
							prompt: `Argumentos para ${pattern.name}: ${pattern.args}`,
						});
						if (entered === undefined) return;
						input = entered.trim();
					}
					promptText = input
						? `Ejecuta el workflow '${pattern.name}' con: ${input}`
						: `Ejecuta el workflow '${pattern.name}'`;
				}
				post({
					type: "info",
					text: `▶ Lanzando patrón agéntico '${pattern.name}'…`,
					level: "info",
				});
				await s.session.prompt(promptText);
				return;
			}
		}

		// Fase 5: montar el WorkflowPanel (footer) + registrar el lifecycle listener
		// (idempotente). Antes de handleWfSlash para que los fire del runner lo pueblen.
		wireWorkflowPanel(s.webBridge);
		const host = createFridaWorkflowHost({
			frida: s,
			cwd: workspaceCwd(),
			notify: (message, level) => post({ type: "info", text: message, level }),
		});
		const availablePatterns = builtinPatternsCatalog().map((p) => p.name);
		await handleWfSlash(arg, {
			host,
			runsDirBase: path.join(context.globalStorageUri.fsPath, "workflows"),
			cwd: workspaceCwd(),
			agentDir: defaultAgentDir(),
			dslBundlePath: path.join(context.extensionPath, "dist", "frida-workflow.js"),
			availablePatterns,
			pickWorkflow,
			checkWorkflows,
		});
	}

	// /wf sola → QuickPick agrupado (Patrones agénticos / Internos / Globales / Proyecto).
	async function pickWorkflow(
		loaded: LoadedWorkflows,
	): Promise<{ name: string; input: string } | undefined> {
		type WfPickItem = vscode.QuickPickItem & {
			name?: string;
			broken?: boolean;
			isPattern?: boolean;
		};
		const GROUP: Record<WorkflowOrigin, string> = {
			builtin: "Internos (extensión)",
			user: "Globales (~/.frida/workflows)",
			project: "Proyecto (.frida/workflows)",
		};
		const byOrigin = new Map<WorkflowOrigin, Workflow[]>();
		for (const [name, wf] of loaded.workflows) {
			const o = loaded.origins.get(name) ?? "builtin";
			const arr = byOrigin.get(o) ?? [];
			arr.push(wf);
			byOrigin.set(o, arr);
		}
		const items: WfPickItem[] = [];

		// Patrones agénticos de frida-extensible-workflows (AiDD, TEA, Code Review, etc.)
		const patterns = builtinPatternsCatalog();
		if (patterns.length > 0) {
			items.push({
				label: "Patrones agénticos (AiDD / TEA / Review / Audit)",
				kind: vscode.QuickPickItemKind.Separator,
			});
			for (const p of patterns) {
				items.push({
					name: p.name,
					label: `⚡ ${p.name}`,
					description: p.description,
					detail: p.args,
					isPattern: true,
				});
			}
		}

		for (const o of ["builtin", "user", "project"] as WorkflowOrigin[]) {
			const list = byOrigin.get(o);
			if (!list || list.length === 0) continue;
			items.push({ label: GROUP[o], kind: vscode.QuickPickItemKind.Separator });
			for (const wf of list) {
				const errs = validateWorkflow(wf).filter((i) => i.severity === "error");
				items.push({
					name: wf.name,
					label: errs.length ? `⚠ ${wf.name}` : wf.name,
					description: Object.keys(wf.stages).join(" → "),
					detail: errs.length
						? `No valida: ${errs
								.map((e) => (e.stage ? `${e.stage}: ${e.message}` : e.message))
								.join("; ")}`
						: undefined,
					broken: errs.length > 0,
				});
			}
		}
		if (items.length === 0) {
			vscode.window.showInformationMessage("No hay workflows disponibles.");
			return undefined;
		}
		const pick = await vscode.window.showQuickPick(items, {
			title: "Workflows · selecciona",
			placeHolder: "Elige un workflow o patrón agéntico para ejecutar",
			matchOnDescription: true,
			matchOnDetail: true,
		});
		if (!pick || !pick.name) return undefined;
		if (pick.broken) {
			vscode.window.showErrorMessage(
				`'${pick.name}' no valida. Usa /wf check para ver los errores y corregirlos.`,
			);
			return undefined;
		}

		// Si seleccionó un patrón agéntico, pedir datos apropiados y despachar al agente
		if (pick.isPattern) {
			const s = await ensureSession();
			let input = "";
			let promptText = "";
			if (pick.name === "aidd-plan") {
				const entered = await vscode.window.showInputBox({
					title: "aidd-plan (AiDD Planning Phase)",
					prompt: "¿Cuál es la idea del producto que deseas planificar?",
					placeHolder: "Ej. Aplicación de seguimiento nutricional...",
				});
				if (!entered || !entered.trim()) return undefined;
				input = entered.trim();
				promptText = `Ejecuta el workflow '${pick.name}' con la siguiente idea de producto:\n${input}`;
			} else if (pick.name === "aidd-ship") {
				promptText = `Ejecuta el workflow '${pick.name}'`;
			} else {
				const entered = await vscode.window.showInputBox({
					title: `Workflow ${pick.name}`,
					prompt: pick.detail
						? `Argumentos: ${pick.detail}`
						: "¿Qué deseas procesar?",
				});
				if (entered === undefined) return undefined;
				input = entered.trim();
				promptText = input
					? `Ejecuta el workflow '${pick.name}' con: ${input}`
					: `Ejecuta el workflow '${pick.name}'`;
			}
			post({
				type: "info",
				text: `▶ Lanzando patrón agéntico '${pick.name}'…`,
				level: "info",
			});
			await s.session.prompt(promptText);
			return undefined; // Ya despachado al motor agéntico
		}

		const input = await vscode.window.showInputBox({
			title: `Input para ${pick.name}`,
			prompt: "¿Qué quieres que haga el workflow?",
		});
		if (input === undefined) return undefined;
		return { name: pick.name, input: input.trim() };
	}

	// /wf check → QuickPick con todos los issues (carga + validación); al elegir,
	// abre el archivo (en la línea si se parsea del mensaje de carga).
	async function checkWorkflows(loaded: LoadedWorkflows): Promise<void> {
		type IssuePickItem = vscode.QuickPickItem & {
			file?: string;
			line?: number;
		};
		const items: IssuePickItem[] = [];
		for (const issue of loaded.issues) {
			items.push({
				label: issue.severity === "error" ? "✗ carga" : "⚠ carga",
				description: issue.path ?? "",
				detail: issue.message,
				file: issue.path,
				line: parseLineNum(issue.message),
			});
		}
		for (const [name, wf] of loaded.workflows) {
			const source = loaded.sources.get(name);
			const file = source && source !== "(built-in)" ? source : undefined;
			for (const i of validateWorkflow(wf)) {
				items.push({
					label: i.severity === "error" ? `✗ ${name}` : `⚠ ${name}`,
					description: i.stage ? `stage ${i.stage}` : "",
					detail: i.message,
					file,
				});
			}
		}
		if (items.length === 0) {
			vscode.window.showInformationMessage("✓ Todos los workflows validan OK.");
			return;
		}
		const pick = await vscode.window.showQuickPick(items, {
			title: `Workflows · ${items.length} issue(s)`,
			placeHolder: "Selecciona un issue para abrir su archivo",
			matchOnDetail: true,
		});
		if (!pick || !pick.file) return;
		await openAtLine(pick.file, pick.line);
	}

	async function openAtLine(file: string, line?: number): Promise<void> {
		const doc = await vscode.workspace.openTextDocument(file);
		const ln = line && line > 0 ? line - 1 : 0;
		const pos = new vscode.Position(ln, 0);
		await vscode.window.showTextDocument(doc, {
			selection: new vscode.Range(pos, pos),
		});
	}

	/** Primer nº de línea en un mensaje de error (":12:3" o "(12,3)"). */
	function parseLineNum(msg: string): number | undefined {
		const m = msg.match(/(?::|\()\s*(\d+)/);
		return m ? Number(m[1]) : undefined;
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
		if (!config.defaults && !config.skills && !config.agents && !config.stages) {
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

	// /skills: lista las skills disponibles con su sintaxis $name (porte de
	// pi-multi-skills). Lee el registry de skills de la sesión y muestra nombre +
	// /skills y /skills-search: overlay navegable de skills (SkillsPanel, Remote
	// React). Sustituye a la toast efímera — persistente, con búsqueda en vivo,
	// scroll y botón "insertar" que manda $name al composer (composer_insert).
	let skillsPanelHandle: { unmount: () => void } | undefined;
	function mountSkillsPanel(initialQuery: string): void {
		const skills: any[] =
			frida?.session?.resourceLoader?.getSkills?.()?.skills ?? [];
		if (skills.length === 0) {
			post({
				type: "info",
				text:
					"No hay skills instaladas. Colócalas en ~/.frida/skills/ o .frida/skills/ y recarga con /reload.",
			});
			return;
		}
		const rows = skills.map((s) => ({
			name: String(s.name),
			description: String(s.description ?? ""),
		}));
		skillsPanelHandle?.unmount();
		skillsPanelHandle = frida!.webBridge.mountPersistent(
			() =>
				createSkillsPanelElement(
					rows,
					initialQuery,
					(text) => post({ type: "composer_insert", text }),
					() => {
						skillsPanelHandle?.unmount();
						skillsPanelHandle = undefined;
					},
				),
			"overlay",
		);
	}
	function postSkillsCommand(): void {
		if (!frida?.session) {
			post({
				type: "info",
				text: "No hay sesión activa. Abre Frida para ver las skills.",
			});
			return;
		}
		mountSkillsPanel("");
	}

	// /skills-search <palabra>: abre el mismo overlay con el filtro precargado.
	function postSkillsSearchCommand(arg: string): void {
		if (!arg) {
			post({ type: "info", text: "Uso: /skills-search <palabra>" });
			return;
		}
		if (!frida?.session) {
			post({ type: "info", text: "No hay sesión activa." });
			return;
		}
		mountSkillsPanel(arg);
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
				() => createAuditPanelElement(entries, () => auditPanelHandle?.unmount()),
				"overlay",
			);
		} catch (e) {
			post({ type: "info", text: `No se pudo leer la auditoría: ${e}` });
		}
	}

	// /gates-config fue retirado (#55): su reemplazo es Configuración >
	// Auto-aprobación en el webview (mismo config-store como fuente de verdad).

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
				text:
					"No se pudo clonar la sesión (espera al primer mensaje del asistente).",
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
		// Comandos de EXTENSIÓN (/ccplugin, /wiki-*, /memory-*): no requieren
		// modelo ni auth — el SDK los despacha ANTES de su propio gate de auth
		// (diseño deliberado: "Extension commands manage their own LLM interaction").
		// Sin esto, /ccplugin list --available moriría en need_key sin salida
		// alguna si no hay key configurada (reporte e2e #49: "no hizo nada").
		const extCmd = trimmed.match(/^\/[\w-]+/)?.[0]?.slice(1);
		if (
			extCmd &&
			session.extensionApi
				?.getCommands?.()
				.some((c: { name: string }) => c.name === extCmd)
		) {
			await session.session.prompt(trimmed);
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

		// B1: si es /skill:, expandir AHORA (reutiliza frida-args) para que el
		// webview muestre el bloque <skill> en vivo y el modelo reciba idéntico.
		// El bloque ya envuelto pasa intacto por la guardia de re-entrada del hook
		// input de frida-args → sin doble expansión ni doble ejecución de shell.
		let skillBlock: string | null = null;
		if (expanded.startsWith("/skill:") && session.extensionApi) {
			try {
				skillBlock = await expandSkillText(expanded, {
					pi: session.extensionApi,
					sessionId: session.sessionManager?.getSessionId?.() ?? "",
					cwd: workspaceCwd(),
				});
			} catch {
				skillBlock = null; // cualquier fallo → comportamiento por defecto
			}
		}
		// B2: si hay `$skill_name` inline (y no era /skill:), expandir AHORA vía
		// frida-multi-skills. Paridad con /skill:: el webview muestra el bloque
		// <skill> en vivo y el modelo recibe idéntico. Múltiples skills se mergean
		// en UN bloque (name="a, b"). El bloque resultante empieza con `<skill ` →
		// pasa intacto por la guardia de re-entrada del hook input de frida-args y
		// de frida-multi-skills (sin $ que re-expandir). Precedencia: /skill: gana
		// sobre $skill (son mutuamente excluyentes en la práctica).
		let multiSkill: ExpandMultiSkillResult | null = null;
		if (!skillBlock && expanded.includes("$") && session.extensionApi) {
			try {
				multiSkill = await expandMultiSkillText(expanded, {
					pi: session.extensionApi,
					sessionId: session.sessionManager?.getSessionId?.() ?? "",
					cwd: workspaceCwd(),
				});
			} catch {
				multiSkill = null; // cualquier fallo → comportamiento por defecto
			}
			if (multiSkill && multiSkill.unresolved.length > 0) {
				post({
					type: "info",
					level: "warning",
					text: `Skills desconocidas: ${multiSkill.unresolved.join(", ")}. Usa /skills para ver las disponibles.`,
				});
			}
		}
		// Slash command /ask: instrucción explícita para formular preguntas usando ask_user_question
		const askPrompt = expandAskPrompt(expanded);

		// toSend = lo que recibe el modelo; toPost = lo que ve el webview. Para
		// skills (/skill: o $skill) ambos son el bloque; para /ask es el prompt estructurado;
		// para @files/normal se preserva el comportamiento actual (post raw, send expandido con @files
		// ya sustituidos).
		const toSend = askPrompt ?? multiSkill?.transformed ?? skillBlock ?? expanded;
		const toPost = multiSkill?.transformed ?? skillBlock ?? trimmed;

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
			queueStore.add(toPost, mode); // subscribe → postQueued
			try {
				await session.session.prompt(toSend, {
					streamingBehavior: mode,
					images: imgs,
				});
			} catch (e: any) {
				queueStore.removeLastByText(toPost); // subscribe → postQueued
				post({ type: "error", text: String(e?.message ?? e) });
			}
			return;
		}

		// Agente libre: turno normal. El busy lo marcan los eventos agent_start/end
		// reales de pi (no turn_start/turn_end manuales).
		post({
			type: "user",
			text: toPost,
			images: imgs?.map((i) => ({ data: i.data, mimeType: i.mimeType })),
		});
		try {
			await session.session.prompt(toSend, imgs ? { images: imgs } : undefined);
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
				text:
					"Espera a que Frida termine de procesar para ejecutar bash directo (!).",
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

	async function requestYoloGate(): Promise<boolean> {
		const item = await vscode.window.showWarningMessage(
			"Modo YOLO: Frida podrá ejecutar comandos (incl. bash compuestos), editar y crear archivos SIN pedir confirmación. Detén con el botón Detener o doble Esc.",
			{ modal: true },
			"Activar YOLO",
		);
		return item === "Activar YOLO";
	}

	async function abortRun(): Promise<void> {
		// #96: delega al módulo testeable src/abort-run.ts. La versión inline tenía
		// un doble desestructurado (`const s = session.session` con `session` YA
		// siendo el AgentSession) que volvió no-op TODOS los aborts — firma forense:
		// isIdle=? en ~/.frida/logs/abort.log (98/98 pre-aborts históricos).
		await abortRunWithDeps({
			ensureSession,
			abortDiag,
			queueStore,
			resetQueue,
			post,
			isInRetry: () => inRetry,
			abortGate,
			abortGateTtlMs: ABORT_GATE_TTL_MS,
		});
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
			postPermissionsConfig(); // #55: panel de auto-aprobación sincronizado.
			frida.webBridge.dispose();
			// Desmonta el widget de agentes (para re-montarlo con el nuevo webBridge al
			// recrear la sesión) y suelta el listener del conteo de subagentes.
			unmountAgentWidget();
			setAgentWidgetListener(undefined);
			// frida-subagents: prunear worktrees huérfanos de la sesión que cierra
			// (crash recovery). El dispose del SDK no emite session_shutdown, así que
			// un agente con isolation: worktree interrumpido dejaría un worktree en
			// ~/.frida/worktrees/. Equivalente al session_shutdown de pi-subagents.
			pruneAllWorktrees();
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

	async function sendSessions(
		scope: "project" | "all" = "project",
	): Promise<void> {
		try {
			// "project": SessionManager.list(cwd, sessionDir) filtra por el cwd del
			// workspace (el SDK compara session.cwd vía sessionCwdMatches). "all":
			// listAll muestra todas, sin filtrar.
			const infos =
				scope === "all"
					? await SessionManager.listAll(sessionDirPath)
					: await SessionManager.list(workspaceCwd(), sessionDirPath);
			const items = infos
				.map((i: any) => {
					// Stats por sesión (tiempo + tokens) leídos del JSONL en disco.
					// readSessionStats cachea por mtime; el SDK ya leyó el archivo para
					// firstMessage/messageCount, así que el costo extra es indexar usage.
					const stats = readSessionStats(i.path);
					const durationMs =
						stats && stats.firstTs && stats.lastTs
							? stats.lastTs - stats.firstTs
							: undefined;
					return {
						path: String(i.path),
						cwd: String(i.cwd ?? ""),
						name: i.name as string | undefined,
						firstMessage: String(i.firstMessage ?? "").slice(0, 160),
						messageCount: Number(i.messageCount ?? 0),
						modified:
							i.modified instanceof Date
								? i.modified.getTime()
								: Number(i.modified) || 0,
						durationMs,
						inputTotal: stats?.inputTotal,
						outputTotal: stats?.outputTotal,
						// #107 — paridad con el chip del header: el mismo readSessionStats
						// ya calcula tiempo activo y turnos; passthrough sin IO extra.
						activeMs: stats?.activeMs,
						turnCount: stats?.turnCount,
						cost: stats?.cost || undefined,
					};
				})
				.sort((a: any, b: any) => b.modified - a.modified);
			post({
				type: "sessions",
				items,
				currentPath: frida?.session?.sessionFile,
				scope,
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
				// #89 (parte 2, repro 20:52–20:54): sin activeModel, el switch
				// caía al fallback DevEngine SILENCIOSO («sin saved») → BASELINE
				// divergente → tarjeta AUTO-CHANGE en el primer agent_end («cambió
				// de proveedor sin pedirlo»). El modelo del host es lo que la UI
				// muestra: la sesión continuada debe respetarlo.
				activeModel,
				getKeyFor: (id: string) => keyCaches[id],
				onUnauthorized: (id: string) => {
					delete keyCaches[id];
					void promptKey(id, "unauthorized");
				},
				onPendingApprovals: (reqs: ApprovalRequest[]) => {
					post({ type: "approvals", approvals: reqs });
				},
				onUiRequest: (reqs) => post({ type: "ui_requests", items: reqs }),
				onUiNotify: (message, level) => post({ type: "ui_notify", message, level }),
				onWebCommit: (rootId, tree, placement) =>
					post({ type: "web_commit", rootId, tree, placement }),
				onQuestionnaire: (reqs) =>
					post({ type: "questionnaire", req: reqs[0] ?? null }),
				onGateStats: (s) => post({ type: "gate_stats", stats: s }),
				getContext7Key,
				getMode: () => approvalMode,
				askUserQuestionEnabled: isAskUserQuestionEnabled,
				todoEnabled: isTodoEnabled,
				contextEnabled: isContextEnabled,
				getGatePatterns: readGatePatterns,
				onLensDiagnostics: mergeLens,
				onGoalState: (goal) => postGoalState(goal),
				onGoalNotify: (_level, text) => post({ type: "info", text }),
				onProviderError,
				requestDumpPath,
				diagnosticDumpPath,
				onGatewayDiagnosis,
				codebaseIndexEnabled: isCodebaseIndexEnabled,
				hermesMemoryEnabled: isHermesMemoryEnabled,
				onHermesMemoryState: handleHermesMemoryState,
				knowledgeBaseEnabled: isKnowledgeBaseEnabled,
				onKnowledgeBaseState: handleKnowledgeBaseState,
				ccPluginsEnabled: isCcPluginsEnabled,
				onCcPluginsState: handleCcPluginsState,
				ccPluginsExtraMarketplaces: readCcPluginsExtraMarketplaces,
				ccPluginsEnabledPlugins: readCcPluginsEnabledPlugins,
				ccPluginsPresenter: createCcPluginsPresenter(),
				ccPluginsPanel: handleCcPanel,
				sandboxesEnabled: isSandboxesEnabled,
				sandboxesDefaultImage: readSandboxesDefaultImage,
				sandboxesAllowDomains: readSandboxesAllowDomains,
				sandboxesPanel: handleSandboxPanel,
				detachedPanel: handleDetachedPanel,
				// Toggles Fase 2 (#53): gates de módulos conmutables.
				subagentsEnabled: isSubagentsEnabled,
				agentBrowserEnabled: isAgentBrowserEnabled,
				supiWebEnabled: isSupiWebEnabled,
				mcpAdapterEnabled: isMcpAdapterEnabled,
				extensibleWorkflowsEnabled: isExtensibleWorkflowsEnabled,
				gitSyncEnabled: isGitSyncEnabled,
				worktreeEnabled: isWorktreeEnabled,
				onCodebaseIndexState: (s) => {
					ciUi = s;
					postCodebaseIndexState();
				},
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
					if (segs.length > 0) items.push({ role: "assistant", segments: segs });
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
			// Moonshot: al configurar por primera vez (sin modelo activo aún),
			// pre-seleccionar kimi-k3 como default del provider.
			if (providerId === MOONSHOT_PROVIDER && !activeModel) {
				const defaultId = moonshotDefaultModelId();
				if (defaultId) await selectModel(providerId, defaultId);
			}
			// OpenAI: al configurar por primera vez (sin modelo activo aún),
			// pre-seleccionar gpt-5 como default del provider.
			if (providerId === OPENAI_PROVIDER && !activeModel) {
				const defaultId = openaiDefaultModelId();
				if (defaultId) await selectModel(providerId, defaultId);
			}
			postResources();
		} else {
			bootstrapSession(); // crea sesión y publica recursos al terminar el onboarding
		}
		post({ type: "key_set" });
		post({ type: "session_ready" });
	}

	// frida-supi-web: API key de Context7 en SecretStorage (servicio NO-LLM, por eso
	// vive fuera de API_KEY_PROVIDERS). Se gestiona con `/login context7` /
	// `/logout context7`. El cache síncrono alimenta el getter getContext7Key.
	async function setContext7Key(key: string): Promise<void> {
		const trimmed = key.trim();
		if (!trimmed) return;
		await context.secrets.store(CONTEXT7_SECRET_KEY, trimmed);
		context7KeyCache = trimmed;
		post({
			type: "info",
			text:
				"API key de Context7 guardada. Las tools `web_docs_search`/`web_docs_fetch` ya pueden usarla.",
		});
	}

	async function promptContext7Key(): Promise<void> {
		const key = await vscode.window.showInputBox({
			prompt:
				"Introduce tu API key de Context7 (se envía como Authorization: Bearer). Consíguela gratis en https://context7.com/dashboard.",
			password: true,
			ignoreFocusOut: true,
		});
		if (key) await setContext7Key(key);
	}

	async function clearContext7Key(): Promise<void> {
		await context.secrets.delete(CONTEXT7_SECRET_KEY);
		context7KeyCache = "";
		post({ type: "info", text: "API key de Context7 eliminada." });
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

	// Genera el mensaje de commit del diff staged con el LLM activo y lo deja en el
	// textbox del SCM para commit manual (issue #9). Reutiliza el patrón de
	// generateSessionTitle: sesión efímera sin tools, mismo modelRuntime/model.
	async function generateCommitMessageCmd(): Promise<void> {
		await runGenerateCommitMessage({
			modelRuntime: frida?.modelRuntime,
			model: frida?.session?.model,
			cwd: workspaceCwd(),
			agentDir: defaultAgentDir(),
		});
	}

	// Gestiona git worktrees (add / abrir / remove / prune / configure) y abre cada
	// worktree en una ventana VS Code nueva: una por requisito, sin choques. Porte
	// nativo de @narumitw/pi-worktree (issue #13).
	async function worktreeCmd(): Promise<void> {
		// Gate #53: si frida-worktree está apagado, aviso honesto en vez de correr.
		if (!isWorktreeEnabled()) {
			void vscode.window.showInformationMessage(
				"frida-worktree está desactivado (frida.worktree.enabled en la configuración). Actívalo en Configuración > Herramientas.",
			);
			return;
		}
		await runWorktreeCommand({ cwd: workspaceCwd() });
	}

	// Exporta el reporte de uso (frida-usage-report/v1) para el concentrador externo.
	// Opt-in inline: sólo incluye email/org si el usuario lo permite (exporta anónimo si no).
	async function exportUsage(): Promise<void> {
		const periodPick = await vscode.window.showQuickPick(
			[
				{ label: "Todo", value: "all" as const },
				{ label: "Últimos 30 días", value: "30d" as const },
				{ label: "Últimos 7 días", value: "7d" as const },
				{ label: "Hoy", value: "today" as const },
			],
			{ placeHolder: "Periodo del reporte de uso" },
		);
		if (!periodPick) return;
		const period = periodPick.value;

		let optIn = isTelemetryOptIn();
		if (!optIn) {
			const consent = await vscode.window.showQuickPick(
				[
					{ label: "Sí, incluir mi email/org", value: true },
					{ label: "No, exportar anónimo", value: false },
				],
				{
					placeHolder:
						"¿Incluir tu email/organización en el reporte? (puedes cambiarlo después en Configuración)",
				},
			);
			if (consent === undefined) return;
			optIn = consent.value;
			if (optIn) await setTelemetryOptIn(true);
		}

		const { snapshot, periodFrom, periodTo } = indexUsage({
			sessionsDir: sessionDirPath,
			period,
		});
		const full = resolveIdentity();
		const identity = optIn ? full : { ...full, email: "" };
		const report = buildReport({
			snapshot,
			identity,
			detailLevel: "structured",
			period,
			periodFrom,
			periodTo,
			clientVersion: fridaVersion,
		});

		const json = JSON.stringify(report, null, 2);
		await vscode.window.showTextDocument(
			await vscode.workspace.openTextDocument({
				content: json,
				language: "json",
			}),
		);
		const uri = await vscode.window.showSaveDialog({
			defaultUri: vscode.Uri.file(
				`frida-usage-${new Date().toISOString().slice(0, 10)}.json`,
			),
			filters: { JSON: ["json"] },
		});
		if (uri) {
			await vscode.workspace.fs.writeFile(uri, Buffer.from(json, "utf8"));
			vscode.window.showInformationMessage(
				`Reporte de uso guardado en ${uri.fsPath}`,
			);
		}
	}

	context.subscriptions.push(
		// Trackear si la ventana de VS Code tiene el foco. Sirve para notificar con
		// sonido al terminar una petición sólo si el usuario se fue a otra app.
		vscode.commands.registerCommand(
			"frida.exportUsage",
			() => void exportUsage(),
		),
		vscode.commands.registerCommand(
			"frida.generateCommitMessage",
			() => void generateCommitMessageCmd(),
		),
		vscode.commands.registerCommand("frida.worktree", () => void worktreeCmd()),
		// frida.codebaseIndex (ADR-0036): abre el SettingsHub en el tab Index. El
		// post directo cubre apertura en caliente; el flush de webview_ready el
		// arranque frío (el listener del webview monta ahí).
		vscode.commands.registerCommand("frida.codebaseIndex", () => {
			pendingSettingsTab = "codebaseIndex";
			void vscode.commands.executeCommand("frida.openPanel").then(() => {
				// En caliente (webview ya montado) el post directo llega confiable:
				// limpiamos el pendiente para que un re-mount posterior NO reabra el
				// tab solo. En frío lo dejamos seteado: el listener aún no existe, el
				// post se perdería y el flush de webview_ready es quien abre el tab.
				if (webviewReady) {
					post({ type: "open_settings", tab: "codebaseIndex" });
					pendingSettingsTab = undefined;
				}
			});
		}),
		// M2 (#143) — abre el SettingsHub en el tab Mapa (molde frida.codebaseIndex:
		// post directo en caliente, flush de webview_ready en frío).
		vscode.commands.registerCommand("frida.projectMap", () => {
			pendingSettingsTab = "projectMap";
			void vscode.commands.executeCommand("frida.openPanel").then(() => {
				if (webviewReady) {
					post({ type: "open_settings", tab: "projectMap" });
					pendingSettingsTab = undefined;
				}
			});
		}),
		vscode.window.onDidChangeWindowState((s) => {
			vscodeWindowFocused = s.focused;
		}),
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
		vscode.commands.registerCommand("frida.showWorkflows", () => {
			// #84: visibilidad forzada — pide el render (empty state «Sin runs» si
			// hace falta) y enfoca el webview.
			requestPanelShow();
			void vscode.commands.executeCommand("frida.codeView.focus");
		}),
		// #84: ancla permanente — conteo vivo de runs; click = mostrar el panel.
		(() => {
			const item = vscode.window.createStatusBarItem(
				vscode.StatusBarAlignment.Right,
				97,
			);
			item.name = "Frida Workflows";
			item.command = "frida.showWorkflows";
			item.tooltip = "Frida Workflows — clic para mostrar el panel";
			const render = () => {
				const rs = getWorkflowRuns();
				const act = rs.filter(
					(r) => r.state === "running" || r.state === "awaiting",
				);
				const running = rs.reduce(
					(n, r) => n + r.agents.filter((a) => a.state === "running").length,
					0,
				);
				item.text = act.length
					? `$(${running > 0 ? "sync~spin" : "play"}) wf ${act.length}`
					: "$(circle-outline) wf";
				item.show();
			};
			render();
			const off = subscribeWorkflowRuns(render);
			return new vscode.Disposable(() => {
				off();
				item.dispose();
			});
		})(),
		vscode.commands.registerCommand("frida.openHelp", async () => {
			// /help desde la paleta: picker de README + herramientas.
			type HelpItem = vscode.QuickPickItem & { rel?: string };
			const items: HelpItem[] = [
				{ label: "Frida Code — Índice general (README)", rel: "README.md" },
				// Con how-to: dos filas explícitas (guía + referencia).
				...HELP_TOOLS.flatMap((t) =>
					t.howTo && t.howTo !== t.file
						? [
								{
									label: t.label,
									description: "guía de uso",
									rel: t.howTo,
								},
								{
									label: t.label,
									description: "referencia técnica",
									rel: t.file,
								},
							]
						: [
								{
									label: t.label,
									description: "herramienta",
									rel: t.file,
								},
							],
				),
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
		vscode.commands.registerCommand("frida.compact", () => void compactContext()),
		vscode.commands.registerCommand("frida.reload", () => void reloadResources()),
		vscode.commands.registerCommand("frida.abort", () => void abortRun()),
		vscode.commands.registerCommand("frida.newSession", () => void newSession()),
		vscode.commands.registerCommand("frida.approvalMode", async () => {
			const next: PermissionMode = approvalMode === "manual" ? "auto" : "manual";
			if (next !== "manual") {
				const ok = await requestYoloGate();
				if (!ok) return;
			}
			approvalMode = next;
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
					text:
						"🧪 Diagnosticando thinking: envío un mensaje de prueba al proveedor y mido si devuelve razonamiento…",
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
							thinkingDeltas > 0 || (typeof reasoning === "number" && reasoning > 0);
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
							preview: "# Tarjetas\n\n```\n┌───┐ ┌───┐\n│ A │ │ B │\n└───┘ └───┘\n```",
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
				const result = await s.askUserQuestion(sample);
				post({
					type: "info",
					text: `QuestionsPanel: ${JSON.stringify(result)}`,
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
