# CONTEXT.md — Extensión VS Code sobre Pi para [Empresa]

Documento de entendimiento compartido para una extensión de VS Code basada en
**Pi** (el agente de programación minimalista de Mario Zechner /
`earendil-works/pi`, pi.dev) que se conecta por defecto al proveedor de LLM
interno de la empresa, con un comportamiento similar a la extensión de
**Claude Code**.

> Este documento es **entendimiento compartido**: contexto (§1), acuerdo de
> seguridad (§2) y **lenguaje ubicuo** (§3). Las decisiones difíciles de revertir
> viven como ADR en [`docs/adr/`](./docs/adr); las reversibles se resumen en §4.
> Cualquier cambio de alcance debe actualizarse aquí y, si aplica, en un ADR.

---

## 1. Contexto y motivación

La empresa tiene políticas estrictas de seguridad. **OpenCode fue prohibido**
porque permite usar modelos libres / no aprobados. La empresa ya dispone de un
**router propio tipo-OpenRouter** (compatible con OpenAI) que centraliza el
acceso a modelos aprobados y contratados (p. ej. Microsoft), con API keys
controladas y emitidas por desarrollador.

**Idea de solución:** una extensión de VS Code (estilo Claude Code / Copilot)
basada en Pi que, al instalarse, use automáticamente el proveedor autorizado y
solo pida al desarrollador su API key personal, con posibilidad de rotarla
cuando venza.

---

## 2. ⚠️ Acuerdo de seguridad (lo más importante — no perder de vista)

**La extensión NO es un perímetro de seguridad.** *(Decisión formalizada en
[ADR-0001](./docs/adr/0001-alcance-disuasivo-no-perimetro.md).)*

- Modelo de amenaza: **fuga de datos (egress)** — el código fuente no debe salir
  hacia modelos o endpoints no autorizados.
- **No existe control de egress de red** por el momento.
- Sin control de red, **ninguna extensión de cliente puede prevenir la fuga
  deliberada**: un desarrollador puede evadirla trivialmente (navegador, `curl`,
  Postman, otra extensión tipo Continue/Cline/Copilot apuntada a un modelo
  gratuito, o `pi`/`@oh-my-pi/pi-coding-agent` instalado aparte, dado que son
  open source).

Por lo tanto, el proyecto se entrega bajo el **alcance (b): UX + centralización +
auditoría + disuasivo**, no como control de seguridad:

- **UX tipo Claude Code** sobre los modelos aprobados.
- **Facturación centralizada**: todo el uso sancionado pasa por el router.
- **Auditoría**: todo lo que pasa por el router queda logueado (quién, qué, cuándo).
- **Disuasivo por fricción**: hacer "lo correcto" (modelo aprobado) sea lo fácil
  y por defecto; "lo incorrecto" requiera esfuerzo consciente. *(Matiz, ver
  [ADR-0005](./docs/adr/0005-descubrimiento-de-recursos-abierto.md): con el
  descubrimiento de recursos abierto, la fricción **dentro de la propia
  herramienta** se reduce; el candado es el **default**, no enforced.)*

> **Declaración obligatoria en toda documentación interna:**
> *"Esta herramienta no previene la fuga deliberada de código. La prevención
> dura de egress requiere un control de red (allowlist/proxy/VPN que bloquee
> todo endpoint LLM excepto el router de la empresa), pendiente de implementar."*

La **prevención dura de egress** es un **prerrequisito de red** que la extensión
no sustituye. Recomendación: plantear a seguridad este gap antes de prometer
cualquier garantía de confidencialidad.

---

## 3. Lenguaje

**Router (de la empresa):**
Gateway interno tipo-OpenRouter que centraliza el acceso a los modelos aprobados;
todo el uso sancionado pasa por aquí y queda auditado. En Pi se registra como un _provider_.
_Evitar:_ gateway, proxy (demasiado genéricos).

**Provider (de Pi):**
La abstracción de Pi para un backend de LLM (`pi.registerProvider(...)`). El _router_ de la empresa se enchufa aquí. Un provider ofrece uno o más modelos.
_Evitar:_ "endpoint", "modelo" (un modelo pertenece a un provider).

**Extensión de Pi:**
Módulo TypeScript (factory inline o paquete) que Pi carga **en-proceso** para registrar tools, providers, comandos o handlers de eventos. Corre con los permisos del proceso. (El gate de aprobación y el proveedor del router son extensiones de Pi.)

**Extensión VS Code:**
El producto que construimos — el `.vsix` que TI instala. **No** es lo mismo que una "extensión de Pi".
→ *Siempre desambiguar:* "extensión de Pi" ≠ "extensión VS Code".

**Perímetro de seguridad:**
Un control que **impide** la fuga. Este proyecto **no** lo es (ver §2 / ADR-0001).
_Evitar:_ aplicar "perímetro"/"candado" a esta herramienta.

**Disuasivo:**
Hacer lo correcto fácil y por defecto; lo incorrecto requiere esfuerzo consciente. Es la postura real del proyecto (no un candado). Con recursos abiertos (ADR-0005), la fricción _dentro de la herramienta_ se reduce.

**Egress:**
Salida de datos de la máquina del desarrollador hacia un endpoint. El modelo de amenaza es la **fuga por egress** hacia modelos/endpoints no autorizados.

**Gate (de aprobación):**
El paso de confirmación antes de ejecutar un tool, implementado con el evento `tool_call` de Pi (bloquea con `{block:true}`) más un puente al webview. Clasificación: **libres** = `read`/`grep`/`find`/`ls`; **diff** = `edit`/`write`; **siempre** = `bash`.

**Toggle de sesión:**
Bandera per-session que silencia los gates de `edit`+`write` ("aceptar todas esta sesión"). **Nunca** cubre `bash`.

**Proveedor exclusivo (por defecto):**
El router + modelo fijo es el valor **por defecto** y lo único que el onboarding configura — pero **no** está _enforced_: un desarrollador puede registrar otro proveedor (ADR-0005).
_Evitar:_ "candado", o "exclusivo" sin el "(por defecto)".

**Onboarding de key:**
Flujo que pide al dev su API key personal (guardada en `SecretStorage`) al activar, y la re-pide ante un 401.

**MVP / Piloto:**
El `.vsix` inicial, instalado por TI para un puñado de desarrolladores.

---

## 4. Decisiones

Las marcadas con **ADR** son difíciles de revertir y sorprendentes sin contexto;
el resto son reversibles o el camino obvio y se detallan aquí.

| # | Decisión | Resumen / Ref |
|---|----------|---------------|
| 1 | Modelo de amenaza | Fuga de datos (egress) — _ver [ADR-0001](./docs/adr/0001-alcance-disuasivo-no-perimetro.md)_ |
| 2 | Perímetro de seguridad | Red + router (red pendiente). La extensión es UX, **no** candado — _ver [ADR-0001](./docs/adr/0001-alcance-disuasivo-no-perimetro.md)_ |
| 3 | UX objetivo | Panel lateral completo tipo Claude Code (chat + tool-cards + diffs aprobables) |
| 4 | Motor | **Pi** (no oh-my-pi). Empezar básico; subagentes/MCP/planeación como extensiones después |
| 5 | Integración de Pi | **SDK embebido en-proceso** — _ver [ADR-0002](./docs/adr/0002-sdk-en-proceso-no-rpc.md)_ |
| 6 | Conexión / proveedor | Router hardcoded en código + key en `SecretStorage` + modelo único (default) — detalle abajo |
| 7 | Aprobación de acciones | Gates vía `tool_call`; libres/diff/siempre — detalle abajo |
| 8 | Distribución | **`.vsix` solo por TI**, key por dev — _ver [ADR-0003](./docs/adr/0003-instalacion-por-ti-key-por-dev.md)_ |
| 9 | Mantenimiento | **Depender + pin exacto, no forkear** — _ver [ADR-0004](./docs/adr/0004-depender-y-pin-sin-forkear.md)_ |
| 10 | Carga de recursos del agente | **Descubrimiento abierto** — _ver [ADR-0005](./docs/adr/0005-descubrimiento-de-recursos-abierto.md)_ |
| 11 | Phone-home a pi.dev | **Desactivado** (detalle abajo) |
| 12 | Bump de Pi | Pin exacto + vigilancia out-of-band en CI + rebuild+test. **Responsable: PSG** (detalle abajo) |
| 13 | Sesiones (JSONL) | `context.globalStorageUri`, desacoplado del `agentDir` (detalle abajo) |
| 14 | Preguntar al usuario (`ask_user_question`) | Tool dedicado nativo vía puente al webview, **no** `ExtensionUIContext` general — _ver [ADR-0006](./docs/adr/0006-preguntar-al-usuario-tool-dedicado.md)_ |

### D6 — Conexión / proveedor

El router se declara **en código** (no en `models.json`) y se registra **directamente
en `ModelRuntime.registerProvider(...)`** (no en la factory) para que `getModel(...)` lo
resuelva. Valores concretos:
`id: "softtek-devengine"`, `name: "Softtek DevEngine Gateway"`,
`baseUrl: "https://mywork.softtek.com/apg/devengine"`, `api: "openai-completions"`,
modelo único `gpt-5.4-mini` (`contextWindow: 400000`, `maxTokens: 128000`).

**Auth (refinado tras probar en vivo):** el gateway espera **`X-Api-Key: <key>`**,
no `Authorization: Bearer`. Se combinan tres piezas: (1) la key —leída de
`SecretStorage` por el host— se fija con `ModelRuntime.setRuntimeApiKey(...)` para
que `getAuth` resuelva y Pi **no bloquee** con *"No API key found"*; (2) el proveedor
se declara con `authHeader:false` (Pi no envía `Authorization: Bearer`); (3) la
factory inyecta el `X-Api-Key` real vía `before_provider_headers`. La factory
**solo instala hooks** (no registra el proveedor; eso va en
`ModelRuntime.registerProvider` para que `getModel` lo vea):

```ts
pi.on("before_provider_headers", (event, ctx) => {
  if (ctx.model?.provider !== "softtek-devengine") return; // CRÍTICO (ADR-0005):
  event.headers["X-Api-Key"] = currentKey;                 // sin esto, filtramos
  event.headers["authorization"] = null;                   // la key empresarial
});                                                      // a un endpoint externo
```

La key vive **solo en memoria del proceso** (no en env — sería visible al tool
`bash` — ni en `auth.json`). El modelo se pasa **explícitamente** al
`createAgentSession` para que el default nuestro no lo desplace (necesario por
ADR-0005). La detección de 401 usa `after_provider_response`
(`event.status === 401`, scoping igual al de arriba) → reabre el onboarding.
**No es un candado:** con el descubrimiento abierto (ADR-0005) un dev puede
registrar otro proveedor; la empresa controla el _default_ vía código + router,
no el conjunto accesible.

### D7 — Aprobación (gates)

Pi core **no** trae pop-ups de permiso. El evento `tool_call` **bloquea**
(`return { block: true, reason }`) y corre **antes** de ejecutar, con acceso al
input — así el diff de `edit` (`{path, edits:[{oldText,newText}]}`) y el de
`write` (`{path, content}` vs archivo actual) se calculan del input **antes** de
aplicar. **No** hace falta fork ni envolver los tools. Los gates son una
**extensión de Pi** (solo el handler de evento de extensión puede bloquear;
`session.subscribe` es observador) que rutea el pedido al webview por un bridge
(postMessage) y queda en `await` de la decisión; al rechazar, `{block:true}` y Pi
le reporta el rechazo al modelo. Política: **libres** = `read`/`grep`/`find`/`ls`;
**gate con diff** = `edit`+`write` (toggle per-session compartido); **siempre
gateado, sin toggle** = `bash`. Pieza central del MVP.

### D11 — Phone-home a pi.dev: desactivado

Por defecto Pi contacta `pi.dev/api/latest-version` (update-check) y
`pi.dev/api/report-install` (telemetría) — egress fuera del router, en contra de
§2. Se desactivan ambos al iniciar la sesión embebida:
`enableInstallTelemetry:false` (vía `SettingsManager`) y `PI_SKIP_VERSION_CHECK=1`
(o `PI_OFFLINE=1`). Así el único egress del agente es hacia el router.
Consecuencia: al cortar el update-check, el aviso de parches es manual (ver D12).

### D12 — Bump de Pi (responsable: PSG)

(1) **Pin exacto** (no `^`) en `package.json` para reproducibilidad del `.vsix`.
(2) **Vigilancia de parches out-of-band** en **infra de CI/build** (no en la
máquina del dev): un job compara el pin con `latest` de npm/GitHub + suscripción a
releases de `earendil-works/pi` (egress desde CI, permitido). (3) **Bump =
reconstruir + probar**: CI reconstruye el `.vsix` por plataforma y corre la suite
antes de entregar a TI; puntos frágiles a regresar en cada bump: el gate
`tool_call`, el `registerProvider` y el empaquetado de nativos. Sin dueño activo,
la promesa de seguridad de ADR-0004 ("hereda parches upstream") se vacía y el pin
se estanca.

### D13 — Sesiones (JSONL)

El `agentDir` se mantiene en `~/.pi/agent` del dev para honrar el descubrimiento
abierto (ADR-0005), pero las sesiones se persisten en `context.globalStorageUri`
(almacenamiento global de la extensión VS Code), **desacopladas** vía un
`SessionManager` con path propio (o `PI_CODING_AGENT_SESSION_DIR`). **No**
in-memory: preserva `/resume`, branching y compaction. **Sensibles:** contienen
el historial = **código fuente** del dev; el `globalStorageUri` no debe quedar
bajo una carpeta sincronizada en la nube (OneDrive/iCloud) ni commiteada.

### D14 — Preguntar al usuario (`ask_user_question`)

Herramienta para que el modelo **pregunte con opciones concretas** (hasta 4
preguntas, 2-4 opciones cada una, con texto libre siempre disponible) en vez de
adivinar ante una decisión real (estrategia, alcance, convención). Equivalente en
**idea** a `@juicesharp/rpiv-ask-user-question`, pero **nativa de Frida**: una
extensión de Pi propia (`createAskUserQuestion`) que registra el tool y lo rutea al
webview por un puente `QuestionBridge`, **exactamente el mismo patrón que los gates
de D7** (`ApprovalBridge`). El `execute` del tool queda en `await` sobre el puente;
el webview muestra una `QuestionCard` (hermana de `ApprovalCard`) y responde por
`postMessage`; el handler del host resuelve la promesa y el resultado viaja al
modelo como `content` del tool.

**Decisión de costura** (formalizada en
[ADR-0006](./docs/adr/0006-preguntar-al-usuario-tool-dedicado.md)): tool dedicado,
**sin** activar el `ExtensionUIContext` general de Pi (`setUIContext`). Así el host
sigue en `ctx.mode="print"` / `hasUI=false` y eso **no afecta** a este tool, que no
usa `ctx.ui`. Descartado cargar el paquete rpiv por descubrimiento (su diálogo es
TUI propia y reabre ADR-0005).

**MVP:** multi-pregunta + texto-libre + single/multi-select + nota opcional.
Post-MVP **implementado**: validación runtime exhaustiva + reserved labels (`Otro`/`Escribe algo`/`Type something.`/`Other`/`Next`/`Siguiente`), previews markdown en la UI (side-by-side en single-select), pestañas tipo rpiv con pestaña Revisar (multregunta tabbed), y refactor `DialogBridge<T>` (base común de `ApprovalBridge`/`QuestionBridge`). Pendiente: i18n. _Detalle en [ADR-0006](./docs/adr/0006-preguntar-al-usuario-tool-dedicado.md) → «Post-MVP resuelto»._
**No reabre ADR-0005:** es código propio en `src/`, no una extensión ajena
descubierta.

---

## 5. Hechos a verificar (antes/durante la implementación)

Estos **no** se deciden a ciegas; deben confirmarse contra los docs reales de Pi
y el entorno de la empresa:

1. **Forma del API del router:** ✅ **Resuelto.** Es **OpenAI-compatible** →
   `api: "openai-completions"`; `baseUrl: https://mywork.softtek.com/apg/devengine`
   (Pi añade `/chat/completions`; verificar el path exacto en runtime). Modelo
   `gpt-5.4-mini` (ctx 400000, output 128000). **Auth NO es Bearer:** el gateway
   usa el header **`X-Api-Key`** → la key se inyecta por `before_provider_headers`,
   no por `setRuntimeApiKey` (ver D6).
2. **Set de herramientas built-in:** ✅ **Resuelto.** Son `read`, `bash`, `edit`,
   `write`, `grep`, `find`, `ls` (7). Por defecto: `read,bash,edit,write`. **No
   existe `search`** (corregido en D7).
3. **Hook de intercepción de tools:** ✅ **Resuelto.** El evento `tool_call`
   **bloquea** (`{block:true}`) y corre antes de ejecutar, con input mutable.
   Recetas oficiales: `permission-gate.ts`, `protected-paths.ts`. **No** hace falta
   fork ni envoltorio (ver D7).
4. **¿Pi es TS puro sin nativos?:** ✅ **Resuelto (NO).** El core es TS, pero trae
   `@silvia-odwyer/photon-node` (**`.wasm`**, resize de imágenes) y
   `@mariozechner/clipboard-*` (**`.node` N-API** por plataforma). Empaquetar el
   SDK en el `.vsix` requiere manejar WASM + nativos por plataforma y casar el ABI
   de Electron — **no es trivial** (ver [ADR-0002](./docs/adr/0002-sdk-en-proceso-no-rpc.md)).
5. **Paquete npm del SDK:** ✅ **Resuelto.** `@earendil-works/pi-coding-agent`
   (exports `createAgentSession`, `ModelRuntime`, `SessionManager`,
   `DefaultResourceLoader`, `defineTool`). Licencia MIT.
6. **¿Máquinas gestionadas (no-admin) por TI?:** ✅ **Resuelto (sí).** Las
   máquinas son gestionadas por TI → sustenta el "solo TI instala"
   ([ADR-0003](./docs/adr/0003-instalacion-por-ti-key-por-dev.md)).

---

## 6. Alcance del MVP

- SDK de Pi embebido en el extension host.
- Panel lateral tipo Claude Code: chat, tarjetas de tool-calls, diffs en línea.
- Proveedor hardcoded al router interno + modelo único (default).
- Onboarding de API key al activar (input en el panel) + rotación por comando y
  por detección de 401.
- Gates de aprobación: diffs para `edit`/`write` (con toggle de sesión), gate
  siempre para `bash`, `read`/`grep`/`find`/`ls` libres.
- **Empaquetado de nativos:** bundlear `photon-node` (`.wasm`) y `clipboard-*`
  (`.node` por plataforma) en el `.vsix`, casando el ABI de Electron del host
  (target platforms por OS/arquitectura).
- Empaquetado como `.vsix` para un piloto con un puñado de desarrolladores,
  instalado por TI.

---

## 7. Fuera del MVP (futuro)

- **Extensiones de Pi** por añadir en fases posteriores: subagentes, MCP,
  planeación. *(Si se cargan extensiones ajenas, hacerlo con allowlist curado, no
  con descubrimiento libre — o se reabre [ADR-0005](./docs/adr/0005-descubrimiento-de-recursos-abierto.md).)*
- **Migración a marketplace** privado (VS Code Marketplace corporativo) o registro
  **OpenVSX** interno a escala. (Depende de si el marketplace público de Microsoft
  está permitido en las máquinas de los devs.)
- **Trigger de fork** si el scope migra de disuasivo a perímetro de seguridad.
- **Control de egress de red** — el verdadero cierre del riesgo de fuga.
  Conversación pendiente con seguridad.

---

## 8. Stack tecnológico asumido

- **Motor del agente:** Pi (`earendil-works/pi`) vía SDK, dependencia npm pinneada
  (pin exacto).
- **Host de la extensión:** VS Code Extension API (Node), webview para el panel
  lateral.
- **Almacenamiento de key:** `vscode.SecretStorage` (keychain del SO, cifrado,
  global).
- **Sesiones:** archivos JSONL en `context.globalStorageUri` (desacoplado del
  `agentDir` del dev), con árbol `id`/`parentId` para branching (formato nativo de
  Pi). **Sensibles:** contienen código fuente.
- **Licencia de Pi:** MIT (permite redistribución propietaria con atribución;
  requerirá *security/license review* interna de la dependencia).
- **Responsable: PSG** — vigila releases de Pi, bumpea el pin exacto, mantiene el
  CI y atiende roturas de upstream (ver D12).

---

## 9. Notas sobre Pi vs oh-my-pi (referencia)

- **Pi** (`pi-mono` / `earendil-works/pi`, pi.dev): agente de terminal minimalista,
  TypeScript, **4 modos** — interactive (TUI), print/JSON (`pi -p`, `--mode json`),
  **RPC** (JSON sobre stdio, `docs/rpc.md`), y **SDK** (embeber; ejemplo de
  referencia: OpenClaw). Proveedores custom vía `models.json`/extensiones.
  Intencionalmente **sin** MCP, subagentes, pop-ups de permiso, background bash,
  to-do's ni plan mode (todo se añade como extensión/skill/template).
- **oh-my-pi / `omp`** (can1357): fork de Pi "con baterías incluidas" — ~55k líneas
  de Rust, 32 herramientas, 40+ proveedores, LSP, DAP, browser, subagentes,
  ediciones hashline. **Descartado para este proyecto** por complejidad y porque su
  core nativo complica el empaquetado; Pi básico cumple el MVP y permite la
  progresión de extensiones prevista.
