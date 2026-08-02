// AnimatedLabel — etiqueta de estado con animación "pulso" para el indicador
// "Procesando…" / "Pensando…" / "Ejecutando…" / "Compactando…" del proc-bar.
//
// Toda la etiqueta late (opacidad + brillo del color de acento) en bucle, con el
// mismo espíritu que el Brain de "Razonamiento". Antes era una ola de letras
// escalonada (un <span> por carácter); se unificó a un pulso del bloque entero,
// más sobrio y coherente con el resto de la UI. Respeta prefers-reduced-motion
// (la animación se anula en CSS).

export function AnimatedLabel({ text }: { text: string }) {
	return (
		<span className="proc-label wave" aria-label={text}>
			{text}
		</span>
	);
}
