// Resuelve la identidad del reporte de uso desde settings + git (fallback de email,
// remote del repo) + datos del host (fingerprint, timezone). `git` es inyectable
// para tests. Diseño: .rpiv/artifacts/designs/2026-08-03_21-38-12_frida-usage-telemetry.md

import { execSync } from "node:child_process";
import * as crypto from "node:crypto";
import * as os from "node:os";
import * as vscode from "vscode";
import { getUserEmail, getOrg, getUserRole } from "../settings";
import type { ReportIdentity } from "./report-schema";

export interface IdentityResolveOptions {
	/** Ejecuta git (args + cwd) → stdout trim, o undefined si falla. Inyectado para tests. */
	git?: (args: string[], cwd: string) => string | undefined;
	workspaceName?: string;
}

function runGit(args: string[], cwd: string): string | undefined {
	try {
		const out = execSync(["git", ...args].join(" "), {
			cwd,
			encoding: "utf8",
			timeout: 4000,
			stdio: ["ignore", "pipe", "ignore"],
		});
		return out.trim() || undefined;
	} catch {
		return undefined;
	}
}

/** Hash estable de la máquina (sha256 de hostname + username). Para desduplicar
 *  usuarios en el concentrador sin exponer el hostname real. */
function hostFingerprint(): string {
	const raw = `${os.hostname()}|${os.userInfo().username}`;
	return crypto.createHash("sha256").update(raw).digest("hex").slice(0, 16);
}

/** Resuelve la identidad para el reporte. `email` queda "" si no hay setting ni fallback git. */
export function resolveIdentity(
	opts: IdentityResolveOptions = {},
): ReportIdentity {
	const git = opts.git ?? runGit;
	const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
	const projectName =
		opts.workspaceName ??
		vscode.workspace.name ??
		(cwd ? (cwd.split(/[/\\]/).pop() ?? "") : "");
	let email = getUserEmail();
	if (!email && cwd) email = git(["config", "user.email"], cwd) ?? "";
	const repoRemote = cwd
		? (git(["remote", "get-url", "origin"], cwd) ?? "")
		: "";
	const repo = repoRemote
		? (repoRemote
				.replace(/\.git$/, "")
				.split(/[/\\]/)
				.pop() ?? "")
		: projectName;
	return {
		org: getOrg(),
		email,
		project: projectName,
		repo,
		repoRemote,
		hostFingerprint: hostFingerprint(),
		timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
		role: getUserRole(),
	};
}
