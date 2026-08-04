import { useEffect, useRef, useState } from "react";
import { Markdown } from "./Markdown";
import type {
	WebQuestionAnswer,
	WebQuestionOption,
	WebQuestionSpec,
} from "../types";

// QuestionsPanel — ask_user_question NATIVO del webview (ADR-0027). Reemplaza al
// WebQuestionnaire sobre Remote React (ADR-0012): corre en el browser (window
// real) para soportar selección por teclado (parity con ApprovalCard), cosa
// imposible con el árbol serializado del host.
//
// La lógica (tabs, drafts, multiSelect ☑/☐, preview side-by-side, texto libre)
// migra tal cual del WebQuestionnaire del host; los tags fbox/ftext/… se vuelven
// div/span/button nativos con las mismas clases CSS (.q-opt, .q-tab, …).
//
// Foco por ZONAS (options | input | buttons), gestionado por el handler (no por
// el navegador). Las opciones y botones llevan tabIndex={-1} para no entrar al
// foco nativo; sólo el textarea es focuseable nativamente (para escribir).
//
// Keymap (consistente con permisos): Tab/Shift+Tab cicla por TODAS las zonas en
// orden (opciones → input → botones → opciones) · ↑↓ navega dentro de la zona
// (opciones o botones) · ⏎/Espacio activa el foco actual (opción → confirma ·
// botón → ejecuta) · 1-9 selección directa · ←/→ cambia de pregunta · Shift+⏎
// envía · Esc cancela (por niveles: con foco+texto en el input, el 1er Esc sale
// del input conservando el texto; el 2º cancela).

interface Props {
	questions: WebQuestionSpec[];
	onResult: (r: { answers: WebQuestionAnswer[]; cancelled: boolean }) => void;
}

type Zone = "options" | "input" | "buttons";

export function QuestionsPanel({ questions, onResult }: Props) {
	const [tab, setTab] = useState(0);
	const [drafts, setDrafts] = useState<Record<number, WebQuestionAnswer>>({});
	const [customText, setCustomText] = useState<Record<number, string>>({});
	const [hoverLabel, setHoverLabel] = useState<string | undefined>();
	// Foco por zonas: options (focusOpt) / input (textarea nativo) / buttons (focusBtn).
	const [zone, setZone] = useState<Zone>("options");
	const [focusOpt, setFocusOpt] = useState(0);
	const [focusBtn, setFocusBtn] = useState(0);
	const inputRef = useRef<HTMLTextAreaElement>(null);

	const q = questions[tab];
	const isLast = tab === questions.length - 1;
	const draft = drafts[tab];

	// Botones de navegación visibles (dependen de tab/isLast). Se recalculan en
	// cada render para que sus actions capturen el estado fresco (drafts, etc.).
	type NavBtn = {
		key: string;
		label: string;
		cls: string;
		action: () => void;
	};
	const navButtons: NavBtn[] = [];
	if (tab > 0)
		navButtons.push({
			key: "prev",
			label: "← Anterior",
			cls: "q-btn secondary",
			action: () => goToTab(tab - 1),
		});
	if (!isLast)
		navButtons.push({
			key: "next",
			label: "Siguiente →",
			cls: "q-btn",
			action: () => goToTab(tab + 1),
		});
	else
		navButtons.push({ key: "submit", label: "Enviar", cls: "q-btn", action: submit });
	navButtons.push({
		key: "cancel",
		label: "Cancelar",
		cls: "q-btn danger",
		action: cancel,
	});

	// ¿La pregunta actual lleva panel de preview? Solo single-select con ≥1 opción
	// que traiga `preview` (paridad con rpiv: previews sólo en single-select).
	const hasPreviews =
		!q.multiSelect &&
		q.options.some((o) => (o.preview ?? "").trim().length > 0);
	// inputMode: el usuario está escribiendo respuesta custom → ancho completo.
	const inputMode = (customText[tab] ?? "").trim().length > 0;

	const selectedLabel = draft?.kind === "option" ? draft.answer : undefined;
	const withPreview = (o: WebQuestionOption) =>
		(o.preview ?? "").trim().length > 0;
	// Opción cuyo preview se muestra: la hovered > la seleccionada, SIN fallback.
	const activePreviewOpt =
		q.options.find((o) => o.label === hoverLabel && withPreview(o)) ??
		q.options.find((o) => o.label === selectedLabel && withPreview(o));

	// reset hoverLabel + foco al cambiar de pregunta
	useEffect(() => {
		setHoverLabel(undefined);
		setFocusOpt(0);
		setFocusBtn(0);
		setZone("options");
	}, [tab]);

	// Sincroniza el foco nativo del textarea con la zona: si la zona es "input",
	// le damos foco (para escribir); si no, lo quitamos.
	useEffect(() => {
		if (zone === "input") inputRef.current?.focus();
		else inputRef.current?.blur();
	}, [zone]);

	function isOptionSelected(label: string): boolean {
		if (q.multiSelect) return !!draft?.selected?.includes(label);
		return draft?.kind === "option" && draft.answer === label;
	}
	function chooseSingle(label: string) {
		setDrafts({
			...drafts,
			[tab]: { questionIndex: tab, kind: "option", answer: label },
		});
	}
	function toggleMulti(label: string) {
		const selected = new Set(draft?.selected ?? []);
		if (selected.has(label)) selected.delete(label);
		else selected.add(label);
		setDrafts({
			...drafts,
			[tab]: {
				questionIndex: tab,
				kind: "multi",
				answer: null,
				selected: [...selected],
			},
		});
	}
	function onCustomChange(text: string) {
		setCustomText({ ...customText, [tab]: text });
		if (text.trim().length > 0) {
			setDrafts({
				...drafts,
				[tab]: { questionIndex: tab, kind: "custom", answer: text },
			});
		} else if (draft?.kind === "custom") {
			const next = { ...drafts };
			delete next[tab];
			setDrafts(next);
		}
	}
	function submit() {
		const answers = questions
			.map((_, i) => drafts[i])
			.filter((a): a is WebQuestionAnswer => a !== undefined);
		onResult({ answers, cancelled: false });
	}
	function cancel() {
		onResult({ answers: [], cancelled: true });
	}
	function goToTab(i: number) {
		if (i < 0 || i >= questions.length) return;
		setTab(i);
	}

	// Teclado por zonas (patrón ApprovalCard). En "input" las teclas van al
	// textarea salvo Tab/Shift+Tab (cambian de zona), Shift+Enter (envía) y Esc.
	useEffect(() => {
		function onKey(e: KeyboardEvent) {
			const k = e.key;
			const n = q.options.length;
			const nb = navButtons.length;

			if (zone === "input") {
				if (k === "Tab") {
					e.preventDefault();
					if (e.shiftKey) {
						// input → options (reversa)
						setZone("options");
						setFocusOpt(Math.max(0, n - 1));
					} else {
						// input → buttons
						setZone("buttons");
						setFocusBtn(0);
					}
				} else if (k === "Enter" && e.shiftKey) {
					e.preventDefault();
					submit();
				} else if (k === "Escape") {
					// Esc por niveles: con texto → salir del input (conserva texto);
					// sin texto → cancelar el cuestionario.
					e.preventDefault();
					if ((customText[tab] ?? "").trim().length > 0) {
						setZone("options");
					} else {
						cancel();
					}
				}
				return; // las demás teclas van al textarea
			}

			if (k === "Tab") {
				e.preventDefault();
				if (e.shiftKey) {
					// reversa: options → buttons · buttons → input
					if (zone === "options") {
						setZone("buttons");
						setFocusBtn(Math.max(0, nb - 1));
					} else {
						setZone("input");
					}
				} else {
					// options → input · buttons → options
					if (zone === "options") setZone("input");
					else {
						setZone("options");
						setFocusOpt(0);
					}
				}
			} else if (k === "ArrowDown") {
				e.preventDefault();
				if (zone === "options" && n > 0) setFocusOpt((s) => (s + 1) % n);
				else if (zone === "buttons" && nb > 0)
					setFocusBtn((s) => (s + 1) % nb);
			} else if (k === "ArrowUp") {
				e.preventDefault();
				if (zone === "options" && n > 0)
					setFocusOpt((s) => (s - 1 + n) % n);
				else if (zone === "buttons" && nb > 0)
					setFocusBtn((s) => (s - 1 + nb) % nb);
			} else if (k === "ArrowRight") {
				if (questions.length >= 2 && tab < questions.length - 1) {
					e.preventDefault();
					goToTab(tab + 1);
				}
			} else if (k === "ArrowLeft") {
				if (questions.length >= 2 && tab > 0) {
					e.preventDefault();
					goToTab(tab - 1);
				}
			} else if (k === "Enter" && e.shiftKey) {
				e.preventDefault();
				submit();
			} else if (k === "Enter" || k === " ") {
				e.preventDefault();
				if (zone === "options") {
					const opt = q.options[focusOpt];
					if (opt) {
						if (q.multiSelect) toggleMulti(opt.label);
						else chooseSingle(opt.label);
					}
				} else if (zone === "buttons") {
					navButtons[focusBtn]?.action();
				}
			} else if (k === "Escape") {
				e.preventDefault();
				cancel();
			} else if (/^[1-9]$/.test(k)) {
				const idx = Number(k) - 1;
				if (idx < n) {
					e.preventDefault();
					setZone("options");
					setFocusOpt(idx);
					const opt = q.options[idx];
					if (q.multiSelect) toggleMulti(opt.label);
					else chooseSingle(opt.label);
				}
			}
		}
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [q, zone, focusOpt, focusBtn, tab, customText, drafts, questions, navButtons]);

	function renderOption(opt: WebQuestionOption, i: number) {
		const selected = isOptionSelected(opt.label);
		const focused = zone === "options" && i === focusOpt;
		const indicator = q.multiSelect
			? selected
				? "☑"
				: "☐"
			: selected
				? "◉"
				: "○";
		return (
			<div
				key={`${opt.label}-${i}`}
				tabIndex={-1}
				className={
					"q-opt" + (selected ? " selected" : "") + (focused ? " focused" : "")
				}
				onMouseEnter={() => setHoverLabel(opt.label)}
				onClick={() => {
					setZone("options");
					setFocusOpt(i);
					if (q.multiSelect) toggleMulti(opt.label);
					else chooseSingle(opt.label);
				}}
			>
				<span className="q-opt-marker">{indicator}</span>
				<div className="q-opt-body">
					<div className="q-opt-label">{opt.label}</div>
					<div className="q-opt-desc">{opt.description}</div>
				</div>
			</div>
		);
	}

	return (
		<div className="q-panel">
			{/* Tab bar: sólo con 2+ preguntas. ● respondida / ○ pendiente; la activa
			    con borde. Clickable además de ←/→. */}
			{questions.length >= 2 ? (
				<div className="q-tabs">
					{questions.map((qq, i) => {
						const d = drafts[i];
						const answered =
							!!d &&
							(d.kind === "multi"
								? (d.selected?.length ?? 0) > 0
								: !!d.answer);
						return (
							<button
								key={i}
								type="button"
								tabIndex={-1}
								className={
									"q-tab" +
									(i === tab ? " active" : "") +
									(answered ? " answered" : "")
								}
								onClick={() => goToTab(i)}
							>
								{answered ? "● " : "○ "}
								{qq.header || `Q${i + 1}`}
							</button>
						);
					})}
				</div>
			) : null}

			{questions.length < 2 && q.header ? (
				<div className="q-header">{q.header}</div>
			) : null}
			<div className="q-question">{q.question}</div>

			{/* Opciones (+ preview side-by-side si aplica y no se está escribiendo custom) */}
			{hasPreviews && !inputMode ? (
				<div className="q-with-preview">
					<div className="q-options">{q.options.map(renderOption)}</div>
					<div className="q-preview">
						<div className="q-preview-title">
							{activePreviewOpt
								? `Preview · ${activePreviewOpt.label}`
								: "Vista previa"}
						</div>
						{activePreviewOpt ? (
							<Markdown>{activePreviewOpt.preview ?? ""}</Markdown>
						) : (
							<div className="q-preview-empty">
								Vista previa no disponible para esta opción.
							</div>
						)}
					</div>
				</div>
			) : (
				<div
					className="q-options"
					onMouseLeave={() => setHoverLabel(undefined)}
				>
					{q.options.map(renderOption)}
				</div>
			)}

			{/* Texto libre (fila "Type something." del TUI). Focuseable nativamente:
			    cuando la zona es "input" recibe foco para escribir. */}
			<textarea
				ref={inputRef}
				className="q-input"
				placeholder="O escribe tu propia respuesta… (Shift+Enter para enviar)"
				value={customText[tab] ?? ""}
				rows={Math.min(
					4,
					Math.max(1, (customText[tab] ?? "").split("\n").length),
				)}
				onChange={(e) => onCustomChange(e.target.value)}
				onFocus={() => setZone("input")}
			/>

			{/* Navegación: tabIndex={-1} (el foco lo gestiona el handler por zona).
			    ↑↓/Tab navegan entre ellos; ⏎ ejecuta el enfocado. */}
			<div className="q-nav">
				{navButtons.map((b, i) => (
					<button
						key={b.key}
						type="button"
						tabIndex={-1}
						className={
							b.cls +
							(zone === "buttons" && i === focusBtn ? " focused" : "")
						}
						onClick={() => {
							setZone("buttons");
							setFocusBtn(i);
							b.action();
						}}
					>
						{b.label}
					</button>
				))}
			</div>
		</div>
	);
}
