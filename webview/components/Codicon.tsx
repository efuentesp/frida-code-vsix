// Wrapper de íconos Codicons (DESIGN-SYSTEM-WEBVIEW.md §4.2).
// La familia objetivo es la fuente del workbench de VS Code (la misma que
// Copilot Chat); Lucide queda como legado en migración. Este componente evita
// repetir spans con clases y centraliza el sizing (los codicons se dimensionan
// con font-size, no con width/height).
//
// Uso:
//   <Codicon name="check" />                    // decorativo (aria-hidden)
//   <Codicon name="loading" size={13} spin />   // spinner (rotación CSS)
//   <Codicon name="error" label="Falló" />      // informativo (role=img)

interface CodiconProps {
	/** Glifo sin el prefijo `codicon-` (p.ej. "check", "chevron-right"). */
	name: string;
	/** Tamaño en px (font-size). Default 13 (contenido; §4.2). */
	size?: number;
	/** aria-label: lo vuelve informativo (role="img"); sin él es aria-hidden. */
	label?: string;
	/** Rotación continua (p.ej. loading). Respeta reduced-motion vía CSS. */
	spin?: boolean;
	/** Clases extra (p.ej. para estados de color del contenedor). */
	className?: string;
}

export function Codicon({
	name,
	size = 13,
	label,
	spin,
	className,
}: CodiconProps) {
	const cls =
		`codicon codicon-${name}` +
		(spin ? " codicon-spin" : "") + // keyframes del propio paquete
		(className ? ` ${className}` : "");
	return (
		<span
			className={cls}
			style={{ fontSize: size }}
			aria-hidden={label ? undefined : true}
			role={label ? "img" : undefined}
			aria-label={label}
		/>
	);
}
