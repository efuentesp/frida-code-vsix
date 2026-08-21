import { useState, type ReactNode } from "react";
import type { OutMessage, ResourceSummary } from "../types";
import { Tooltip } from "./Tooltip";
import { Codicon } from "./Codicon";

// Sección colapsable con Codicons nativos de VS Code.
function Section({
	title,
	count,
	iconName,
	children,
}: {
	title: string;
	count: number;
	iconName: string;
	children: ReactNode;
}) {
	const [open, setOpen] = useState(true);
	if (count === 0) return null;
	return (
		<div className={"res-section" + (open ? "" : " collapsed")}>
			<div className="res-section-head" onClick={() => setOpen(!open)}>
				<Codicon
					name={open ? "chevron-down" : "chevron-right"}
					size={12}
					className="res-chev"
				/>
				<Codicon name={iconName} size={14} className="res-section-icon" />
				<span className="res-section-title">{title}</span>
				<span className="res-section-count">{count}</span>
			</div>
			{open && <div className="res-section-body">{children}</div>}
		</div>
	);
}

// Sección estática de referencia: dónde colocar cada tipo de recurso
function LocationsSection() {
	const [open, setOpen] = useState(true);
	const [copiedKey, setCopiedKey] = useState<string | null>(null);

	const copyPath = (key: string, text: string) => {
		if (typeof navigator !== "undefined" && navigator.clipboard) {
			navigator.clipboard.writeText(text).catch(() => undefined);
			setCopiedKey(key);
			setTimeout(() => setCopiedKey(null), 1500);
		}
	};

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
			<div className="res-loc-paths">
				<button
					type="button"
					className="res-loc-path-btn"
					onClick={() => copyPath(`${kind}-g`, global)}
					title="Copiar ruta global"
				>
					<code>{global}</code>
					<Codicon
						name={copiedKey === `${kind}-g` ? "check" : "copy"}
						size={11}
					/>
				</button>
				<span className="res-loc-sep">·</span>
				<button
					type="button"
					className="res-loc-path-btn muted"
					onClick={() => copyPath(`${kind}-p`, project)}
					title="Copiar ruta de proyecto"
				>
					<code>{project}</code>
					<Codicon
						name={copiedKey === `${kind}-p` ? "check" : "copy"}
						size={11}
					/>
				</button>
			</div>
		</div>
	);

	return (
		<div className={"res-section locations" + (open ? "" : " collapsed")}>
			<div className="res-section-head" onClick={() => setOpen(!open)}>
				<Codicon
					name={open ? "chevron-down" : "chevron-right"}
					size={12}
					className="res-chev"
				/>
				<Codicon name="folder-opened" size={14} className="res-section-icon" />
				<span className="res-section-title">Dónde se cargan</span>
				<span className="res-section-count">guía</span>
			</div>
			{open && (
				<div className="res-section-body">
					<p className="res-loc-intro">
						Descubrimiento automático en <code>~/.frida</code> y{" "}
						<code>.pi</code>. <code>global</code> = disponible en todos tus
						proyectos; <code>proyecto</code> = exclusivo de este repositorio.
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
						<div className="res-loc-paths">
							<code className="res-loc-path">AGENTS.md · CLAUDE.md</code>
							<span className="res-loc-sep">·</span>
							<code className="res-loc-path muted">~/.frida · padres · cwd</code>
						</div>
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

// Metadatos por origen de recurso
const ORIGIN_META: Record<string, { label: string; cls: string; icon: string }> =
	{
		extension: { label: "extensión", cls: "src-extension", icon: "extensions" },
		global: { label: "global", cls: "src-global", icon: "globe" },
		project: { label: "proyecto", cls: "src-project", icon: "folder" },
		"built-in": { label: "built-in", cls: "src-built-in", icon: "lock" },
		path: { label: "path", cls: "src-path", icon: "file" },
	};
const ORIGIN_ORDER = ["extension", "global", "project", "built-in", "path"];

/** Badge visual de procedencia */
function SourceBadge({ source }: { source: string }) {
	const meta = ORIGIN_META[source] ?? ORIGIN_META.path;
	return (
		<span className={"res-tag-origin " + meta.cls} title={meta.label}>
			<Codicon name={meta.icon} size={10} />
			<span>{meta.label}</span>
		</span>
	);
}

/** Barra de filtros por origen */
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
	if (items.length === 0) return null;
	return (
		<div className="src-filter">
			<button
				type="button"
				className={"src-chip" + (active === "all" ? " active" : "")}
				onClick={() => setActive("all")}
			>
				Todos {items.length}
			</button>
			{distinct.map((o) => (
				<button
					key={o}
					type="button"
					className={"src-chip" + (active === o ? " active" : "")}
					onClick={() => setActive(active === o ? "all" : o)}
				>
					<Codicon name={ORIGIN_META[o].icon} size={11} />
					<span>{ORIGIN_META[o].label}</span>
					<span className="src-chip-count">{counts.get(o)}</span>
				</button>
			))}
		</div>
	);
}

export function ResourcesContent({
	res,
	post,
	onInsertText,
}: {
	res: ResourceSummary;
	post?: (m: OutMessage) => void;
	onInsertText?: (text: string) => void;
}) {
	const [skillFilter, setSkillFilter] = useState("all");
	const [cmdFilter, setCmdFilter] = useState("all");
	const [copiedPath, setCopiedPath] = useState<string | null>(null);

	const skills = res.skills.filter(
		(s) => skillFilter === "all" || s.source === skillFilter,
	);
	const commands = res.commands.filter(
		(c) => cmdFilter === "all" || c.source === cmdFilter,
	);

	const handleUseSkill = (skillName: string) => {
		const text = `/skill:${skillName}`;
		if (onInsertText) {
			onInsertText(text);
		} else if (post) {
			post({ type: "copy_text", text });
		}
	};

	const handleInsertCommand = (cmdName: string) => {
		const text = `/${cmdName}`;
		if (onInsertText) {
			onInsertText(text);
		} else if (post) {
			post({ type: "copy_text", text });
		}
	};

	const handleCopyPath = (p: string) => {
		if (typeof navigator !== "undefined" && navigator.clipboard) {
			navigator.clipboard.writeText(p).catch(() => undefined);
			setCopiedPath(p);
			setTimeout(() => setCopiedPath(null), 1500);
		}
	};

	return (
		<div className="resources-content">
			<div className="sessions-list">
				{/* 1. Extensiones */}
				<Section
					title="Extensiones"
					count={res.extensions.length}
					iconName="extensions"
				>
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

				{/* 2. Skills */}
				<Section title="Skills" count={res.skills.length} iconName="sparkle">
					<SourceFilter
						items={res.skills}
						active={skillFilter}
						setActive={setSkillFilter}
					/>
					{skills.map((s, i) => (
						<div key={i} className="res-item">
							<div className="res-item-head-row">
								<div className="res-item-name">
									<SourceBadge source={s.source} />
									<code className="res-code-name">{s.name}</code>
								</div>
								<button
									type="button"
									className="res-use-btn"
									onClick={() => handleUseSkill(s.name)}
									title={`Insertar /skill:${s.name} en el chat`}
								>
									<Codicon name="play" size={11} />
									<span>Usar</span>
								</button>
							</div>
							{s.description && (
								<div className="res-item-meta">{s.description}</div>
							)}
							{s.path && (
								<div className="res-item-meta muted">
									<code>{shortPath(s.path)}</code>
								</div>
							)}
						</div>
					))}
				</Section>

				{/* 3. Comandos */}
				<Section
					title="Comandos"
					count={res.commands.length}
					iconName="terminal"
				>
					<SourceFilter
						items={res.commands}
						active={cmdFilter}
						setActive={setCmdFilter}
					/>
					{commands.map((c, i) => (
						<div key={i} className="res-item">
							<div className="res-item-head-row">
								<div className="res-item-name">
									<SourceBadge source={c.source} />
									<code className="res-code-name">/{c.name}</code>
									{c.argumentHint && (
										<span className="cmd-arg">{c.argumentHint}</span>
									)}
									{c.source === "extension" && c.extension && (
										<span className="tag">{c.extension}</span>
									)}
								</div>
								<button
									type="button"
									className="res-use-btn"
									onClick={() => handleInsertCommand(c.name)}
									title={`Insertar /${c.name} en el chat`}
								>
									<Codicon name="add" size={11} />
									<span>Insertar</span>
								</button>
							</div>
							{c.description && (
								<div className="res-item-meta">{c.description}</div>
							)}
						</div>
					))}
				</Section>

				{/* 4. Prompts */}
				<Section title="Prompts" count={res.prompts.length} iconName="book">
					{res.prompts.map((p, i) => (
						<div key={i} className="res-item">
							<div className="res-item-head-row">
								<div className="res-item-name">
									<code className="res-code-name">/{p.name}</code>
								</div>
								<button
									type="button"
									className="res-use-btn"
									onClick={() => handleInsertCommand(p.name)}
									title={`Insertar /${p.name} en el chat`}
								>
									<Codicon name="add" size={11} />
									<span>Insertar</span>
								</button>
							</div>
							{p.description && (
								<div className="res-item-meta">{p.description}</div>
							)}
						</div>
					))}
				</Section>

				{/* 5. Themes */}
				<Section title="Themes" count={res.themes.length} iconName="paintcan">
					{res.themes.map((t, i) => (
						<div key={i} className="res-item">
							<div className="res-item-name">
								<Codicon name="color-mode" size={13} />
								<span>{t.name}</span>
							</div>
						</div>
					))}
				</Section>

				{/* 6. Contexto */}
				<Section
					title="Contexto (AGENTS.md / CLAUDE.md)"
					count={res.contextFiles.length}
					iconName="file-code"
				>
					{res.contextFiles.map((f, i) => (
						<div key={i} className="res-item">
							<div className="res-item-head-row">
								<div className="res-item-name">
									<Codicon name="file-text" size={13} />
									<code>{shortPath(f.path)}</code>
								</div>
								<button
									type="button"
									className="res-use-btn"
									onClick={() => handleCopyPath(f.path)}
									title={f.path}
								>
									<Codicon
										name={copiedPath === f.path ? "check" : "go-to-file"}
										size={11}
									/>
									<span>{copiedPath === f.path ? "Copiado" : "Abrir"}</span>
								</button>
							</div>
						</div>
					))}
				</Section>

				{/* 7. Errores */}
				<Section title="Errores" count={res.errors.length} iconName="error">
					{res.errors.map((e, i) => (
						<div key={i} className="res-item err">
							<div className="res-item-name">
								<Codicon name="warning" size={13} />
								<code>{shortPath(e.path)}</code>
							</div>
							<div className="res-item-meta">{e.error}</div>
						</div>
					))}
				</Section>

				{/* 8. Dónde se cargan */}
				<LocationsSection />
			</div>
		</div>
	);
}
