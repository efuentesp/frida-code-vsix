import { useRef, useState, type ReactNode } from "react";

// Tooltip fiable para webviews de VS Code, donde el `title` nativo es
// inconsistente. Muestra un globo al hover/focus con un pequeño delay.
export function Tooltip({
	label,
	side = "top",
	wide = false,
	children,
}: {
	label: string;
	side?: "top" | "bottom" | "bottom-right" | "bottom-left";
	wide?: boolean;
	children: ReactNode;
}) {
	const [show, setShow] = useState(false);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

	function schedule(on: boolean) {
		if (timer.current) clearTimeout(timer.current);
		if (on) {
			timer.current = setTimeout(() => setShow(true), 300);
		} else {
			setShow(false);
		}
	}

	return (
		<span
			className="tip-wrap"
			onMouseEnter={() => schedule(true)}
			onMouseLeave={() => schedule(false)}
			onFocus={() => schedule(true)}
			onBlur={() => schedule(false)}
		>
			{children}
			{show && (
				<span
					className={"tip tip-" + side + (wide ? " tip-wide" : "")}
					role="tooltip"
				>
					{label}
				</span>
			)}
		</span>
	);
}
