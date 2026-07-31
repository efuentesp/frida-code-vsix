// Imprime seis líneas etiquetadas resumiendo el estado git del cwd actual.
// Siempre termina con exit 0 — todo path de fallo colapsa a un fallback
// estable para que el cuerpo de la skill nunca reciba un
// `[Shell error: ...]`.
//
//   branch: <name>|no-branch
//   commit: <short-sha>|no-commit
//   author: <user.name>|unknown
//   repo:   <url>|none
//   remote: <name>|none
//   dirty:  yes|no
//
// Porte de rpiv-pi/skills/_shared/git-context.mjs. Sin cambios funcionales.

import { execSync } from "node:child_process";

function git(args) {
	try {
		return execSync(`git ${args}`, {
			encoding: "utf-8",
			timeout: 5000,
			stdio: ["pipe", "pipe", "pipe"],
		}).trim();
	} catch {
		return null;
	}
}

const branch = git("rev-parse --abbrev-ref HEAD") || "no-branch";
const commit = git("rev-parse --short HEAD") || "no-commit";
const author = git("config user.name") || "unknown";
const repo = git("remote get-url origin") || "none";
const remote = git("remote")?.split("\n")[0] || "none";
const status = git("status --porcelain");
const dirty = status && status.length > 0 ? "yes" : "no";

process.stdout.write(
	[
		`branch: ${branch === "HEAD" ? "detached" : branch}`,
		`commit: ${commit}`,
		`author: ${author}`,
		`repo: ${repo}`,
		`remote: ${remote}`,
		`dirty: ${dirty}`,
	].join("\n"),
);
