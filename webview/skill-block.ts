// Réplica de parseSkillBlock del SDK (core/agent-session.js, exportado). Cuando el
// usuario invoca /skill:nombre, pi expande el mensaje del usuario a este bloque y lo
// persiste así en la sesión. Lo detectamos para colapsarlo en el transcript (igual
// que el SkillInvocationMessageComponent del TUI) en vez de mostrar el SKILL.md crudo.
export interface SkillBlock {
	name: string;
	location: string;
	content: string;
	userMessage?: string; // texto que el usuario añadió tras /skill:nombre
}

export function parseSkillBlock(text: string): SkillBlock | null {
	const m = text.match(
		/^<skill name="([^"]+)" location="([^"]+)">\n([\s\S]*?)\n<\/skill>(?:\n\n([\s\S]+))?$/,
	);
	if (!m) return null;
	return {
		name: m[1],
		location: m[2],
		content: m[3],
		userMessage: m[4]?.trim() || undefined,
	};
}
