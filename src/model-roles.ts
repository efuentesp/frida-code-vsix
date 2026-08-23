/**
 * #121 — F7: roles de modelo y routing por intención.
 *
 * Resolvedor PURO (sin vscode, sin red): dado el mapa de roles configurados,
 * el catálogo de modelos disponibles por proveedor y el estado de auth,
 * produce la asignación efectiva (provider/modelId) + la cadena de fallback
 * que el runtime debe intentar.
 *
 * Roles:
 * - `default` — trabajo principal del agente.
 * - `smol` — subagents, extracciones, resúmenes (barato).
 * - `commit` — changelogs / mensajes de commit.
 *
 * Reglas (espec #121):
 * 1. Rol sin configurar → hereda `default` (nunca vacío, nunca adivina).
 * 2. Proveedor sin auth → se salta en la resolución y en la cadena.
 * 3. Catálogo sin modelos del provider elegido → igualmente hereda.
 * 4. Fallback OFF → cadena de 1 (solo el principal del rol).
 * 5. Fallback ON → cadena = [rol.resuelto, ...siguientes providers authed
 *    distintos, en orden estable] (máx 3: el turno no debe rebotar infinito).
 */

export type ModelRole = "default" | "smol" | "commit";

/** Providers de modelo que Frida registra en el ModelRuntime — candidatos
 * para construir el catálogo autenticado (getModels(p) no vacío = authed). */
export const KNOWN_MODEL_PROVIDERS: readonly string[] = [
	"frida-enterprise",
	"ollama",
	"openai",
	"zai",
	"softtek-devengine",
	"moonshotai",
	"frida-antigravity",
];

export const MODEL_ROLES: readonly ModelRole[] = ["default", "smol", "commit"];

/** Etiqueta humana + propósito del rol (para UI y logs). */
export const ROLE_META: Record<
	ModelRole,
	{ label: string; hint: string; icon: string }
> = {
	default: {
		label: "Principal",
		hint: "Trabajo principal del agente",
		icon: "settings-gear",
	},
	smol: {
		label: "Rápido",
		hint: "Subagents, extracciones y resúmenes",
		icon: "zap",
	},
	commit: {
		label: "Commits",
		hint: "Changelogs y mensajes de commit",
		icon: "edit",
	},
};

export interface RoleAssignment {
	provider: string;
	modelId: string;
}

/** Config de entrada: lo que el usuario puso en settings (todo opcional). */
export interface ModelRolesConfig {
	/** Switch maestro (#121): OFF = todo resuelve al modelo activo (modo
	 *  clásico, una sola acción para volver atrás). Default false. */
	enabled?: boolean;
	/** `default` requerido en la resolución efectiva (viene del modelo activo). */
	default?: RoleAssignment;
	smol?: RoleAssignment | null;
	commit?: RoleAssignment | null;
	/** Cadena de respaldo explícita (provider ids). OFF si viene null/ausente. */
	fallback?: string[] | null;
}

/** Estado del mundo necesario para resolver. */
export interface ResolveInput {
	config: ModelRolesConfig;
	/** Proveedores autenticados (id → lista de modelos disponibles). */
	authedCatalog: Record<string, string[]>;
}

/** Resultado de resolución de un rol. */
export interface ResolvedRole {
	role: ModelRole;
	/** Asignación efectiva (siempre válida: hereda hasta caer en default). */
	effective: RoleAssignment | null;
	/** De dónde vino: "explicit" | "inherit". */
	origin: "explicit" | "inherit";
	/** Cadena a intentar en orden: [efectivo, ...respaldos authed]. */
	chain: RoleAssignment[];
}

/** ¿El provider tiene auth y el modelo existe en su catálogo? */
function isUsable(
	assignment: RoleAssignment | null | undefined,
	authedCatalog: Record<string, string[]>,
): assignment is RoleAssignment {
	if (!assignment) return false;
	const models = authedCatalog[assignment.provider];
	return Array.isArray(models) && models.includes(assignment.modelId);
}

/**
 * Construye la cadena de fallback de un rol:
 * el efectivo + hasta N-1 respaldos de otros providers authed (orden estable:
 * los que el usuario listó primero, luego el resto alfabético).
 */
function buildChain(
	effective: RoleAssignment,
	config: ModelRolesConfig,
	authedCatalog: Record<string, string[]>,
): RoleAssignment[] {
	if (config.fallback == null) {
		return [effective];
	}
	// Providers explícitos de la cadena, en el orden del usuario.
	const explicitOrder = config.fallback.filter(
		(p) => p !== effective.provider && authedCatalog[p]?.length,
	);
	// Respaldo por defecto: cualquier otro provider authed con modelos.
	const others = Object.keys(authedCatalog)
		.filter(
			(p) =>
				p !== effective.provider &&
				!explicitOrder.includes(p) &&
				authedCatalog[p].length > 0,
		)
		.sort((a, b) => a.localeCompare(b));
	const chain = [effective];
	for (const p of [...explicitOrder, ...others]) {
		const models = authedCatalog[p];
		chain.push({ provider: p, modelId: models[models.length - 1] });
		if (chain.length >= 3) break; // tope: principal + 2 respaldos
	}
	return chain;
}

/** Resuelve TODOS los roles de una vez (default primero — los demás heredan). */
export function resolveModelRoles(input: ResolveInput): {
	default: ResolvedRole;
	smol: ResolvedRole;
	commit: ResolvedRole;
} {
	const { config, authedCatalog } = input;

	// #121 — switch maestro OFF: modo clásico. Todo usa el modelo activo
	// (o su caída de emergencia si ni siquiera está usable), cadena de 1,
	// roles y fallback ignorados por completo.
	if (config.enabled === false) {
		let active: RoleAssignment | null = config.default ?? null;
		if (!isUsable(active, authedCatalog)) {
			const firstAuthed = Object.keys(authedCatalog)
				.filter((p) => authedCatalog[p].length > 0)
				.sort((a, b) => a.localeCompare(b))[0];
			active = firstAuthed
				? {
						provider: firstAuthed,
						modelId: authedCatalog[firstAuthed].at(0) ?? "",
					}
				: null;
		}
		const classic: ResolvedRole = {
			role: "default",
			effective: active,
			origin: "inherit",
			chain: active ? [active] : [],
		};
		return {
			default: classic,
			smol: { ...classic, role: "smol" },
			commit: { ...classic, role: "commit" },
		};
	}

	// default: cae en cascada por su propia cadena si no es utilizable.
	let defaultEffective = config.default ?? null;
	let defaultOrigin: "explicit" | "inherit" = "explicit";
	if (!isUsable(defaultEffective, authedCatalog)) {
		// El modelo activo no es usable (sin auth o fuera de catálogo):
		// primer provider authed con modelos, orden estable.
		const firstAuthed = Object.keys(authedCatalog)
			.filter((p) => authedCatalog[p].length > 0)
			.sort((a, b) => a.localeCompare(b))[0];
		defaultEffective = firstAuthed
			? {
					provider: firstAuthed,
					modelId: authedCatalog[firstAuthed].at(0) ?? "",
				}
			: null;
		defaultOrigin = "inherit";
	}

	const resolveNonDefault = (
		role: Exclude<ModelRole, "default">,
	): ResolvedRole => {
		const raw = config[role] ?? null;
		if (isUsable(raw, authedCatalog)) {
			return {
				role,
				effective: raw,
				origin: "explicit",
				chain: buildChain(raw, config, authedCatalog),
			};
		}
		// Hereda default (incluye el caso default:null → null).
		return {
			role,
			effective: defaultEffective,
			origin: "inherit",
			chain: defaultEffective
				? buildChain(defaultEffective, config, authedCatalog)
				: [],
		};
	};

	const resolvedDefault: ResolvedRole = {
		role: "default",
		effective: defaultEffective,
		origin: defaultOrigin,
		chain: defaultEffective
			? buildChain(defaultEffective, config, authedCatalog)
			: [],
	};

	return {
		default: resolvedDefault,
		smol: resolveNonDefault("smol"),
		commit: resolveNonDefault("commit"),
	};
}

/** Nombre estable para atribución en session-stats/usage. */
export function roleTag(role: ModelRole): string {
	return `role:${role}`;
}

/** #121 — modelo para SESIONES HIJAS (subagents/workflows): el rol `smol`
 * efectivo cuando los roles están activos. null = usar el modelo de la
 * sesión interactiva (comportamiento clásico). */
export function pickChildModel(
	config: ModelRolesConfig,
	resolution: { smol: ResolvedRole },
	getModel: (provider: string, modelId: string) => unknown,
): unknown {
	if (config.enabled !== true) return null;
	if (resolution.smol.origin !== "explicit") return null;
	const eff = resolution.smol.effective;
	if (!eff) return null;
	return getModel(eff.provider, eff.modelId) ?? null;
}

/** #121 — respaldo AL ARRANQUE para la sesión interactiva: primer candidato
 * de la cadena (después del efectivo) que el runtime tenga disponible.
 * null = dejar que el caller use su fallback de siempre (DevEngine). */
export function pickStartupFallback(
	config: ModelRolesConfig,
	resolution: { default: ResolvedRole },
	getModel: (provider: string, modelId: string) => unknown,
): unknown {
	if (config.enabled !== true || config.fallback == null) return null;
	for (const cand of resolution.default.chain.slice(1)) {
		const m = getModel(cand.provider, cand.modelId);
		if (m) return m;
	}
	return null;
}
