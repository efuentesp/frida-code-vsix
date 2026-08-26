import type { ReactNode } from "react";

/** ¿Coincide alguno de los campos con la consulta por subcadena
 * (case-insensitive)? Query vacía = coincide con todo (sin filtro). */
export function matchesAny(
	q: string,
	...fields: (string | undefined | null)[]
): boolean {
	const query = q.trim().toLowerCase();
	if (!query) return true;
	return fields.some((f) => !!f && f.toLowerCase().includes(query));
}

/** Resalta TODAS las ocurrencias (case-insensitive) de `q` dentro de `text`
 * con <mark class="hl"> (color del tema via findMatchHighlightBackground,
 * ver estilos .hl en styles.css). Sin query devuelve el texto tal cual:
 * el markup extra sólo existe mientras se filtra. */
export function highlightText(text: string, q: string): ReactNode {
	const query = q.trim().toLowerCase();
	if (!query || !text) return text;
	const lower = text.toLowerCase();
	const out: ReactNode[] = [];
	let i = 0;
	let n = 0;
	while (i < text.length) {
		const at = lower.indexOf(query, i);
		if (at === -1) {
			out.push(text.slice(i));
			break;
		}
		if (at > i) out.push(text.slice(i, at));
		out.push(
			<mark className="hl" key={n++}>
				{text.slice(at, at + query.length)}
			</mark>,
		);
		i = at + query.length;
	}
	return out;
}
