# `frida-youtube-transcript`: transcripciones de YouTube sin límites diarios

**Estado:** aceptado (#37). No bloqueado (prerrequisitos ya instalados).

## Contexto

Se necesita obtener transcripciones de videos de YouTube para investigación
(videos de Loop/Agentic Engineering, etc.), en **lotes de varios videos sin
preocuparse por límites diarios**. Se investigaron las 3 rutas disponibles y
**las 3 fallan por la misma causa raíz: detección de bot de Google**:

| Ruta | Síntoma | Causa |
| --- | --- | --- |
| `timedtext` HTTP (curl/web_fetch) | respuesta vacía | challenge **POT token** (se genera en JS client-side; curl no lo resuelve) |
| `pi-youtube-transcript` (lib `youtube-transcript`, fetch naive) | `YoutubeTranscriptTooManyRequestError` | mismo fetch de watch page + timedtext, mismo rate-limit |
| `agent_browser` (chromium) | redirect a `google.com/sorry/index` | *"Our systems have detected unusual traffic..."* (IP flaggeada) |

La única extensión pi dedicada, `pi-youtube-transcript` (jonjonrankin, MIT),
usa **exactamente el mismo método** que el fetch manual y topa con el mismo
muro. **No existe extensión pi con un método distinto que funcione.**

## Decisión

**D1 — Tool `youtube_transcript` que envuelve `yt-dlp` con sesión logueada.** El
diferenciador que evade el bot-check NO es un método HTTP distinto, sino **usar
la sesión autenticada del navegador del usuario** (`--cookies-from-browser`).
Las peticiones van como usuario logueado → sin bot-check ni rate-limit agresivo
→ apto para lotes.

**D2 — Solver de challenges nsig/PO-token vía `--remote-components ejs:github`
(requiere `deno`).** YouTube ahora exige resolver el challenge PO (proof-of-origin)
y nsig client-side. `yt-dlp` delega esto en un solver JS descargable (EJS) que
corre en `deno`. Sin esto, el player response viene degradado (sólo imágenes) y
no hay transcripción.

**D3 — Prerrequisitos verificados en runtime** (`ensureDeps`): detecta yt-dlp y
deno en el PATH ampliado (`~/.local/bin` + `/opt/homebrew/bin`) y lanza con
mensajes de instalación claros si faltan.

**D4 — Navegador configurable, default `brave`.** El usuario mantiene su sesión
de YouTube logueada en Brave (1321 cookies confirmadas). Configurable vía
`createFridaYoutubeTranscript({ browser })` para soportar chrome/firefox/edge/arc.

**D5 — Main only.** Usa el navegador y herramientas externas del host; las
sesiones hijas de workflow no las necesitan.

## Alternativas consideradas

- **A — Portear `pi-youtube-transcript` directo.** Descartado: método naive, ya
  probado, lanza `TooManyRequestError`. No evita límites.
- **B — `agent_browser` scraping del panel "Show transcript".** Descartado: el
  chromium de agent_browser es redirigido al intersticial anti-bot (`/sorry`).
  Requeriría perfil logueado + es frágil (UI scraping por video).
- **C — Lib `youtube-transcript` (Node).** Descartado: mismo método que
  `pi-youtube-transcript`, mismo muro.

## Consecuencias

**Positivas**

- Apto para lotes (sesión logueada → sin límites diarios agresivos).
- Reusa `yt-dlp` (herramienta madura, mantenida) en vez de reimplementar fetch.
- Mensajes de error claros cuando faltan yt-dlp/deno.

**Negativas / trade-offs**

- Dependencia de binarios externos (yt-dlp + deno) en el host.
- `--remote-components ejs:github` descarga el solver JS desde GitHub en la 1ª
  ejecución (luego cacheado). Es el mecanismo oficial de yt-dlp y corre bajo
  sandbox de deno, pero es código descargado en runtime.
- Requiere sesión de YouTube logueada en el navegador configurado.

## Prerrequisitos (instalados esta sesión)

| Pieza | Estado | Para qué |
| --- | --- | --- |
| `yt-dlp` `~/.local/bin/yt-dlp` | ✅ instalado | extractor |
| `deno` `/opt/homebrew/bin/deno` | ✅ instalado | runtime JS (nsig/PO challenges) |
| `--remote-components ejs:github` | ✅ cacheado | solver de challenges |
| sesión Brave logueada | ✅ 1321 cookies | auth → sin límites |

## Referencias

- Issue **#37**.
- Extensión pi descartada: `pi-youtube-transcript` (jonjonrankin, MIT) — método naive.
- Herramientas: `yt-dlp` (❤ community) · `deno` · EJS remote components.
- Validado e2e: 36,025 chars extraídos del video *"FORGET Loop Engineering"* (youtube `VQy50fuxI34`).
