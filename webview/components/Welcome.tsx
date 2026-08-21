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
		desc: "Crea el plan completo (brief, PRD, arquitectura y specs) para una nueva idea.",
		iconName: "rocket",
		prompt: "/wf aidd-plan ",
		actionType: "insert",
	},
	{
		id: "tea-test",
		title: "Diseñar Pruebas (TEA)",
		desc: "Diseña la matriz de pruebas por escenarios y criterios de aceptación.",
		iconName: "beaker",
		prompt: "Ejecuta el workflow tea-test-design para diseñar las pruebas del proyecto.",
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
		desc: "Explica la estructura, módulos principales y flujo de datos del workspace.",
		iconName: "symbol-structure",
		prompt: "Explica la arquitectura y componentes clave de este proyecto.",
		actionType: "submit",
	},
];

const SHORTCUTS = [
	{ label: "@archivos", text: "@", iconName: "file" },
	{ label: "/workflows", text: "/wf ", iconName: "gear" },
	{ label: "$skills", text: "$", iconName: "sparkle" },
];

interface Feature {
	key: string;
	title: string;
	body: React.ReactNode;
}

const FEATURES: Feature[] = [
	{
		key: "files",
		title: "Archivos e imágenes",
		body: (
			<>
				escribe <code>@</code> para adjuntar archivos (búsqueda difusa, navega
				carpetas con <code>/</code>, comillas para espacios:{" "}
				<code>@&quot;ruta con espacios&quot;</code>). Pega una{" "}
				<strong>imagen</strong> del portapapeles para enviarla al modelo
				(visión).
			</>
		),
	},
	{
		key: "bash",
		title: "Bash rápido",
		body: (
			<>
				<code>!comando</code> envía el resultado al modelo;{" "}
				<code>!!comando</code> lo ejecuta sin enviarlo (solo lo ves tú).
			</>
		),
	},
	{
		key: "slash",
		title: "Comandos / y Workflows",
		body: (
			<>
				usa <code>/wf aidd-plan</code>, <code>/wf aidd-ship</code> o escribe{" "}
				<code>/</code> para ver comandos rápidos como <code>/compact</code>,{" "}
				<code>/reload</code>, <code>/model</code> o <code>/login</code>.
			</>
		),
	},
	{
		key: "send",
		title: "Envío y atajos",
		body: (
			<>
				<kbd>Enter</kbd> envía · <kbd>Shift</kbd>+<kbd>Enter</kbd> salto de
				línea · <kbd>Alt</kbd>+<kbd>Enter</kbd> encola un <em>follow-up</em>.{" "}
				<kbd>↑</kbd>/<kbd>↓</kbd> recupera mensajes anteriores.
			</>
		),
	},
	{
		key: "ctx",
		title: "Contexto y razonamiento",
		body: (
			<>
				la barra inferior muestra uso del contexto y tokens. El botón de
				razonamiento permite alternar el <em>thinking</em>; <code>/compact</code>{" "}
				resume el contexto.
			</>
		),
	},
	{
		key: "gates",
		title: "Aprobaciones y seguridad",
		body: (
			<>
				Frida pide confirmar <strong>ediciones</strong> y <strong>bash</strong>.
				Cambia de modo con el botón de escudo: <strong>manual</strong>,{" "}
				<strong>auto-edit</strong> o <strong>YOLO (auto)</strong>.
			</>
		),
	},
	{
		key: "esc",
		title: "Detener respuesta",
		body: (
			<>
				haz clic en el botón circular <strong>■</strong> o presiona{" "}
				<kbd>Esc</kbd> dos veces para detener inmediatamente.
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
	const [tipIndex, setTipIndex] = useState(() =>
		Math.floor(Math.random() * FEATURES.length),
	);

	const nextTip = () => {
		if (FEATURES.length <= 1) return;
		setTipIndex((prev) => {
			let n = Math.floor(Math.random() * FEATURES.length);
			while (n === prev) n = Math.floor(Math.random() * FEATURES.length);
			return n;
		});
	};

	const tip = FEATURES[tipIndex];

	const handleCardClick = (card: StarterCard) => {
		if (card.actionType === "insert" && onInsert) {
			onInsert(card.prompt);
		} else if (onPrompt) {
			onPrompt(card.prompt);
		}
	};

	return (
		<div className="welcome">
			<div className="welcome-logo">
				<img src={logo} className="welcome-logo-img" alt="Frida Code" />
			</div>
			<h1>Frida Code</h1>
			<p className="welcome-sub">
				Asistente inteligente de código de Softtek AppDev. ¿En qué podemos trabajar hoy?
			</p>

			<div className="welcome-shortcuts">
				{SHORTCUTS.map((s) => (
					<button
						key={s.label}
						type="button"
						className="welcome-shortcut-btn"
						onClick={() => onInsert?.(s.text)}
					>
						<Codicon name={s.iconName} size={12} />
						<span>{s.label}</span>
					</button>
				))}
			</div>

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
							<Codicon name={c.iconName} size={15} className="starter-card-icon" />
							<span>{c.title}</span>
						</div>
						<p className="starter-card-desc">{c.desc}</p>
					</div>
				))}
			</div>

			<div className="tip-day">
				<div className="tip-day-label">
					<span>
						<Codicon name="lightbulb" size={12} /> Tip del día
					</span>
					<button
						className="tip-day-refresh"
						onClick={nextTip}
						title="Ver otro tip"
						aria-label="Ver otro tip"
					>
						<Codicon name="refresh" size={13} />
					</button>
				</div>
				<p className="tip-day-body">
					<strong>{tip.title}:</strong> {tip.body}
				</p>
			</div>

			<details className="welcome-help">
				<summary>Instrucciones y atajos</summary>
				<ul className="tips">
					{FEATURES.map((f) => (
						<li key={f.key}>
							<strong>{f.title}:</strong> {f.body}
						</li>
					))}
				</ul>
			</details>
		</div>
	);
}
