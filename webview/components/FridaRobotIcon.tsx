import type { CSSProperties } from "react";

export interface FridaRobotIconProps {
	size?: number;
	className?: string;
	style?: CSSProperties;
	ariaLabel?: string;
}

/**
 * Icono vectorial oficial de Frida Code:
 * Robot con antena en L, orejas laterales y expresión { > _ } (ojo izquierdo > y guiño _).
 */
export function FridaRobotIcon({
	size = 15,
	className = "",
	style,
	ariaLabel = "Frida Code",
}: FridaRobotIconProps) {
	return (
		<svg
			viewBox="0 0 24 24"
			width={size}
			height={size}
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			className={`frida-robot-icon ${className}`.trim()}
			style={{ display: "inline-block", verticalAlign: "middle", ...style }}
			aria-label={ariaLabel}
			role="img"
		>
			{/* Antena en L */}
			<path d="M12 8V4H8" />
			{/* Cabeza rectangular redondeada */}
			<rect width="16" height="12" x="4" y="8" rx="2" />
			{/* Orejas laterales */}
			<path d="M2 14h2" />
			<path d="M20 14h2" />
			{/* Ojo izquierdo: '>' */}
			<path d="M8 12.5 L10.5 14 L8 15.5" />
			{/* Ojo derecho: '_' (guiño) */}
			<path d="M13.5 15.5 h3" />
		</svg>
	);
}
