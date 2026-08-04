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
		["json", "yaml", "yml", "toml", "ini", "cfg", "conf", "env"].includes(ext)
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

/** Cuenta líneas (para assistedKloc). */
export function countLines(text: string | undefined | null): number {
	if (!text) return 0;
	const n = text.split("\n").length;
	return n > 0 ? n : 0;
}
