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
// Keymap (consistente con permisos): ↑↓ navega foco · ⏎/Espacio confirma opción ·
// 1-9 selección directa · ←/→ cambia de pregunta · Tab al texto libre ·
// Shift+⏎ envía · Esc cancela (por niveles: si hay foco+texto en el input, el
// 1er Esc sale del input y conserva el texto; el 2º cancela).

interface Props {
	questions: WebQuestionSpec[];
	onResult: (r: { answers: WebQuestionAnswer[]; cancelled: boolean }) => void;
}

export function QuestionsPanel({ questions, onResult }: Props) {
	const [tab, setTab] = useState(0);
	const [drafts, setDrafts] = useState<Record<number, WebQuestionAnswer>>({});
	const [customText, setCustomText] = useState<Record<number, string>>({});
	const [hoverLabel, setHoverLabel] = useState<string | undefined>();
	const [focusIdx, setFocusIdx] = useState(0); // foco de teclado en opciones
	const [inputFocused, setInputFocused] = useState(false);
	const inputRef = useRef<HTMLTextAreaElement>(null);

	const q = questions[tab];
	const isLast = tab === questions.length - 1;
	const draft = drafts[tab];

	// ¿La pregunta actual lleva panel de preview? Solo single-select con ≥1 opción
	// que traiga `preview` (paridad con rpiv: previews sólo en single-select).
	const hasPreviews =
		!q.multiSelect && q.options.some((o) => (o.preview ?? "").trim().length > 0);
	// inputMode: el usuario está escribiendo respuesta custom → ancho completo.
	const inputMode = (customText[tab] ?? "").trim().length > 0;

	const selectedLabel = draft?.kind === "option" ? draft.answer : undefined;
	const withPreview = (o: WebQuestionOption) => (o.preview ?? "").trim().length > 0;
	// Opción cuyo preview se muestra: la hovered > la seleccionada, SIN fallback.
	const activePreviewOpt =
		q.options.find((o) => o.label === hoverLabel && withPreview(o)) ??
		q.options.find((o) => o.label === selectedLabel && withPreview(o));

	// reset hoverLabel + foco al cambiar de pregunta
	useEffect(() => {
		setHoverLabel(undefined);
		setFocusIdx(0);
		setInputFocused(false);
	}, [tab]);

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

	// Teclado (patrón ApprovalCard). Mientras el foco está en el textarea, las
	// teclas van a él (salvo Esc por niveles y Shift+Enter que envía).
	useEffect(() => {
		function onKey(e: KeyboardEvent) {
			const k = e.key;
			const n = q.options.length;

			if (inputFocused) {
				if (k === "Enter" && e.shiftKey) {
					e.preventDefault();
					submit();
				} else if (k === "Escape") {
					// Esc por niveles: con texto → salir del input (conserva texto);
					// sin texto → cancelar el cuestionario.
					e.preventDefault();
					if ((customText[tab] ?? "").trim().length > 0) {
						inputRef.current?.blur();
						setInputFocused(false);
					} else {
						cancel();
					}
				}
				return; // las demás teclas van al textarea
			}

			if (k === "ArrowDown") {
				e.preventDefault();
				setFocusIdx((s) => (n > 0 ? (s + 1) % n : 0));
			} else if (k === "ArrowUp") {
				e.preventDefault();
				setFocusIdx((s) => (n > 0 ? (s - 1 + n) % n : 0));
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
				const opt = q.options[focusIdx];
				if (opt) {
					if (q.multiSelect) toggleMulti(opt.label);
					else chooseSingle(opt.label);
				}
			} else if (k === "Tab") {
				e.preventDefault();
				inputRef.current?.focus();
				setInputFocused(true);
			} else if (k === "Escape") {
				e.preventDefault();
				cancel();
			} else if (/^[1-9]$/.test(k)) {
				const idx = Number(k) - 1;
				if (idx < n) {
					e.preventDefault();
					const opt = q.options[idx];
					if (q.multiSelect) toggleMulti(opt.label);
					else chooseSingle(opt.label);
				}
			}
		}
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [q, focusIdx, tab, inputFocused, customText, drafts, questions]);

	function renderOption(opt: WebQuestionOption, i: number) {
		const selected = isOptionSelected(opt.label);
		const focused = i === focusIdx && !inputFocused;
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
				className={
					"q-opt" + (selected ? " selected" : "") + (focused ? " focused" : "")
				}
				onMouseEnter={() => setHoverLabel(opt.label)}
				onClick={() =>
					q.multiSelect ? toggleMulti(opt.label) : chooseSingle(opt.label)
				}
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
					<div className="q-options">
						{q.options.map(renderOption)}
					</div>
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

			{/* Texto libre (fila "Type something." del TUI) */}
			<textarea
				ref={inputRef}
				className="q-input"
				placeholder="O escribe tu propia respuesta… (Shift+Enter para enviar)"
				value={customText[tab] ?? ""}
				rows={Math.min(4, Math.max(1, (customText[tab] ?? "").split("\n").length))}
				onChange={(e) => onCustomChange(e.target.value)}
				onFocus={() => setInputFocused(true)}
				onBlur={() => setInputFocused(false)}
			/>

			{/* Navegación (clic; el teclado usa ←/→ y Shift+Enter) */}
			<div className="q-nav">
				{tab > 0 ? (
					<button
						type="button"
						className="q-btn secondary"
						onClick={() => goToTab(tab - 1)}
					>
						← Anterior
					</button>
				) : null}
				{!isLast ? (
					<button
						type="button"
						className="q-btn"
						onClick={() => goToTab(tab + 1)}
					>
						Siguiente →
					</button>
				) : (
					<button type="button" className="q-btn" onClick={submit}>
						Enviar
					</button>
				)}
				<button type="button" className="q-btn danger" onClick={cancel}>
					Cancelar
				</button>
			</div>
		</div>
	);
}
