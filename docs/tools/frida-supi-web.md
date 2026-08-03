# `frida-supi-web`

> **Estado:** ✅ estable · porte nativo de [`@mrclrchtr/supi-web`](https://www.npmjs.com/package/@mrclrchtr/supi-web) · referencia: [supi-web README](https://github.com/mrclrchtr/supi/tree/main/packages/supi-web#readme)

Tres tools web para el agente: descargar una URL pública como Markdown limpio y buscar/traer documentación de librerías vía Context7.

## ¿Qué es?

**Frida no incluye `supi-web`** (vive en `~/.pi`, no en el `agentDir` de Frida `~/.frida`), de modo que sin este porte el agente carecería de capacidad de "trae esta URL como texto" y "busca la doc de esta librería". `frida-supi-web` es un **porte nativo** — al estilo de `frida-agent-browser`: la misma `ExtensionAPI` de Pi, pero **sin** los renderers Ink (`renderCall`/`renderResult`), que el webview de Frida ignora.

Registra tres tools que el modelo puede invocar:

| Tool | Propósito |
| --- | --- |
| `web_fetch_md` | Descarga una URL pública `http(s)` y la devuelve como **Markdown limpio** para el LLM |
| `web_docs_search` | Busca IDs de librerías en **Context7** antes de traer la doc |
| `web_docs_fetch` | Trae documentación enfocada para un `library_id` de Context7 conocido |

La lógica (negociación de contenido, conversión HTML→Markdown con Readability+Turndown, cliente REST de Context7) es un porte del paquete original; **no depende** de `@mrclrchtr/supi-web` en runtime.

## ¿Cuándo usarla?

- **`web_fetch_md`** — quieres el contenido de una página pública (docs, blog, referencia de API) como texto para el agente.
- **`web_docs_search` → `web_docs_fetch`** — necesitas la doc actualizada de una librería (React, Next.js, FastAPI…) y conoces / buscas su ID de Context7.
- **`frida-agent-browser`** en su lugar — cuando necesites **interacción real** con el navegador (clicks, fills, login, screenshots, snapshots) o **búsqueda web** (Exa/Brave). `frida-supi-web` es lectura ligera sin levantar navegador.
- **NO la uses** para páginas con login/paywall — pide al usuario una fuente permitida. Tampoco para URLs de GitHub: si `gh` CLI está instalado, el guideline del prompt lo prefiere.

## Conceptos

| Término | Significado |
| --- | --- |
| **Negociación de contenido** | `web_fetch_md` prueba en cascada: Markdown nativo (HEAD) → sniff del content-type → URL sibling `.md` → HTML→Markdown. Devuelve lo "más limpio" posible. |
| **Context7** | Servicio de documentación de librerías; requiere `CONTEXT7_API_KEY`. |
| **`output_mode`** | `auto` (inline si ≤15 000 chars, si no temp) · `inline` (trunca a 2000 líneas/50 KB) · `file` (siempre temp). El archivo completo se vuelca a un temp persistente. |
| **Renderers Ink** | `renderCall`/`renderResult` del TUI de Pi. Frida **no** los usa; el webview renderiza vía `ToolCard.tsx`. |

## Uso

El agente invoca estas tools automáticamente cuando las necesita. No hay slash command propio; abre esta doc con `/help frida-supi-web`.

```text
Tú:    ¿qué dice la doc de fastapi sobre los lifespan events?
Agente: (web_docs_search "fastapi" → library_id) → (web_docs_fetch … )
        → [Web Fetch / Docs Fetch: markdown renderizado en la tarjeta]
```

## API / DSL

### `web_fetch_md`

```ts
{
  url: string;              // ✓ URL http(s) pública
  output_mode?: "auto" | "inline" | "file";   // default "auto"
  abs_links?: boolean;      // default true — absolutiza enlaces/imágenes
  timeout_ms?: number;      // default 30000
}
```

Solo acepta `http://`/`https://`. El texto plano se cerca como bloque de código; el HTML se convierte con Readability + Turndown (+ GFM). La salida visible al modelo se trunca a 2000 líneas / 50 KB y el resto se guarda en un temp.

### `web_docs_search`

```ts
{
  library_name: string;  // ✓ p.ej. "react", "next.js"
  query: string;         // ✓ para ranking de relevancia
}
```

Devuelve una tabla Markdown (ID, nombre, trust, bench, snippets, versiones; top 10).

### `web_docs_fetch`

```ts
{
  library_id: string;  // ✓ ID de Context7, p.ej. "/facebook/react" (busca antes si no lo sabes)
  query: string;       // ✓ pregunta concreta
  raw?: boolean;       // default false — true → JSON de snippets
}
```

Flujo típico: `web_docs_search` → eliges un `library_id` → `web_docs_fetch`.

## Ejemplos

### Fetch de una página de docs

```text
Agente: web_fetch_md({ url: "https://fastapi.tiangolo.com/tutorial/first-steps/",
                       output_mode: "auto" })
        → Markdown de la página (inline o temp si es grande).
```

### Docs de librería vía Context7

```text
Agente: web_docs_search({ library_name: "next.js", query: "app router server components" })
        → tabla con IDs  →  /vercel/next.js
Agente: web_docs_fetch({ library_id: "/vercel/next.js",
                         query: "how do server components work in the app router" })
        → doc enfocada en Markdown.
```

## Configuración

### API key de Context7 (`web_docs_*`)

Las tools de docs requieren una API key de Context7. Frida la gestiona con el **mismo patrón que los proveedores de modelos** (SecretStorage, nunca en disco/env en claro):

- **`/login context7`** — abre un input box, pegas tu key (empieza por `ctx7sk`) y se guarda en el llavero del SO (SecretStorage, clave `frida.context7Key`). Tras esto, `web_docs_search`/`web_docs_fetch` ya funcionan.
- **`/logout context7`** — elimina la key guardada.
- **Fallback:** si no hay key en SecretStorage, se usa `CONTEXT7_API_KEY` del entorno (útil para sesiones hijas offline o CI). Replica el comportamiento del `supi-web` original.

Consigue tu key gratis en <https://context7.com/dashboard>. Sin ninguna key, las tools devuelven un 401 con un mensaje útil; `web_fetch_md` no necesita key.

La herramienta está siempre activa (no tiene setting `frida.supiWeb.enabled` por ahora).

| Clave | Tipo | Default | Descripción |
| --- | --- | --- | --- |
| `frida.context7Key` (SecretStorage) | string | — | API key de Context7, gestionada con `/login context7`. |
| `CONTEXT7_API_KEY` (env, fallback) | string | — | Usada solo si no hay key en SecretStorage. |

## Integración con Frida

- **Registro:** se monta en `src/pi-session.ts` como `{ name: "frida-supi-web", factory: createFridaSupiWeb() }`, junto al resto de tools nativas (tras `frida-agent-browser`). Factory `createFridaSupiWeb()` que devuelve `(pi: ExtensionAPI) => void`.
- **Sesiones / gates:** **main only** (igual que `frida-agent-browser`). Las sesiones hijas de workflow no la cargan. No pasa por gates (solo lectura; solo escribe temps en `tmpdir()`).
- **UI:** sin renderers TUI. El Markdown de las 3 tools se renderiza en el webview porque `webview/components/ToolCard.tsx` las trata como `Markdown` (no `<pre>`) y les asigna icono + argumento en el header (`TOOL_INFO`).
- **Auth Context7:** la API key vive en `context.secrets` (`frida.context7Key`), cargada al arrancar a un cache síncrono. El getter `getContext7Key` viaja por `CreateFridaSessionOptions` → `createFridaSupiWeb({ getKey })` → `context7-client.ts` (con fallback a `process.env.CONTEXT7_API_KEY`). Se gestiona con `/login context7` / `/logout context7`; NO pertenece a `API_KEY_PROVIDERS` porque Context7 no es un proveedor de modelos.

## Arquitectura / Internals

```text
src/tools/frida-supi-web/
  index.ts            ← createFridaSupiWeb(): registra los 3 tools (execute, sin renderers)
  tool-specs.ts       ← catálogo (name/label/parameters typebox/prompt) + stringEnum local
  prompt.ts           ← metadata de prompt (+ hint "usa gh CLI para GitHub" si está instalado)
  fetch.ts            ← fetchWithNegotiation (HEAD→sniff→sibling→html) + heurísticas de content-type
  convert.ts          ← htmlToMarkdown (jsdom + @mozilla/readability + turndown + GFM)
  context7-client.ts  ← searchLibrary / getContext (REST Context7, key inyectada por el host + fallback env)
  output.ts           ← truncateHead del SDK + vuelca a temp si se trunca
  temp-file.ts        ← writeTempFile con withFileMutationQueue del SDK
```

Dependencias añadidas a `package.json`: `jsdom`, `@mozilla/readability`, `turndown`, `turndown-plugin-gfm` (+ `@types/jsdom`, `@types/turndown` como devDeps). Para los tipos DOM, el `tsconfig.json` del host ahora incluye `DOM` + `DOM.Iterable` (necesario para jsdom/`querySelectorAll`).

> **jsdom es `external`:** NO se bundlea en `dist/extension.js` (ver `esbuild.js`). Es necesario porque jsdom, al importarse, lee `default-stylesheet.css` con `path.resolve(__dirname, "../../../browser/...")` asumiendo su estructura interna; si se bundlea, `__dirname` = `dist/` y la ruta se rompe → `ENOENT` que tira `activate()`. Como `external`, jsdom se resuelve desde `node_modules` en runtime (estructura intacta) y, de paso, `extension.js` baja ~12 MB. vsce incluye jsdom (es `dependency`) en el `.vsix`.

## Ver también

- [README](../../README.md) — índice general de Frida Code
- [frida-agent-browser](./frida-agent-browser.md) — automatización de navegador real + búsqueda web
- [Extensiones](./extensions.md) — cómo Frida hereda el sistema de extensiones de Pi
- Referencia original: [`@mrclrchtr/supi-web`](https://github.com/mrclrchtr/supi/tree/main/packages/supi-web)

## Estado y madurez

- ✅ Las 3 tools portadas y funcionales (paridad con supi-web v4.4.0).
- ✅ Build del host y del webview pasan; typecheck limpio en `src/` y `webview/`.
- ✅ Rendering rico en el webview (Markdown + iconos).
- ✅ `jsdom` marcado como `external` en `esbuild.js`: no se bundlea (evita un `ENOENT` de `default-stylesheet.css` que rompía `activate()`), se resuelve desde `node_modules` en runtime y aligera `extension.js` (~12 MB menos).
- ○ Sin setting de toggle (`frida.supiWeb.enabled`) por ahora; siempre activa. Se puede añadir envolviendo la factory en `toggleable(...)`.
