import type { CSSProperties } from "react";

export interface CodiconProps {
	name: string;
	size?: number;
	className?: string;
	ariaLabel?: string;
	style?: CSSProperties;
	spin?: boolean;
}

// Aliases para nombres comunes de iconos
const ICON_ALIASES: Record<string, string> = {
	bot: "copilot",
	brain: "sparkle",
};

/**
 * Componente unificado para renderizar glifos vectoriales de @vscode/codicons.
 */
export function Codicon({
	name,
	size = 16,
	className = "",
	ariaLabel,
	style,
	spin = false,
}: CodiconProps) {
	let normalized = name.startsWith("codicon-") ? name.slice(8) : name;
	if (ICON_ALIASES[normalized]) {
		normalized = ICON_ALIASES[normalized];
	}
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
