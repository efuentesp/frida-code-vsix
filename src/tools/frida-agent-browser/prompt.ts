/**
 * frida-agent-browser — textos del prompt (porte nativo de pi-agent-browser-native).
 *
 * Se replican fielmente los activos de prompt del paquete referencia
 * (dist/extensions/agent-browser/lib/playbook.js): la regla de proyecto que se
 * inyecta al system prompt (before_agent_start) y las guidelines Tier-A que van
 * en el `promptGuidelines` del tool. Son el valor central de la extensión: sin
 * ellas el agente malgasta el tool (no sigue la receta open→snapshot→click).
 */

import { LAUNCH_SCOPED_FLAG_LABEL } from "./constants";

/**
 * Regla de proyecto: se APENDIZA al system prompt en `before_agent_start` para que
 * el agente prefiera el tool nativo `agent_browser` sobre `agent-browser` por bash.
 */
export const PROJECT_RULE_PROMPT =
	"Project rule: when browser automation is needed, prefer the native `agent_browser` tool. Do not run direct `agent-browser` bash commands unless the user explicitly asks for a bash-oriented workflow or browser-integration debugging.";

/**
 * Guidelines Tier-A (siempre activas) — van en `promptGuidelines` del tool.
 * Réplica de RUNTIME_PROMPT_GUIDELINES del referencia; 6 bullets concisos que
 * condensan la receta operativa (input-modes, @refs, sessionMode, artifacts,
 * nextActions, extracción).
 */
export function buildPromptGuidelines(): string[] {
	return [
		"Use agent_browser with one input mode: args, semanticAction, job, qa, script, sourceLookup/networkSourceLookup, or electron. stdin only for batch/eval/auth/wrapper batch; electron rejects stdin; never pass --json.",
		"For agent_browser, use open → snapshot -i → current @refs or semanticAction → re-snapshot after navigation/scroll/rerender. Batch same-snapshot forms; split before navigation/submits. Stop before order/post/purchase/submit.",
		`Use agent_browser sessionMode=fresh for launch-scoped flags, including --allowed-domains; never put --session-mode in args. Use requested/configured profiles only; on profile failures run profiles/doctor. Profile content is model-visible.`,
		"For agent_browser artifacts, use exact user paths and verify details.artifactVerification/details.artifacts before claiming success. Save details.promptGuard-required artifacts before close; record stop needs ffmpeg; close keeps files; waited:timeout is not proof.",
		"When agent_browser details.nextActions exists, use exact payloads over guessed selectors/prose. Dense snapshots: check Omitted high-value controls/highValueControlRefIds. Dashboards: verify scroll with screenshot/snapshot.",
		"For agent_browser extraction: read <url> for docs/text; read for active-tab DOM; get title/url; get text/html/value/count <selector>; get attr <selector> <name>; eval --stdin for targeted state. Batch 3+ getters; heed visibility warnings.",
	];
}

/** Descripción agent-facing del tool (réplica del referencia). */
export const AGENT_BROWSER_DESCRIPTION =
	"Browse websites, read live docs, click and fill pages, extract browser content, take screenshots, and automate real web workflows. " +
	"Input choice: default `args` for open → snapshot -i → click/fill @refs; `semanticAction` for stable role/text/label targets; `job` or `qa` for multi-step checks; `script` for loops, conditional branches, and multi-page aggregation via sandboxed browser()/emit(); `electron` only for desktop apps; experimental `sourceLookup` / `networkSourceLookup` for candidates only.";

/** Snippet corto para el catálogo de tools del agente. */
export const AGENT_BROWSER_PROMPT_SNIPPET =
	"Browse websites, read live docs, click and fill pages, extract browser content, take screenshots, and automate real web workflows.";

/**
 * Mensaje de error cuando el binario upstream `agent-browser` no está en PATH.
 * Réplica de final-result.js (missing-binary) — guía al usuario a instalarlo.
 */
export const MISSING_BINARY_MESSAGE = `agent-browser is required but was not found on PATH.

This extension does not bundle agent-browser. Install it using the upstream docs:
- https://agent-browser.dev/
- https://github.com/vercel-labs/agent-browser

After installing, ensure the binary is on the PATH visible to the editor and reload.`;

/** Hint que se añade a las guidelines cuando hay flags launch-scoped. (Informativo.) */
export function launchScopedFlagHint(): string {
	return `Launch-scoped flags (${LAUNCH_SCOPED_FLAG_LABEL}) require a fresh session: retry with sessionMode=fresh or an explicit --session.`;
}
