import type { CSSProperties } from "react";
import { Bot, Brain } from "lucide-react";

export interface CodiconProps {
	name: string;
	size?: number;
	className?: string;
	ariaLabel?: string;
	style?: CSSProperties;
	spin?: boolean;
}

// Iconos de marca propios de Frida que se conservan en vector mientras el resto migra a codicons
const BRAND_ICONS: Record<string, typeof Bot> = {
	bot: Bot,
	brain: Brain,
};

/**
 * Componente unificado para renderizar glifos vectoriales de @vscode/codicons.
 * Si se pide un icono de marca (bot, brain), hace fallback a los SVGs de Frida.
 */
export function Codicon({
	name,
	size = 16,
	className = "",
	ariaLabel,
	style,
	spin = false,
}: CodiconProps) {
	const Brand = BRAND_ICONS[name];
	if (Brand) {
		return (
			<Brand
				size={size}
				className={`codicon-brand ${className}`.trim()}
				aria-label={ariaLabel}
				aria-hidden={!ariaLabel}
				style={style}
			/>
		);
	}

	const normalized = name.startsWith("codicon-") ? name.slice(8) : name;
	const spinClass =
		spin || normalized === "loading" ? " codicon-modifier-spin" : "";
	const fullClass =
		`codicon codicon-${normalized}${spinClass} ${className}`.trim();

	return (
		<span
			className={fullClass}
			style={{ fontSize: `${size}px`, lineHeight: 1, ...style }}
			aria-label={ariaLabel}
			aria-hidden={!ariaLabel}
			role={ariaLabel ? "img" : undefined}
		/>
	);
}
