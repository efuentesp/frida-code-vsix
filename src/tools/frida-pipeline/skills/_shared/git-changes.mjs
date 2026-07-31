// Pre-cocina el snapshot de "qué cambió" para la skill commit.
//
// Imprime:
//   in_repo: yes|no
//   ---status---
//   <git status --short>
//   ---staged---
//   <git diff --cached --stat>
//   ---unstaged---
//   <git diff --stat>
//
// Porte de rpiv-pi/skills/_shared/git-changes.mjs. Sin cambios funcionales.

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

const inRepo = git("rev-parse --git-dir");

if (!inRepo) {
	process.stdout.write("in_repo: no\n");
	process.exit(0);
}

process.stdout.write("in_repo: yes\n");
process.stdout.write("---status---\n");
process.stdout.write(git("status --short") || "(clean)");
process.stdout.write("\n---staged---\n");
process.stdout.write(git("diff --cached --stat") || "(nada stagado)");
process.stdout.write("\n---unstaged---\n");
process.stdout.write(git("diff --stat") || "(nada sin stagar)");
