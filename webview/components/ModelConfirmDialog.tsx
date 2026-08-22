import { useEffect } from "react";
import { Codicon } from "./Codicon";

export interface ModelConfirmTarget {
	provider: string;
	providerName: string;
	modelId: string;
	modelName: string;
	contextWindow?: number;
	reasoning?: boolean;
	input?: ("text" | "image")[];
}

export interface ModelConfirmDialogProps {
	current: ModelConfirmTarget;
	target: ModelConfirmTarget;
	onConfirm: () => void;
	onCancel: () => void;
}

function fmtTokens(n?: number): string {
	if (!n) return "Estándar";
	if (n >= 1_000_000) {
		const val = (n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0);
		return `${val}M`;
	}
	if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
	return String(n);
}

export function ModelConfirmDialog({
	current,
	target,
	onConfirm,
	onCancel,
}: ModelConfirmDialogProps) {
	// Atajos de teclado: Enter para confirmar, Esc para cancelar
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.preventDefault();
				onCancel();
			} else if (e.key === "Enter" && !e.shiftKey && !e.altKey) {
				e.preventDefault();
				onConfirm();
			}
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [onConfirm, onCancel]);

	const currentCtx = current.contextWindow ?? 0;
	const targetCtx = target.contextWindow ?? 0;
	const hasContextComparison = currentCtx > 0 && targetCtx > 0;
	const isContextReduced = hasContextComparison && targetCtx < currentCtx;
	const isContextExpanded = hasContextComparison && targetCtx > currentCtx;

	return (
		<div className="model-diff-overlay" onClick={onCancel}>
			<div
				className="model-diff-card"
				onClick={(e) => e.stopPropagation()}
				role="dialog"
				aria-modal="true"
				aria-labelledby="model-diff-title"
			>
				{/* Header */}
				<div className="model-diff-header">
					<div className="model-diff-title-wrap">
						<Codicon name="sparkle" size={15} className="model-diff-icon" />
						<span id="model-diff-title" className="model-diff-title">
							Confirmar cambio de modelo
						</span>
					</div>
					<button
						type="button"
						className="model-diff-close"
						onClick={onCancel}
						aria-label="Cerrar"
						title="Cancelar (Esc)"
					>
						<Codicon name="close" size={13} />
					</button>
				</div>

				{/* Body prompt */}
				<p className="model-diff-prompt">
					¿Deseas cambiar el modelo activo para esta sesión?
				</p>

				{/* Side-by-Side Comparison Matrix */}
				<div className="model-diff-matrix">
					{/* Columna Actual */}
					<div className="model-diff-col current">
						<div className="model-diff-col-badge">ACTUAL</div>
						<div className="model-diff-name" title={current.modelId}>
							{current.modelName}
						</div>
						<div className="model-diff-provider">{current.providerName}</div>
						<div className="model-diff-specs">
							<div className="model-diff-spec-row">
								<span className="spec-label">Ventana:</span>
								<span className="spec-value">{fmtTokens(current.contextWindow)}</span>
							</div>
							<div className="model-diff-spec-row">
								<span className="spec-label">Razonamiento:</span>
								<span className="spec-value">
									{current.reasoning ? "Activo" : "Estándar"}
								</span>
							</div>
							{current.input && current.input.includes("image") && (
								<div className="model-diff-spec-row">
									<span className="spec-label">Visión:</span>
									<span className="spec-value">Soportada</span>
								</div>
							)}
						</div>
					</div>

					{/* Flecha divisora */}
					<div className="model-diff-arrow" aria-hidden="true">
						<Codicon name="arrow-right" size={14} />
					</div>

					{/* Columna Nuevo */}
					<div className="model-diff-col target">
						<div className="model-diff-col-badge target">NUEVO</div>
						<div className="model-diff-name" title={target.modelId}>
							{target.modelName}
						</div>
						<div className="model-diff-provider">{target.providerName}</div>
						<div className="model-diff-specs">
							<div className="model-diff-spec-row">
								<span className="spec-label">Ventana:</span>
								<span className="spec-value">{fmtTokens(target.contextWindow)}</span>
							</div>
							<div className="model-diff-spec-row">
								<span className="spec-label">Razonamiento:</span>
								<span className="spec-value">
									{target.reasoning ? "Activo" : "Estándar"}
								</span>
							</div>
							{target.input && target.input.includes("image") && (
								<div className="model-diff-spec-row">
									<span className="spec-label">Visión:</span>
									<span className="spec-value">Soportada</span>
								</div>
							)}
						</div>
					</div>
				</div>

				{/* Warning / Gain banner */}
				{isContextReduced && (
					<div className="model-diff-warn">
						<Codicon name="warning" size={13} className="model-diff-warn-icon" />
						<span>
							<strong>Atención:</strong> La ventana de contexto es menor (
							{fmtTokens(targetCtx)} vs {fmtTokens(currentCtx)}). Si la sesión es
							larga, podría requerir compactación de memoria más pronto.
						</span>
					</div>
				)}

				{isContextExpanded && (
					<div className="model-diff-gain">
						<Codicon name="pass" size={13} className="model-diff-gain-icon" />
						<span>
							Mayor ventana de contexto disponible ({fmtTokens(targetCtx)}).
						</span>
					</div>
				)}

				<div className="model-diff-note">
					<Codicon name="info" size={12} />
					<span>El historial y el estado de la sesión actual se preservarán.</span>
				</div>

				{/* Actions */}
				<div className="model-diff-actions">
					<button
						type="button"
						className="model-diff-btn secondary"
						onClick={onCancel}
					>
						Cancelar <kbd>Esc</kbd>
					</button>
					<button
						type="button"
						className="model-diff-btn primary"
						onClick={onConfirm}
						autoFocus
					>
						Cambiar Modelo <kbd>Enter</kbd>
					</button>
				</div>
			</div>
		</div>
	);
}
