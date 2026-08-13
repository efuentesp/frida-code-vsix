# `frida-remote-control` — control remoto de la sesión embebida (WebSocket sobre el bus Remote React)

**Estado:** aceptado (#42). **Bloqueado por** el refactor del `WebBridge` a **bus
multiplexado** (trabajo de plataforma: hoy `onCommit` es 1:1 con el webview de VS Code).

> Referencia de producto: [Claude Code Remote Control](https://code.claude.com/docs/en/remote-control)
> (relay cloud outbound + app móvil + QR + sync en tiempo real). Referencia de
> implementación: el ecosistema Pi `pi-remote*` (todas envuelven `pi --mode rpc`).

## Contexto

El usuario quiere **controlar la sesión de Frida desde un dispositivo remoto** (móvil /
browser) — arrancar una tarea en VS Code y continuarla desde el teléfono, estilo Claude
Remote Control.

### El ecosistema Pi existente (no reusable directo)

Hay un ecosistema maduro de remote control para Pi, pero **todas envuelven el CLI `pi`**
(`pi --mode rpc` o `pi-package-webui`):

| Paquete | Modelo | Por qué no reusable en Frida |
| --- | --- | --- |
| `@noahsaso/pi-remote` | WebSocket + browser UI móvil + QR + Tailscale + token auth | Envuelve `pi --mode rpc` |
| `@k3_2o/pi-remote` | server runtime (WS+HTTP) sobre `pi --mode rpc`; SDKs JS/Python | Envuelve `pi --mode rpc` |
| `zerray/pi-remote-control` | relay daemon + app iOS App Store | Envuelve el CLI `pi` |
| `@firstpick/pi-package-remote-webui` | abre la Web UI de Pi a la LAN | Envuelve `pi-package-webui` |

**Frida no puede reusarlas directo:** embebe el SDK *in-proceso* en el extension host de
VS Code (`createAgentSession` en `src/pi-session.ts`), **no lanza el binario `pi`**. No
existe hoy ningún server HTTP/WebSocket en Frida. Portear `pi --mode rpc` al contexto
embebido sería reconstruir una capa del SDK que Frida ya no necesita.

### El hallazgo: Frida YA tiene el 80% — el bus "Remote React"

El `WebBridge` (`src/web-bridge.ts`) implementa un protocolo de **Remote React**:

1. Las herramientas crean un `ReactElement` (`<Box><Button onClick={fn}/></Box>`).
2. Un custom renderer (`react-reconciler`) serializa cada commit a un árbol `WebNode`
   (`src/web-protocol.ts`: `type`/`props`/`children` string-safe; las funciones →
   `handlerId` `"h#N"`).
3. El host publica `web_commit{rootId, tree, placement}` vía un callback `onCommit`.
4. El webview materializa (`webview/RemoteRoot`) y devuelve `web_event{handlerId,
   payload}` por `fireEvent`.

**El protocolo es 100% transport-agnóstico:** es JSON plano, y el `WebBridge` solo depende
de un callback `onCommit(rootId, tree, placement)`. Hoy ese callback publica al webview
de VS Code (`vscode.Webview.postMessage`), pero **podría publicar a un WebSocket sin
tocar ni una línea de las herramientas**. Además, `lastTrees` + `republish()` ya existen
para rehidratar tras una recarga del webview — exactamente lo que un cliente remoto que
se reconecta necesita.

**Conclusión:** frida-remote-control **no es un porte** de `pi --mode rpc`. Es
**multiplexar este bus existente** a clientes remotos. El cliente remoto es el **mismo
webview React** con un *transport* WebSocket en lugar de `acquireVsCodeApi()`.

## Decisión

**No portear `pi --mode rpc`.** Construir `frida-remote-control` sobre el bus Remote
React existente, en 4 piezas:

### 1. `WebBridge` multiplexado (plataforma — el refactor bloqueante)

`onCommit` pasa de **1:1** (un webview) a **1:N** (webview local + N clientes remotos).
Un `WebBridgeMultiplexer` (o una lista de *subscribers* en el `WebBridge`) hace broadcast
de cada `web_commit` a todos los clientes conectados. `fireEvent` ya es por-`rootId`, así
que los eventos entrantes se enrutan igual vengan de donde vengan. `lastTrees` +
`republish()` se reusan para rehidratar a cualquier cliente que (re)conecte. **Este es el
único trabajo de plataforma que bloquea todo lo demás.**

### 2. `frida-remote-control` server (extensión nueva)

Un servidor **WebSocket dentro del extension host** que:

- Habla el **mismo protocolo** `web_commit`/`web_event` del bus (es el *transport* de un
  *subscriber* más del multiplexer).
- **Auth**: token bearer + **QR code de pairing** (URL+token) mostrado en el webview /
  notificación de Frida (patrón `@noahsaso` `pi-remote` y `zerray` `/remote-control-pair`).
- **HTTP** sirve el cliente web estático (el mismo bundle React del webview de Frida,
  apuntando al WebSocket).
- Opcional: **multi-sesión / discovery** (`/sessions`) si Frida soporta N sesiones
  simultáneas (patrón `@noahsaso` `/pi/{id}/`).

### 3. Abstracción de *transport* en el cliente

El webview React (`webview/`) hoy habla con el host vía `acquireVsCodeApi().postMessage`.
Se abstrae tras una interface `Transport { send(msg); onMessage(cb) }` con dos
implementaciones: **VS Code** (`acquireVsCodeApi`) y **WebSocket**. El cliente remoto es
el **mismo React**, distinto *transport*. Idealmente el webview ya es *responsive*; si
no, un *build* móvil (CSS responsive o subset de componentes) — parte del alcance, no de
la decisión.

### 4. Acceso remoto (transporte de red)

Frida **no puede ofrecer el relay cloud outbound de Claude** (requiere infra server
propia de Frida: relay central, credenciales *short-lived*, app móvil nativa — fuera del
alcance de una extensión VS Code). En su lugar:

- **LAN** (baseline): bind a la IP local — funciona siempre dentro de la red (patrón
  `@firstpick` `remote-webui`).
- **Tailscale** (recomendado para fuera-de-casa): VPN *zero-trust*, sin abrir puertos
  públicos (patrón `@noahsaso` `pi-remote`).
- **Túnel** (cloudflare/ngrok): alternativa sin Tailscale.

## Consecuencias

**(+) Reutilización masiva.** El 80% ya existe: protocolo Remote React, webview React,
`lastTrees`/`republish`. El *remote control* es "un segundo frontend del mismo bus".

**(+) Sync en tiempo real "gratis".** Como todos los clientes reciben los mismos
`web_commit` (broadcast), la conversación, subagentes y workflows se mantienen en sync
entre webview local y remoto(s) — sin lógica extra. Es el modelo "work from both surfaces
at once" de Claude.

**(+) Reconnect "gratis".** `lastTrees` + `republish()` ya rehidratan tras recarga del
webview; un cliente WebSocket que se reconecta hace exactamente lo mismo.

**(+) Independiente del contenido.** No bloquea ni depende de `#18` (tokens) ni `#21`
(hermes). Es puramente una capa de *transport* sobre el bus.

**(−) Refactor del `WebBridge` a bus multiplexado** — el único trabajo de plataforma
bloqueante. Pequeño (añadir *subscribers* + broadcast en `commit()`), pero toca el bus
central.

**(−) Abstracción de *transport* en el cliente** — refactor del webview para no acoplarlo
a `acquireVsCodeApi()`.

**(−) Build móvil del webview** — el webview actual está pensado para sidebar de VS Code;
necesita ser *responsive* o tener un subset móvil.

**(−) RIESGO CORPORATIVO (importante).** El entorno de Frida es corporativo restrictivo
(sin permisos de instalación). Tailscale y los túneles requieren permisos de red que
pueden no estar disponibles. **LAN funciona siempre** dentro de la red corp. Para
fuera-de-casa, el usuario debe poder instalar Tailscale o usar un túnel — si no, el
*remote control* queda limitado a LAN. El ADR **no depende** de Tailscale; LAN es el
baseline y Tailscale/túnel son *opt-in*.

**(−) Sin app móvil nativa.** Claude tiene apps iOS/Android; Frida ofrece un cliente
**web** (browser móvil). No está en alcance una app nativa.

## Alternativas consideradas

**A) Portear `pi --mode rpc` al contexto embebido.** RECHAZADA. Frida no es el CLI;
reconstruir la capa RPC del SDK (`dist/modes/rpc/`) sería más trabajo y menos natural que
multiplexar el bus Remote React que Frida **ya implementa y usa** para todo su UI. Las
extensiones `pi-remote*` son **referencia de patrones**, no código portable.

**B) Relay cloud outbound tipo Claude** (relay central propio + credenciales *short-lived*
- app móvil). RECHAZADA. Requeriría infra server propia de Frida — fuera del alcance de
una extensión VS Code. Tailscale/túnel es el equivalente *autohospedado* y *zero-trust*.

**C) LAN-only (como `@firstpick/remote-webui`).** ACEPTADA COMO SUBCONJUNTO. Es el
*baseline* de transporte de la pieza 4, no una alternativa completa. frida-remote-control
lo incluye como modo mínimo (sin Tailscale/túnel).

## Conexiones con el roadmap

- **`WebBridge` / Remote React** (`src/web-bridge.ts`, `src/web-protocol.ts`) — la base.
  frida-remote-control la multiplexa (pieza 1).
- **`#7` (store de estado, Fase 2)** — `lastTrees`/`republish` ya es un *proto-store*;
  frida-remote-control lo reusa para rehidratar clientes que reconectan. Refuerza la
  dirección del #7 Fase 2.
- **`#24` frida-background-tasks (Channels)** — **COMPLEMENTARIO**, no redundante.
  *Channels* = async (eventos *push* desde Discord/Telegram/cron, el humano responde
  cuando puede). *Remote Control* = síncrono bidireccional (control completo de la sesión
  en tiempo real). Cubren dos enfoques distintos de la tabla "Choose the right approach"
  de Claude. GSD-pi `remote-questions` era solo *Channels*; frida-remote-control añade el
  *Remote Control* completo.
- **`#28` frida-relay** — **DISTINTO**. El `relay` del roadmap era "corrección gobernada
  sobre hermes" (relay de memoria/correcciones), no control remoto de sesión. Mismo
  sustantivo, concepto distinto; no hay conflicto de nombres porque `#28` es memory-relay
  y este es session-remote-control.
- **Independiente de `#18` (tokens), `#21` (hermes), `#16` (skills).** No se bloquea por
  la cadena crítica de metodología.

## Mapeo al ecosistema Pi (referencia de patrones, NO porte)

| Pieza frida-remote-control | Referencia Pi | Qué se toma |
| --- | --- | --- |
| WebSocket server + mismo protocolo | `@k3_2o/pi-remote` | server runtime, session multiplexing |
| Browser UI móvil + QR + token auth + discovery | `@noahsaso/pi-remote` | UX móvil, pairing, `/sessions` |
| Relay daemon + `/remote-control-pair` (QR+hex) | `zerray/pi-remote-control` | pairing flow, ADRs de relay |
| LAN-only baseline | `@firstpick/remote-webui` | bind a IP local, "trusted network" |
| App móvil nativa | `zerray/pi-remote-control` (iOS) | **NO** — fuera de alcance (web, no nativa) |
