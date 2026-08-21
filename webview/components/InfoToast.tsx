import { useEffect, useState, type ReactNode } from "react";
import type { ToastLevel } from "../types";
import { Codicon } from "./Codicon";

export interface InfoToastProps {
	toast: { text: string; level: ToastLevel } | undefined;
	onCopy?: (text: string) => void;
	onClose?: () => void;
}

const TOAST_META: Record<
	ToastLevel,
	{ icon: ReactNode; cls: string; title: string }
> = {
	error: {
		icon: <Codicon name="error" size={15} />,
		cls: "error",
		title: "Error",
	},
	warning: {
		icon: <Codicon name="warning" size={15} />,
		cls: "warning",
		title: "Advertencia",
	},
	info: {
		icon: <Codicon name="info" size={15} />,
		cls: "info",
		title: "Información",
	},
	success: {
		icon: <Codicon name="pass-filled" size={15} />,
		cls: "success",
		title: "Completado",
	},
};

/**
 * InfoToast — Notificación flotante nativa de VS Code (Opción 1).
 *
 * Superficie 100% opaca con variables nativas de notificación/widget de VS Code,
 * borde semántico por nivel, botón de copiar mensaje, botón de cierre y micro-barra
 * de progreso animada para avisos efímeros (info / success).
 */
export function InfoToast({ toast, onCopy, onClose }: InfoToastProps) {
	const [visible, setVisible] = useState(!!toast);
	const [copied, setCopied] = useState(false);
	const [cur, setCur] = useState<
		{ text: string; level: ToastLevel } | undefined
	>(toast);

	useEffect(() => {
		if (!toast) return;
		setCur(toast);
		setVisible(true);
		setCopied(false);
		if (toast.level === "error" || toast.level === "warning") return;
		const t = setTimeout(() => {
			setVisible(false);
			onClose?.();
		}, 4500);
		return () => clearTimeout(t);
	}, [toast, onClose]);

	if (!visible || !cur) return null;
	const meta = TOAST_META[cur.level] ?? TOAST_META.info;
	const isEphemeral = cur.level === "info" || cur.level === "success";

	const handleCopy = () => {
		if (onCopy) {
			onCopy(cur.text);
		} else if (typeof navigator !== "undefined" && navigator.clipboard) {
			navigator.clipboard.writeText(cur.text).catch(() => undefined);
		}
		setCopied(true);
		setTimeout(() => setCopied(false), 1500);
	};

	const handleClose = () => {
		setVisible(false);
		onClose?.();
	};

	return (
		<div
			className={`info-toast ${meta.cls}`}
			role={cur.level === "error" ? "alert" : "status"}
		>
			<div className="info-toast-icon">{meta.icon}</div>
			<div className="info-toast-body">
				<span className="info-toast-text">{cur.text}</span>
			</div>
			<div className="info-toast-actions">
				<button
					className="info-toast-btn"
					aria-label={copied ? "Copiado" : "Copiar mensaje"}
					title={copied ? "Copiado al portapapeles" : "Copiar mensaje"}
					type="button"
					onClick={handleCopy}
				>
					<Codicon name={copied ? "check" : "copy"} size={13} />
				</button>
				<button
					className="info-toast-btn close"
					aria-label="Cerrar aviso"
					title="Cerrar"
					type="button"
					onClick={handleClose}
				>
					<Codicon name="close" size={13} />
				</button>
			</div>
			{isEphemeral && (
				<div className="info-toast-progress" aria-hidden="true">
					<span className="info-toast-progress-bar" />
				</div>
			)}
		</div>
	);
}
