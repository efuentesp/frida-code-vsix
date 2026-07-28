import { useState } from "react";
import type { ReactElement } from "react";

// WebQuestionnaire — reimplementación de ask_user_question sobre Remote React
// (opción A, ADR-0012). El componente corre en el HOST con React + useState; cada
// cambio serializa un commit al webview (RemoteRoot lo materializa). Así recuperamos
// la UI rica (tabs, opciones con descripción, multiSelect, texto libre) que el modo
// RPC secuencial (UiDialog) perdía.
//
// Tags intrinsic de frida-webview (fbox/ftext/fbutton/finput), tipados por el
// declare global en src/frida-webview/index.ts. El renderer del host los serializa
// a WebNode{type:"fbox",...}; el webview los pinta (fbox→div, fbutton→button).

/** Una opción de pregunta (mismo contrato que rpiv / ask-user-question). */
export interface WebQuestionOption {
	label: string;
	description: string;
	preview?: string;
}

/** Una pregunta del cuestionario. */
export interface WebQuestionSpec {
	question: string;
	header: string;
	multiSelect?: boolean;
	options: WebQuestionOption[];
}

/** Respuesta del usuario a una pregunta (mismo shape que QuestionAnswer). */
export interface WebQuestionAnswer {
	questionIndex: number;
	kind: "option" | "custom" | "multi";
	answer: string | null;
	selected?: string[];
}

/** Resultado que el cuestionario devuelve al tool (→ details del toolResult). */
export interface WebQuestionnaireResult {
	answers: WebQuestionAnswer[];
	cancelled: boolean;
}

interface Props {
	questions: WebQuestionSpec[];
	done: (result: WebQuestionnaireResult) => void;
}

/** Punto de entrada: monta el elemento raíz del cuestionario. */
export function createWebQuestionnaireElement(
	questions: WebQuestionSpec[],
	done: (result: WebQuestionnaireResult) => void,
): ReactElement {
	return <WebQuestionnaire questions={questions} done={done} />;
}

function WebQuestionnaire({ questions, done }: Props): ReactElement {
	const [tab, setTab] = useState(0);
	// Borradores de respuesta por índice de pregunta.
	const [drafts, setDrafts] = useState<Record<number, WebQuestionAnswer>>({});
	// Texto libre por pregunta (separado del draft para no pisar la selección al teclear).
	const [customText, setCustomText] = useState<Record<number, string>>({});

	const q = questions[tab];
	const isLast = tab === questions.length - 1;
	const draft = drafts[tab];

	// ¿Está seleccionada una opción? (single o multi)
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
		// Si hay texto, la respuesta pasa a "custom"; si se vacía y había option, restaura.
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
		done({ answers, cancelled: false });
	}
	function cancel() {
		done({ answers: [], cancelled: true });
	}

	return (
		<fbox flexDirection="column" gap={8} padding={10}>
			{/* Encabezado: progreso + header de la pregunta */}
			<ftext bold>
				{`Pregunta ${tab + 1}/${questions.length}`}
				{q.header ? ` · ${q.header}` : ""}
			</ftext>
			<ftext>{q.question}</ftext>

			{/* Opciones */}
			<fbox flexDirection="column" gap={4}>
				{q.options.map((opt, i) => (
					<fbutton
						key={`${opt.label}-${i}`}
						variant={isOptionSelected(opt.label) ? "primary" : "secondary"}
						onClick={() =>
							q.multiSelect ? toggleMulti(opt.label) : chooseSingle(opt.label)
						}
					>
						{opt.label} — {opt.description}
					</fbutton>
				))}
			</fbox>

			{/* Texto libre (equivalente a la fila "Type something." del TUI) */}
			<finput
				placeholder="O escribe tu propia respuesta…"
				value={customText[tab] ?? ""}
				onChange={onCustomChange}
			/>

			{/* Navegación */}
			<fbox flexDirection="row" gap={6}>
				{tab > 0 ? (
					<fbutton variant="secondary" onClick={() => setTab(tab - 1)}>
						← Anterior
					</fbutton>
				) : null}
				{!isLast ? (
					<fbutton onClick={() => setTab(tab + 1)}>Siguiente →</fbutton>
				) : (
					<fbutton onClick={submit}>Enviar</fbutton>
				)}
				<fbutton variant="danger" onClick={cancel}>
					Cancelar
				</fbutton>
			</fbox>
		</fbox>
	);
}
