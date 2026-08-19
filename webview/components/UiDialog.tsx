import { useState } from "react";
import type { UiRequest } from "../types";
import { Codicon } from "./Codicon";

// Renderiza un diálogo data-oriented del ExtensionUIContext (pi.ui.select/input/
// confirm). Son los diálogos que las extensiones nativas en modo RPC usan cuando
// no hay TUI (rpiv-ask-user-question vía runRpcQuestionnaire). Mucho más simple
// que WebQuestionnaire: sin previews/tabs — el protocolo select/input es solo texto.
//
// El contrato (rpiv rpc-fallback.ts):
//  - select(title, options[]) → string elegido | undefined (cancelado)
//  - input(title, placeholder?) → string | undefined
//  - confirm(title, message) → "true" | "false" (host traduce a boolean)
// El componente emite ui_response {id, value?, cancelled}.

export function UiDialog({
	request,
	onRespond,
}: {
	request: UiRequest;
	onRespond: (value: string | undefined, cancelled: boolean) => void;
}) {
	const [text, setText] = useState("");

	const cancel = () => onRespond(undefined, true);

	const body = (() => {
		switch (request.method) {
			case "select":
				return (
					<ul className="ui-dialog-options">
						{(request.options ?? []).map((opt, i) => (
							<li key={`${opt}-${i}`}>
								<button
									type="button"
									className="ui-dialog-option"
									onClick={() => onRespond(opt, false)}
								>
									{opt}
								</button>
							</li>
						))}
					</ul>
				);
			case "input":
				return (
					<form
						className="ui-dialog-form"
						onSubmit={(e) => {
							e.preventDefault();
							onRespond(text, false);
						}}
					>
						<textarea
							className="ui-dialog-textarea"
							value={text}
							placeholder={request.placeholder ?? ""}
							autoFocus
							rows={Math.min(6, Math.max(2, text.split("\n").length))}
							onChange={(e) => setText(e.target.value)}
						/>
						<div className="ui-dialog-row">
							<button
								type="submit"
								className="ui-dialog-send"
								disabled={!text.trim()}
							>
								<Codicon name="send" size={14} /> Enviar
							</button>
						</div>
					</form>
				);
			case "confirm":
				return (
					<div className="ui-dialog-row">
						<button
							type="button"
							className="ui-dialog-confirm yes"
							onClick={() => onRespond("true", false)}
						>
							Sí
						</button>
						<button
							type="button"
							className="ui-dialog-confirm no"
							onClick={() => onRespond("false", false)}
						>
							No
						</button>
					</div>
				);
			default:
				return null;
		}
	})();

	return (
		<div className="ui-dialog">
			<div className="ui-dialog-head">
				<Codicon name="question" size={16} />
				<span className="ui-dialog-title">
					{/* El título del select ya trae opciones/previews plegados (rpiv). */}
					{request.title}
				</span>
				{request.method === "confirm" ? null : (
					<button
						type="button"
						className="ui-dialog-x"
						title="Cancelar"
						onClick={cancel}
					>
						<Codicon name="close" size={14} />
					</button>
				)}
			</div>
			{request.method === "confirm" && request.message ? (
				<p className="ui-dialog-message">{request.message}</p>
			) : null}
			<div className="ui-dialog-body">{body}</div>
		</div>
	);
}
