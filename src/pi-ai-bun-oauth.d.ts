// Declaración ambiente para el registro de flujos OAuth bundled de pi-ai.
//
// pi-ai es dependencia TRANSITORIA (anidada bajo pi-coding-agent), así que tsc no
// resuelve la subpath `@earendil-works/pi-ai/bun-oauth` desde el top-level.
// esbuild sí la resuelve vía el alias de esbuild.js (que apunta a la ubicación
// real) y la bundlea estáticamente dentro de dist/extension.js. Esta declaración
// sólo aporta tipos al import estático; el módulo real lo provee esbuild.
//
// ¿Para qué? Sin llamar registerBunOAuthFlows() al activar, el login OAuth de
// GitHub Copilot (y anthropic/codex/xai/radius) cae en un dynamic import opaco
// (`import("./github-copilot.ts")`) que al bundlear queda relativo al bundle →
// ERR_MODULE_NOT_FOUND. Registrar los flows bundled hace que se carguen estáticos.
declare module "@earendil-works/pi-ai/bun-oauth" {
	/**
	 * Registra estáticamente los flujos OAuth (anthropic, github-copilot,
	 * openai-codex, xai, radius) para que se carguen sin el dynamic import opaco.
	 * Idempotente; llamar una vez al activar la extensión.
	 */
	export function registerBunOAuthFlows(): void;
}
