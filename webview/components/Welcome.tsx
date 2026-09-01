/// <reference path="../assets.d.ts" />
import { useEffect, useState, useMemo } from "react";
import { Codicon } from "./Codicon";
import logo from "../assets/frida-logo.png";
import type { SettingsTab } from "./SettingsHub";
import type { WorkspaceInfo } from "../types";

export type WelcomeCategory = "greenfield" | "brownfield" | "control";

interface StarterCard {
	id: string;
	title: string;
	desc: string;
	iconName: string;
	prompt?: string;
	actionType: "submit" | "insert" | "settings" | "roadmap";
	settingsTab?: SettingsTab;
	badge?: string;
	badgeTitle?: string;
}

interface CategoryConfig {
	id: WelcomeCategory;
	label: string;
	iconName: string;
	tagline: string;
	cards: StarterCard[];
}

const CATEGORIES: CategoryConfig[] = [
	{
		id: "greenfield",
		label: "De cero",
		iconName: "rocket",
		tagline:
			"De la idea al software: planificación, arquitectura y desarrollo autónomo.",
		cards: [
			{
				id: "sdd-autonomous",
				title: "Desarrollo Autónomo (SDD)",
				desc:
					"La fábrica: features avanzando discover → research → design → plan → 🚀 ready-to-ship, con su board de ejecución.",
				iconName: "tools",
				prompt: "/pipeline",
				actionType: "submit",
			},
			{
				id: "aidd-plan",
				title: "Planificar con AiDD",
				desc: "Brief, PRD, arquitectura y specs para una idea nueva.",
				iconName: "rocket",
				actionType: "roadmap",
				badge: "PRÓXIMAMENTE",
				badgeTitle:
					"Entrará con el motor de paneles (FR#9) cuando el método exista — /wf aidd-plan sigue disponible hoy",
			},
			{
				id: "tea-test",
				title: "Diseñar Pruebas (TEA)",
				desc:
					"Diseña la matriz de pruebas por escenarios y criterios de aceptación BDD.",
				iconName: "beaker",
				prompt:
					"Ejecuta el workflow tea-test-design para diseñar las pruebas del proyecto.",
				actionType: "submit",
			},
			{
				id: "team-packs",
				title: "Packs de Equipo",
				desc:
					"Plantillas de arquitectura y estándares compartidos de la organización.",
				iconName: "package",
				actionType: "roadmap",
				badge: "ROADMAP",
				badgeTitle: "Pista P3: Ecosistema de packs y estándares corporativos",
			},
		],
	},
	{
		id: "brownfield",
		label: "Existente",
		iconName: "repo",
		tagline:
			"Entender, documentar, auditar y dimensionar aplicaciones existentes.",
		cards: [
			{
				id: "understand",
				title: "Entender el Código",
				desc:
					"7 preguntas clave del día 1, mapa de riesgos y modelo de arquitectura LikeC4.",
				iconName: "remote-explorer",
				prompt: "/understand",
				actionType: "submit",
			},
			{
				id: "walkthrough",
				title: "Documentar la App",
				desc:
					"Recorre la app como usuario real y genera la documentación funcional completa.",
				iconName: "window",
				prompt: "/walkthrough ",
				actionType: "insert",
			},
			{
				id: "size",
				title: "Dimensionar para Preventa",
				desc:
					"KLOC, complejidad, deuda técnica y estimación COCOMO para propuestas.",
				iconName: "graph",
				prompt: "/size",
				actionType: "submit",
			},
			{
				id: "traffic2api",
				title: "Del Tráfico a la API",
				desc:
					"Captura tráfico de red y deriva contratos y especificaciones OpenAPI.",
				iconName: "pulse",
				prompt: "/traffic2api",
				actionType: "submit",
			},
			{
				id: "project-map",
				title: "Mapa del Proyecto",
				desc:
					"Navegación interactiva de módulos, dependencias y grafo funcional del repo.",
				iconName: "map",
				actionType: "settings",
				settingsTab: "projectMap",
			},
			{
				id: "codebase-audit",
				title: "Auditar Codebase",
				desc:
					"Inspecciona calidad, modularidad, patrones de diseño y consistencia.",
				iconName: "search-sparkle",
				prompt: "Realiza una auditoría integral del código en src/",
				actionType: "submit",
			},
			{
				id: "explain-arch",
				title: "Explicar Arquitectura",
				desc:
					"Estructura de capas, flujo de datos y dependencias principales del workspace.",
				iconName: "symbol-structure",
				prompt: "Explica la arquitectura y componentes clave de este proyecto.",
				actionType: "submit",
			},
			{
				id: "modernize",
				title: "Modernizar Legado",
				desc: "Estrategia y ejecución de migración de stacks antiguos a modernos.",
				iconName: "sparkle",
				actionType: "roadmap",
				badge: "ROADMAP",
				badgeTitle: "Pista M6 (P3): Modernización automática de apps legadas",
			},
		],
	},
	{
		id: "control",
		label: "Control Studio",
		iconName: "shield",
		tagline:
			"Gobernanza agéntica, calidad, sandboxes, métricas y observabilidad.",
		cards: [
			{
				id: "approval",
				title: "Seguridad y Aprobaciones",
				desc:
					"Políticas de ejecución: Manual, Auto-edit o YOLO con auditoría de gates.",
				iconName: "shield",
				actionType: "settings",
				settingsTab: "approval",
			},
			{
				id: "usage",
				title: "Uso, Métricas y Costos",
				desc:
					"Telemetría de tokens, desglose por modelo y reporte de consumo facturable.",
				iconName: "graph",
				actionType: "settings",
				settingsTab: "usage",
			},
			{
				id: "agents",
				title: "Subagentes en Paralelo",
				desc:
					"Supervisa y coordina agentes secundarios en worktrees y tareas concurrentes.",
				iconName: "organization",
				prompt: "/agents",
				actionType: "submit",
			},
			{
				id: "sandboxes",
				title: "Sandboxes Aislados",
				desc:
					"Contenedores seguros para ejecución y prueba de código sin riesgo local.",
				iconName: "package",
				prompt: "/sandbox",
				actionType: "submit",
			},
			{
				id: "workflows",
				title: "Panel de Workflows",
				desc: "Visualizador en vivo de etapas, gates, estado y avance de flujos.",
				iconName: "gear",
				prompt: "/wf",
				actionType: "submit",
			},
			{
				id: "sonar",
				title: "Quality Gate Sonar",
				desc:
					"Puertas de calidad, cobertura de código y métricas estáticas de análisis.",
				iconName: "verified",
				actionType: "settings",
				settingsTab: "sonar",
			},
			{
				id: "skills",
				title: "Catálogo de Skills",
				desc:
					"Biblioteca de habilidades especializadas ($commit, $code-review...).",
				iconName: "sparkle",
				prompt: "/skills",
				actionType: "submit",
			},
			{
				id: "models",
				title: "Cambiar Modelo / LLM",
				desc:
					"Configuración de proveedores DevEngine, Anthropic, OpenAI o Copilot.",
				iconName: "plug",
				actionType: "settings",
				settingsTab: "models",
			},
		],
	},
];

const SHORTCUTS = [
	{ label: "@archivos", text: "@", iconName: "file" },
	{ label: "/workflows", text: "/wf ", iconName: "gear" },
	{ label: "$skills", text: "$", iconName: "sparkle" },
];

interface HelpCategory {
	id: string;
	label: string;
	iconName: string;
	title: string;
	content: React.ReactNode;
}

const HELP_CATEGORIES: HelpCategory[] = [
	{
		id: "files",
		label: "Archivos",
		iconName: "file",
		title: "Adjuntar archivos e imágenes",
		content: (
			<>
				<p>
					Escribe <code>@</code> para adjuntar archivos al contexto con búsqueda
					difusa. Navega carpetas con <code>/</code> y usa comillas para rutas con
					espacios (ej. <code>@&quot;mi carpeta/archivo.ts&quot;</code>).
				</p>
				<p>
					También puedes pegar directamente una <strong>imagen</strong> desde el
					portapapeles (<kbd>Ctrl+V</kbd> / <kbd>Cmd+V</kbd>) para razonar con
					modelos de visión.
				</p>
			</>
		),
	},
	{
		id: "workflows",
		label: "Workflows",
		iconName: "gear",
		title: "Flujos de trabajo y comandos /",
		content: (
			<>
				<p>
					Inicia flujos guiados con <code>/wf aidd-plan</code> (planificación
					integral) o <code>/wf aidd-ship</code> (desarrollo autónomo).
				</p>
				<p>
					Usa comandos rápidos de control como <code>/compact</code> (resumir
					contexto), <code>/model</code> (cambiar LLM activo), o <code>/reload</code>{" "}
					para refrescar extensiones.
				</p>
			</>
		),
	},
	{
		id: "skills",
		label: "Skills",
		iconName: "sparkle",
		title: "Habilidades especializadas $",
		content: (
			<>
				<p>
					Invoca habilidades del catálogo escribiendo <code>$</code> o{" "}
					<code>/skill:nombre</code>.
				</p>
				<p>
					Destacadas: <code>$commit</code> (commits estructurados),{" "}
					<code>$code-review</code> (revisión de estándares y specs),{" "}
					<code>$research</code> (investigación profunda de código) y{" "}
					<code>$tdd</code> (desarrollo guiado por pruebas).
				</p>
			</>
		),
	},
	{
		id: "keyboard",
		label: "Teclado",
		iconName: "keyboard",
		title: "Atajos de teclado y navegación",
		content: (
			<>
				<ul className="wh-kbd-list">
					<li>
						<kbd>Enter</kbd> <span>Enviar mensaje o ejecutar acción</span>
					</li>
					<li>
						<kbd>Shift</kbd>+<kbd>Enter</kbd> <span>Insertar salto de línea</span>
					</li>
					<li>
						<kbd>Alt</kbd>+<kbd>Enter</kbd> <span>Encolar un follow-up</span>
					</li>
					<li>
						<kbd>Esc</kbd>{" "}
						<span>Cerrar diálogos (presiona 2 veces para abortar)</span>
					</li>
					<li>
						<kbd>↑</kbd> / <kbd>↓</kbd>{" "}
						<span>Navegar el historial de mensajes anteriores</span>
					</li>
				</ul>
			</>
		),
	},
	{
		id: "security",
		label: "Seguridad",
		iconName: "shield",
		title: "Aprobaciones y políticas de ejecución",
		content: (
			<>
				<p>
					Frida solicita autorización antes de editar archivos o ejecutar comandos
					bash.
				</p>
				<p>
					Configura el modo desde el icono de escudo en el composer:{" "}
					<strong>Manual</strong> (aprueba todo), <strong>Auto-edit</strong>{" "}
					(auto-aprobar escrituras de código) o <strong>YOLO</strong>{" "}
					(auto-aprobación con auditoría completa).
				</p>
			</>
		),
	},
];

export function Welcome({
	onPrompt,
	onInsert,
	onOpenSettings,
	onOpenMonitor,
	workspace,
	monitorUrl,
}: {
	onPrompt?: (text: string) => void;
	onInsert?: (text: string) => void;
	onOpenSettings?: (tab: SettingsTab) => void;
	/** #195 — Apertura del monitor en el navegador externo: los webviews no
	 *  pueden navegar a URLs externas (ancla muerta); el click lo delega el
	 *  host con vscode.env.openExternal. */
	onOpenMonitor?: () => void;
	workspace?: WorkspaceInfo;
	/** FR#10 — URL del monitor del pipeline (mensaje monitor_url del host);
	 *  habilita el ancla «Abrir monitor ↗» de la tarjeta SDD. */
	monitorUrl?: string;
}) {
	// Auto-detección inteligente: si el workspace tiene diffs o rama activa → brownfield, sino greenfield.
	// El mensaje "workspace" llega de forma asíncrona (git status + postMessage)
	// DESPUÉS del primer render, así que useState inicial nunca ve la detección:
	// sincronizamos por efecto mientras el usuario no haya elegido una tab a mano.
	const detectedCategory: WelcomeCategory = useMemo(() => {
		if (
			workspace?.dirty ||
			(workspace?.diff &&
				(workspace.diff.added > 0 ||
					workspace.diff.modified > 0 ||
					workspace.diff.deleted > 0)) ||
			(workspace?.branch && workspace.branch !== "")
		) {
			return "brownfield";
		}
		return "greenfield";
	}, [workspace]);

	const [activeCategory, setActiveCategory] =
		useState<WelcomeCategory>(detectedCategory);
	const [userPicked, setUserPicked] = useState(false);

	useEffect(() => {
		if (!userPicked) setActiveCategory(detectedCategory);
	}, [detectedCategory, userPicked]);
	const [activeHelpCategory, setActiveHelpCategory] = useState("files");

	const currentCatConfig =
		CATEGORIES.find((c) => c.id === activeCategory) ?? CATEGORIES[0];

	const handleCardClick = (card: StarterCard) => {
		if (card.actionType === "roadmap") return;
		if (card.actionType === "settings" && card.settingsTab && onOpenSettings) {
			onOpenSettings(card.settingsTab);
			return;
		}
		if (card.actionType === "insert" && card.prompt && onInsert) {
			onInsert(card.prompt);
		} else if (card.actionType === "submit" && card.prompt && onPrompt) {
			onPrompt(card.prompt);
		}
	};

	const currentHelpCat =
		HELP_CATEGORIES.find((c) => c.id === activeHelpCategory) ??
		HELP_CATEGORIES[0];

	return (
		<div className="welcome-wrapper">
			<div className="welcome">
				{/* Hero: Logo 96px + Título Rebrandeado + Tagline */}
				<div className="welcome-hero">
					<div className="welcome-logo">
						<img src={logo} className="welcome-logo-img" alt="Frida Studio" />
					</div>
					<h1>Frida Studio</h1>
					<p className="welcome-sub">Agentic Software Factory · Softtek AppDev</p>
				</div>

				{/* Quick Insert Pills (@ / $) */}
				<div className="welcome-shortcuts">
					{SHORTCUTS.map((s) => (
						<button
							key={s.label}
							type="button"
							className="welcome-shortcut-btn"
							onClick={() => onInsert?.(s.text)}
							title={`Insertar prefijo ${s.text} en el prompt`}
						>
							<Codicon name={s.iconName} size={12} />
							<span>{s.label}</span>
						</button>
					))}
				</div>

				{/* Segmented Category Tabs */}
				<div className="welcome-category-tabs" role="tablist">
					{CATEGORIES.map((cat) => {
						const active = cat.id === activeCategory;
						return (
							<button
								key={cat.id}
								type="button"
								role="tab"
								aria-selected={active}
								className={`welcome-cat-tab${active ? " active" : ""}`}
								onClick={() => {
									setUserPicked(true);
									setActiveCategory(cat.id);
								}}
							>
								<Codicon name={cat.iconName} size={13} className="welcome-cat-icon" />
								<span>{cat.label}</span>
							</button>
						);
					})}
				</div>

				{/* Category Subtitle */}
				<p className="welcome-cat-desc">{currentCatConfig.tagline}</p>

				{/* Responsive Starter Cards Grid */}
				<div className="welcome-cards">
					{currentCatConfig.cards.map((c) => {
						const isRoadmap = c.actionType === "roadmap";
						return (
							<div
								key={c.id}
								className={`starter-card${isRoadmap ? " roadmap" : ""}`}
								onClick={() => handleCardClick(c)}
								role={isRoadmap ? "article" : "button"}
								tabIndex={isRoadmap ? -1 : 0}
								title={isRoadmap ? c.badgeTitle : undefined}
								onKeyDown={(e) => {
									if (!isRoadmap && (e.key === "Enter" || e.key === " ")) {
										e.preventDefault();
										handleCardClick(c);
									}
								}}
							>
								<div className="starter-card-head">
									<div className="starter-card-title-group">
										<Codicon name={c.iconName} size={14} className="starter-card-icon" />
										<span>{c.title}</span>
									</div>
									{c.badge && (
										<span className="starter-card-badge" title={c.badgeTitle}>
											{c.badge}
										</span>
									)}
								</div>
								<p className="starter-card-desc">{c.desc}</p>
									{/* FR#10 — ancla al monitor del pipeline: la URL llega por el
									 mensaje monitor_url (host → webview). #195 — el webview NO puede
									 navegar a URLs externas: interceptar el click y delegar al host
									 (openExternal). href queda como respaldo visual/accesibilidad.
									 stopPropagation: el click NO debe disparar el submit /pipeline de
									 la tarjeta contenedora. */}
									{c.id === "sdd-autonomous" && monitorUrl && (
										<a
											href={monitorUrl}
											target="_blank"
											rel="noreferrer"
											title="Abrir el monitor del pipeline (N1 + N2) en el navegador"
											onClick={(e) => {
												e.stopPropagation();
												e.preventDefault();
												onOpenMonitor?.();
											}}
										style={{
											display: "inline-flex",
											alignItems: "center",
											gap: 4,
											marginTop: 2,
											width: "fit-content",
											fontSize: 11,
											color: "var(--vscode-textLink-foreground)",
											textDecoration: "none",
										}}
									>
										Abrir monitor ↗
									</a>
								)}
							</div>
						);
					})}
				</div>

				{/* Collapsible Categorized Tips Hub */}
				<details className="welcome-help">
					<summary className="wh-summary">
						<span className="wh-summary-left">
							<Codicon name="book" size={13} className="wh-book-icon" />
							<span>Guía rápida de atajos y capacidades</span>
						</span>
						<Codicon name="chevron-down" size={12} className="wh-chevron" />
					</summary>
					<div className="wh-content">
						{/* Category Tabs */}
						<div className="wh-tabs" role="tablist">
							{HELP_CATEGORIES.map((cat) => {
								const active = cat.id === activeHelpCategory;
								return (
									<button
										key={cat.id}
										type="button"
										role="tab"
										aria-selected={active}
										className={`wh-tab-btn${active ? " active" : ""}`}
										onClick={() => setActiveHelpCategory(cat.id)}
									>
										<Codicon name={cat.iconName} size={12} />
										<span>{cat.label}</span>
									</button>
								);
							})}
						</div>

						{/* Active Category Content Card */}
						<div className="wh-card">
							<div className="wh-card-title">
								<Codicon name={currentHelpCat.iconName} size={13} />
								<span>{currentHelpCat.title}</span>
							</div>
							<div className="wh-card-body">{currentHelpCat.content}</div>
						</div>
					</div>
				</details>
			</div>
		</div>
	);
}
