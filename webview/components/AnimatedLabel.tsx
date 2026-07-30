// AnimatedLabel — etiqueta de estado con animación "ola de letras".
//
// Parte el texto en un <span> por carácter; cada uno oscila (sube/baja + tinte de
// acento) con un retardo escalonado, formando una ola que recorre la palabra. Pensada
// para el indicador "Procesando…" / "Pensando…" / "Ejecutando…" del proc-bar.
//
// Reconciliación: key = índice del carácter. Si el texto cambia sin variar su longitud
// (ej. cuenta regresiva "…en 5s…" → "…en 4s…"), los spans se reutilizan (mismo key) y la
// animación continúa sin reiniciarse. Los espacios → \u00A0 para preservar ancho en
// inline-block. Respeta prefers-reduced-motion (la animación se anula en CSS).

export function AnimatedLabel({ text }: { text: string }) {
	return (
		<span className="proc-label wave" aria-label={text}>
			{text.split("").map((ch, i) => (
				<span
					key={i}
					className="ltr"
					style={{ animationDelay: `${(i * 0.06).toFixed(2)}s` }}
				>
					{ch === " " ? "\u00A0" : ch}
				</span>
			))}
		</span>
	);
}
