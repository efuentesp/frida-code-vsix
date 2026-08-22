import { useEffect, useRef, useState } from "react";
import { Markdown } from "./Markdown";
import { Codicon } from "./Codicon";
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

export interface QuestionsPanelProps {
	questions: WebQuestionSpec[];
	onResult: (r: { answers: WebQuestionAnswer[]; cancelled: boolean }) => void;
	initialTab?: number;
}

type Zone = "options" | "input" | "buttons";

export function QuestionsPanel({
	questions,
	onResult,
	initialTab,
}: QuestionsPanelProps) {
	// tab: 0..questions.length-1 = pregunta · questions.length = pestaña "Enviar" (review)
	const [tab, setTab] = useState(initialTab ?? 0);
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

	// Estado de respuestas para navegación y pestaña "Enviar" (review).
	function isAnswered(i: number): boolean {
		const d = drafts[i];
		if (!d) return false;
		return d.kind === "multi" ? (d.selected?.length ?? 0) > 0 : !!d.answer;
	}
	const allAnswered = questions.every((_, i) => isAnswered(i));
	const answeredCount = questions.filter((_, i) => isAnswered(i)).length;
	const firstMissingIndex = questions.findIndex((_, i) => !isAnswered(i));
	const missing = questions
		.map((qq, i) => ({ qq, i }))
		.filter(({ i }) => !isAnswered(i))
		.map(({ qq, i }) => qq.header || `Paso ${i + 1}`);

	// Botones de navegación visibles según el tab. Se recalculan en cada render
	// para que sus actions capturen el estado fresco (Opción B: Flexible con confirmación de omisión).
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
				...(allAnswered
					? [
							{
								key: "submit",
								label: "Enviar respuestas ✓",
								cls: "q-btn",
								action: submit,
							},
						]
					: [
							{
								key: "complete",
								label: "Completar pendientes →",
								cls: "q-btn",
								action: () => goToTab(firstMissingIndex >= 0 ? firstMissingIndex : 0),
							},
							{
								key: "skipSubmit",
								label: `Omitir restantes y enviar (${answeredCount}/${questions.length})`,
								cls: "q-btn secondary q-btn-skip",
								action: submit,
							},
						]),
				{
					key: "cancel",
					label: "Cancelar",
					cls: "q-btn danger",
					action: cancel,
				},
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
				{
					key: "cancel",
					label: "Cancelar",
					cls: "q-btn danger",
					action: cancel,
				},
			];

	// ¿La pregunta actual lleva panel de preview? Solo single-select con ≥1 opción
	// con `preview` (paridad rpiv). El review tab no lleva opciones.
	const hasPreviews =
		!isReviewTab &&
		!q!.multiSelect &&
		q!.options.some((o) => (o.preview ?? "").trim().length > 0);
	const inputMode = !isReviewTab && (customText[tab] ?? "").trim().length > 0;

	const selectedLabel = draft?.kind === "option" ? draft.answer : undefined;
	const withPreview = (o: WebQuestionOption) =>
		(o.preview ?? "").trim().length > 0;
	const activePreviewOpt = isReviewTab
		? undefined
		: (q!.options.find((o) => o.label === hoverLabel && withPreview(o)) ??
			q!.options.find((o) => o.label === selectedLabel && withPreview(o)));

	// reset foco al cambiar de pestaña
	useEffect(() => {
		setHoverLabel(undefined);
		setFocusOpt(0);
		if (isReviewTab) {
			// En el review tab el foco va al botón "Enviar".
			setZone("buttons");
			setFocusBtn(
				Math.max(
					0,
					navButtons.findIndex((b) => b.key === "submit"),
				),
			);
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
		// No auto-advance (issue #5): al elegir, el usuario se queda en la
		// pregunta para releer/corregir y avanza manualmente (Siguiente →,
		// flechas ←→, o Revisar y enviar). Con 1 sola pregunta no hay tab bar y
		// se envía con Shift+Enter / Enviar.
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
					if (allAnswered || isReviewTab) {
						submit();
					} else {
						goToTab(questions.length);
					}
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
				if (zone === "options" && n > 0) setFocusOpt((s) => (s - 1 + n) % n);
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
				if (allAnswered || isReviewTab) {
					submit();
				} else {
					goToTab(questions.length);
				}
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
	}, [
		q,
		zone,
		focusOpt,
		focusBtn,
		tab,
		customText,
		drafts,
		questions,
		navButtons,
	]);

	function renderOption(opt: WebQuestionOption, i: number) {
		const selected = isOptionSelected(opt.label);
		const focused = zone === "options" && i === focusOpt;
		const isShortNumeric = i < 9;
		return (
			<div
				key={`${opt.label}-${i}`}
				tabIndex={-1}
				className={`q-opt${selected ? " selected" : ""}${focused ? " focused" : ""}`}
				onMouseEnter={() => setHoverLabel(opt.label)}
				onClick={() => {
					setZone("options");
					setFocusOpt(i);
					if (q!.multiSelect) toggleMulti(opt.label);
					else chooseSingle(opt.label);
				}}
			>
				{isShortNumeric && <span className="q-opt-badge">{i + 1}</span>}
				<Codicon
					name={
						q!.multiSelect
							? selected
								? "check"
								: "circle-outline"
							: selected
								? "circle-filled"
								: "circle-outline"
					}
					size={13}
					className={`q-opt-icon${selected ? " is-selected" : ""}`}
				/>
				<div className="q-opt-body">
					<div className="q-opt-label">
						<Markdown>{opt.label}</Markdown>
					</div>
					{opt.description && (
						<div className="q-opt-desc">
							<Markdown>{opt.description}</Markdown>
						</div>
					)}
				</div>
			</div>
		);
	}

	return (
		<div className="q-panel">
			{/* Historial de pasos previos completados (Propuesta 2: Inline Step Flow) */}
			{isMulti && (
				<div className="q-history-list">
					{questions.map((qq, i) => {
						const answered = isAnswered(i);
						if (i === tab || !answered) return null;
						const d = drafts[i];
						let value = "";
						if (d?.kind === "multi") value = (d.selected ?? []).join(", ");
						else if (d?.kind === "custom") value = `(escrito) ${d.answer}`;
						else value = d?.answer ?? "";
						return (
							<div key={i} className="q-step-chip">
								<Codicon name="pass-filled" size={13} className="q-step-pass" />
								<span className="q-step-num">{i + 1}.</span>
								<span className="q-step-name">{qq.header || `Paso ${i + 1}`}:</span>
								<span className="q-step-val">{value}</span>
								<button
									type="button"
									className="q-step-edit"
									onClick={() => goToTab(i)}
									title={`Modificar paso ${i + 1}`}
								>
									<Codicon name="edit" size={11} />
									<span>Cambiar</span>
								</button>
							</div>
						);
					})}
				</div>
			)}

			{isReviewTab ? (
				/* Pestaña "Enviar": resumen de respuestas + estado (parity pi "Submit"). */
				<div className="q-review">
					<div className="q-review-header">
						<Codicon name="checklist" size={14} className="q-review-icon" />
						<span>Listo para enviar</span>
					</div>
					<div className="q-review-list">
						{questions.map((qq, i) => {
							const d = drafts[i];
							const answered = isAnswered(i);
							let value: string;
							if (!d || !answered) value = "(sin responder)";
							else if (d.kind === "multi") value = (d.selected ?? []).join(", ");
							else if (d.kind === "custom") value = `(escrito) ${d.answer}`;
							else value = d.answer ?? "";
							return (
								<div key={i} className={`q-review-row${answered ? " ok" : " missing"}`}>
									<div className="q-review-head">
										<span className="q-review-idx">{`Paso ${i + 1}`}</span>
										<Codicon
											name={answered ? "pass-filled" : "circle-outline"}
											size={12}
											className="q-review-state"
										/>
										<span className="q-review-label">
											{qq.header || `Pregunta ${i + 1}`}
										</span>
										<button
											type="button"
											className="q-review-edit-link"
											onClick={() => goToTab(i)}
											title={`Editar paso ${i + 1}`}
										>
											<Codicon name="edit" size={11} />
											<span>Cambiar</span>
										</button>
									</div>
									<div className="q-review-value">
										<Markdown>{value}</Markdown>
									</div>
								</div>
							);
						})}
					</div>
					{!allAnswered && (
						<div className="q-review-warn-box">
							<div className="q-review-warn-head">
								<Codicon name="warning" size={13} className="q-review-warn-icon" />
								<span className="q-review-warn-title">
									Faltan por responder ({questions.length - answeredCount} de{" "}
									{questions.length})
								</span>
							</div>
							<div className="q-review-warn-desc">
								Preguntas pendientes: <strong>{missing.join(", ")}</strong>. Puedes
								completar las preguntas pendientes para mayor precisión o confirmar la
								omisión con el botón secundario.
							</div>
						</div>
					)}
					<div className={`q-review-status ${allAnswered ? "ok" : "warn"}`}>
						{allAnswered
							? "✓ Respuestas completas. Presiona Enviar para confirmar."
							: `Faltan por responder: ${missing.join(", ")}`}
					</div>
				</div>
			) : (
				<div className="q-active-card">
					<div className="q-active-header">
						<Codicon name="question" size={14} className="q-active-icon" />
						<span className="q-active-title">
							{isMulti
								? `Paso ${tab + 1} de ${questions.length}${q!.header ? `: ${q!.header}` : ""}`
								: q!.header || "Pregunta"}
						</span>
						{q!.multiSelect && (
							<span className="q-multiselect-badge">Selección múltiple</span>
						)}
					</div>
					<div className="q-question">
						<Markdown>{q!.question}</Markdown>
					</div>

					{hasPreviews && !inputMode ? (
						<div className="q-with-preview">
							<div className="q-options">{q!.options.map(renderOption)}</div>
							<div className="q-preview">
								<div className="q-preview-title">
									<Codicon name="eye" size={12} />
									<span>
										{activePreviewOpt
											? `Vista previa · ${activePreviewOpt.label}`
											: "Vista previa"}
									</span>
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
						<div className="q-options" onMouseLeave={() => setHoverLabel(undefined)}>
							{q!.options.map(renderOption)}
						</div>
					)}

					<div className="q-input-wrap">
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
					</div>
				</div>
			)}

			{/* Navegación: tabIndex={-1} (el foco lo gestiona el handler por zona). */}
			<div className="q-nav">
				{navButtons.map((b, i) => (
					<button
						key={b.key}
						type="button"
						tabIndex={-1}
						className={
							b.cls + (zone === "buttons" && i === focusBtn ? " focused" : "")
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

			{/* Barra de atajos de teclado (estilo Copilot / ApprovalCard) */}
			<div className="q-keys">
				<span>
					<kbd>↑↓</kbd> Navegar
				</span>
				<span>
					<kbd>1-9</kbd> Seleccionar
				</span>
				<span>
					<kbd>Tab</kbd> Zonas
				</span>
				<span>
					<kbd>⏎</kbd> {isReviewTab || isLastQuestion ? "Enviar" : "Siguiente"}
				</span>
				<span>
					<kbd>Esc</kbd> Cancelar
				</span>
			</div>
		</div>
	);
}
