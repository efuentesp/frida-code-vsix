import { useEffect, useState } from "react";
import { Codicon } from "./Codicon";
import type { CodebaseIndexUiState, OutMessage, State } from "../types";

/** Formatea segundos como m:ss (el reloj de la barra de progreso). */
function fmtElapsed(totalSec: number): string {
	const m = Math.floor(totalSec / 60);
	const s = totalSec % 60;
	return `${m}:${String(s).padStart(2, "0")}`;
}

/** Miles con coma para contadores (500 → 500, 1100 → 1,100). #109 */
function fmtCount(n: number): string {
	return n.toLocaleString("en-US");
}

/** Fases del coordinador upstream → etiqueta humana. #109 */
const PHASE_LABELS: Record<string, string> = {
	scanning: "escaneando",
	parsing: "parseando",
	embedding: "vectorizando",
};

/** Nombres legibles de proveedores de embeddings (#114) — espejo de
 *  getProviderDisplayName del upstream (open-codebase-index). */
const PROVIDER_LABELS: Record<string, string> = {
	"github-copilot": "GitHub Copilot",
	openai: "OpenAI",
	google: "Google (Gemini)",
	ollama: "Ollama (Local)",
	custom: "Custom (OpenAI-compatible)",
};

/** Etiqueta del motor del banner: metadata REAL del índice o fallback al
 *  setting (auto/ollama/custom). #114 */
function engineLabel(providerMode: string, metaLabel: string | null): string {
	if (metaLabel) return metaLabel;
	if (providerMode === "ollama") return "Ollama Local";
	if (providerMode === "custom") return "Endpoint Custom";
	return "Auto (Ollama/OpenAI)";
}

interface ToolMeta {
	name: string;
	title: string;
	desc: string;
	icon: string;
}

const INDEX_TOOLS: ToolMeta[] = [
	{
		name: "semantic_search",
		title: "Búsqueda Semántica",
		desc: "Búsqueda de código por intención o significado en lenguaje natural.",
		icon: "search",
	},
	{
		name: "semantic_context",
		title: "Contexto Semántico",
		desc:
			"Contexto relevante estructurado para enriquecer los prompts del agente.",
		icon: "sparkle",
	},
	{
		name: "call_graph",
		title: "Grafo de Llamadas",
		desc: "Trazado de jerarquías de llamadas de funciones (caller y callee).",
		icon: "references",
	},
	{
		name: "implementation_lookup",
		title: "Lookup de Implementación",
		desc: "Localización rápida de definiciones e implementaciones de símbolos.",
		icon: "symbol-method",
	},
	{
		name: "index_codebase",
		title: "Indexador del Workspace",
		desc:
			"Indexación incremental de archivos modificados o reconstrucción total.",
		icon: "refresh",
	},
	{
		name: "index_status",
		title: "Salud y Diagnóstico",
		desc:
			"Diagnóstico de frescura, archivos indexados y estado del vector store.",
		icon: "pulse",
	},
];

/** Cuerpo de la sección Archivos (#112): sin anidar ternarios. */
function FilesBody({
	idxFiles,
	filtered,
	query,
}: {
	idxFiles: NonNullable<State["codebaseIndexFiles"]>;
	filtered: { path: string; chunks: number; language: string }[];
	query: string;
}) {
	if (!idxFiles.available) {
		return (
			<div className="ci-files-empty">
				Sin índice construido en este workspace — ejecuta «Indexar» para crearlo.
			</div>
		);
	}
	return (
		<>
			<div className="ci-files-list">
				{filtered.length === 0 && (
					<div className="ci-files-empty">
						Ningún archivo coincide con «{query}».
					</div>
				)}
				{filtered.map((f) => (
					<div key={f.path} className="ci-file-row">
						<span className="ci-file-path" title={f.path}>
							{f.path}
						</span>
						<span className="ci-file-meta">{f.language}</span>
						<span className="ci-file-chunks">{f.chunks}</span>
					</div>
				))}
			</div>
			{idxFiles.failed.length > 0 && (
				<div className="ci-files-failed">
					<div className="ci-files-failed-head">
						<Codicon name="warning" size={13} /> Fallidos en embedding (
						{idxFiles.failed.length} archivos)
					</div>
					{idxFiles.failed.slice(0, 10).map((f) => (
						<div key={f.path} className="ci-file-row is-failed">
							<span className="ci-file-path" title={f.path}>
								{f.path}
							</span>
							<span className="ci-file-chunks">{f.chunks}</span>
						</div>
					))}
				</div>
			)}
		</>
	);
}

/**
 * #113 — Diálogo de confirmación para detener la indexación.
 *
 * El upstream no expone cancelación limpia (la tool descarta la señal de
 * aborto), así que detener = recargar el extension host. Puro: solo recibe
 * callbacks. Esc cancela, Enter confirma (patrón ModelConfirmDialog).
 */
export function StopIndexDialog({
	onConfirm,
	onCancel,
}: {
	onConfirm: () => void;
	onCancel: () => void;
}) {
	return (
		<div
			className="model-diff-overlay"
			role="dialog"
			aria-modal="true"
			aria-label="Detener indexación"
			onKeyDown={(e) => {
				if (e.key === "Escape") {
					e.preventDefault();
					onCancel();
				}
				if (e.key === "Enter") {
					e.preventDefault();
					onConfirm();
				}
			}}
		>
			<div className="stp-stop-card ci-stop-card">
				<div className="ci-stop-title">
					<Codicon name="debug-stop" size={16} /> Detener la indexación
				</div>
				<div className="ci-stop-text">
					El paquete no permite cancelar en caliente: se{" "}
					<strong>recargará la ventana de VS Code</strong> para cortar la corrida. Es
					seguro — el índice es incremental: al volver a indexar{" "}
					<strong>retomará desde donde quedó</strong>
					(los archivos ya procesados se saltan y los chunks fallidos se reintentan).
				</div>
				<div className="ci-stop-actions">
					<button
						type="button"
						className="model-diff-btn secondary"
						onClick={onCancel}
					>
						Seguir indexando
					</button>
					<button
						type="button"
						className="model-diff-btn primary"
						onClick={onConfirm}
					>
						<Codicon name="debug-stop" size={13} /> Detener y recargar
					</button>
				</div>
			</div>
		</div>
	);
}

/** Proveedores seleccionables (#116/#117). */
export type EmbProviderId =
	| "auto"
	| "frida-enterprise"
	| "ollama"
	| "openai"
	| "custom";

/** Estado de semáforo por proveedor (#117). */
interface EmbCardState {
	id: "frida-enterprise" | "ollama" | "openai" | "custom";
	name: string;
	icon: string;
	/** ok=verde · warn=ámbar · error=rojo · neutral=gris (custom) */
	level: "ok" | "warn" | "error" | "neutral";
	label: string;
}

const EMB_MODELS: Record<string, string[]> = {
	"frida-enterprise": ["azure-embeddings-default"],
	ollama: ["nomic-embed-text", "mxbai-embed-large"],
	openai: ["text-embedding-3-small", "text-embedding-3-large"],
};

const EMB_NAMES: Record<string, string> = {
	"frida-enterprise": "Frida Enterprise",
	ollama: "Ollama Local",
	openai: "OpenAI API",
	custom: "Endpoint Custom",
};

const EMB_CARD_IDS = [
	"frida-enterprise",
	"ollama",
	"openai",
	"custom",
] as const;

/** Tarjeta individual de proveedor (#117). Extraída para bajar complejidad. */
function EmbProviderCard({
	id,
	st,
	selected,
	result,
	modelOpts,
	model,
	locking,
	enterpriseAuthed,
	customBaseUrl,
	copiedOllama,
	onPing,
	onSelect,
	onLogin,
	onCopyOllama,
}: {
	id: (typeof EMB_CARD_IDS)[number];
	st: EmbCardState;
	selected: boolean;
	result?: {
		ok: boolean;
		latencyMs?: number;
		dimensions?: number;
		error?: string;
	};
	modelOpts?: string[];
	model?: string;
	locking: boolean;
	enterpriseAuthed: boolean;
	customBaseUrl?: string;
	copiedOllama: boolean;
	onPing: (provider: EmbCardState["id"], model?: string) => void;
	onSelect: (provider: EmbProviderId, model?: string) => void;
	onLogin: (provider: string) => void;
	onCopyOllama: () => void;
}) {
	const badgeCls =
		st.level === "ok" ? "is-ok" : st.level === "warn" ? "is-warn" : "is-error";
	const stop = (fn: () => void) => (e: { stopPropagation(): void }) => {
		e.stopPropagation();
		fn();
	};
	return (
		<div
			className={`cfg-env-card ${selected ? "is-installed" : ""} ci-emb-card`}
			onClick={() => !locking && onSelect(id)}
		>
			<div className="ci-emb-head">
				<Codicon name={st.icon} size={15} />
				<span className="ci-emb-name">{st.name}</span>
				{st.level === "neutral" ? (
					<span className="cfg-env-badge">{st.label}</span>
				) : (
					<span className={`cfg-env-badge ${badgeCls}`}>{st.label}</span>
				)}
				{selected && <span className="cfg-env-badge is-ok">Activo</span>}
			</div>
			<div className="ci-emb-desc">
				{id === "frida-enterprise" &&
					"Endpoint corporativo con la sesión OAuth de Frida."}
				{id === "ollama" && "Privacidad total en tu máquina; sin costo por token."}
				{id === "openai" && "API key gestionada en Frida (SecretStorage)."}
				{id === "custom" && "vLLM, LiteLLM o servidores OpenAI-compatible."}
			</div>
			<div className="ci-emb-controls">
				{modelOpts && modelOpts.length > 0 ? (
					<select
						className="bar-select"
						value={model ?? modelOpts[0]}
						disabled={locking}
						onChange={(e) => {
							e.stopPropagation();
							onSelect(id, e.target.value);
						}}
					>
						{modelOpts.map((m) => (
							<option key={m} value={m}>
								{m}
							</option>
						))}
					</select>
				) : id === "custom" ? (
					<span className="ci-emb-hint">{customBaseUrl || "(settings)"}</span>
				) : null}
				{id === "frida-enterprise" && !enterpriseAuthed && (
					<button
						type="button"
						className="model-diff-btn secondary"
						onClick={stop(() => onLogin("frida-enterprise"))}
					>
						Iniciar sesión
					</button>
				)}
				{id === "ollama" && (
					<button
						type="button"
						className={`model-diff-btn secondary ${copiedOllama ? "copied" : ""}`}
						onClick={stop(onCopyOllama)}
					>
						{copiedOllama ? "¡Copiado!" : "ollama pull…"}
					</button>
				)}
				<button
					type="button"
					className="ci-emb-ping"
					onClick={stop(() => onPing(id, model))}
				>
					<Codicon name="radio-tower" size={12} /> Probar conexión
				</button>
			</div>
			{result && (
				<div className={`ci-emb-result ${result.ok ? "is-ok" : "is-error"}`}>
					{result.ok ? (
						<>
							<Codicon name="pass" size={12} /> {result.latencyMs}ms ·{" "}
							{result.dimensions}d
						</>
					) : (
						<>
							<Codicon name="error" size={12} /> {result.error}
						</>
					)}
				</div>
			)}
		</div>
	);
}

/** Sección MOTOR DE EMBEDDINGS (#117 Fase B): tarjetas interactivas con
 *  semáforo, selector, ping y candado cuando el índice ya existe. */
export function EmbeddingsEngine({
	ci,
	ping,
	locking,
	onPing,
	onSelect,
	onLogin,
	onCopyOllama,
	copiedOllama,
	onOpenChangeDialog,
}: {
	ci: CodebaseIndexUiState;
	ping?:
		| {
				provider: string;
				ok: boolean;
				latencyMs?: number;
				dimensions?: number;
				error?: string;
		  }
		| undefined;
	locking: boolean;
	onPing: (provider: EmbCardState["id"], model?: string) => void;
	onSelect: (provider: EmbProviderId, model?: string) => void;
	onLogin: (provider: string) => void;
	onCopyOllama: () => void;
	copiedOllama: boolean;
	onOpenChangeDialog: () => void;
}) {
	const cfg = ci.config;
	const selected = cfg?.provider ?? "auto";

	const cardState = (id: EmbCardState["id"]): EmbCardState => {
		const meta = EMB_NAMES[id] ?? id;
		if (id === "frida-enterprise") {
			return {
				id,
				name: meta,
				icon: "organization",
				level: cfg?.enterpriseAuthed ? "ok" : "warn",
				label: cfg?.enterpriseAuthed ? "Conectado" : "Requiere iniciar sesión",
			};
		}
		if (id === "ollama") {
			return {
				id,
				name: meta,
				icon: "device-desktop",
				level: "neutral",
				label: "100% Local",
			};
		}
		if (id === "openai") {
			return {
				id,
				name: meta,
				icon: "cloud",
				level: cfg?.openaiAuthed ? "ok" : "error",
				label: cfg?.openaiAuthed ? "API key lista" : "Sin API key",
			};
		}
		return {
			id,
			name: meta,
			icon: "settings",
			level: "neutral",
			label: "Configurable",
		};
	};

	const currentModel = (id: EmbCardState["id"]): string | undefined =>
		id === "frida-enterprise"
			? cfg?.fridaEnterpriseModel
			: id === "ollama"
				? cfg?.ollamaModel
				: id === "openai"
					? cfg?.openaiModel
					: cfg?.customModel;

	return (
		<div className="ci-emb-wrap">
			{locking && (
				<div className="ci-emb-lock">
					<Codicon name="lock" size={13} />
					<span>
						🔒 Bloqueado · Indexado con{" "}
						<strong>
							{PROVIDER_LABELS[ci.indexMeta?.provider ?? ""] ?? ci.indexMeta?.provider}{" "}
							· {ci.indexMeta?.model}
						</strong>
					</span>
					<button
						type="button"
						className="model-diff-btn secondary ci-emb-change-btn"
						onClick={onOpenChangeDialog}
					>
						Cambiar motor de embeddings…
					</button>
				</div>
			)}

			<div className="ci-emb-cards">
				{EMB_CARD_IDS.map((id) => (
					<EmbProviderCard
						key={id}
						id={id}
						st={cardState(id)}
						selected={selected === id}
						result={ping?.provider === id ? ping : undefined}
						modelOpts={EMB_MODELS[id]}
						model={currentModel(id)}
						locking={locking}
						enterpriseAuthed={!!cfg?.enterpriseAuthed}
						customBaseUrl={cfg?.customBaseUrl}
						copiedOllama={copiedOllama}
						onPing={onPing}
						onSelect={onSelect}
						onLogin={onLogin}
						onCopyOllama={onCopyOllama}
					/>
				))}
			</div>

			<div className="ci-emb-auto">
				<label className="ci-emb-auto-label">
					<input
						type="radio"
						name="ci-emb-provider"
						checked={selected === "auto"}
						disabled={locking}
						onChange={() => onSelect("auto")}
					/>
					Automático (Ollama → Copilot → …)
				</label>
				<span className="ci-engine-hint">
					El motor Auto elige el primer proveedor disponible al indexar.
				</span>
			</div>
		</div>
	);
}

/**
 * #117 — Diálogo de cambio de motor con reindexación obligatoria.
 * Contrato de StopIndexDialog/ModelConfirmDialog: Esc cancela, Enter confirma.
 */
export function EmbeddingsChangeDialog({
	current,
	target,
	onConfirm,
	onCancel,
}: {
	current?: { provider: string; model?: string };
	target: { provider: string; model?: string };
	onConfirm: () => void;
	onCancel: () => void;
}) {
	return (
		<div
			className="model-diff-overlay"
			role="dialog"
			aria-modal="true"
			aria-label="Cambiar motor de embeddings"
			onKeyDown={(e) => {
				if (e.key === "Escape") {
					e.preventDefault();
					onCancel();
				}
				if (e.key === "Enter") {
					e.preventDefault();
					onConfirm();
				}
			}}
		>
			<div className="ci-stop-card">
				<div className="ci-stop-title">
					<Codicon name="debug-restart" size={16} /> Cambiar motor de embeddings
				</div>
				{/* Comparativa Actual → Nuevo (badge estilo model-diff) */}
				<div className="model-diff-compare">
					<div className="model-diff-col">
						<span className="model-diff-col-badge">Actual</span>
						<span className="ci-emb-cmp-model">
							{current
								? `${PROVIDER_LABELS[current.provider] ?? EMB_NAMES[current.provider] ?? current.provider}${current.model ? ` · ${current.model}` : ""}`
								: "Auto"}
						</span>
					</div>
					<Codicon name="arrow-right" size={14} />
					<div className="model-diff-col">
						<span className="model-diff-col-badge">Nuevo</span>
						<span className="ci-emb-cmp-model">
							{EMB_NAMES[target.provider] ?? target.provider}
							{target.model ? ` · ${target.model}` : ""}
						</span>
					</div>
				</div>
				<div className="ci-stop-text">
					Cambiar de modelo <strong>invalidará los vectores existentes</strong> en
					<code> .codebase-index/</code>. Se requiere una reconstrucción total para
					habilitar la búsqueda semántica.
				</div>
				<div className="model-diff-actions">
					<button
						type="button"
						className="model-diff-btn secondary"
						onClick={onCancel}
					>
						Cancelar
					</button>
					<button
						type="button"
						className="model-diff-btn primary"
						onClick={onConfirm}
					>
						<Codicon name="debug-restart" size={13} /> Cambiar y Reconstruir Índice
					</button>
				</div>
			</div>
		</div>
	);
}

export function IndexTab({
	state,
	post,
}: {
	state: State;
	post: (m: OutMessage) => void;
}) {
	const ci = state.codebaseIndex;
	const busy = ci?.busy ?? null;
	const isInstalled = !!ci?.installed;

	// Reloj de la acción en curso (#111): deriva de ci.busySince (epoch ms del
	// HOST, vive en el store) — así NO se reinicia al cambiar de pestaña:
	// el componente se desmonta/remonta pero busySince sigue siendo el mismo
	// y el elapsed se recomputa correcto desde el primer render.
	const busySince = ci?.busySince ?? null;
	const [elapsed, setElapsed] = useState(() =>
		busy && busySince ? Math.floor((Date.now() - busySince) / 1000) : 0,
	);
	const [copiedOllama, setCopiedOllama] = useState(false);

	// #112 — lista de archivos en el índice: auto-consulta al montar (si está
	// instalado), colapso + filtro en vivo del lado del cliente.
	const idxFiles = state.codebaseIndexFiles;
	// Abierto por defecto cuando ya hay datos en el store (remount con datos o
	// guía «sin índice»); colapsado en el primer montaje mientras llega la
	// consulta. (Los efectos no corren en SSR: la auto-consulta se prueba en
	// vivo, no con renderToStaticMarkup.)
	const [filesOpen, setFilesOpen] = useState(idxFiles !== undefined);
	const [filesQuery, setFilesQuery] = useState("");
	// #113 — confirmación para detener la indexación (recarga de ventana)
	const [stopOpen, setStopOpen] = useState(false);
	// #117 — target del modal de cambio de motor: undefined=cerrado,
	// null=abierto desde el botón (sin selección previa), objeto=elección.
	const [changeTarget, setChangeTarget] = useState<
		| {
				provider: "auto" | "frida-enterprise" | "ollama" | "openai" | "custom";
				model?: string;
		  }
		| null
		| undefined
	>(undefined);
	useEffect(() => {
		if (isInstalled && !idxFiles) {
			post({ type: "codebase_index_action", action: "files" });
		}
	}, [isInstalled, idxFiles, post]);
	const filteredFiles = (idxFiles?.files ?? []).filter((f) =>
		f.path.toLowerCase().includes(filesQuery.trim().toLowerCase()),
	);

	useEffect(() => {
		setElapsed(
			busy && busySince ? Math.floor((Date.now() - busySince) / 1000) : 0,
		);
	}, [busy, busySince]);

	useEffect(() => {
		if (!busy || !busySince) return;
		const t = setInterval(() => {
			setElapsed(Math.floor((Date.now() - busySince) / 1000));
		}, 1000);
		return () => clearInterval(t);
	}, [busy, busySince]);

	const handleCopyOllama = () => {
		const cmd = "ollama pull nomic-embed-text";
		try {
			if (navigator?.clipboard?.writeText) {
				navigator.clipboard.writeText(cmd);
			}
		} catch {
			/* fallback host */
		}
		post({ type: "copy_text", text: cmd });
		setCopiedOllama(true);
		setTimeout(() => setCopiedOllama(false), 2000);
	};

	const providerMode = ci?.config?.provider ?? "auto";
	// #114 — proveedor/modelo REALES del índice construido (metadata), con
	// nombre legible; solo si existe metadata (índice con embeddings).
	const meta = ci?.indexMeta;
	const metaProvider = meta
		? (PROVIDER_LABELS[meta.provider] ?? meta.provider)
		: null;
	const metaLabel = meta ? `${metaProvider} · ${meta.model}` : null;

	return (
		<div className="cfg-resources ci-tab">
			{/* #113 — diálogo de confirmación para detener (recarga ventana) */}
			{stopOpen && busy !== "install" && (
				<StopIndexDialog
					onConfirm={() => {
						setStopOpen(false);
						post({ type: "codebase_index_action", action: "stop" });
					}}
					onCancel={() => setStopOpen(false)}
				/>
			)}

			{/* Banner superior de salud del índice */}
			<div className={`ci-banner ${isInstalled ? "is-ready" : "is-missing"}`}>
				<div className="ci-banner-left">
					<div className="ci-banner-icon-wrap">
						<Codicon
							name={isInstalled ? "database" : "cloud-download"}
							size={20}
							className={isInstalled ? "ci-banner-icon-ok" : "ci-banner-icon-warn"}
						/>
					</div>
					<div className="ci-banner-info">
						<div className="ci-banner-title">
							{isInstalled
								? "Índice de Código: Listo y Operativo"
								: "Índice de Código: Paquete No Instalado"}
						</div>
						<div className="ci-banner-subtitle">
							{isInstalled ? (
								<>
									<span>
										Paquete:{" "}
										<strong>
											open-codebase-index{ci.version ? `@${ci.version}` : ""}
										</strong>
									</span>
									<span className="ci-bullet">·</span>
									<span>
										Motor: <strong>{engineLabel(providerMode, metaLabel)}</strong>
										{meta && meta.dimensions > 0 && (
											<span className="ci-tag-dims" title="Dimensiones de los vectores">
												{meta.dimensions}d
											</span>
										)}
										{metaProvider && providerMode === "auto" && (
											<span
												className="ci-tag-auto"
												title="El motor Auto eligió este proveedor al construir el índice"
											>
												Auto resolvió a {metaProvider}
											</span>
										)}
									</span>
								</>
							) : (
								<span>
									Requiere descarga on-demand (~256 MB, podado a ~48 MB). 6 tools del
									agente esperando.
								</span>
							)}
						</div>
						{isInstalled && (
							<div className="ci-banner-tags">
								<span className="ci-tag">6 tools activas para el agente</span>
								<span className="ci-tag">Espacio optimizado (~48 MB en disco)</span>
								<span className="ci-tag">Storage local .codebase-index</span>
							</div>
						)}
					</div>
				</div>

				<div className="ci-banner-right">
					{isInstalled ? (
						<button
							type="button"
							className="pc-save ci-btn-action"
							disabled={!!busy}
							onClick={() => post({ type: "codebase_index_action", action: "index" })}
							title="Indexar cambios recientes del workspace"
						>
							{busy === "index" ? (
								<>
									<Codicon name="loading" size={13} spin /> Indexando…
								</>
							) : (
								<>
									<Codicon name="refresh" size={13} /> Re-indexar
								</>
							)}
						</button>
					) : (
						<button
							type="button"
							className="pc-save ci-btn-install"
							disabled={!!busy}
							onClick={() =>
								post({ type: "codebase_index_action", action: "install" })
							}
						>
							{busy === "install" ? (
								<>
									<Codicon name="loading" size={13} spin /> Instalando…
								</>
							) : (
								<>
									<Codicon name="cloud-download" size={13} /> Instalar paquete
								</>
							)}
						</button>
					)}
				</div>
			</div>

			{/* Barra de progreso y reloj de tiempo transcurrido en vivo */}
			{busy && (
				<div className="ci-busy-card">
					<div className="ci-busy-head">
						<div className="ci-busy-status">
							<Codicon name="loading" size={14} spin />
							<span>
								{busy === "install"
									? "Descargando e instalando el paquete open-codebase-index..."
									: "Indexando archivos del workspace..."}
							</span>
						</div>
						<div className="ci-busy-timer">
							<Codicon name="clock" size={13} />
							<span>
								Tiempo: <strong>{fmtElapsed(elapsed)}</strong>
							</span>
						</div>
						{/* #113 — detener la indexación (no aplica a install) */}
						{busy !== "install" && (
							<button
								type="button"
								className="ci-stop-btn"
								onClick={() => setStopOpen(true)}
							>
								<Codicon name="debug-stop" size={12} /> Detener
							</button>
						)}
					</div>

					{/* #109 — barra determinada cuando el coordinador reporta
					 * progreso (index/rebuild); indeterminada para install o sin datos. */}
					{busy !== "install" && ci?.progress ? (
						<div
							className="ci-busy-bar determinate"
							role="progressbar"
							aria-label="Progreso de indexación"
							aria-valuenow={ci.progress.percentage}
							aria-valuemin={0}
							aria-valuemax={100}
						>
							<span style={{ width: `${ci.progress.percentage}%` }} />
						</div>
					) : (
						<div className="ci-busy-bar" role="progressbar" aria-label="En progreso">
							<span />
						</div>
					)}

					{/* #109 — contadores y fase en vivo (solo index/rebuild) */}
					{busy !== "install" &&
						(() => {
							const p = ci?.progress;
							const dash = p ? null : "—";
							return (
								<>
									<div className="ci-busy-counters">
										<span className="ci-busy-count">
											<Codicon name="file" size={12} />
											<span className="ci-busy-num">
												{p
													? `${fmtCount(p.filesProcessed)}/${fmtCount(p.totalFiles)}`
													: `${dash}/${dash}`}
											</span>
											archivos
										</span>
										<span className="ci-bullet">·</span>
										<span className="ci-busy-count">
											<Codicon name="symbol-snippet" size={12} />
											<span className="ci-busy-num">
												{p
													? `${fmtCount(p.chunksProcessed)}/${fmtCount(p.totalChunks)}`
													: `${dash}/${dash}`}
											</span>
											chunks
										</span>
										{p && <span className="ci-busy-pct">{p.percentage}%</span>}
									</div>
									{p ? (
										<div className="ci-busy-phase">
											<Codicon name="settings-gear" size={12} />
											Fase: {PHASE_LABELS[p.phase] ?? p.phase}
										</div>
									) : (
										<div className="ci-busy-desc">
											Vectorizando archivos y actualizando el grafo de llamadas según el
											tamaño del repositorio.
										</div>
									)}
								</>
							);
						})()}

					{busy === "install" && (
						<div className="ci-busy-desc">
							npm no imprime progreso intermedio durante la descarga (~256 MB): el
							reloj confirma que el instalador sigue activo.
						</div>
					)}
				</div>
			)}

			{/* Última línea de progreso / resultado */}
			{ci?.lastLine && !busy && (
				<div className="ci-log-box">
					<Codicon name="terminal" size={13} className="ci-log-icon" />
					<div className="ci-log-text">{ci.lastLine}</div>
				</div>
			)}

			{/* Barra de acciones rápidas (cuando está instalado) */}
			{isInstalled && (
				<div className="ci-section-group">
					<div className="cfg-section">
						<Codicon name="tools" size={13} /> ACCIONES Y MANTENIMIENTO DEL WORKSPACE
					</div>
					<div className="ci-actions-row">
						<button
							type="button"
							className="ci-action-card"
							disabled={!!busy}
							onClick={() => post({ type: "codebase_index_action", action: "index" })}
						>
							<div className="ci-action-icon">
								<Codicon name="refresh" size={15} />
							</div>
							<div className="ci-action-info">
								<span className="ci-action-title">Indexación Incremental</span>
								<span className="ci-action-desc">
									Procesa solo los archivos modificados desde la última indexación.
								</span>
							</div>
						</button>

						<button
							type="button"
							className="ci-action-card"
							disabled={!!busy}
							onClick={() =>
								post({ type: "codebase_index_action", action: "rebuild" })
							}
						>
							<div className="ci-action-icon">
								<Codicon name="tools" size={15} />
							</div>
							<div className="ci-action-info">
								<span className="ci-action-title">Reconstruir desde Cero</span>
								<span className="ci-action-desc">
									Limpia el vector store local y re-indexa todo el repositorio.
								</span>
							</div>
						</button>

						<button
							type="button"
							className="ci-action-card"
							disabled={!!busy}
							onClick={() => post({ type: "codebase_index_action", action: "status" })}
						>
							<div className="ci-action-icon">
								<Codicon name="pulse" size={15} />
							</div>
							<div className="ci-action-info">
								<span className="ci-action-title">Ver Diagnóstico y Salud</span>
								<span className="ci-action-desc">
									Verifica frescura de vectores, errores y conteo de archivos.
								</span>
							</div>
						</button>
					</div>
				</div>
			)}

			{/* #112 — Archivos presentes en el índice (consulta read-only) */}
			{isInstalled && (
				<div className="ci-section-group">
					<div className="cfg-section">
						<Codicon name="file" size={13} /> ARCHIVOS EN EL ÍNDICE
					</div>
					<div className="ci-files-card">
						<button
							type="button"
							className="ci-files-toggle"
							onClick={() => setFilesOpen((v) => !v)}
						>
							<Codicon name={filesOpen ? "chevron-down" : "chevron-right"} size={13} />
							<span>
								Archivos indexados{" "}
								<strong>
									{idxFiles ? `(${idxFiles.files.length})` : "(… consultando)"}
								</strong>
							</span>
						</button>
						{idxFiles && idxFiles.available && (
							<input
								type="text"
								className="ci-files-search"
								placeholder="Filtrar por ruta…"
								value={filesQuery}
								onChange={(e) => setFilesQuery(e.target.value)}
							/>
						)}
						<button
							type="button"
							className="ci-files-refresh"
							title="Volver a consultar el índice"
							onClick={() => post({ type: "codebase_index_action", action: "files" })}
						>
							<Codicon name="refresh" size={13} />
						</button>

						{filesOpen && (
							<div className="ci-files-body">
								{idxFiles ? (
									<FilesBody
										idxFiles={idxFiles}
										filtered={filteredFiles}
										query={filesQuery}
									/>
								) : (
									<div className="ci-files-empty">Consultando el índice…</div>
								)}
							</div>
						)}
					</div>
				</div>
			)}

			{/* #117 (Fase B) — Motor de embeddings: tarjetas interactivas */}
			{isInstalled && ci && (
				<div className="ci-section-group">
					<div className="cfg-section">
						<Codicon name="sparkle" size={13} /> MOTOR DE EMBEDDINGS (VECTORIZACIÓN)
					</div>
					<EmbeddingsEngine
						ci={ci}
						ping={state.codebaseIndexPing}
						locking={!!ci.indexMeta}
						onPing={(provider, model) =>
							post({ type: "codebase_index_ping", provider, model })
						}
						onSelect={(provider, model) => {
							if (ci.indexMeta) {
								// Bloqueado: la selección pasa por el modal de reconstrucción
								setChangeTarget({ provider, model });
							} else {
								post({ type: "codebase_index_select", provider, model });
							}
						}}
						onLogin={(provider) => post({ type: "login_provider", provider })}
						onCopyOllama={handleCopyOllama}
						copiedOllama={copiedOllama}
						onOpenChangeDialog={() => setChangeTarget(null)}
					/>
				</div>
			)}

			{/* #117 — modal de cambio de motor (reindexación obligatoria) */}
			{ci?.indexMeta && changeTarget && (
				<EmbeddingsChangeDialog
					current={{ provider: ci.indexMeta.provider, model: ci.indexMeta.model }}
					target={changeTarget ?? { provider: "ollama" }}
					onConfirm={() => {
						post({
							type: "codebase_index_select",
							provider: changeTarget?.provider ?? "ollama",
							model: changeTarget?.model,
							rebuild: true,
						});
						setChangeTarget(undefined);
					}}
					onCancel={() => setChangeTarget(undefined)}
				/>
			)}

			{/* Matriz de Tools activas para el agente */}
			<div className="ci-section-group">
				<div className="cfg-section">
					<Codicon name="symbol-interface" size={13} /> HERRAMIENTAS ACTIVAS PARA EL
					AGENTE (6 TOOLS)
				</div>
				<div className="ci-tools-grid">
					{INDEX_TOOLS.map((t) => (
						<div
							key={t.name}
							className={`ci-tool-card ${isInstalled ? "is-active" : "is-disabled"}`}
						>
							<div className="ci-tool-head">
								<div className="ci-tool-icon-wrap">
									<Codicon name={t.icon} size={15} />
								</div>
								<div className="ci-tool-title-wrap">
									<span className="ci-tool-name">{t.name}</span>
									<span className="ci-tool-tag">{t.title}</span>
								</div>
							</div>
							<div className="ci-tool-desc">{t.desc}</div>
						</div>
					))}
				</div>
			</div>
		</div>
	);
}
