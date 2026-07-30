// frida-workflow — schemas (Standard Schema v1) + adapter TypeBox.
//
// outputSchema/inputSchema son StandardSchemaV1: el autor usa Zod/Valibot/ArkType
// (que hablan ~standard nativo) o TypeBox vía typeboxSchema() (typebox v1.1.x NO
// trae ~standard, por eso el adapter). El runner valida vía validateSchema().

import type { TSchema } from "typebox";
import { Value } from "typebox/value";
import type { StandardIssue, StandardResult, StandardSchemaV1 } from "./types";

export type { StandardSchemaV1, StandardResult, StandardIssue };

/** Valida `value` contra un schema Standard. `~standard.validate` puede ser async. */
export async function validateSchema(
	schema: StandardSchemaV1,
	value: unknown,
): Promise<
	{ ok: true; value: unknown } | { ok: false; issues: StandardIssue[] }
> {
	const res: StandardResult = await schema["~standard"].validate(value);
	if (res.issues && res.issues.length > 0)
		return { ok: false, issues: res.issues };
	return { ok: true, value: res.value };
}

/** String corto de issues para logs/audit (no para el usuario final). */
export function summarizeIssues(issues: StandardIssue[]): string {
	return issues
		.slice(0, 3)
		.map((i) => {
			const at =
				i.path && i.path.length > 0
					? `/${(i.path as unknown[]).join("/")}`
					: "";
			return `${at}: ${i.message ?? "inválido"}`.trim();
		})
		.join("; ");
}

/**
 * Envuelve un schema TypeBox en un Standard Schema v1 (typebox v1.1.x no trae
 * `~standard` nativo). Validación síncrona vía Value.Check / Value.Errors.
 */
export function typeboxSchema<S extends TSchema>(schema: S): StandardSchemaV1 {
	return {
		"~standard": {
			version: 1,
			vendor: "typebox",
			validate: (value: unknown): StandardResult => {
				if (Value.Check(schema, value)) return { value };
				const issues: StandardIssue[] = [...Value.Errors(schema, value)].map(
					(e) => {
						// typebox v1.1.x usa `instancePath` (JSON-pointer "/a/b"), no `path`.
						const ip = (e as { instancePath?: string }).instancePath;
						return {
							message: (e as { message?: string }).message,
							path: ip ? ip.split("/").filter(Boolean) : undefined,
						};
					},
				);
				return { issues };
			},
		},
	};
}
