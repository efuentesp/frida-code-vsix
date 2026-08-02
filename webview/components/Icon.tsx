import {
	Check,
	CheckCheck,
	ChevronRight,
	Link,
	Pencil,
	Terminal,
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
	link: Link,
	term: Terminal,
	edit: Pencil,
	wrench: Wrench,
};

export function Icon({ name, size = 14 }: { name: string; size?: number }) {
	const Cmp = ICONS[name];
	if (!Cmp) return null;
	return <Cmp size={size} className="icon" aria-hidden />;
}
