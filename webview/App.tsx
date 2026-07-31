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
import { OnboardingWizard } from "./components/OnboardingWizard";
import { TurnView } from "./components/Turn";
import { CompactionCard } from "./components/CompactionCard";
import { BranchSummaryCard } from "./components/BranchSummaryCard";
import { UiDialog } from "./components/UiDialog";
import { RemoteRoot } from "./components/RemoteRoot";
import { Composer, type CommandItem } from "./components/Composer";
import { ContextBar } from "./components/ContextBar";
import { SessionsPanel } from "./components/SessionsPanel";
import { Welcome } from "./components/Welcome";
import { ResourcesPanel } from "./components/ResourcesPanel";
import { WorkspaceBar } from "./components/WorkspaceBar";
import {
	Bot,
	Brain,
	CircleAlert,
	CircleCheck,
	CircleStop,
	CornerDownRight,
	History,
	Info,
	Key,
	Library,
	Minimize2,
	RotateCw,
	Settings,
	ShieldCheck,
	SquarePen,
	TriangleAlert,
	X,
} from "lucide-react";
import { ChevronDown } from "lucide-react";
import { Tooltip } from "./components/Tooltip";
import { Spinner } from "./components/Spinner";
import { AnimatedLabel } from "./components/AnimatedLabel";
import { ApprovalCard } from "./components/ApprovalCard";
import { ModelPanel } from "./components/ModelPanel";
import { SettingsHub } from "./components/SettingsHub";
import { ForkPanel } from "./components/ForkPanel";
import { LensDiagnostics } from "./components/LensDiagnostics";

type VsCodeApi = { postMessage(msg: OutMessage): void };

// acquireVsCodeApi() solo puede llamarse UNA VEZ por webview → singleton de módulo.
declare function acquireVsCodeApi(): VsCodeApi;
let _vscode: VsCodeApi | null = null;
function getVsCode(): VsCodeApi {
	if (!_vscode) _vscode = acquireVsCodeApi();
	return _vscode;
}

function nextMode(m: ApprovalMode): ApprovalMode {
	return m === "manual" ? "auto-edit" : m === "auto-edit" ? "auto" : "manual";
}
function labelMode(m: ApprovalMode): string {
	return m === "manual" ? "Manual" : m === "auto-edit" ? "Auto-edit" : "Auto";
}

export function App() {
	const [state, dispatch] = useReducer(reduce, initialState);
	const approvalsRef = useRef<HTMLDivElement>(null);
	const logRef = useRef<HTMLDivElement>(null);
	const stickRef = useRef(true);
	const [escHint, setEscHint] = useState(false);
	const [sessionsOpen, setSessionsOpen] = useState(false);
	const [resourcesOpen, setResourcesOpen] = useState(false);
	const [modelsOpen, setModelsOpen] = useState(false);
	const [forkOpen, setForkOpen] = useState(false);
	const [configOpen, setConfigOpen] = useState(false);
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

	useEffect(() => {
		const vscode = getVsCode();
		const handler = (e: MessageEvent) => {
			const msg = e.data as InMessage;
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
	useEffect(() => {
		if (!state.busy) {
			setEscHint(false);
			return;
		}
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			const now = Date.now();
			if (now - lastEscRef.current < 450) {
				lastEscRef.current = 0;
				if (escTimerRef.current) clearTimeout(escTimerRef.current);
				setEscHint(false);
				getVsCode().postMessage({ type: "abort" });
			} else {
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

	// Built-in slash commands (siempre disponibles, ejecutados por el host).
	const builtinCommands: CommandItem[] = useMemo(
		() => [
			{
				kind: "builtin",
				label: "/compact",
				name: "compact",
				description: "Compactar el contexto de la sesión",
			},
			{
				kind: "builtin",
				label: "/reload",
				name: "reload",
				description: "Recargar extensiones, skills y prompts",
			},
			{
				kind: "builtin",
				label: "/new",
				name: "new",
				description: "Iniciar una sesión nueva",
			},
			{
				kind: "builtin",
				label: "/model",
				name: "model",
				description: "Abrir el selector de modelo/proveedor",
				argumentHint: "<provider/model>",
			},
			{
				kind: "builtin",
				label: "/login",
				name: "login",
				description: "Iniciar sesión con un proveedor (suscripción)",
				argumentHint: "<provider>",
			},
			{
				kind: "builtin",
				label: "/logout",
				name: "logout",
				description: "Cerrar sesión de un proveedor",
				argumentHint: "<provider>",
			},
			{
				kind: "builtin",
				label: "/name",
				name: "name",
				description: "Renombrar la sesión actual",
				argumentHint: "<nombre>",
			},
			{
				kind: "builtin",
				label: "/copy",
				name: "copy",
				description: "Copiar el último mensaje al portapapeles",
			},
			{
				kind: "builtin",
				label: "/clone",
				name: "clone",
				description: "Duplicar la sesión actual",
			},
			{
				kind: "builtin",
				label: "/fork",
				name: "fork",
				description: "Bifurcar desde un mensaje anterior",
			},
			{
				kind: "builtin",
				label: "/todos",
				name: "todos",
				description: "Mostrar la lista de tareas agrupada por estado",
			},
			{
				kind: "builtin",
				label: "/context",
				name: "context",
				description:
					"Reporte de uso del contexto (presión, categorías, system prompt)",
			},
			{
				kind: "builtin",
				label: "/gates",
				name: "gates",
				description: "Auditoría de permisos (decisiones allow/block del gate)",
			},
			{
				kind: "builtin",
				label: "/gates-config",
				name: "gates-config",
				description: "Editor de permisos (allow/ask/deny por tool)",
			},
			{
				kind: "builtin",
				label: "/help",
				name: "help",
				description: "Mostrar atajos y comandos",
			},
		],
		[],
	);

	// Lista de comandos para el autocompletado de "/": built-in + skills + prompts.
	const commands: CommandItem[] = useMemo(() => {
		const r = state.resources;
		if (!r) return builtinCommands;
		return [
			...builtinCommands,
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
	}, [state.resources, builtinCommands]);

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
			setRetrySecs(
				Math.max(0, Math.ceil((total - (Date.now() - start)) / 1000)),
			);
		}, 250);
		return () => clearInterval(id);
	}, [state.retry]);

	const procLabel = (() => {
		if (state.retry) {
			const secs = retrySecs ?? Math.ceil(state.retry.delayMs / 1000);
			return `Reintentando (${state.retry.attempt}/${state.retry.maxAttempts}) en ${secs}s… (doble Esc para cancelar)`;
		}
		if (!state.busy) return null;
		const last = state.turns[state.turns.length - 1];
		if (last?.bash?.status === "running") return "Ejecutando bash…";
		if (last?.status === "executing" && last.executingTool)
			return `Ejecutando ${last.executingTool}…`;
		if (last?.status === "thinking") return "Pensando…";
		return "Procesando…";
	})();

	// Roots de diálogo en el slot del composer (ask_user_question): reemplazan
	// el input como las aprobaciones. placement "composer" (distinto de "footer"
	// para no mezclarse con el panel de todo/workflow, que vive en .web-footer).
	const composerDialogRoots = Object.entries(state.webRoots ?? {}).filter(
		([, r]) => r.placement === "composer" && r.tree,
	);

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

	return (
		<div className="app">
			<InfoToast toast={state.info} />
			<header className="toolbar">
				<span className="brand">
					<span className="avatar ai sm">
						<Bot size={13} />
					</span>{" "}
					Frida Code
				</span>
				<span className="spacer" />
				<span className="tb-group">
					<Tooltip
						label="Recursos cargados (extensiones, skills, prompts, themes, contexto)"
						side="bottom"
					>
						<button
							className="ico"
							onClick={() => {
								post({ type: "list_resources" });
								setResourcesOpen(true);
							}}
						>
							<Library size={15} />
						</button>
					</Tooltip>
					<Tooltip label="Sesiones anteriores" side="bottom">
						<button
							className="ico"
							onClick={() => {
								setSessionsOpen(true);
								post({ type: "list_sessions" });
							}}
						>
							<History size={15} />
						</button>
					</Tooltip>
					<Tooltip label="Configuración" side="bottom">
						<button className="ico" onClick={() => setConfigOpen(true)}>
							<Settings size={15} />
						</button>
					</Tooltip>
				</span>
				<span className="tb-sep" />
				<span className="tb-group">
					<Tooltip label="Nueva sesión" side="bottom">
						<button
							className="ico"
							onClick={() => post({ type: "new_session" })}
							disabled={state.busy}
						>
							<SquarePen size={15} />
						</button>
					</Tooltip>
					<Tooltip label="Compactar contexto" side="bottom">
						<button
							className="ico"
							onClick={() => post({ type: "compact" })}
							disabled={
								state.busy || state.isCompacting || state.turns.length === 0
							}
						>
							<Minimize2 size={15} />
						</button>
					</Tooltip>
					<Tooltip
						label={
							hideThinking ? "Mostrar razonamiento" : "Ocultar razonamiento"
						}
						side="bottom"
					>
						<button
							className={"ico" + (hideThinking ? " off" : " active")}
							onClick={() => setHideThinking((v) => !v)}
						>
							<Brain size={15} />
						</button>
					</Tooltip>
					<Tooltip label="Recargar extensiones y recursos" side="bottom">
						<button
							className="ico"
							onClick={() => post({ type: "reload" })}
							disabled={state.busy}
						>
							<RotateCw size={15} />
						</button>
					</Tooltip>
				</span>
				<span className="tb-sep" />
				<span className="tb-group">
					<Tooltip
						label="Modo de aprobación: Manual → Auto-edit → Auto (clic para ciclar)"
						side="bottom"
					>
						<button
							className={"toggle " + state.mode}
							onClick={() =>
								post({ type: "set_mode", mode: nextMode(state.mode) })
							}
						>
							<ShieldCheck size={14} /> {labelMode(state.mode)}
							{state.gateStats &&
							state.gateStats.allow +
								state.gateStats.block +
								state.gateStats.autoAllow >
								0 ? (
								<span className="gate-stats">
									<span className="gs-allow">✓{state.gateStats.allow}</span>
									<span className="gs-block">✗{state.gateStats.block}</span>
									{state.gateStats.autoAllow > 0 ? (
										<span className="gs-auto">
											⚡{state.gateStats.autoAllow}
										</span>
									) : null}
								</span>
							) : null}
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

			<div className="sub-header">
				<Tooltip label="Proveedor" side="bottom">
					<span className="sub-provider">{state.provider ?? "…"}</span>
				</Tooltip>
				<span className="sub-sep">·</span>
				<Tooltip label="Cambiar modelo / proveedor" side="bottom">
					<button
						className="sub-model-btn"
						onClick={() => {
							setModelsOpen(true);
							post({ type: "list_models" });
						}}
					>
						{state.model ?? "…"} <ChevronDown size={12} />
					</button>
				</Tooltip>
				<span className="sub-sep">·</span>
				<Tooltip label="Nivel de esfuerzo / thinking" side="bottom">
					<select
						className="thinking-select"
						value={state.thinking ?? "medium"}
						onChange={(e) =>
							post({ type: "set_thinking", level: e.target.value })
						}
					>
						<option value="low">low</option>
						<option value="medium">medium</option>
						<option value="high">high</option>
					</select>
				</Tooltip>
				<Tooltip
					label={state.keyNeeded ? "Configurar API key" : "Cambiar API key"}
					side="bottom"
				>
					<button
						className={"sub-key" + (state.keyNeeded ? " missing" : "")}
						onClick={() => post({ type: "rotate_key" })}
					>
						<Key size={12} />
					</button>
				</Tooltip>
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
							className={
								"lens-badge" + (state.lensStatus.active ? " active" : "")
							}
						>
							{state.lensStatus.active ? "✓" : "○"} frida-lens
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
							onClick={() =>
								post({ type: "submit", text: "/update", mode: "steer" })
							}
						>
							v{state.version}
						</button>
					</Tooltip>
				)}
			</div>

			{state.mode === "auto-edit" && (
				<div className="info-bar warn">
					<TriangleAlert size={12} /> Edición automática: crear/editar archivos
					sin confirmación (bash sí pide).
				</div>
			)}
			{state.mode === "auto" && (
				<div className="info-bar warn">
					<TriangleAlert size={12} /> Auto ON: edit/write/bash corren sin
					pedirte confirmación.
				</div>
			)}
			{escHint && (
				<div className="info-bar">
					<CircleStop size={12} /> Presiona Esc de nuevo para detener…
				</div>
			)}
			<div
				className="log"
				ref={logRef}
				onScroll={() => {
					const el = logRef.current;
					if (!el) return;
					stickRef.current =
						el.scrollHeight - el.scrollTop - el.clientHeight < 80;
				}}
			>
				{state.turns.length === 0 && <Welcome />}
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
				<div ref={approvalsRef} className="approvals-area">
					{state.queued.map((q, i) => (
						<div key={i} className="queued-msg">
							<CornerDownRight size={12} /> encolado: {q}
						</div>
					))}
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
						<TriangleAlert size={12} /> {state.providerError}
					</div>
				)}
				{state.isCompacting ? (
					<div className="proc-bar">
						<Spinner size={14} />
						<AnimatedLabel
							text={
								state.retry
									? `Reintentando compactación (${state.retry.attempt}/${state.retry.maxAttempts}) en ${retrySecs ?? Math.ceil(state.retry.delayMs / 1000)}s…`
									: `Compactando contexto${state.compactReason && state.compactReason !== "manual" ? " (automática)" : ""}…`
							}
						/>
						<button
							className="proc-cancel"
							onClick={() => post({ type: "cancel_compaction" })}
						>
							Cancelar
						</button>
					</div>
				) : (
					procLabel && (
						<div className="proc-bar">
							<Spinner size={14} /> <AnimatedLabel text={procLabel} />
						</div>
					)
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
				<LensDiagnostics lens={state.lens} />
				{state.approvals.length > 0 ? (
					// Aprobación pendiente: el input cede su lugar a la tarjeta de permiso
					// (como en la extensión original de pi). No tiene sentido dejar escribir
					// mientras Frida espera Accept/Reject; la tarjeta trae los botones.
					<div className="approval-inline">
						{state.approvals.map((a) => (
							<ApprovalCard
								key={a.id}
								approval={a}
								onRespond={(r) =>
									post({ type: "approval_response", id: a.id, ...r })
								}
							/>
						))}
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
						busy={state.busy}
						pendingDialog={state.approvals.length > 0}
						onAbort={() => post({ type: "abort" })}
					/>
				)}
				<WorkspaceBar
					ws={state.workspace}
					onRefresh={() => post({ type: "workspace" })}
				/>
				{state.usage && <ContextBar usage={state.usage} />}
			</div>
			{sessionsOpen && state.sessions && (
				<SessionsPanel
					sessions={state.sessions}
					onClose={() => setSessionsOpen(false)}
					onSwitch={(p) => {
						post({ type: "switch_session", path: p });
						setSessionsOpen(false);
					}}
					onRename={(p, n) =>
						post({ type: "rename_session", path: p, name: n })
					}
					onDelete={(p) => post({ type: "delete_session", path: p })}
				/>
			)}
			{resourcesOpen && state.resources && (
				<ResourcesPanel
					res={state.resources}
					model={state.model}
					onClose={() => setResourcesOpen(false)}
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
					state={state}
					post={post}
					onClose={() => setConfigOpen(false)}
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
	error: { icon: <CircleAlert size={14} />, cls: "error" },
	warning: { icon: <TriangleAlert size={14} />, cls: "warning" },
	info: { icon: <Info size={14} />, cls: "info" },
	success: { icon: <CircleCheck size={14} />, cls: "success" },
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
		// Los errores NO se auto-cierran: el usuario debe cerrarlos manualmente para
		// alcanzar a leerlos/copiarlos. Los demás desaparecen a los 4.5s.
		if (toast.level === "error") return;
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
				<X size={13} />
			</button>
		</div>
	);
}
