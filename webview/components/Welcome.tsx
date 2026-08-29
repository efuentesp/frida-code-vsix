/// <reference path="../assets.d.ts" />
import { useState } from "react";
import { Codicon } from "./Codicon";
import logo from "../assets/frida-logo.png";

interface StarterCard {
	id: string;
	title: string;
	desc: string;
	iconName: string;
	prompt: string;
	actionType?: "submit" | "insert";
}

const STARTER_CARDS: StarterCard[] = [
	{
		id: "aidd-plan",
		title: "Planificar con AiDD",
		desc:
			"Crea el plan completo (brief, PRD, arquitectura y specs) para una nueva idea.",
		iconName: "rocket",
		prompt: "/wf aidd-plan ",
		actionType: "insert",
	},
	{
		id: "tea-test",
		title: "Diseñar Pruebas (TEA)",
		desc: "Diseña la matriz de pruebas por escenarios y criterios de aceptación.",
		iconName: "beaker",
		prompt:
			"Ejecuta el workflow tea-test-design para diseñar las pruebas del proyecto.",
		actionType: "submit",
	},
	{
		id: "codebase-audit",
		title: "Auditar Codebase",
		desc: "Inspecciona calidad, modularidad, patrones de reuso y consistencia.",
		iconName: "search-sparkle",
		prompt: "Realiza una auditoría integral del código en src/",
		actionType: "submit",
	},
	{
		id: "explain-arch",
		title: "Explicar Arquitectura",
		desc:
			"Explica la estructura, módulos principales y flujo de datos del workspace.",
		iconName: "symbol-structure",
		prompt: "Explica la arquitectura y componentes clave de este proyecto.",
		actionType: "submit",
	},
	// #140 (Pista M): cards de los comandos slash — actionType "insert"
	// para no enviar (el usuario completa URL/presupuesto tras el comando;
	// /walkthrough acepta URL inline, de ahí su espacio final, D5).
	{
		id: "walkthrough",
		title: "Documentar una App",
		desc:
			"Recorre la app como usuario real y genera la documentación funcional (pantallas, journeys, reglas, roles).",
		iconName: "window",
		prompt: "/walkthrough ",
		actionType: "insert",
	},
	{
		id: "understand",
		title: "Entender el Código",
		desc:
			"Produce el entendimiento técnico del repo con evidencia: 7 preguntas del día 1, riesgos y modelo LikeC4.",
		iconName: "remote-explorer",
		prompt: "/understand",
		actionType: "insert",
	},
	{
		id: "size",
		title: "Dimensionar para Preventa",
		desc:
			"KLOC, COCOMO, deuda técnica y costo con salario mensual para la conversación de preventa.",
		iconName: "graph",
		prompt: "/size",
		actionType: "insert",
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
}: {
	onPrompt?: (text: string) => void;
	onInsert?: (text: string) => void;
}) {
	const [activeCategory, setActiveCategory] = useState("files");

	const handleCardClick = (card: StarterCard) => {
		if (card.actionType === "insert" && onInsert) {
			onInsert(card.prompt);
		} else if (onPrompt) {
			onPrompt(card.prompt);
		}
	};

	const currentCat =
		HELP_CATEGORIES.find((c) => c.id === activeCategory) ?? HELP_CATEGORIES[0];

	return (
		<div className="welcome-wrapper">
			<div className="welcome">
				{/* Hero: Logo 96px + Título + Subtítulo */}
				<div className="welcome-hero">
					<div className="welcome-logo">
						<img src={logo} className="welcome-logo-img" alt="Frida Code" />
					</div>
					<h1>Frida Code</h1>
					<p className="welcome-sub">
						Asistente inteligente de código de Softtek AppDev. ¿En qué podemos
						trabajar hoy?
					</p>
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

				{/* 2x2 Starter Cards (Copilot Canvas) */}
				<div className="welcome-cards">
					{STARTER_CARDS.map((c) => (
						<div
							key={c.id}
							className="starter-card"
							onClick={() => handleCardClick(c)}
							role="button"
							tabIndex={0}
							onKeyDown={(e) => {
								if (e.key === "Enter" || e.key === " ") {
									e.preventDefault();
									handleCardClick(c);
								}
							}}
						>
							<div className="starter-card-head">
								<Codicon name={c.iconName} size={14} className="starter-card-icon" />
								<span>{c.title}</span>
							</div>
							<p className="starter-card-desc">{c.desc}</p>
						</div>
					))}
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
								const active = cat.id === activeCategory;
								return (
									<button
										key={cat.id}
										type="button"
										role="tab"
										aria-selected={active}
										className={`wh-tab-btn${active ? " active" : ""}`}
										onClick={() => setActiveCategory(cat.id)}
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
								<Codicon name={currentCat.iconName} size={13} />
								<span>{currentCat.title}</span>
							</div>
							<div className="wh-card-body">{currentCat.content}</div>
						</div>
					</div>
				</details>
			</div>
		</div>
	);
}
