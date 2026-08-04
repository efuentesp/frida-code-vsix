// Clasificador de artefactos: extensión de path → lenguaje/tipo. Usado por el
// indexer para byLanguage/byArtifact y assistedKloc (write/edit).

export type ArtifactKind =
	| "markdown"
	| "code"
	| "config"
	| "doc"
	| "data"
	| "other";

/** Extensión (sin punto, lowercase) → lenguaje canónico. */
const EXT_TO_LANG: Record<string, string> = {
	ts: "typescript",
	tsx: "typescript",
	mts: "typescript",
	cts: "typescript",
	js: "javascript",
	jsx: "javascript",
	mjs: "javascript",
	cjs: "javascript",
	py: "python",
	pyi: "python",
	go: "go",
	rs: "rust",
	java: "java",
	kt: "kotlin",
	kts: "kotlin",
	scala: "scala",
	clj: "clojure",
	cljs: "clojure",
	ex: "elixir",
	exs: "elixir",
	heex: "elixir",
	erl: "erlang",
	rb: "ruby",
	php: "php",
	c: "c",
	h: "c",
	cpp: "cpp",
	cc: "cpp",
	cxx: "cpp",
	hpp: "cpp",
	cs: "csharp",
	vb: "vb",
	fs: "fsharp",
	swift: "swift",
	m: "objc",
	mm: "objc",
	lua: "lua",
	md: "markdown",
	mdx: "markdown",
	markdown: "markdown",
	r: "r",
	dart: "dart",
	elm: "elm",
	hs: "haskell",
	ml: "ocaml",
	vim: "vim",
	html: "html",
	htm: "html",
	xml: "xml",
	svg: "xml",
	css: "css",
	scss: "css",
	sass: "css",
	less: "css",
	vue: "vue",
	svelte: "svelte",
	astro: "astro",
	json: "json",
	jsonc: "json",
	yaml: "yaml",
	yml: "yaml",
	toml: "toml",
	ini: "ini",
	cfg: "ini",
	conf: "ini",
	sql: "sql",
	graphql: "graphql",
	gql: "graphql",
	sh: "shell",
	bash: "shell",
	zsh: "shell",
	fish: "shell",
	ps1: "powershell",
	bat: "batch",
	cmd: "batch",
	proto: "protobuf",
};

function extOf(filePath: string): string {
	const base = (filePath.split(/[/\\]/).pop() ?? filePath).toLowerCase();
	if (base === "dockerfile") return "dockerfile";
	if (base === "makefile") return "makefile";
	const i = base.lastIndexOf(".");
	return i >= 0 ? base.slice(i + 1) : "";
}

/** Clasifica un path a un lenguaje canónico (o "other"). */
export function classifyLanguage(filePath: string): string {
	return EXT_TO_LANG[extOf(filePath)] ?? "other";
}

/** Clasifica un path a un tipo de artefacto para byArtifact. */
export function classifyArtifactKind(filePath: string): ArtifactKind {
	const ext = extOf(filePath);
	if (ext === "md" || ext === "mdx" || ext === "markdown") return "markdown";
	if (
		[
			"json",
			"yaml",
			"yml",
			"toml",
			"ini",
			"cfg",
			"conf",
			"env",
			"gitignore",
			"gitattributes",
			"editorconfig",
			"npmrc",
			"nvmrc",
			"prettierrc",
			"eslintrc",
			"babelrc",
			"example",
			"envrc",
			"dockerfile",
			"makefile",
		].includes(ext)
	)
		return "config";
	if (["sql", "csv", "tsv"].includes(ext)) return "data";
	if (ext in EXT_TO_LANG) return "code";
	const p = filePath.toLowerCase();
	if (
		p.includes("license") ||
		p.includes("changelog") ||
		p.includes("readme") ||
		ext === "txt"
	)
		return "doc";
	return "other";
}

/** Extensión → familia legible (más fina que EXT_TO_LANG: distingue ts de tsx). */
const EXT_FAMILY: Record<string, string> = {
	ts: "TypeScript",
	tsx: "TypeScript JSX",
	mts: "TypeScript (módulo)",
	cts: "TypeScript (módulo)",
	js: "JavaScript",
	jsx: "JavaScript JSX",
	mjs: "JavaScript (módulo)",
	cjs: "JavaScript (CommonJS)",
	py: "Python",
	pyi: "Python (stubs)",
	go: "Go",
	rs: "Rust",
	java: "Java",
	kt: "Kotlin",
	kts: "Kotlin (script)",
	scala: "Scala",
	clj: "Clojure",
	cljs: "ClojureScript",
	ex: "Elixir",
	exs: "Elixir (script)",
	heex: "Elixir (HEEx)",
	erl: "Erlang",
	rb: "Ruby",
	php: "PHP",
	c: "C",
	h: "C (header)",
	cpp: "C++",
	cc: "C++",
	cxx: "C++",
	hpp: "C++ (header)",
	cs: "C#",
	vb: "Visual Basic",
	fs: "F#",
	swift: "Swift",
	m: "Objective-C",
	mm: "Objective-C++",
	lua: "Lua",
	r: "R",
	dart: "Dart",
	elm: "Elm",
	hs: "Haskell",
	ml: "OCaml",
	vim: "Vimscript",
	html: "HTML",
	htm: "HTML",
	xml: "XML",
	svg: "SVG",
	css: "CSS",
	scss: "SCSS",
	sass: "Sass",
	less: "Less",
	vue: "Vue",
	svelte: "Svelte",
	astro: "Astro",
	json: "JSON",
	jsonc: "JSON (comentarios)",
	yaml: "YAML",
	yml: "YAML",
	toml: "TOML",
	ini: "INI",
	cfg: "Config (cfg)",
	conf: "Config (conf)",
	sql: "SQL",
	graphql: "GraphQL",
	gql: "GraphQL",
	sh: "Shell",
	bash: "Bash",
	zsh: "Zsh",
	fish: "Fish",
	ps1: "PowerShell",
	bat: "Batch",
	cmd: "Batch (cmd)",
	proto: "Protobuf",
	md: "Markdown",
	mdx: "MDX",
	markdown: "Markdown",
	dockerfile: "Dockerfile",
	makefile: "Makefile",
	env: "Variables de entorno",
	envrc: "direnv",
	gitignore: "Git ignore",
	gitattributes: "Git attributes",
	editorconfig: "EditorConfig",
	npmrc: "npm config",
	nvmrc: "Node version",
	prettierrc: "Prettier config",
	eslintrc: "ESLint config",
	babelrc: "Babel config",
	example: "Ejemplo (template)",
};

/** Extensiones consideradas frontend (para la categoría del tooltip). */
const FRONTEND_EXTS = new Set([
	"tsx",
	"jsx",
	"vue",
	"svelte",
	"astro",
	"html",
	"htm",
	"css",
	"scss",
	"sass",
	"less",
]);

/** Tipo de archivo = extensión con punto (".ts", ".tsx", ".md").
 *  Sin extensión → "(sin ext)". Sin agrupar (a diferencia de classifyLanguage). */
export function classifyFileType(filePath: string): string {
	const ext = extOf(filePath);
	return ext ? "." + ext : "(sin ext)";
}

/** Categoría del archivo para el tooltip (frontend | backend | docs | config | data | otros). */
function fileTypeCategory(filePath: string): string {
	const ext = extOf(filePath);
	const kind = classifyArtifactKind(filePath);
	if (kind === "markdown" || kind === "doc") return "docs";
	if (kind === "config") return "config";
	if (kind === "data") return "data";
	if (kind === "code") return FRONTEND_EXTS.has(ext) ? "frontend" : "backend";
	return "otros";
}

/** Familia legible + categoría para el tooltip (ej "TypeScript JSX · frontend"). */
export function fileTypeFamily(filePath: string): string {
	const ext = extOf(filePath);
	const family = EXT_FAMILY[ext] ?? "Otros";
	return `${family} · ${fileTypeCategory(filePath)}`;
}

/** Cuenta líneas (para assistedKloc). */
export function countLines(text: string | undefined | null): number {
	if (!text) return 0;
	const n = text.split("\n").length;
	return n > 0 ? n : 0;
}
