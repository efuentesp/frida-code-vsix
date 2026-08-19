/**
 * Atribución de recursos a módulos frida (issue #54).
 *
 * Dado lo que el resource loader ve (extensiones con tools/comandos, skills,
 * prompts, errores) decide a qué módulo pertenece cada recurso — un toggle
 * (#53) o un módulo base — para pintarlo en el acordeón de Configuración >
 * Herramientas. Lo que no pertenece a un módulo frida (extensiones externas,
 * skills globales/proyecto, comandos built-in) queda "general" y se muestra
 * en Recursos.
 *
 * Puro (sin vscode/fs): el host pre-resuelve realpaths y alimenta los sets;
 * este módulo solo cruza strings → testeable directo con fixtures.
 *
 * Reglas (en orden):
 * 1. tools/comandos: por factory del loader (`<inline:frida-subagents>` o
 *    basename) → join con TOOL_TOGGLES.factory / TOOL_TOGGLE_BASES.
 * 2. skills: (a) registradas por cc-plugins (namespaced `<plugin>-<nombre>`),
 *    (b) bundled del pipeline (agentes empaquetados), (c) realpath dentro del
 *    paquete pi-llm-wiki (KB materializa symlinks). El resto → general.
 * 3. prompts: prefijos de módulo (`wiki-` de la KB); el resto → general.
 * 4. errores: por path/realpath con las mismas reglas (2); huérfanos → general.
 */
import {
	TOOL_TOGGLE_BASES,
	TOOL_TOGGLE_KEY_BY_FACTORY,
	TOOL_TOGGLES,
	type ToolToggleBaseDef,
} from "./tool-toggles";

/** Extensión del loader tal como la colecta el host. */
export interface AttribExtension {
	path: string;
	inline: boolean;
	tools: string[];
	commands: string[];
}

/** Skill con realpath pre-resuelto por el host (best-effort = path). */
export interface AttribSkill {
	name: string;
	path: string;
	realPath: string;
	description: string;
	source: string;
}

/** Entradas de atribución ya resueltas por el host. */
export interface AttributionInput {
	extensions: AttribExtension[];
	skills: AttribSkill[];
	prompts: { name: string; description: string }[];
	errors: { path: string; error: string }[];
	/** Skills bundled del pipeline (agentes empaquetados, skills-sync). */
	bundledSkillNames: ReadonlySet<string>;
	/** Skill names registradas por cc-plugins (namespaced). */
	ccSkillNames: ReadonlySet<string>;
	/** Prefijos de realpath del paquete KB (pi-llm-wiki instalado on-demand). */
	kbRealPathPrefixes: readonly string[];
}

/** Recursos de un módulo (toggle o base) para el acordeón. */
export interface ModuleResources {
	/** key del toggle (#53) o factory para los base. */
	module: string;
	title: string;
	desc: string;
	/** true si es conmutable (toggle #53); false = módulo base. */
	toggleable: boolean;
	tools: string[];
	commands: string[];
	skills: string[];
	prompts: string[];
	errors: { path: string; error: string }[];
}

/** Lo que NO pertenece a un módulo frida → se queda en Recursos. */
export interface GeneralResources {
	/** Extensiones externas (de disco ~/.frida o .frida del proyecto). */
	extensions: AttribExtension[];
	/** Skills globales/proyecto no atribuidas a un módulo. */
	skills: AttribSkill[];
	/** Prompts no atribuidos. */
	prompts: { name: string; description: string }[];
	/** Errores huérfanos. */
	errors: { path: string; error: string }[];
}

export interface AttributionResult {
	modules: ModuleResources[];
	general: GeneralResources;
}

/** Nombre legible de factory: `<inline:NAME>` → NAME; si no, basename sin ext. */
export function factoryNameOf(extPath: string): string {
	const m = extPath.match(/^<inline:([^>]+)>$/);
	if (m) return m[1];
	const base = extPath.split(/[/\\]/).pop() ?? extPath;
	return base.replace(/\.(ts|js)$/, "");
}

/** Prefijos de prompt que pertenecen a un módulo (key del toggle). */
const PROMPT_PREFIX_MODULE: readonly [prefix: string, module: string][] = [
	["wiki-", "knowledgeBase"],
];

/**
 * Atribuye todos los recursos. Los módulos del resultado SIEMPRE incluyen los
 * 15 toggles + los base (aunque no tengan recursos: el acordeón los lista) en
 * el orden del registro; los recursos de extensiones desconocidas quedan en
 * general.
 */
export function attributeResources(input: AttributionInput): AttributionResult {
	// Inicializa módulos en orden de registro (toggles primero, luego bases).
	const byModule = new Map<string, ModuleResources>();
	for (const t of TOOL_TOGGLES) {
		byModule.set(t.key, {
			module: t.key,
			title: t.title,
			desc: t.desc,
			toggleable: true,
			tools: [],
			commands: [],
			skills: [],
			prompts: [],
			errors: [],
		});
	}
	const baseByFactory = new Map<string, ToolToggleBaseDef>(
		TOOL_TOGGLE_BASES.map((b) => [b.factory, b]),
	);
	for (const b of TOOL_TOGGLE_BASES) {
		byModule.set(b.factory, {
			module: b.factory,
			title: b.title,
			desc: b.desc,
			toggleable: false,
			tools: [],
			commands: [],
			skills: [],
			prompts: [],
			errors: [],
		});
	}

	const general: GeneralResources = {
		extensions: [],
		skills: [],
		prompts: [],
		errors: [],
	};

	// 1) Extensiones del loader: tools/comandos al módulo por factory.
	for (const e of input.extensions) {
		const factory = factoryNameOf(e.path);
		const key = TOOL_TOGGLE_KEY_BY_FACTORY.get(factory);
		const target = key
			? byModule.get(key)
			: baseByFactory.has(factory)
				? byModule.get(factory)
				: undefined;
		if (target) {
			target.tools.push(...e.tools);
			target.commands.push(...e.commands);
		} else {
			general.extensions.push(e);
		}
	}

	// 2) Skills: cc-plugins → bundled pipeline → realpath KB → general.
	for (const s of input.skills) {
		if (input.ccSkillNames.has(s.name)) {
			byModule.get("ccPlugins")?.skills.push(s.name);
		} else if (input.bundledSkillNames.has(s.name)) {
			byModule.get("frida-pipeline")?.skills.push(s.name);
		} else if (input.kbRealPathPrefixes.some((p) => s.realPath.startsWith(p))) {
			byModule.get("knowledgeBase")?.skills.push(s.name);
		} else {
			general.skills.push(s);
		}
	}

	// 3) Prompts: prefijos de módulo; el resto → general.
	for (const p of input.prompts) {
		const hit = PROMPT_PREFIX_MODULE.find(([prefix]) =>
			p.name.startsWith(prefix),
		);
		if (hit) byModule.get(hit[1])?.prompts.push(p.name);
		else general.prompts.push(p);
	}

	// 4) Errores: realpath/prefijos KB; skills bundled; huérfanos → general.
	for (const e of input.errors) {
		if (input.kbRealPathPrefixes.some((p) => e.path.startsWith(p))) {
			byModule.get("knowledgeBase")?.errors.push(e);
		} else {
			general.errors.push(e);
		}
	}

	return { modules: [...byModule.values()], general };
}

/**
 * Resuelve la procedencia (source) de una skill para el ResourceSummary del webview (#92):
 * - "extension": si está empaquetada en frida-pipeline o registrada por cc-plugins.
 * - "project": si fue descubierta en el workspace (.frida/skills o .pi/skills).
 * - "global": si fue descubierta en ~/.frida/skills (~/.pi/agent/skills).
 * - "path": cualquier otra ruta adicional.
 */
export function resolveSkillSource(
	skill: { name: string; source?: string },
	bundledSkillNames: ReadonlySet<string>,
	ccSkillNames: ReadonlySet<string>,
): "extension" | "global" | "project" | "path" {
	if (bundledSkillNames.has(skill.name) || ccSkillNames.has(skill.name)) {
		return "extension";
	}
	if (skill.source === "project") return "project";
	if (skill.source === "user") return "global";
	return "path";
}
