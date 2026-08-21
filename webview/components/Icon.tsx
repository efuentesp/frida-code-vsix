import { Codicon } from "./Codicon";

// Mapeo de nombres históricos a nombres de @vscode/codicons.
const ICONS: Record<string, string> = {
	check: "check",
	checkcheck: "check-all",
	x: "close",
	chevron: "chevron-right",
	circle: "circle-outline",
	link: "link",
	search: "search",
	alert: "warning",
	term: "terminal",
	edit: "edit",
	wrench: "tools",
	up: "chevron-up",
	down: "chevron-down",
};

export function Icon({ name, size = 14 }: { name: string; size?: number }) {
	const codiconName = ICONS[name] || name;
	return <Codicon name={codiconName} size={size} className="icon" />;
}
