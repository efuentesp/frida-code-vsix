function packageSource(value: unknown): string | undefined {
	if (typeof value === "string") return value;
	if (
		value &&
		typeof value === "object" &&
		!Array.isArray(value) &&
		typeof (value as { source?: unknown }).source === "string"
	) {
		return (value as { source: string }).source;
	}
	return undefined;
}

/** Return whether a package source is safe to synchronize across machines. */
export function isPortablePackageSource(source: string): boolean {
	if (typeof source !== "string" || source.length === 0) return false;
	if (/[\u0000-\u001f\u007f]/.test(source)) return false;
	if (/^(?:file:|\.\.?[\\/]|[\\/]|~[\\/])/i.test(source)) return false;
	return /^(?:npm:|git:|https?:\/\/|ssh:\/\/)/i.test(source);
}

function parseSettings(content: Buffer): Record<string, unknown> | undefined {
	try {
		const parsed: unknown = JSON.parse(content.toString("utf-8"));
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: undefined;
	} catch {
		return undefined;
	}
}

function portableSettings(
	settings: Record<string, unknown>,
): Record<string, unknown> {
	if (!Array.isArray(settings.packages)) return settings;
	return {
		...settings,
		packages: settings.packages.filter((entry) => {
			const source = packageSource(entry);
			return source !== undefined && isPortablePackageSource(source);
		}),
	};
}

function canonicalize(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonicalize);
	if (!value || typeof value !== "object") return value;
	return Object.fromEntries(
		Object.entries(value as Record<string, unknown>)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, entry]) => [key, canonicalize(entry)]),
	);
}

/** Strip machine-local package declarations before writing shared settings. */
export function sanitizeSettingsForRepository(content: Buffer): Buffer {
	const settings = parseSettings(content);
	if (!settings || !Array.isArray(settings.packages)) return content;
	const portable = portableSettings(settings);
	if ((portable.packages as unknown[]).length === settings.packages.length) {
		return content;
	}
	return Buffer.from(`${JSON.stringify(portable, null, 2)}\n`, "utf-8");
}

/** Canonical portable representation used by three-way settings comparison. */
export function normalizeSettingsForComparison(content: Buffer): Buffer {
	const settings = parseSettings(content);
	if (!settings) return content;
	return Buffer.from(JSON.stringify(canonicalize(portableSettings(settings))));
}

/** Preserve this machine's local package paths when applying shared settings. */
export function mergeLocalPackagesIntoSettings(
	remoteContent: Buffer,
	localContent: Buffer,
): Buffer {
	const remote = parseSettings(remoteContent);
	const local = parseSettings(localContent);
	if (!remote || !local || !Array.isArray(local.packages)) return remoteContent;

	const localOnly = local.packages.filter((entry) => {
		const source = packageSource(entry);
		return source !== undefined && !isPortablePackageSource(source);
	});
	if (localOnly.length === 0) return remoteContent;

	const remotePackages = Array.isArray(remote.packages) ? remote.packages : [];
	const seen = new Set(remotePackages.map((entry) => JSON.stringify(entry)));
	const mergedLocal = localOnly.filter(
		(entry) => !seen.has(JSON.stringify(entry)),
	);
	if (mergedLocal.length === 0) return remoteContent;

	return Buffer.from(
		`${JSON.stringify(
			{ ...remote, packages: [...remotePackages, ...mergedLocal] },
			null,
			2,
		)}\n`,
		"utf-8",
	);
}
