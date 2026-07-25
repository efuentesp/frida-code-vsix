import { useState } from "react";
import type { QuestionAnswer, QuestionRequest } from "../types";
import { Bot, Check, Circle, Dot, Square } from "lucide-react";
import { Markdown } from "./Markdown";

// Estado de respuesta por pregunta. `custom` (texto libre) reemplaza cualquier
// selección cuando no está vacío; `selected` aplica solo en multi-select.
interface QDraft {
	option?: string;
	selected: string[];
	custom?: string;
	note?: string;
}

const emptyDraft = (): QDraft => ({ selected: [] });

// ¿La pregunta lleva panel de vista previa? Solo single-select con ≥1 opción
// que traiga `preview` no vacío (paridad con rpiv: previews solo en single-select).
function hasPreviews(q: QuestionRequest["questions"][number]): boolean {
	return !q.multiSelect && q.options.some((o) => (o.preview ?? "").trim().length > 0);
}

// Primera opción con preview no vacío: la que se muestra al entrar, antes de que
// el usuario pase el cursor o seleccione.
function firstPreviewLabel(q: QuestionRequest["questions"][number]): string | undefined {
	return q.options.find((o) => (o.preview ?? "").trim().length > 0)?.label;
}

// Texto legible de una respuesta, para la pestaña "Revisar".
function formatAnswer(a: QuestionAnswer): string {
	if (a.kind === "multi") return (a.selected ?? []).join(", ") || "(vacío)";
	if (a.kind === "custom") return `«${a.answer ?? ""}»`;
	return a.answer ?? "";
}

export function QuestionCard({
	request,
	onRespond,
}: {
	request: QuestionRequest;
	onRespond: (r: { answers: QuestionAnswer[]; cancelled: boolean }) => void;
}) {
	const single = request.questions.length === 1;
	const reviewIndex = request.questions.length; // índice de la pestaña "Revisar"

	const [drafts, setDrafts] = useState<Record<number, QDraft>>(() => {
		const init: Record<number, QDraft> = {};
		request.questions.forEach((_, i) => {
			init[i] = emptyDraft();
		});
		return init;
	});

	// Label cuya vista previa se muestra por pregunta. Por defecto la primera con
	// preview; cambia al hacer hover/foco o seleccionar una opción.
	const [previewLabel, setPreviewLabel] = useState<Record<number, string>>(() => {
		const init: Record<number, string> = {};
		request.questions.forEach((q, i) => {
			const lbl = firstPreviewLabel(q);
			if (lbl) init[i] = lbl;
		});
		return init;
	});

	// Pestaña activa del layout tabbed: 0..n-1 = pregunta, n = "Revisar".
	const [activeTab, setActiveTab] = useState(0);

	const setDraft = (i: number, patch: Partial<QDraft>) =>
		setDrafts((d) => ({ ...d, [i]: { ...d[i], ...patch } }));

	const focusPreview = (i: number, label: string) =>
		setPreviewLabel((p) => (p[i] === label ? p : { ...p, [i]: label }));

	const toAnswer = (i: number, multi?: boolean): QuestionAnswer | null => {
		const d = drafts[i];
		const note = d.note?.trim() || undefined;
		if (d.custom && d.custom.trim()) {
			return { questionIndex: i, kind: "custom", answer: d.custom.trim(), notes: note };
		}
		if (multi && d.selected.length > 0) {
			return { questionIndex: i, kind: "multi", answer: null, selected: d.selected, notes: note };
		}
		if (!multi && d.option) {
			return { questionIndex: i, kind: "option", answer: d.option, notes: note };
		}
		return null;
	};

	const isAnswered = (i: number) => toAnswer(i, request.questions[i].multiSelect) !== null;

	const submitAll = () => {
		const answers: QuestionAnswer[] = [];
		request.questions.forEach((q, i) => {
			const a = toAnswer(i, q.multiSelect);
			if (a) answers.push(a);
		});
		onRespond({ answers, cancelled: answers.length === 0 });
	};

	const cancel = () => onRespond({ answers: [], cancelled: true });

	// Bloque de pregunta reutilizado por el layout simple y por cada pestaña.
	const renderQuestionBlock = (i: number) => {
		const q = request.questions[i];
		const d = drafts[i];
		const withPreview = hasPreviews(q);
		// Preview activo: el hovered → el seleccionado → el primero con preview.
		const activeLabel = previewLabel[i] ?? d.option ?? firstPreviewLabel(q);
		const activePreview = q.options.find((o) => o.label === activeLabel)?.preview;

		const optionButtons = q.options.map((o) => {
			const checked = q.multiSelect ? d.selected.includes(o.label) : d.option === o.label;
			const toggle = () =>
				q.multiSelect
					? setDraft(i, {
							selected: checked ? d.selected.filter((s) => s !== o.label) : [...d.selected, o.label],
						})
					: setDraft(i, { option: o.label });
			return (
				<button
					type="button"
					key={o.label}
					className={"q-option" + (checked ? " on" : "")}
					onClick={toggle}
					onMouseEnter={withPreview ? () => focusPreview(i, o.label) : undefined}
					onFocus={withPreview ? () => focusPreview(i, o.label) : undefined}
				>
					<span className="q-mark">
						{q.multiSelect ? (
							checked ? (
								<Check size={13} />
							) : (
								<Square size={13} />
							)
						) : checked ? (
							<Dot size={16} />
						) : (
							<Circle size={13} />
						)}
					</span>
					<span className="q-opt-body">
						<span className="q-opt-label">{o.label}</span>
						{o.description && <span className="q-opt-desc">{o.description}</span>}
					</span>
				</button>
			);
		});

		return (
			<div className="q-block" key={i}>
				<div className="q-header">{q.header}</div>
				<div className="q-text">{q.question}</div>
				{withPreview ? (
					<div className="q-with-preview">
						<div className="q-options">{optionButtons}</div>
						<div className="q-preview">
							{activePreview ? (
								<Markdown>{activePreview}</Markdown>
							) : (
								<span className="q-preview-empty">Pasa el cursor sobre una opción para ver su vista previa…</span>
							)}
						</div>
					</div>
				) : (
					<div className="q-options">{optionButtons}</div>
				)}
				<input
					className="q-custom"
					placeholder="Escribe tu propia respuesta…"
					value={d.custom ?? ""}
					onChange={(e) => setDraft(i, { custom: e.target.value })}
				/>
				<details className="q-note">
					<summary>Añadir nota {d.note?.trim() ? <Check size={12} /> : null}</summary>
					<textarea
						placeholder="Aclara o matiza tu respuesta (opcional)…"
						value={d.note ?? ""}
						onChange={(e) => setDraft(i, { note: e.target.value })}
					/>
				</details>
			</div>
		);
	};

	const header = (
		<div className="ttl">
			<span className="ic">
				<Bot size={14} />
			</span>
			<span>
				Frida te pregunta
				{request.questions.length > 1 ? ` · ${request.questions.length} preguntas` : ""}
			</span>
		</div>
	);

	// --- Layout simple (1 sola pregunta): sin tab bar, como antes ---
	if (single) {
		return (
			<div className="question">
				{header}
				{renderQuestionBlock(0)}
				<div className="acts">
					<button onClick={submitAll}>Enviar</button>
					<button className="sec" onClick={cancel}>
						Cancelar
					</button>
				</div>
			</div>
		);
	}

	// --- Layout tabbed (>1 pregunta) + pestaña "Revisar" ---
	const onReviewTab = activeTab === reviewIndex;
	return (
		<div className="question">
			{header}
			<div className="q-tabs">
				{request.questions.map((q, i) => (
					<button
						key={i}
						type="button"
						className={"q-tab" + (activeTab === i ? " active" : "") + (isAnswered(i) ? " done" : "")}
						onClick={() => setActiveTab(i)}
					>
						{q.header || `Pregunta ${i + 1}`}
						{isAnswered(i) && <Check size={11} />}
					</button>
				))}
				<button
					type="button"
					className={"q-tab review" + (onReviewTab ? " active" : "")}
					onClick={() => setActiveTab(reviewIndex)}
				>
					Revisar
				</button>
			</div>

			<div className="q-tab-body">
				{onReviewTab ? (
					<div className="q-review">
						{request.questions.map((q, i) => {
							const a = toAnswer(i, q.multiSelect);
							return (
								<div key={i} className={"q-review-item" + (a ? "" : " pending")}>
									<span className="q-review-q">{q.question}</span>
									<span className="q-review-a">{a ? formatAnswer(a) : "Sin responder"}</span>
								</div>
							);
						})}
						<div className="acts">
							<button onClick={submitAll}>Enviar respuestas</button>
							<button className="sec" onClick={cancel}>
								Cancelar
							</button>
						</div>
					</div>
				) : (
					<>
						{renderQuestionBlock(activeTab)}
						<div className="q-tab-nav">
							{activeTab > 0 ? (
								<button className="sec" onClick={() => setActiveTab(activeTab - 1)}>
									← Anterior
								</button>
							) : (
								<span />
							)}
							<span className="q-tab-nav-right">
								<button className="sec" onClick={cancel}>
									Cancelar
								</button>
								<button onClick={() => setActiveTab(Math.min(activeTab + 1, reviewIndex))}>
									{activeTab === reviewIndex - 1 ? "Revisar →" : "Siguiente →"}
								</button>
							</span>
						</div>
					</>
				)}
			</div>
		</div>
	);
}
