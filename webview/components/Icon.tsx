import {
	Check,
	CheckCheck,
	ChevronRight,
	ChevronDown,
	ChevronUp,
	Circle,
	Link,
	Pencil,
	Search,
	Terminal,
	TriangleAlert,
	Wrench,
	X,
	type LucideIcon,
} from "lucide-react";

// Iconos centralizados sobre lucide-react. Se conserva la API por nombre para no
// tener que tocar los puntos de uso (<Icon name="check" />) al cambiar de librería.
const ICONS: Record<string, LucideIcon> = {
	check: Check,
	checkcheck: CheckCheck,
	x: X,
	chevron: ChevronRight,
	circle: Circle,
	link: Link,
	search: Search,
	alert: TriangleAlert,
	term: Terminal,
	edit: Pencil,
	wrench: Wrench,
	up: ChevronUp,
	down: ChevronDown,
};

export function Icon({ name, size = 14 }: { name: string; size?: number }) {
	const Cmp = ICONS[name];
	if (!Cmp) return null;
	return <Cmp size={size} className="icon" aria-hidden />;
}
