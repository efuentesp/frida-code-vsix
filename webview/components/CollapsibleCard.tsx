import {
	useEffect,
	useRef,
	useState,
	type KeyboardEvent,
	type ReactNode,
	type UIEvent,
} from "react";
import { Icon } from "./Icon";
import { Codicon } from "./Codicon";
import { Tooltip } from "./Tooltip";

/**
 * Tarjeta colapsable reutilizable: contenedor + cabecera + cuerpo.
 *
 * Base común de las tarjetas del transcript (ToolCard, BashCard y la SummaryCard
 * de compaction/branch) para no reimplementar una y otra vez el mismo patrón
 * "header con icono/título/estado/chevron + cuerpo plegable".
 *
 * COMPORTAMIENTO DE APERTURA AUTOMÁTICA (Fase 1):
 * - Mientras `running` es true, la tarjeta se abre sola para mostrar la salida en
 *   vivo, dando al usuario la confianza de que "se está generando algo". Se abre
 *   de inmediato si `hasPartial` (hay progreso parcial) o, si no lo hay, tras
 *   `threshold` ms (placeholder "Ejecutando…") para no parpadear con las tools
 *   instantáneas (read/grep/edit) que terminan en milisegundos.
 * - Al terminar (`running` → false) se colapsa automáticamente, salvo que el
 *   usuario la haya abierto/cerrado a mano: la intervención manual SIEMPRE tiene
 *   prioridad sobre la automática.
 * - Ya finalizada, el usuario puede expandir/colapsar a voluntad.
 *
 * RELOJ ÚNICO: cuando `running`, re-renderiza cada 250 ms. Basta para evaluar el
 * umbral y para que el cronómetro del status (que el hijo calcula con Date.now())
 * avance, sin que cada tarjeta gestione su propio timer.
 */
export interface CollapsibleCardProps {
	/** ¿Está en ejecución? true → auto-apertura según umbral/partial. */
	running?: boolean;
	/** Timestamp de inicio (ms) para el cálculo del umbral. Si se omite, usa el
	 *  momento de montaje del componente. */
	startedAt?: number;
	/** Ms que debe llevar corriendo antes de auto-abrir SIN partial. Evita el
	 *  parpadeo de las tools instantáneas. Default 400. */
	threshold?: number;
	/** ¿Hay salida parcial en vivo? true + running → auto-apertura inmediata. */
	hasPartial?: boolean;
	/** ¿Hay contenido (resultado) final que mostrar? Habilita el toggle persistente
	 *  cuando no está running y muestra el chevron. */
	hasContent?: boolean;
	/** Apertura inicial (sólo aplica antes de cualquier estado running/auto). */
	defaultOpen?: boolean;
	/** Variante visual: ajusta colores/bordes del contenedor y cabecera. */
	variant?: "tool" | "bash" | "compact" | "thinking" | "flat";
	/** Icono de cabecera. Si `iconLive`, late mientras running. */
	icon?: ReactNode;
	iconLive?: boolean;
	/** Contenido del header entre el icono y el estado: título, etiqueta, badges…
	 *  Cada tarjeta lo arma con sus clases (.card-title/.card-label/.card-badges). */
	leading?: ReactNode;
	/** Bloque de estado a la derecha (spinner/check/duración…). Cada tarjeta le
	 *  pone .card-status (+ estado de color). */
	status?: ReactNode;
	/** Tooltip del chevron (recibe si está abierto). */
	chevronTooltip?: (open: boolean) => string;
	/** Cuerpo: se renderiza sólo cuando la tarjeta está abierta. */
	children?: ReactNode;
	/** Clase extra para el cuerpo (p.ej. para quitar scroll en variantes). */
	bodyClassName?: string;
	/** Clase extra del contenedor (p.ej. "dim" para el modo !! del bash). */
	className?: string;
}

export function CollapsibleCard({
	running = false,
	startedAt,
	threshold = 400,
	hasPartial = false,
	hasContent = false,
	defaultOpen = false,
	variant = "tool",
	icon,
	iconLive = false,
	leading,
	status,
	chevronTooltip,
	children,
	bodyClassName,
	className,
}: CollapsibleCardProps) {
	// Apertura decidida por el usuario (null = aún no interviene). Tiene prioridad
	// absoluta sobre la apertura automática derivada del estado running.
	const [userToggle, setUserToggle] = useState<boolean | null>(null);
	const startRef = useRef<number>(startedAt ?? Date.now());
	if (startedAt !== undefined) startRef.current = startedAt;
	const rootRef = useRef<HTMLDivElement>(null);
	const bodyRef = useRef<HTMLDivElement>(null);

	// Reloj en vivo sólo mientras ejecuta (re-render ligero cada 250 ms). Sirve
	// tanto para el umbral de auto-apertura como para que el cronómetro del status
	// (en el hijo) avance, sin que cada tarjeta gestione su propio timer.
	const [, setTick] = useState(0);
	useEffect(() => {
		if (!running) return;
		const id = setInterval(() => setTick((n) => n + 1), 250);
		return () => clearInterval(id);
	}, [running]);

	const now = Date.now();
	const elapsedRunning = now - startRef.current;
	const exceedsThreshold = running && elapsedRunning > threshold;
	const isFlat = variant === "flat";
	// Las herramientas en formato flat no se auto-abren durante la ejecución para
	// evitar saltos molestos en el scroll del transcript de conversación.
	const autoOpen = !isFlat && running && (hasPartial || exceedsThreshold);
	const open = userToggle ?? (autoOpen || defaultOpen);

	// AUTO-SCROLL: cuando la apertura es automática (durante la ejecución, sin
	// intervención del usuario) y la tarjeta pasa de cerrada a abierta, la
	// traemos a la vista del transcript para que se vea la salida generándose.
	// No dispara al finalizar ni cuando el usuario abre a mano: así no pelea con
	// quien está leyendo otra parte de la conversación.
	const prevOpenRef = useRef(false);
	useEffect(() => {
		const autoOpened = open && autoOpen && userToggle === null;
		if (autoOpened && !prevOpenRef.current) {
			rootRef.current?.scrollIntoView({
				block: "nearest",
				behavior: "smooth",
			});
		}
		prevOpenRef.current = open;
	}, [open, autoOpen, userToggle]);

	// STICK-TO-BOTTOM del cuerpo mientras corre: mantener pegado al final para que
	// se vea SIEMPRE lo último que se va generando (output/razonamiento fluyendo).
	// El thinking crece en BLOQUES grandes (párrafos por delta), así que no basta
	// con medir "cerca del final" en cada tick: si un bloque supera el umbral, el
	// scroll se queda atrás para siempre. Por eso trackeamos con stickRef si el
	// usuario está "siguiendo" el flujo: pegamos siempre MIENTRAS no haya subido a
	// leer; si sube (onScroll), dejamos de forzar; si vuelve al final, reanudamos.
	// Es el comportamiento estándar de una terminal/log (tail -f). Al terminar
	// deja de forzar → el usuario navega libre por el resultado.
	const stickRef = useRef(true);
	function handleBodyScroll(e: UIEvent<HTMLDivElement>) {
		const el = e.currentTarget;
		stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
	}
	useEffect(() => {
		if (!running || !open) return;
		const el = bodyRef.current;
		if (!el) return;
		// Al (re)abrir durante la ejecución: empezar pegado (el usuario aún no ha
		// scrolleado arriba en esta apertura).
		stickRef.current = true;
		const stick = () => {
			if (stickRef.current) el.scrollTop = el.scrollHeight;
		};
		stick();
		const id = setInterval(stick, 150);
		return () => clearInterval(id);
	}, [running, open]);

	// El header es clicable mientras corre (para colapsar el live) o si hay
	// contenido final que mostrar.
	const clickable = running || hasContent;

	function toggle() {
		if (!clickable) return;
		setUserToggle(!open);
	}

	function handleKeyDown(e: KeyboardEvent) {
		if (clickable && (e.key === "Enter" || e.key === " ")) {
			e.preventDefault();
			toggle();
		}
	}

	const containerClass =
		`card card--${variant}` +
		(open ? " open" : " collapsed") +
		(className ? " " + className : "");

	return (
		<div className={containerClass} ref={rootRef}>
			<div
				className={
					(isFlat ? "tool-flat" : "card-head") +
					(clickable ? " is-toggle" : "") +
					(isFlat && open ? " is-expanded" : "")
				}
				onClick={clickable ? toggle : undefined}
				role={clickable ? "button" : undefined}
				aria-expanded={clickable ? open : undefined}
				tabIndex={clickable ? 0 : undefined}
				onKeyDown={handleKeyDown}
			>
				{icon ? (
					<span className={"card-icon" + (iconLive ? " live" : "")}>{icon}</span>
				) : null}
				{leading}
				{status}
				{clickable ? (
					<CardChevron
						open={open}
						tooltip={chevronTooltip?.(open)}
						isFlat={isFlat}
					/>
				) : null}
			</div>
			{open && children != null ? (
				<div
					className={
						"card-body" +
						(isFlat ? " card-body--flat" : "") +
						(bodyClassName ? " " + bodyClassName : "")
					}
					ref={bodyRef}
					onScroll={handleBodyScroll}
				>
					{children}
				</div>
			) : null}
		</div>
	);
}

/** Chevron del header de CollapsibleCard, con tooltip opcional. */
function CardChevron({
	open,
	tooltip,
	isFlat,
}: {
	open: boolean;
	tooltip?: string;
	isFlat?: boolean;
}) {
	const chev = isFlat ? (
		<span className={"tool-flat-chevron" + (open ? " is-expanded" : "")}>
			<Codicon name="chevron-right" size={14} />
		</span>
	) : (
		<span className={"card-chev" + (open ? "" : " closed")}>
			<Icon name="chevron" size={12} />
		</span>
	);
	return tooltip ? (
		<Tooltip label={tooltip} side="top">
			{chev}
		</Tooltip>
	) : (
		chev
	);
}
