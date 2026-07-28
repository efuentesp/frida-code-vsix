import { useState } from "react";
import type { ReactElement, ReactNode } from "react";

// WebQuestionnaire — reimplementación de ask_user_question sobre Remote React
// (opción A, ADR-0012). El componente corre en el HOST con React + useState; cada
// cambio serializa un commit al webview (RemoteRoot lo materializa). Recupera la
// UI rica del TUI: opciones con descripción, multiSelect (con checkbox visual),
// texto libre y —cuando una opción trae `preview`— panel markdown side-by-side.
//
// Tags intrinsic de frida-webview (fbox/ftext/fbutton/finput/fmarkdown), tipados
// por el declare global en src/frida-webview/index.ts.

export interface WebQuestionOption {
	label: string;
	description: string;
	preview?: string;
}

export interface WebQuestionSpec {
	question: string;
	header: string;
	multiSelect?: boolean;
	options: WebQuestionOption[];
}

export interface WebQuestionAnswer {
	questionIndex: number;
	kind: "option" | "custom" | "multi";
	answer: string | null;
	selected?: string[];
}

export interface WebQuestionnaireResult {
	answers: WebQuestionAnswer[];
	cancelled: boolean;
}

interface Props {
	questions: WebQuestionSpec[];
	done: (result: WebQuestionnaireResult) => void;
}

export function createWebQuestionnaireElement(
	questions: WebQuestionSpec[],
	done: (result: WebQuestionnaireResult) => void,
): ReactElement {
	return <WebQuestionnaire questions={questions} done={done} />;
}

function WebQuestionnaire({ questions, done }: Props): ReactElement {
	const [tab, setTab] = useState(0);
	const [drafts, setDrafts] = useState<Record<number, WebQuestionAnswer>>({});
	const [customText, setCustomText] = useState<Record<number, string>>({});

	const q = questions[tab];
	const isLast = tab === questions.length - 1;
	const draft = drafts[tab];

	// ¿La pregunta actual lleva panel de preview? Solo single-select con ≥1 opción
	// que traiga `preview` (paridad con rpiv: previews sólo en single-select).
	const hasPreviews =
		!q.multiSelect &&
		q.options.some((o) => (o.preview ?? "").trim().length > 0);

	// Opción cuyo preview se muestra: la seleccionada (si tiene preview), si no la
	// primera con preview. Derivado del draft → sin estado extra, se resetea solo al
	// cambiar de pregunta.
	const selectedLabel = draft?.kind === "option" ? draft.answer : undefined;
	const activePreviewOpt =
		q.options.find(
			(o) => o.label === selectedLabel && (o.preview ?? "").trim(),
		) ?? q.options.find((o) => (o.preview ?? "").trim());

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
		done({ answers, cancelled: false });
	}
	function cancel() {
		done({ answers: [], cancelled: true });
	}

	function renderOption(opt: WebQuestionOption, i: number): ReactNode {
		const selected = isOptionSelected(opt.label);
		// multiSelect: checkbox visual (☑/☐) al inicio del label.
		const marker = q.multiSelect ? (selected ? "☑ " : "☐ ") : "";
		return (
			<fbutton
				key={`${opt.label}-${i}`}
				variant={selected ? "primary" : "secondary"}
				onClick={() =>
					q.multiSelect ? toggleMulti(opt.label) : chooseSingle(opt.label)
				}
			>
				{marker}
				{opt.label} — {opt.description}
			</fbutton>
		);
	}

	// Columna de opciones (común con/sin preview).
	const optionsColumn = (
		<fbox flexDirection="column" gap={4}>
			{q.options.map(renderOption)}
		</fbox>
	);

	return (
		<fbox flexDirection="column" gap={8} padding={10}>
			<ftext bold>
				{`Pregunta ${tab + 1}/${questions.length}`}
				{q.header ? ` · ${q.header}` : ""}
			</ftext>
			<ftext>{q.question}</ftext>

			{/* Opciones (+ preview side-by-side si aplica) */}
			{hasPreviews ? (
				<fbox flexDirection="row" gap={10}>
					<fbox flexDirection="column" gap={4} flex={1}>
						{q.options.map(renderOption)}
					</fbox>
					<fbox flexDirection="column" gap={4} flex={1}>
						<ftext bold>
							{activePreviewOpt
								? `Preview · ${activePreviewOpt.label}`
								: "Preview"}
						</ftext>
						<fmarkdown>{activePreviewOpt?.preview ?? ""}</fmarkdown>
					</fbox>
				</fbox>
			) : (
				optionsColumn
			)}

			{/* Texto libre (fila "Type something." del TUI) */}
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
