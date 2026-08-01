import { useState, type ReactNode } from "react";
import type { ResourceSummary } from "../types";
import { Tooltip } from "./Tooltip";
import { ChevronRight } from "lucide-react";

// Sección colapsable dentro del panel.
function Section({
	title,
	count,
	children,
}: {
	title: string;
	count: number;
	children: ReactNode;
}) {
	const [open, setOpen] = useState(true);
	if (count === 0) return null;
	return (
		<div className={"res-section" + (open ? "" : " collapsed")}>
			<div className="res-section-head" onClick={() => setOpen(!open)}>
				<span className="chev">
					<ChevronRight size={12} />
				</span>
				<span className="res-section-title">{title}</span>
				<span className="res-section-count">{count}</span>
			</div>
			{open && <div className="res-section-body">{children}</div>}
		</div>
	);
}

// Sección estática de referencia: dónde colocar cada tipo de recurso para que
// el descubrimiento propio ~/.frida (ADR-0010) lo cargue.
function LocationsSection() {
	const [open, setOpen] = useState(true);
	const Row = ({
		kind,
		global,
		project,
	}: {
		kind: string;
		global: string;
		project: string;
	}) => (
		<div className="res-loc-row">
			<div className="res-loc-kind">{kind}</div>
			<code className="res-loc-path">{global}</code>
			<span className="res-loc-sep">·</span>
			<code className="res-loc-path muted">{project}</code>
		</div>
	);
	return (
		<div className={"res-section locations" + (open ? "" : " collapsed")}>
			<div className="res-section-head" onClick={() => setOpen(!open)}>
				<span className="chev">
					<ChevronRight size={12} />
				</span>
				<span className="res-section-title">Dónde se cargan</span>
				<span className="res-section-count">ref</span>
			</div>
			{open && (
				<div className="res-section-body">
					<p className="res-loc-intro">
						Descubrimiento propio en <code>~/.frida</code> (ADR-0010).{" "}
						<code>global</code> = todos tus proyectos; <code>proyecto</code> =
						solo este (el proyecto aún usa <code>.pi</code>; recarga tras
						añadir).
					</p>
					<Row kind="Skills" global="~/.frida/skills/" project=".pi/skills/" />
					<Row
						kind="Prompts"
						global="~/.frida/prompts/"
						project=".pi/prompts/"
					/>
					<Row
						kind="Extensiones / MCP"
						global="~/.frida/extensions/"
						project=".pi/extensions/"
					/>
					<Row kind="Themes" global="~/.frida/themes/" project=".pi/themes/" />
					<div className="res-loc-row">
						<div className="res-loc-kind">Contexto</div>
						<code className="res-loc-path">AGENTS.md · CLAUDE.md</code>
						<span className="res-loc-sep">·</span>
						<code className="res-loc-path muted">~/.frida · padres · cwd</code>
					</div>
					<p className="res-loc-note">
						MCP no es nativo: se carga como <strong>extensión</strong> (un
						paquete que lo aporta). Tras colocar recursos, pulsa{" "}
						<code>Recargar</code>.
					</p>
				</div>
			)}
		</div>
	);
}

// Pinta un path recortando el home para que quepa.
function shortPath(p: string): string {
	return p.replace(/^\/Users\/[^/]+/, "~").replace(/^\/home\/[^/]+/, "~");
}

// Nombre legible de una extensión: si es inline "<inline:NAME>", devuelve NAME;
// si es de disco, el basename sin extensión.
function extName(p: string): string {
	const m = p.match(/^<inline:([^>]+)>$/);
	if (m) return m[1];
	const base = p.split(/[/\\]/).pop() ?? p;
	return base.replace(/\.(ts|js)$/, "");
}

// --- Procedencia (extensión / global / proyecto / built-in / path) ---
// Metadatos por origen: etiqueta legible + clase del punto de color. El orden
// fija el orden de los chips en la barra de filtros.
const ORIGIN_META: Record<string, { label: string; dot: string }> = {
	extension: { label: "extensión", dot: "src-extension" },
	global: { label: "global", dot: "src-global" },
	project: { label: "proyecto", dot: "src-project" },
	"built-in": { label: "built-in", dot: "src-built-in" },
	path: { label: "path", dot: "src-path" },
};
const ORIGIN_ORDER = ["extension", "global", "project", "built-in", "path"];

/** Punto de color que identifica el origen a simple vista. */
function SourceDot({ source }: { source: string }) {
	const meta = ORIGIN_META[source] ?? ORIGIN_META.path;
	return (
		<span
			className={"src-dot " + meta.dot}
			title={meta.label}
			aria-label={meta.label}
		/>
	);
}

/** Barra de filtros por origen. Sólo se renderiza si hay 2+ orígenes distintos
 *  (si todos son del mismo tipo, el filtro no aporta). Cada chip muestra el
 *  conteo; al hacer clic alterna (igual origen → vuelve a "Todos"). */
function SourceFilter({
	items,
	active,
	setActive,
}: {
	items: { source: string }[];
	active: string;
	setActive: (s: string) => void;
}) {
	const counts = new Map<string, number>();
	for (const it of items)
		counts.set(it.source, (counts.get(it.source) ?? 0) + 1);
	const distinct = ORIGIN_ORDER.filter((o) => counts.has(o));
	// Mostramos la barra siempre que haya ítems: aun con un solo origen actúa como
	// leyenda (te dice de dónde vienen y fija el color del punto) y deja el
	// filtro listo para cuando aparezca un segundo origen. Sin ítems → oculta.
	if (items.length === 0) return null;
	return (
		<div className="src-filter">
			<button
				className={"src-chip" + (active === "all" ? " active" : "")}
				onClick={() => setActive("all")}
			>
				Todos {items.length}
			</button>
			{distinct.map((o) => (
				<button
					key={o}
					className={"src-chip" + (active === o ? " active" : "")}
					onClick={() => setActive(active === o ? "all" : o)}
				>
					<span className={"src-dot " + ORIGIN_META[o].dot} />
					{ORIGIN_META[o].label} {counts.get(o)}
				</button>
			))}
		</div>
	);
}

export function ResourcesContent({ res }: { res: ResourceSummary }) {
	// Filtros por origen (uno por sección con múltiples orígenes). "all" = sin filtro.
	const [skillFilter, setSkillFilter] = useState("all");
	const [cmdFilter, setCmdFilter] = useState("all");
	const skills = res.skills.filter(
		(s) => skillFilter === "all" || s.source === skillFilter,
	);
	const commands = res.commands.filter(
		(c) => cmdFilter === "all" || c.source === cmdFilter,
	);
	return (
		<div className="resources-content">
			<div className="sessions-list">
				<Section title="Extensiones" count={res.extensions.length}>
					{res.extensions.map((e, i) => {
						const pills = [
							...(e.tools ?? []).map((t) => ({ k: "tool", v: t })),
							...(e.commands ?? []).map((c) => ({ k: "cmd", v: c })),
						];
						return (
							<div key={i} className="res-item">
								<Tooltip label={shortPath(e.path)} side="top">
									<div className="res-item-name">
										{e.inline ? (
											<span className="tag inline">inline</span>
										) : (
											<span className="tag">ext</span>
										)}
										<span className="ext-name">{extName(e.path)}</span>
									</div>
								</Tooltip>
								{pills.length > 0 && (
									<div className="res-item-pills">
										{pills.map((p, j) => (
											<span key={j} className="tag tool">
												<span className="tag-k">{p.k}</span>
												{p.v}
											</span>
										))}
									</div>
								)}
							</div>
						);
					})}
				</Section>

				<Section title="Comandos" count={res.commands.length}>
					<SourceFilter
						items={res.commands}
						active={cmdFilter}
						setActive={setCmdFilter}
					/>
					{commands.map((c, i) => (
						<div key={i} className="res-item">
							<div className="res-item-name">
								<SourceDot source={c.source} />
								<code>/{c.name}</code>
								{c.argumentHint && (
									<span className="cmd-arg">{c.argumentHint}</span>
								)}
								{c.source === "extension" && c.extension && (
									<span className="tag">{c.extension}</span>
								)}
							</div>
							{c.description && (
								<div className="res-item-meta">{c.description}</div>
							)}
						</div>
					))}
				</Section>

				<Section title="Skills" count={res.skills.length}>
					<SourceFilter
						items={res.skills}
						active={skillFilter}
						setActive={setSkillFilter}
					/>
					{skills.map((s, i) => (
						<div key={i} className="res-item">
							<div className="res-item-name">
								<SourceDot source={s.source} />
								<code>{s.name || "skill"}</code>
							</div>
							{s.description && (
								<div className="res-item-meta">{s.description}</div>
							)}
							{s.path && (
								<div className="res-item-meta muted">{shortPath(s.path)}</div>
							)}
						</div>
					))}
				</Section>

				<Section title="Prompts" count={res.prompts.length}>
					{res.prompts.map((p, i) => (
						<div key={i} className="res-item">
							<div className="res-item-name">
								<code>/{p.name}</code>
							</div>
							{p.description && (
								<div className="res-item-meta">{p.description}</div>
							)}
						</div>
					))}
				</Section>

				<Section title="Themes" count={res.themes.length}>
					{res.themes.map((t, i) => (
						<div key={i} className="res-item">
							<div className="res-item-name">{t.name}</div>
						</div>
					))}
				</Section>

				<Section
					title="Contexto (AGENTS.md / CLAUDE.md)"
					count={res.contextFiles.length}
				>
					{res.contextFiles.map((f, i) => (
						<div key={i} className="res-item">
							<div className="res-item-name">
								<code>{shortPath(f.path)}</code>
							</div>
						</div>
					))}
				</Section>

				<Section title="Errores" count={res.errors.length}>
					{res.errors.map((e, i) => (
						<div key={i} className="res-item err">
							<div className="res-item-name">
								<code>{shortPath(e.path)}</code>
							</div>
							<div className="res-item-meta">{e.error}</div>
						</div>
					))}
				</Section>

				<LocationsSection />
			</div>
		</div>
	);
}
