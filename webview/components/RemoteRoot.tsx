import type { ComponentType, ReactNode, CSSProperties } from "react";
import type { WebNode } from "../types";
import { Markdown } from "./Markdown";
import {
	Check,
	ChevronDown,
	ChevronRight,
	Circle,
	CircleStop,
	LoaderCircle,
	RotateCw,
	Square,
	X,
} from "lucide-react";

/** Registro nombre-lucide (kebab) → componente. `ficon` lo consulta por `name`. */
const F_ICONS: Record<
	string,
	ComponentType<{
		size?: number;
		color?: string;
		strokeWidth?: number;
		className?: string;
	}>
> = {
	circle: Circle,
	"loader-circle": LoaderCircle,
	check: Check,
	x: X,
	"circle-stop": CircleStop,
	square: Square,
	"chevron-down": ChevronDown,
	"chevron-right": ChevronRight,
	"rotate-cw": RotateCw,
};

// Renderer espejo de Remote React (opción A). Recibe el árbol WebNode serializado
// por el host (web-renderer.ts) y lo materializa en DOM real, mapeando tipos de
// host (fbox/ftext/fbutton/…) a elementos HTML. Los handlers viajan como IDs
// ("h#N") en props; aquí se envuelven para emitir web_event al host, que ejecuta
// la fn real y re-renderiza → nuevo commit.
//
// Esto es el "otro extremo" del custom renderer: el host produce el árbol, el
// webview lo consume. React no está involucrado en el host para esto (allí corre
// el reconciler custom); aquí sí usamos React para pintar, pero de forma puramente
// declarativa a partir del árbol recibido.

interface RemoteRootProps {
	tree: WebNode | null;
	rootId: string;
	/** Emite el evento al host (postMessage web_event). */
	onEvent: (
		handlerId: string,
		payload: { value?: string; checked?: boolean },
	) => void;
}

export function RemoteRoot({ tree, onEvent }: RemoteRootProps): ReactNode {
	if (!tree) return null;
	return renderNode(tree, onEvent);
}

function isHandlerId(v: unknown): v is string {
	return typeof v === "string" && v.startsWith("h#");
}

/** Aplana children (strings/WebNode anidados) a un solo string — para fmarkdown. */
function flattenText(children: Array<WebNode | string>): string {
	return children
		.map((c) => (typeof c === "string" ? c : flattenText(c.children)))
		.join("");
}

/** Convierte las props serializadas en props DOM, envolviendo los handlerId. */
function materializeProps(
	props: Record<string, unknown>,
	onEvent: (
		handlerId: string,
		payload: { value?: string; checked?: boolean },
	) => void,
): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(props)) {
		if (isHandlerId(v)) {
			const handlerId = v;
			out[k] = (e: any) => {
				// onChange/onSubmit esperan value; onClick ninguno.
				const payload =
					k === "onChange" || k === "onSubmit"
						? { value: e?.target?.value ?? "" }
						: k === "onSelect"
							? { value: String(e ?? "") }
							: {};
				onEvent(handlerId, payload);
			};
		} else {
			out[k] = v;
		}
	}
	return out;
}

/** Sólo los event handlers (claves on* que son handlerIds) — para fbox, que ya
 *  aplica su style de layout aparte y no quiere que los props de layout pisén el DOM. */
function pickEventHandlers(
	props: Record<string, unknown>,
	onEvent: (
		handlerId: string,
		payload: { value?: string; checked?: boolean },
	) => void,
): Record<string, () => void> {
	const out: Record<string, () => void> = {};
	for (const [k, v] of Object.entries(props)) {
		if (k.startsWith("on") && isHandlerId(v)) {
			const handlerId = v;
			out[k] = () => onEvent(handlerId, {});
		}
	}
	return out;
}

function flexStyle(props: Record<string, unknown>): CSSProperties {
	const s: CSSProperties = { display: "flex" };
	s.flexDirection = props.flexDirection === "row" ? "row" : "column";
	if (typeof props.flex === "number") s.flex = props.flex;
	if (typeof props.gap === "number") s.gap = props.gap;
	if (typeof props.padding === "number") s.padding = props.padding;
	if (typeof props.margin === "number") s.margin = props.margin;
	if (typeof props.alignItems === "string")
		s.alignItems = props.alignItems as any;
	if (typeof props.justifyContent === "string")
		s.justifyContent = props.justifyContent as any;
	if (typeof props.background === "string") s.background = props.background;
	if (typeof props.height === "number") s.height = props.height;
	if (typeof props.overflow === "string") s.overflow = props.overflow;
	return s;
}

function textStyle(props: Record<string, unknown>): CSSProperties {
	const s: CSSProperties = {};
	if (props.bold) s.fontWeight = 700;
	if (typeof props.color === "string") s.color = props.color;
	if (typeof props.size === "number") s.fontSize = props.size;
	if (props.wrap === false) s.whiteSpace = "nowrap";
	if (props.strike) s.textDecoration = "line-through";
	return s;
}

function renderNode(
	node: WebNode | string,
	onEvent: (
		handlerId: string,
		payload: { value?: string; checked?: boolean },
	) => void,
): ReactNode {
	if (typeof node === "string") return node;
	const domProps = materializeProps(node.props, onEvent);
	const children = node.children.map((c, i) => (
		<span key={i} style={{ display: "contents" }}>
			{renderNode(c, onEvent)}
		</span>
	));

	switch (node.type) {
		case "fbox": {
			// style de layout va aparte (flexDirection/gap/...); los handlers (onMouseEnter,
			// etc.) viajan en props como handlerIds → los extraemos sin pisar el style.
			// bordered/tone controlan la decoración (tarjeta / destaque) sin pisar el layout.
			const handlers = pickEventHandlers(node.props, onEvent);
			const cls =
				"fbox" +
				(node.props.bordered ? " bordered" : "") +
				(node.props.tone === "active" ? " tone-active" : "") +
				(typeof node.props.cls === "string" && node.props.cls
					? " " + node.props.cls
					: "");
			return (
				<div className={cls} style={flexStyle(node.props)} {...handlers}>
					{children}
				</div>
			);
		}
		case "ftext": {
			const textCls =
				"ftext" +
				(typeof node.props.cls === "string" && node.props.cls
					? " " + node.props.cls
					: "");
			return (
				<span className={textCls} style={textStyle(node.props)}>
					{children}
				</span>
			);
		}
		case "fbutton": {
			const variant = node.props.variant ?? "primary";
			// Filtramos props no-DOM (variant/cls) del spread para que no filtren al
			// <button> como atributos inválidos.
			const btnProps = { ...domProps } as Record<string, unknown>;
			delete btnProps.variant;
			delete btnProps.cls;
			const btnCls =
				"fbutton " +
				variant +
				(typeof node.props.cls === "string" && node.props.cls
					? " " + node.props.cls
					: "");
			return (
				<button
					type="button"
					className={btnCls}
					disabled={!!node.props.disabled}
					{...btnProps}
				>
					{children}
				</button>
			);
		}
		case "finput":
			return <input className="finput" {...domProps} />;
		case "fselect": {
			const options = Array.isArray(node.props.options)
				? (node.props.options as string[])
				: [];
			return (
				<ul className="fselect">
					{options.map((opt, i) => (
						<li key={`${opt}-${i}`}>
							<button
								type="button"
								className="fselect-option"
								onClick={() => {
									const h = node.props.onSelect;
									if (isHandlerId(h)) onEvent(h, { value: opt });
								}}
							>
								{opt}
							</button>
						</li>
					))}
				</ul>
			);
		}
		case "fmarkdown": {
			// children del WebNode son strings/arrays; los aplanamos a un string markdown
			// y lo delegamos al renderer del webview (react-markdown + gfm + highlight).
			return <Markdown>{flattenText(node.children)}</Markdown>;
		}
		case "ficon": {
			// Icono lucide por nombre. El host sólo pasa `name` (+size/color/cls);
			// el webview es quien tiene lucide-react y materializa el SVG. `cls` se
			// aplica como className (ej. "spinner" para rotar el loader-circle).
			const name = typeof node.props.name === "string" ? node.props.name : "";
			const Icon = F_ICONS[name];
			if (!Icon) return null;
			const ip: {
				size?: number;
				color?: string;
				strokeWidth?: number;
				className?: string;
			} = {};
			if (typeof node.props.size === "number") ip.size = node.props.size;
			if (typeof node.props.color === "string") ip.color = node.props.color;
			if (typeof node.props.strokeWidth === "number")
				ip.strokeWidth = node.props.strokeWidth;
			const cls =
				typeof node.props.cls === "string" && node.props.cls
					? node.props.cls
					: "";
			if (cls) ip.className = cls;
			return <Icon {...ip} />;
		}
		default:
			return (
				<div className="funknown" data-type={node.type}>
					{children}
				</div>
			);
	}
}
