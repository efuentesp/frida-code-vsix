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
// Parity con el TUI de pi (examples/extensions/questionnaire.ts): con 2+ preguntas
// hay una tab bar con una pestaña por pregunta + una pestaña final "✓ Enviar"
// (review) que resume las respuestas, indica qué falta y envía con Enter. Al
// responder la última pregunta (single-select) se salta ahí automáticamente.
//
// Foco por ZONAS (options | input | buttons), gestionado por el handler. Las
// opciones, tabs y botones llevan tabIndex={-1}; sólo el textarea es focuseable
// nativamente (para escribir).
//
// Keymap (consistente con permisos): Tab/Shift+Tab cicla zonas (opciones → input
// → botones) · ↑↓ navega dentro de la zona · ⏎/Espacio activa el foco actual ·
// 1-9 selección directa · ←/→ cambia de pestaña (pregunta o Enviar) · Shift+⏎
// envía · Esc cancela (por niveles en el input).

interface Props {
	questions: WebQuestionSpec[];
	onResult: (r: { answers: WebQuestionAnswer[]; cancelled: boolean }) => void;
}

type Zone = "options" | "input" | "buttons";

export function QuestionsPanel({ questions, onResult }: Props) {
	// tab: 0..questions.length-1 = pregunta · questions.length = pestaña "Enviar" (review)
	const [tab, setTab] = useState(0);
	const [drafts, setDrafts] = useState<Record<number, WebQuestionAnswer>>({});
	const [customText, setCustomText] = useState<Record<number, string>>({});
	const [hoverLabel, setHoverLabel] = useState<string | undefined>();
	const [zone, setZone] = useState<Zone>("options");
	const [focusOpt, setFocusOpt] = useState(0);
	const [focusBtn, setFocusBtn] = useState(0);
	const inputRef = useRef<HTMLTextAreaElement>(null);

	const isReviewTab = tab === questions.length;
	const isMulti = questions.length >= 2;
	const q = isReviewTab ? undefined : questions[tab];
	const isLastQuestion = tab === questions.length - 1;
	const draft = drafts[tab];

	// Botones de navegación visibles según el tab. Se recalculan en cada render
	// para que sus actions capturen el estado fresco.
	type NavBtn = {
		key: string;
		label: string;
		cls: string;
		action: () => void;
	};
	const navButtons: NavBtn[] = isReviewTab
		? [
				{
					key: "prev",
					label: "← Anterior",
					cls: "q-btn secondary",
					action: () => goToTab(questions.length - 1),
				},
				{ key: "submit", label: "Enviar ✓", cls: "q-btn", action: submit },
				{ key: "cancel", label: "Cancelar", cls: "q-btn danger", action: cancel },
			]
		: [
				...(tab > 0
					? [
							{
								key: "prev",
								label: "← Anterior",
								cls: "q-btn secondary",
								action: () => goToTab(tab - 1),
							},
						]
					: []),
				isLastQuestion
					? {
							key: "review",
							label: "Revisar y enviar →",
							cls: "q-btn",
							action: () => goToTab(questions.length),
						}
					: {
							key: "next",
							label: "Siguiente →",
							cls: "q-btn",
							action: () => goToTab(tab + 1),
						},
				{ key: "cancel", label: "Cancelar", cls: "q-btn danger", action: cancel },
			];

	// ¿La pregunta actual lleva panel de preview? Solo single-select con ≥1 opción
	// con `preview` (paridad rpiv). El review tab no lleva opciones.
	const hasPreviews =
		!isReviewTab &&
		!q!.multiSelect &&
		q!.options.some((o) => (o.preview ?? "").trim().length > 0);
	const inputMode = !isReviewTab && (customText[tab] ?? "").trim().length > 0;

	const selectedLabel = draft?.kind === "option" ? draft.answer : undefined;
	const withPreview = (o: WebQuestionOption) => (o.preview ?? "").trim().length > 0;
	const activePreviewOpt = isReviewTab
		? undefined
		: (q!.options.find((o) => o.label === hoverLabel && withPreview(o)) ??
			q!.options.find((o) => o.label === selectedLabel && withPreview(o)));

	// Estado de respuestas para la pestaña "Enviar" (review).
	function isAnswered(i: number): boolean {
		const d = drafts[i];
		if (!d) return false;
		return d.kind === "multi" ? (d.selected?.length ?? 0) > 0 : !!d.answer;
	}
	const allAnswered = questions.every((_, i) => isAnswered(i));
	const missing = questions
		.map((qq, i) => ({ qq, i }))
		.filter(({ i }) => !isAnswered(i))
		.map(({ qq, i }) => qq.header || `Q${i + 1}`);

	// reset foco al cambiar de pestaña
	useEffect(() => {
		setHoverLabel(undefined);
		setFocusOpt(0);
		if (isReviewTab) {
			// En el review tab el foco va al botón "Enviar".
			setZone("buttons");
			setFocusBtn(Math.max(0, navButtons.findIndex((b) => b.key === "submit")));
		} else {
			setZone("options");
			setFocusBtn(0);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [tab]);

	// Sincroniza el foco nativo del textarea con la zona "input".
	useEffect(() => {
		if (zone === "input") inputRef.current?.focus();
		else inputRef.current?.blur();
	}, [zone]);

	function isOptionSelected(label: string): boolean {
		if (q?.multiSelect) return !!draft?.selected?.includes(label);
		return draft?.kind === "option" && draft.answer === label;
	}
	function chooseSingle(label: string) {
		setDrafts({
			...drafts,
			[tab]: { questionIndex: tab, kind: "option", answer: label },
		});
		// Parity pi: al elegir (single-select) saltar a la siguiente pestaña.
		// Con 2+ preguntas avanza (a la siguiente pregunta o a "Enviar"); con 1
		// sola no hay tab bar → el usuario envía con Shift+Enter / Enviar.
		if (isMulti) goToTab(Math.min(tab + 1, questions.length));
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
		if (i < 0 || i > questions.length) return;
		setTab(i);
	}

	// Teclado por zonas.
	useEffect(() => {
		function onKey(e: KeyboardEvent) {
			const k = e.key;
			const n = q?.options.length ?? 0;
			const nb = navButtons.length;

			if (zone === "input") {
				if (k === "Tab") {
					e.preventDefault();
					if (e.shiftKey) {
						setZone("options");
						setFocusOpt(Math.max(0, n - 1));
					} else {
						setZone("buttons");
						setFocusBtn(0);
					}
				} else if (k === "Enter" && e.shiftKey) {
					e.preventDefault();
					submit();
				} else if (k === "Escape") {
					e.preventDefault();
					if ((customText[tab] ?? "").trim().length > 0) setZone("options");
					else cancel();
				}
				return;
			}

			if (k === "Tab") {
				e.preventDefault();
				if (e.shiftKey) {
					if (zone === "options") {
						setZone("buttons");
						setFocusBtn(Math.max(0, nb - 1));
					} else setZone("input");
				} else if (zone === "options") setZone("input");
				else {
					setZone("options");
					setFocusOpt(0);
				}
			} else if (k === "ArrowDown") {
				e.preventDefault();
				if (zone === "options" && n > 0) setFocusOpt((s) => (s + 1) % n);
				else if (zone === "buttons" && nb > 0) setFocusBtn((s) => (s + 1) % nb);
			} else if (k === "ArrowUp") {
				e.preventDefault();
				if (zone === "options" && n > 0)
					setFocusOpt((s) => (s - 1 + n) % n);
				else if (zone === "buttons" && nb > 0)
					setFocusBtn((s) => (s - 1 + nb) % nb);
			} else if (k === "ArrowRight") {
				if (isMulti && tab < questions.length) {
					e.preventDefault();
					goToTab(tab + 1);
				}
			} else if (k === "ArrowLeft") {
				if (isMulti && tab > 0) {
					e.preventDefault();
					goToTab(tab - 1);
				}
			} else if (k === "Enter" && e.shiftKey) {
				e.preventDefault();
				submit();
			} else if (k === "Enter" || k === " ") {
				e.preventDefault();
				if (zone === "options" && q) {
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
			} else if (/^[1-9]$/.test(k) && q) {
				const idx = Number(k) - 1;
				if (idx < q.options.length) {
					e.preventDefault();
					setZone("options");
					setFocusOpt(idx);
					if (q.multiSelect) toggleMulti(q.options[idx]!.label);
					else chooseSingle(q.options[idx]!.label);
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
		const indicator = q!.multiSelect
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
					if (q!.multiSelect) toggleMulti(opt.label);
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
			{/* Tab bar (sólo 2+ preguntas): una pestaña por pregunta + "✓ Enviar". */}
			{isMulti ? (
				<div className="q-tabs">
					{questions.map((qq, i) => {
						const answered = isAnswered(i);
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
					<button
						type="button"
						tabIndex={-1}
						className={
							"q-tab review" +
							(isReviewTab ? " active" : "") +
							(allAnswered ? " answered" : "")
						}
						onClick={() => goToTab(questions.length)}
					>
						✓ Enviar
					</button>
				</div>
			) : null}

			{isReviewTab ? (
				/* Pestaña "Enviar": resumen de respuestas + estado (parity pi "Submit"). */
				<div className="q-review">
					<div className="q-header">Listo para enviar</div>
					<div className="q-review-list">
						{questions.map((qq, i) => {
							const d = drafts[i];
							let value: string;
							if (!d || !isAnswered(i)) value = "(sin responder)";
							else if (d.kind === "multi")
								value = (d.selected ?? []).join(", ");
							else if (d.kind === "custom") value = `(escrito) ${d.answer}`;
							else value = d.answer ?? "";
							return (
								<div key={i} className="q-review-row">
									<span className="q-review-label">{qq.header || `Q${i + 1}`}:</span>{" "}
									<span className="q-review-value">{value}</span>
								</div>
							);
						})}
					</div>
					<div className={"q-review-status " + (allAnswered ? "ok" : "warn")}>
						{allAnswered
							? "✓ Enter para enviar"
							: `Faltan: ${missing.join(", ")}`}
					</div>
				</div>
			) : (
				<>
					{!isMulti && q!.header ? (
						<div className="q-header">{q!.header}</div>
					) : null}
					<div className="q-question">{q!.question}</div>

					{hasPreviews && !inputMode ? (
						<div className="q-with-preview">
							<div className="q-options">{q!.options.map(renderOption)}</div>
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
							{q!.options.map(renderOption)}
						</div>
					)}

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
				</>
			)}

			{/* Navegación: tabIndex={-1} (el foco lo gestiona el handler por zona). */}
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
