import { Codicon } from "./Codicon";

// Iconos centralizados (Fase 1 P3: migrado de lucide-react a Codicon). Se
// conserva la API por nombre para no tocar los puntos de uso (<Icon name="check" />).
const ICON_MAP: Record<string, string> = {
	check: "check",
	checkcheck: "pass", // o "check-all" si existe
	x: "close",
	chevron: "chevron-right",
	circle: "circle-outline",
	link: "link",
	search: "search",
	alert: "warning",
	term: "terminal",
	edit: "edit",
	wrench: "wrench",
};

export function Icon({ name, size = 14 }: { name: string; size?: number }) {
	const codiconName = ICON_MAP[name];
	if (!codiconName) return null;
	return <Codicon name={codiconName} size={size} className="icon" aria-hidden />;
}
