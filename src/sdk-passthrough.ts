// Passthrough del SDK para extensiones externas cargadas vía jiti.
//
// PROBLEMA: Cuando el SDK se compila con esbuild (CJS), getAliases() en
// loader.js calcula rutas incorrectas porque __dirname apunta a dist/ en
// lugar de la ubicación original del SDK en node_modules. Esto hace que
// los aliases para @earendil-works/* apunten a archivos inexistentes,
// y el shim de import.meta.resolve devuelve el specifier tal cual al
// fallar require.resolve → fileURLToPath("<bare-specifier>") → "Invalid URL".
//
// FIX: Este módulo re-exporta toda la API pública del SDK. El plugin de
// esbuild parchea loader.js para que packageIndex apunte a este archivo.
// Así, cuando jiti carga una extensión externa (ej. ~/.frida/extensions/hello.ts)
// e importa { defineTool } from "@earendil-works/pi-coding-agent", el alias
// resuelve a este passthrough que sí exporta defineTool.

export * from "@earendil-works/pi-coding-agent";
