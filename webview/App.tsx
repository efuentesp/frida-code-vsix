import {
	Fragment,
	useEffect,
	useMemo,
	useReducer,
	useRef,
	useState,
	type ReactNode,
} from "react";
import { reduce, initialState } from "./store";
import type { ApprovalMode, InMessage, OutMessage, ToastLevel } from "./types";
import { fmtTokens, formatDuration } from "./format";
import { OnboardingWizard } from "./components/OnboardingWizard";
import { TurnView } from "./components/Turn";
import { CompactionCard } from "./components/CompactionCard";
import { BranchSummaryCard } from "./components/BranchSummaryCard";
import { UiDialog } from "./components/UiDialog";
import { CcPluginsPanel } from "./components/CcPluginsPanel";
import { SandboxesPanel } from "./components/SandboxesPanel";
import { DetachedPanel } from "./components/DetachedPanel";
import { RemoteRoot } from "./components/RemoteRoot";
import { Composer, type CommandItem } from "./components/Composer";
import { SessionsPanel } from "./components/SessionsPanel";
import { Welcome } from "./components/Welcome";
import { Statusline } from "./components/Statusline";
import { Tooltip } from "./components/Tooltip";
import { ApprovalCard } from "./components/ApprovalCard";
import { QuestionsPanel } from "./components/QuestionsPanel";
import { ModelPanel } from "./components/ModelPanel";
import { SettingsHub, type SettingsTab } from "./components/SettingsHub";
import { ForkPanel } from "./components/ForkPanel";
import { LensDiagnostics } from "./components/LensDiagnostics";
import { QueuePanel } from "./components/QueuePanel";
import { Icon } from "./components/Icon";
import { Codicon } from "./components/Codicon";
import { Followups } from "./components/Followups";
import { getContextualFollowups } from "./followup-rules";
import { formatCurrentActivity } from "./activity-formatter";

type VsCodeApi = { postMessage(msg: OutMessage): void };

// acquireVsCodeApi() solo puede llamarse UNA VEZ por webview → singleton de módulo.
declare function acquireVsCodeApi(): VsCodeApi;
let _vscode: VsCodeApi | null = null;
function getVsCode(): VsCodeApi {
	if (!_vscode) _vscode = acquireVsCodeApi();
	return _vscode;
}

function providerLabel(id: string): string {
	switch (id) {
		case "softtek-devengine":
			return "Softtek DevEngine";
		case "zai":
			return "z.ai";
		case "github-copilot":
			return "GitHub Copilot";
		default:
			return id;
	}
}

function nextMode(m: ApprovalMode): ApprovalMode {
	return m === "manual" ? "auto" : "manual";
}

export function App() {
	const [state, dispatch] = useReducer(reduce, initialState);
	const approvalsRef = useRef<HTMLDivElement>(null);
	const logRef = useRef<HTMLDivElement>(null);
	// `stick` (state) → re-render para mostrar/ocultar el botón flotante.
	// `stickRef` (ref) → lectura "actual" dentro del efecto de auto-scroll sin
	// meter `stick` en sus deps (evita re-scrollear al cambiar de estado).
	const [stick, setStick] = useState(true);
	const stickRef = useRef(true);
	useEffect(() => {
		stickRef.current = stick;
	}, [stick]);
	const [escHint, setEscHint] = useState(false);
	const [sessionsOpen, setSessionsOpen] = useState(false);
	// Scope del listado de sesiones: 'project' filtra por el cwd del workspace;
	// 'all' muestra todas. Recuerda la elección durante la sesión (estado en App,
	// no por-panel) y se reenvía al backend al alternar el toggle.
	const [sessionScope, setSessionScope] = useState<"project" | "all">("project");
	const [modelsOpen, setModelsOpen] = useState(false);
	const [forkOpen, setForkOpen] = useState(false);
	const [configOpen, setConfigOpen] = useState(false);
	// Tab pedido del hub (p.ej. el comando frida.codebaseIndex pide "codebaseIndex").
	// Fuerza re-monte del SettingsHub vía key para entrar al tab correcto incluso
	// con el hub ya abierto; se limpia al cerrar para que el engrane vuelva a
	// "providers".
	const [settingsTab, setSettingsTab] = useState<string | undefined>(undefined);
	// Wizard de onboarding: se muestra cuando no hay proveedor configurado
	// (keyNeeded) y permanece hasta que el usuario completa el paso "¡Listo!".
	const [wizardVisible, setWizardVisible] = useState(false);
	useEffect(() => {
		if (state.keyNeeded && !wizardVisible) setWizardVisible(true);
	}, [state.keyNeeded, wizardVisible]);
	const [hideThinking, setHideThinking] = useState(false);
	const [retrySecs, setRetrySecs] = useState<number | null>(null);
	const lastEscRef = useRef(0);
	const escTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const followups = useMemo(
		() => getContextualFollowups(state.turns, state.busy),
		[state.turns, state.busy],
	);

	useEffect(() => {
		const vscode = getVsCode();
		const handler = (e: MessageEvent) => {
			const msg = e.data as InMessage;
			if (msg.type === "open_settings") {
				setConfigOpen(true);
				setSettingsTab(msg.tab);
				return; // no despachar al reducer
			}
			if (msg.type === "open_models") {
				setModelsOpen(true);
				getVsCode().postMessage({ type: "list_models" });
				return;
			}
			if (msg.type === "fork_points") {
				setForkOpen(true);
				return;
			}
			dispatch(msg);
		};
		window.addEventListener("message", handler);
		vscode.postMessage({ type: "webview_ready" });
		return () => window.removeEventListener("message", handler);
	}, []);

	useEffect(() => {
		if (state.approvals.length > 0) {
			approvalsRef.current?.scrollIntoView({
				behavior: "smooth",
				block: "end",
			});
		}
	}, [state.approvals]);

	// Auto-scroll: mantiene la vista en la última respuesta salvo que el usuario
	// haya subido a leer (stick-to-bottom). Se dispara con cada delta/tool/turno.
	useEffect(() => {
		const el = logRef.current;
		if (el && stickRef.current) el.scrollTop = el.scrollHeight;
	}, [state.turns, state.queued]);

	// Auto-scroll al MONTAR un panel overlay-body nuevo (/context, /gates): son resultados de comandos del usuario que espera ver. A
	// diferencia del de turnos, aquí forzamos el scroll al final aunque el usuario
	// hubiera subido a leer (el comando es explícito). No dispara en updates del
	// mismo root (re-render del panel) — sólo en montajes nuevos.
	const prevOverlayRootsRef = useRef<string[]>([]);
	useEffect(() => {
		const overlayIds = Object.entries(state.webRoots ?? {})
			.filter(([, r]) => r.placement === "overlay" && r.tree)
			.map(([id]) => id);
		const hasNew = overlayIds.some(
			(id) => !prevOverlayRootsRef.current.includes(id),
		);
		prevOverlayRootsRef.current = overlayIds;
		if (hasNew) {
			const el = logRef.current;
			if (el) el.scrollTop = el.scrollHeight;
		}
	}, [state.webRoots]);

	// Doble Escape (mientras responde) → abort, como el botón Detener.
	// GLOBAL: funciona incluso con un approval/cuestión pendiente. La 1ª Esc la
	// reclama el menú de permisos (rechazar la acción); la 2ª (en <450ms) aborta
	// el agente. Así nunca se queda sin opción de detener (bug previo: el Composer
	// se ocultaba durante un approval y el doble-Esc estaba pausado).
	useEffect(() => {
		if (!state.busy) {
			diagLog(`listener Esc DESACTIVADO (busy=false) — el doble-Esc no disparará`);
			setEscHint(false);
			return;
		}
		diagLog(`listener Esc ACTIVADO (busy=true) — esperando doble-Esc`);
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			const now = Date.now();
			if (now - lastEscRef.current < 450) {
				diagLog(`Esc#2 (<450ms) → post {abort}`);
				lastEscRef.current = 0;
				if (escTimerRef.current) clearTimeout(escTimerRef.current);
				setEscHint(false);
				post({ type: "abort" });
			} else {
				diagLog(`Esc#1 (espera 2ª Esc en <450ms)`);
				lastEscRef.current = now;
				setEscHint(true);
				if (escTimerRef.current) clearTimeout(escTimerRef.current);
				escTimerRef.current = setTimeout(() => setEscHint(false), 1200);
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [state.busy]);

	const post = (msg: OutMessage) => getVsCode().postMessage(msg);

	// Trazado del flujo de Detener: además de la consola del webview (DevTools),
	// reenvía al host para que caiga en el canal "Frida Abort" y se correlacione
	// con abortRun()/eventos del agente en una sola línea de tiempo.
	const diagLog = (text: string) => {
		console.log("[frida-abort]", text);
		post({ type: "abort_diag", text });
	};

	// Comandos para el autocompletado de "/": built-in (del host vía
	// state.resources.commands) + skills + prompts. FUENTE ÚNICA: BUILTIN_COMMANDS
	// en extension.ts → ResourceSummary.commands → aquí. Así host y client nunca
	// divergen (bug anterior: 22 en el host vs 15 hardcodeados → /wf y 6 más sólo
	// funcionaban escribiéndolos a mano).
	const commands: CommandItem[] = useMemo(() => {
		const r = state.resources;
		const builtins: CommandItem[] = (r?.commands ?? []).map((c) => ({
			kind: "builtin" as const,
			label: `/${c.name}`,
			name: c.name,
			description: c.description,
			argumentHint: c.argumentHint,
		}));
		if (!r) return builtins;
		return [
			...builtins,
			...r.skills.map((s) => ({
				kind: "skill" as const,
				label: `/skill:${s.name}`,
				name: s.name,
				description: s.description,
			})),
			...r.prompts.map((p) => ({
				kind: "prompt" as const,
				label: `/${p.name}`,
				name: p.name,
				description: p.description,
			})),
		];
	}, [state.resources]);

	// Etiqueta del indicador de procesamiento (fijo en el footer). Refleja el
	// sub-estado cuando se conoce; no depende del scroll de la conversación.
	// Countdown del reintento del provider (auto_retry_start → delayMs con backoff).
	// Equivalente al RetryStatusIndicator del TUI.
	useEffect(() => {
		if (!state.retry) {
			setRetrySecs(null);
			return;
		}
		const total = state.retry.delayMs;
		setRetrySecs(Math.ceil(total / 1000));
		const start = Date.now();
		const id = setInterval(() => {
			setRetrySecs(Math.max(0, Math.ceil((total - (Date.now() - start)) / 1000)));
		}, 250);
		return () => clearInterval(id);
	}, [state.retry]);

	// Temporizador en vivo para la línea de actividad (Propuesta A)
	const [activityStart, setActivityStart] = useState<number | null>(null);
	const [elapsedSeconds, setElapsedSeconds] = useState<string>("");

	useEffect(() => {
		if (state.busy || state.isCompacting) {
			if (!activityStart) setActivityStart(Date.now());
			const interval = setInterval(() => {
				if (activityStart) {
					const sec = ((Date.now() - activityStart) / 1000).toFixed(1);
					setElapsedSeconds(`${sec}s`);
				}
			}, 200);
			return () => clearInterval(interval);
		}
		setActivityStart(null);
		setElapsedSeconds("");
	}, [state.busy, state.isCompacting, activityStart]);

	// Información dinámica y legible en tiempo real sobre la actividad en curso
	const lastTurn = state.turns[state.turns.length - 1];
	const activity = formatCurrentActivity(
		lastTurn,
		state.busy,
		state.isCompacting,
		state.compactReason,
		state.retry,
		state.backgroundRunning,
		retrySecs,
	);

	// Roots de diálogo en el slot del composer (ask_user_question): reemplazan
	// el input como las aprobaciones. placement "composer" (distinto de "footer"
	// para no mezclarse con el panel de todo/workflow, que vive en .web-footer).
	const composerDialogRoots = Object.entries(state.webRoots ?? {}).filter(
		([, r]) => r.placement === "composer" && r.tree,
	);
	// Estado controlado del editor ampliado del Composer: lo subimos a App para
	// saber cuándo ocultar el botón "ir al final" (al ampliar crece el footer →
	// .log se redimensiona → el botón salta). Fuente única → sin desync al
	// desmontarse el Composer por una aprobación/diálogo.
	const [composerExpanded, setComposerExpanded] = useState(false);
	// El botón "ir al final" salta de sitio cuando un diálogo interactivo reemplaza
	// el composer (approval / ask_user_question), cuando el editor está ampliado
	// o mientras se procesa una petición: el footer cambia de altura y .log se
	// redimensiona. Lo ocultamos en esos estados; sólo reaparece con el agente
	// idle, editor compacto y composer visible.
	const hideJump =
		state.busy ||
		state.approvals.length > 0 ||
		state.uiRequests.length > 0 ||
		composerDialogRoots.length > 0 ||
		composerExpanded;

	if (wizardVisible) {
		return (
			<OnboardingWizard
				providers={state.models?.providers ?? []}
				deviceCode={state.oauthDeviceCode}
				onSetKey={(id, key) => post({ type: "set_key", provider: id, key })}
				onLogin={(id) => post({ type: "login_provider", provider: id })}
				onLogout={(id) => post({ type: "logout_provider", provider: id })}
				onDone={() => setWizardVisible(false)}
				onOpenSettings={() => {
					setWizardVisible(false);
					setConfigOpen(true);
				}}
			/>
		);
	}

	// Aviso de compactación: cuando el contexto ≥70%, el ícono del toolbar pulsa
	// (color error) y la barra del footer también, para llamar la atención.
	const ctxPct = Math.round(
		state.usage?.pressurePercent ?? state.usage?.contextPercent ?? 0,
	);
	const ctxWarn = ctxPct >= 70;
	return (
		<div className="app">
			<InfoToast toast={state.info} />
			<header className="toolbar">
				<span className="brand">
					<span className="avatar ai sm">
						<Codicon name="copilot" size={13} />
					</span>{" "}
					Frida Code
				</span>
				{state.lensStatus?.loaded && (
					<Tooltip
						label={
							state.lensStatus.active
								? "frida-lens activo (emitiendo diagnósticos)"
								: "frida-lens cargado (sin actividad aún este turno)"
						}
						side="bottom"
					>
						<span
							className={"lens-badge" + (state.lensStatus.active ? " active" : "")}
						>
							<Icon name={state.lensStatus.active ? "check" : "circle"} size={12} />
						</span>
					</Tooltip>
				)}
				{state.version && (
					<Tooltip
						label="Versión instalada · click para comprobar actualizaciones (/update)"
						side="bottom"
					>
						<button
							className="sub-version"
							onClick={() => post({ type: "submit", text: "/update", mode: "steer" })}
						>
							v{state.version}
						</button>
					</Tooltip>
				)}
				{state.usage?.sessionDurationMs !== undefined && (
					<Tooltip
						label="Tiempo de sesión (primer→último mensaje) · tokens acumulados"
						side="bottom"
					>
						<span className="session-stats">
							<span className="ss-time">
								⏱ {formatDuration(state.usage.sessionDurationMs)}
							</span>
							{(state.usage.inputTotal > 0 || state.usage.outputTotal > 0) && (
								<>
									<span className="ss-sep">·</span>
									<span className="ss-tokens">
										↑{fmtTokens(state.usage.inputTotal)} ↓
										{fmtTokens(state.usage.outputTotal)}
									</span>
								</>
							)}
						</span>
					</Tooltip>
				)}
				{state.busy &&
					(state.approvals.length > 0 ||
						state.modelChanges.length > 0 ||
						!!state.questionnaire) && (
						<Tooltip label="Detener agente (también doble Esc)" side="bottom">
							<button
								type="button"
								className="tb-stop"
								onClick={() => {
									diagLog("botón Detener (toolbar approvals) → post {abort}");
									post({ type: "abort" });
								}}
							>
								<Codicon name="stop-circle" size={13} /> Detener
							</button>
						</Tooltip>
					)}
				<span className="spacer" />
				<span className="tb-group">
					<Tooltip label="Nueva sesión" side="bottom">
						<button
							className="ico"
							onClick={() => post({ type: "new_session" })}
							disabled={state.busy}
						>
							<Codicon name="add" size={15} />
						</button>
					</Tooltip>
					<Tooltip label="Sesiones anteriores" side="bottom">
						<button
							className="ico"
							onClick={() => {
								setSessionsOpen(true);
								post({ type: "list_sessions", scope: sessionScope });
							}}
						>
							<Codicon name="history" size={15} />
						</button>
					</Tooltip>
				</span>
				<span className="tb-sep" />
				<span className="tb-group">
					<Tooltip
						label={
							ctxWarn
								? `⚠ Contexto al ${ctxPct}% — compacta para liberar`
								: "Compactar contexto"
						}
						side="bottom"
					>
						<button
							className={"ico" + (ctxWarn ? " warn" : "")}
							onClick={() => post({ type: "compact" })}
							disabled={state.busy || state.isCompacting || state.turns.length === 0}
						>
							<Codicon name="collapse-all" size={15} />
						</button>
					</Tooltip>
					<Tooltip
						label={hideThinking ? "Mostrar razonamiento" : "Ocultar razonamiento"}
						side="bottom"
					>
						<button
							className={"ico" + (hideThinking ? " off" : " active")}
							onClick={() => setHideThinking((v) => !v)}
						>
							<Codicon name="sparkle" size={15} />
						</button>
					</Tooltip>
				</span>
				<span className="tb-sep" />
				<span className="tb-group">
					<Tooltip label="Configuración" side="bottom">
						<button className="ico" onClick={() => setConfigOpen(true)}>
							<Codicon name="settings-gear" size={15} />
						</button>
					</Tooltip>
				</span>
			</header>

			{state.oauthDeviceCode && (
				<div className="oauth-banner">
					<div className="oauth-title">Iniciando sesión…</div>
					<div className="oauth-hint">
						Entra este código en GitHub (la página ya se abrió):
					</div>
					<div className="oauth-code">{state.oauthDeviceCode.userCode}</div>
					<a
						className="oauth-link"
						href={state.oauthDeviceCode.verificationUri}
						target="_blank"
						rel="noreferrer"
					>
						{state.oauthDeviceCode.verificationUri}
					</a>
				</div>
			)}

			{state.mode === "auto-edit" && (
				<div className="info-bar warn">
					<Codicon name="warning" size={12} /> Edición automática: crear/editar
					archivos sin confirmación (bash sí pide).
				</div>
			)}
			{state.mode === "auto" && (
				<div className="info-bar warn">
					<Codicon name="warning" size={12} /> YOLO ON: TODO corre sin pedirte
					confirmación (edit/write/bash, incl. comandos compuestos y rutas
					externas). Detén con el botón Detener o doble Esc.
				</div>
			)}
			{escHint && (
				<div className="info-bar">
					<Codicon name="stop-circle" size={12} /> Presiona Esc de nuevo para
					detener…
				</div>
			)}
			<div
				className="log"
				ref={logRef}
				onScroll={() => {
					const el = logRef.current;
					if (!el) return;
					const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
					stickRef.current = atBottom;
					setStick(atBottom);
				}}
			>
				{state.turns.length === 0 && (
					<Welcome
						onPrompt={(text) => post({ type: "submit", text, mode: "steer" })}
						onInsert={(text) =>
							dispatch({
								type: "composer_insert",
								text,
							})
						}
					/>
				)}
				{state.compactions
					.filter((c) => c.afterTurnId === null)
					.map((c) => (
						<CompactionCard key={c.id} entry={c} />
					))}
				{state.branchSummaries?.map((b, i) => (
					<BranchSummaryCard key={`bs-${i}`} entry={b} />
				))}
				{state.turns.map((t) => (
					<Fragment key={t.id}>
						<TurnView
							turn={t}
							live={state.busy && t.id === state.turns[state.turns.length - 1]?.id}
							hideThinking={hideThinking}
							onCopy={(text) => post({ type: "copy_text", text })}
						/>
						{state.compactions
							.filter((c) => c.afterTurnId === t.id)
							.map((c) => (
								<CompactionCard key={c.id} entry={c} />
							))}
					</Fragment>
				))}
				{/* Botón flotante "ir al final": siempre montado para que el fade
				    sea estable; se oculta con .hidden cuando stick=true. */}
				<button
					className={"jump-bottom" + (stick || hideJump ? " hidden" : "")}
					title="Ir al final"
					aria-label="Ir al final de la conversación"
					onClick={() => {
						const el = logRef.current;
						if (!el) return;
						el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
					}}
				>
					<Codicon name="arrow-down" size={16} />
				</button>
				<div ref={approvalsRef} className="approvals-area">
					{/* Las tarjetas de aprobación se renderizan ahora en el footer, en lugar
					    del Composer, cuando hay pendientes (más abajo). */}
					{state.uiRequests.map((r) => (
						<UiDialog
							key={r.id}
							request={r}
							onRespond={(value, cancelled) =>
								post({ type: "ui_response", id: r.id, value, cancelled })
							}
						/>
					))}
					{state.ccPanel ? (
						<CcPluginsPanel
							panel={state.ccPanel}
							onAction={(id, a) =>
								post({
									type: "ccplugins_panel_action",
									id,
									action: a.kind,
									ref: "ref" in a ? a.ref : undefined,
									value: a.kind === "mkt_add" ? a.value : undefined,
									name:
										(a.kind === "mkt_remove" || a.kind === "mkt_update") && "name" in a
											? a.name
											: undefined,
									source: a.kind === "retry" ? a.source : undefined,
								})
							}
							onRowMeta={(id, ref) => post({ type: "ccplugins_row_meta", id, ref })}
							onClose={(id) => post({ type: "ccplugins_panel_close", id })}
						/>
					) : null}
					{state.sbxPanel ? (
						<SandboxesPanel
							panel={state.sbxPanel}
							onAction={(id, a) =>
								a.kind === "merge"
									? post({
											type: "sandbox_panel_merge",
											id,
											name: a.name,
											files: a.files,
										})
									: a.kind === "changes" || a.kind === "terminal"
										? post({
												type:
													a.kind === "terminal"
														? "sandbox_panel_terminal"
														: "sandbox_panel_changes",
												id,
												name: a.name,
											})
										: post({
												type: "sandbox_panel_action",
												id,
												action: a.kind,
												name: "name" in a ? a.name : undefined,
											})
							}
							onClose={(id) => post({ type: "sandbox_panel_close", id })}
						/>
					) : null}
					{state.dtPanel ? (
						<DetachedPanel
							panel={state.dtPanel}
							onAction={(id, a) =>
								post({
									type: "detached_panel_action",
									id,
									action: a.kind,
									runId: "runId" in a ? a.runId : undefined,
								})
							}
							onClose={(id) => post({ type: "detached_panel_close", id })}
						/>
					) : null}
					{Object.entries(state.webRoots ?? {})
						.filter(([, r]) => r.placement === "overlay" && r.tree)
						.map(([id, r]) => (
							<RemoteRoot
								key={id}
								tree={r.tree!}
								rootId={id}
								onEvent={(handlerId, payload) =>
									post({ type: "web_event", rootId: id, handlerId, payload })
								}
							/>
						))}
				</div>
			</div>
			<div className="footer">
				{state.providerError && (
					<div className="provider-error-bar">
						<Codicon name="warning" size={12} /> {state.providerError}
						<button
							aria-label="Cerrar error del proveedor"
							className="info-toast-close"
							type="button"
							onClick={() => post({ type: "clear_provider_error" })}
						>
							<Codicon name="close" size={13} />
						</button>
					</div>
				)}
				{activity && (
					<div className="activity-line-wrap">
						<div className={`activity-icon-beacon is-${activity.kind}`}>
							<Codicon
								name={activity.icon}
								size={13}
								className={
									`activity-icon is-${activity.kind}` +
									(activity.spin
										? " codicon-modifier-spin"
										: activity.kind === "thinking"
											? " tc-sparkle-spin"
											: "")
								}
							/>
							<span className="activity-beacon-ring" aria-hidden="true" />
						</div>
						<div className="activity-text-flow">
							<span className="activity-verb">{activity.verb}</span>
							{activity.target && (
								<span className="activity-target">{activity.target}</span>
							)}
							{activity.parentDir && (
								<span className="activity-parent">{activity.parentDir}</span>
							)}
						</div>
						{elapsedSeconds && (
							<span className="activity-timer">· {elapsedSeconds}</span>
						)}
						{activity.canCancel && (
							<button
								type="button"
								className="activity-cancel-link"
								onClick={() => post({ type: "cancel_compaction" })}
							>
								Cancelar
							</button>
						)}
					</div>
				)}
				<div className="web-footer">
					{Object.entries(state.webRoots ?? {})
						.filter(([, r]) => r.placement === "footer" && r.tree)
						.map(([id, r]) => (
							<RemoteRoot
								key={id}
								tree={r.tree!}
								rootId={id}
								onEvent={(handlerId, payload) =>
									post({ type: "web_event", rootId: id, handlerId, payload })
								}
							/>
						))}
				</div>
				<QueuePanel
					items={state.queued}
					onRemove={(id) => post({ type: "queue_remove", id })}
					onEdit={(id) => post({ type: "queue_edit", id })}
					onMove={(id, dir) => post({ type: "queue_move", id, dir })}
				/>
				<LensDiagnostics lens={state.lens} />
				<Followups
					items={followups}
					onSelect={(text) => post({ type: "submit", text, mode: "steer" })}
				/>
				{state.modelChanges.length > 0 ? (
					// Confirmación de cambio de proveedor pendiente (red de seguridad):
					// ocupa el lugar del composer como las aprobaciones.
					<div className="approval-inline">
						{state.modelChanges.map((mc) => (
							<div key={mc.id} className="model-change-card">
								<div className="model-change-ttl">
									Cambio de proveedor
									{mc.source === "auto-detected" ? " ⚠" : ""}
								</div>
								<div className="model-change-flow">
									<span>
										{providerLabel(mc.from.provider)}/{mc.from.modelId}
									</span>
									<span className="model-change-arrow">→</span>
									<span>
										{providerLabel(mc.to.provider)}/{mc.to.modelId}
									</span>
								</div>
								{mc.reason ? (
									<div className="model-change-reason">{mc.reason}</div>
								) : null}
								<div className="model-change-btns">
									<button
										type="button"
										className="q-btn"
										onClick={() =>
											post({
												type: "model_change_response",
												id: mc.id,
												decision: "accept",
											})
										}
									>
										{mc.source === "auto-detected" ? "Mantener" : "Aceptar"}
									</button>
									<button
										type="button"
										className="q-btn danger"
										onClick={() =>
											post({
												type: "model_change_response",
												id: mc.id,
												decision: "cancel",
											})
										}
									>
										{mc.source === "auto-detected" ? "Volver al anterior" : "Cancelar"}
									</button>
								</div>
							</div>
						))}
					</div>
				) : state.approvals.length > 0 ? (
					// Aprobación pendiente: el input cede su lugar a la tarjeta de permiso
					// (como en la extensión original de pi). No tiene sentido dejar escribir
					// mientras Frida espera Accept/Reject; la tarjeta trae los botones.
					<div className="approval-inline">
						{state.approvals.map((a, i) => (
							<ApprovalCard
								key={a.id}
								approval={a}
								active={i === 0}
								onRespond={(r) => post({ type: "approval_response", id: a.id, ...r })}
							/>
						))}
					</div>
				) : state.questionnaire ? (
					// ask_user_question nativo (ADR-0027): QuestionsPanel ocupa el lugar del
					// composer (como las aprobaciones), con selección por teclado.
					<div className="approval-inline">
						<QuestionsPanel
							key={state.questionnaire.id}
							questions={state.questionnaire.questions}
							onResult={(r) =>
								post({
									type: "questionnaire_answer",
									id: state.questionnaire!.id,
									...r,
								})
							}
						/>
					</div>
				) : composerDialogRoots.length > 0 ? (
					// Diálogo ask_user_question: ocupa el lugar del composer (como las
					// aprobaciones). El cuestionario ya trae sus propios botones.
					<div className="approval-inline">
						{composerDialogRoots.map(([id, r]) => (
							<RemoteRoot
								key={id}
								tree={r.tree!}
								rootId={id}
								onEvent={(handlerId, payload) =>
									post({ type: "web_event", rootId: id, handlerId, payload })
								}
							/>
						))}
					</div>
				) : (
					<Composer
						onSubmit={(text, mode, images) =>
							post({ type: "submit", text, mode, images })
						}
						onSearch={(q) => post({ type: "search_files", query: q })}
						files={state.files}
						commands={commands}
						models={state.models}
						active={state.models?.active}
						thinking={state.thinking}
						mode={state.mode}
						busy={state.busy}
						pendingDialog={state.approvals.length > 0}
						expanded={composerExpanded}
						onExpandedChange={setComposerExpanded}
						insertSignal={state.composerInsert}
						onAbort={() => {
							diagLog("botón Detener (Composer) → post {abort}");
							post({ type: "abort" });
						}}
						onSelectModel={(provider, modelId) =>
							post({ type: "select_model", provider, model: modelId })
						}
						onSetThinking={(level) => post({ type: "set_thinking", level })}
						onCycleMode={() => post({ type: "set_mode", mode: nextMode(state.mode) })}
					/>
				)}
				<Statusline
					ws={state.workspace}
					goal={state.goal}
					usage={state.usage}
					onRename={(name) =>
						state.workspace?.sessionPath &&
						post({
							type: "rename_session",
							path: state.workspace.sessionPath,
							name,
						})
					}
				/>
			</div>
			{sessionsOpen && state.sessions && (
				<SessionsPanel
					sessions={state.sessions}
					scope={sessionScope}
					onScopeChange={(s) => {
						setSessionScope(s);
						post({ type: "list_sessions", scope: s });
					}}
					onClose={() => setSessionsOpen(false)}
					onSwitch={(p) => {
						post({ type: "switch_session", path: p });
						setSessionsOpen(false);
					}}
					onRename={(p, n) => post({ type: "rename_session", path: p, name: n })}
					onDelete={(p) => post({ type: "delete_session", path: p })}
					onNewSession={() => {
						post({ type: "new_session" });
						setSessionsOpen(false);
					}}
				/>
			)}
			{modelsOpen && state.models && (
				<ModelPanel
					providers={state.models.providers}
					active={state.models.active}
					refreshing={state.models.refreshing}
					refreshErrors={state.models.refreshErrors}
					deviceCode={state.oauthDeviceCode}
					onClose={() => setModelsOpen(false)}
					onSelect={(provider, model) =>
						post({ type: "select_model", provider, model })
					}
					onLogin={(provider) => post({ type: "login_provider", provider })}
					onLogout={(provider) => post({ type: "logout_provider", provider })}
					onSetKey={(provider) => post({ type: "rotate_key", provider })}
					onDiscoverModels={(provider) =>
						post({ type: "discover_models", provider })
					}
				/>
			)}
			{forkOpen && state.forkPoints && state.forkPoints.length > 0 && (
				<ForkPanel
					points={state.forkPoints}
					onClose={() => setForkOpen(false)}
					onFork={(entryId) => post({ type: "fork_at", entryId })}
				/>
			)}
			{configOpen && (
				<SettingsHub
					key={settingsTab ?? "default"}
					state={state}
					post={post}
					onClose={() => {
						setConfigOpen(false);
						setSettingsTab(undefined);
					}}
					initialTab={(settingsTab ?? "providers") as SettingsTab}
				/>
			)}
		</div>
	);
}

/** Toast efímero para `state.info`: muestra el mensaje flotante y se auto-oculta
 *  tras ~4.5s. Si llega un mensaje nuevo mientras está visible, reinicia el timer.
 *  Reemplaza al info-bar persistente (MVP → toast, como marcaba store.ts). Los
 *  avisos de modo (auto-edit/auto) y el hint de Esc siguen como info-bar
 *  (persistentes, arriba) porque son contexto operativo, no notificaciones. */
const TOAST_META: Record<ToastLevel, { icon: ReactNode; cls: string }> = {
	error: { icon: <Codicon name="error" size={14} />, cls: "error" },
	warning: { icon: <Codicon name="warning" size={14} />, cls: "warning" },
	info: { icon: <Codicon name="info" size={14} />, cls: "info" },
	success: { icon: <Codicon name="pass-filled" size={14} />, cls: "success" },
};
function InfoToast({
	toast,
}: {
	toast: { text: string; level: ToastLevel } | undefined;
}) {
	const [visible, setVisible] = useState(false);
	const [cur, setCur] = useState<
		{ text: string; level: ToastLevel } | undefined
	>();
	useEffect(() => {
		if (!toast) return;
		setCur(toast);
		setVisible(true);
		// Errores y warnings NO se auto-cierran: el usuario debe cerrarlos manualmente
		// para alcanzar a leerlos/copiarlos (p. ej. el ABI de better-sqlite3 llegaba como
		// warning y desaparecía a los 4.5s). info/success sí desaparecen.
		if (toast.level === "error" || toast.level === "warning") return;
		const t = setTimeout(() => setVisible(false), 4500);
		return () => clearTimeout(t);
	}, [toast]);
	if (!visible || !cur) return null;
	const meta = TOAST_META[cur.level] ?? TOAST_META.info;
	return (
		<div
			className={"info-toast " + meta.cls}
			role={cur.level === "error" ? "alert" : "status"}
		>
			{meta.icon}
			<span className="info-toast-text">{cur.text}</span>
			<button
				className="info-toast-close"
				aria-label="Cerrar aviso"
				type="button"
				onClick={() => setVisible(false)}
			>
				<Codicon name="close" size={13} />
			</button>
		</div>
	);
}
