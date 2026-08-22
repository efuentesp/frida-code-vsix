import { useEffect, useState } from "react";
import type {
	DependencyStatus,
	EnvironmentReport,
	OutMessage,
	State,
	SupportedPlatform,
} from "../types";
import { Codicon } from "./Codicon";

function getDepIcon(id: string): string {
	switch (id) {
		case "git":
			return "git-branch";
		case "bash":
			return "terminal-bash";
		case "node_npm":
			return "code";
		case "gh":
			return "github";
		case "agent_browser":
			return "globe";
		case "docker":
			return "package";
		default:
			return "tools";
	}
}

function getPlatformIcon(platform: SupportedPlatform): string {
	switch (platform) {
		case "win32":
			return "window";
		case "darwin":
			return "device-desktop";
		case "linux":
			return "terminal-linux";
		default:
			return "server-process";
	}
}

interface EnvCardProps {
	dep: DependencyStatus;
	hostPlatform: SupportedPlatform;
	post: (m: OutMessage) => void;
}

function EnvCard({ dep, hostPlatform, post }: EnvCardProps) {
	const [activeOsTab, setActiveOsTab] =
		useState<SupportedPlatform>(hostPlatform);
	const [copied, setCopied] = useState(false);
	const [expanded, setExpanded] = useState(!dep.installed);

	const guide =
		dep.installGuides[activeOsTab] ?? dep.installGuides[hostPlatform];

	const handleCopy = () => {
		if (!guide?.command) return;
		try {
			if (navigator?.clipboard?.writeText) {
				navigator.clipboard.writeText(guide.command);
			}
		} catch {
			/* fallback host */
		}
		post({ type: "copy_text", text: guide.command });
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	return (
		<div
			className={`cfg-env-card ${dep.installed ? "is-installed" : "is-missing"} ${dep.category === "core" && !dep.installed ? "is-critical" : ""}`}
		>
			{/* Encabezado de la tarjeta */}
			<div className="cfg-env-card-header">
				<div className="cfg-env-card-left">
					<div className="cfg-env-icon-wrap">
						<Codicon name={getDepIcon(dep.id)} size={16} />
					</div>
					<div className="cfg-env-info">
						<div className="cfg-env-name-row">
							<span className="cfg-env-name">{dep.name}</span>
							<span className="cfg-env-usedby">{dep.usedBy}</span>
						</div>
						<div className="cfg-env-desc">{dep.description}</div>
					</div>
				</div>

				<div className="cfg-env-card-right">
					{dep.installed ? (
						<div className="cfg-env-badge is-ok" title={dep.version || "Instalado"}>
							<Codicon name="check" size={13} />
							<span>
								{dep.version ? `v${dep.version.replace(/^v/i, "")}` : "Instalado"}
							</span>
						</div>
					) : dep.category === "core" ? (
						<div className="cfg-env-badge is-error" title="Requerido para operar">
							<Codicon name="error" size={13} />
							<span>No encontrado</span>
						</div>
					) : (
						<div className="cfg-env-badge is-warn" title="Opcional según la feature">
							<Codicon name="warning" size={13} />
							<span>No instalado</span>
						</div>
					)}

					<button
						type="button"
						className="cfg-env-expand-btn"
						onClick={() => setExpanded(!expanded)}
						title={
							expanded ? "Ocultar guía de instalación" : "Ver guía de instalación"
						}
					>
						<Codicon name={expanded ? "chevron-up" : "chevron-down"} size={13} />
					</button>
				</div>
			</div>

			{/* Notas o advertencias específicas */}
			{dep.notes && (
				<div
					className={`cfg-env-notes ${dep.installed ? "is-info" : "is-warning"}`}
				>
					<Codicon name={dep.installed ? "info" : "warning"} size={13} />
					<span>{dep.notes}</span>
				</div>
			)}

			{/* Acordeón de Guía de instalación */}
			{expanded && guide && (
				<div className="cfg-env-guide">
					<div className="cfg-env-guide-head">
						<span className="cfg-env-guide-title">
							<Codicon name="book" size={12} /> Guía de instalación:
						</span>
						<div className="cfg-env-os-tabs">
							<button
								type="button"
								className={`cfg-env-os-tab ${activeOsTab === "win32" ? "active" : ""}`}
								onClick={() => setActiveOsTab("win32")}
							>
								Windows
							</button>
							<button
								type="button"
								className={`cfg-env-os-tab ${activeOsTab === "darwin" ? "active" : ""}`}
								onClick={() => setActiveOsTab("darwin")}
							>
								macOS
							</button>
							<button
								type="button"
								className={`cfg-env-os-tab ${activeOsTab === "linux" ? "active" : ""}`}
								onClick={() => setActiveOsTab("linux")}
							>
								Linux
							</button>
						</div>
					</div>

					<div className="cfg-env-cmd-box">
						<code className="cfg-env-cmd-text">{guide.command}</code>
						<button
							type="button"
							className={`cfg-env-copy-btn ${copied ? "copied" : ""}`}
							onClick={handleCopy}
							title="Copiar comando al portapapeles"
						>
							<Codicon name={copied ? "check" : "copy"} size={13} />
							<span>{copied ? "¡Copiado!" : "Copiar"}</span>
						</button>
					</div>

					{guide.guide && <div className="cfg-env-guide-tip">{guide.guide}</div>}
				</div>
			)}
		</div>
	);
}

export function EnvironmentTab({
	state,
	post,
}: {
	state: State;
	post: (m: OutMessage) => void;
}) {
	const env = state.environment;
	const isChecking = !!state.environmentChecking;

	// Al abrir la pestaña por primera vez, si no hay reporte o está vacío, disparar verificación
	useEffect(() => {
		if (!env && !isChecking) {
			post({ type: "check_environment" });
		}
	}, [env, isChecking, post]);

	const hostPlatform: SupportedPlatform = env?.platform ?? "win32";
	const coreDeps = env?.dependencies.filter((d) => d.category === "core") ?? [];
	const extDeps = env?.dependencies.filter((d) => d.category !== "core") ?? [];

	return (
		<div className="cfg-environment">
			{/* Banner superior de salud del sistema */}
			<div
				className={`cfg-env-banner ${env?.coreReady ? "is-ready" : "is-incomplete"}`}
			>
				<div className="cfg-env-banner-left">
					<div className="cfg-env-banner-icon-wrap">
						<Codicon
							name={env?.coreReady ? "pulse" : "warning"}
							size={18}
							className={
								env?.coreReady ? "cfg-env-banner-icon-ok" : "cfg-env-banner-icon-warn"
							}
						/>
					</div>
					<div className="cfg-env-banner-info">
						<div className="cfg-env-banner-title">
							{env
								? `Estado del Sistema: ${env.readyCount} de ${env.totalCount} dependencias listas`
								: "Comprobando entorno..."}
						</div>
						<div className="cfg-env-banner-subtitle">
							<Codicon name={getPlatformIcon(hostPlatform)} size={12} />
							<span>
								SO Detectado: <strong>{env?.platformLabel ?? "Detectando..."}</strong> (
								{env?.arch ?? "..."})
							</span>
							{env && (
								<span className="cfg-env-banner-tag">
									{env.coreReady ? "Núcleo 100% Operativo" : "Falta Núcleo Requerido"}
								</span>
							)}
						</div>
					</div>
				</div>

				<div className="cfg-env-banner-right">
					<button
						type="button"
						className="pc-save cfg-env-refresh-btn"
						disabled={isChecking}
						onClick={() => post({ type: "check_environment" })}
					>
						<Codicon name="refresh" size={13} spin={isChecking} />
						<span>{isChecking ? "Verificando…" : "Re-verificar"}</span>
					</button>
				</div>
			</div>

			{/* Sin reporte aún (cargando) */}
			{!env && isChecking && (
				<div className="cfg-stub">
					<Codicon name="loading" size={14} spin /> Analizando binarios del sistema
					(Git, Bash, Node, npm, gh, agent-browser, Docker)...
				</div>
			)}

			{/* Sección 1: Núcleo Requerido */}
			{coreDeps.length > 0 && (
				<div className="cfg-env-section-group">
					<div className="cfg-section">
						<Codicon name="shield" size={13} /> NÚCLEO REQUERIDO (Sin esto el agente
						no puede operar)
					</div>
					<div className="cfg-env-cards-list">
						{coreDeps.map((dep) => (
							<EnvCard
								key={dep.id}
								dep={dep}
								hostPlatform={hostPlatform}
								post={post}
							/>
						))}
					</div>
				</div>
			)}

			{/* Sección 2: Extensiones y Módulos */}
			{extDeps.length > 0 && (
				<div className="cfg-env-section-group">
					<div className="cfg-section">
						<Codicon name="extensions" size={13} /> EXTENSIONES Y MÓDULOS
						(Funcionalidades por demanda)
					</div>
					<div className="cfg-env-cards-list">
						{extDeps.map((dep) => (
							<EnvCard
								key={dep.id}
								dep={dep}
								hostPlatform={hostPlatform}
								post={post}
							/>
						))}
					</div>
				</div>
			)}
		</div>
	);
}
