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
todo el uso sancionado pasa por aquí y queda auditado. En Pi se registra como un *provider*.
*Evitar:* gateway, proxy (demasiado genéricos).

**Provider (de Pi):**
La abstracción de Pi para un backend de LLM (`pi.registerProvider(...)`). El *router* de la empresa se enchufa aquí. Un provider ofrece uno o más modelos.
*Evitar:* "endpoint", "modelo" (un modelo pertenece a un provider).

**Extensión de Pi:**
Módulo TypeScript (factory inline o paquete) que Pi carga **en-proceso** para registrar tools, providers, comandos o handlers de eventos. Corre con los permisos del proceso. (El gate de aprobación y el proveedor del router son extensiones de Pi.)

**Extensión VS Code:**
El producto que construimos — el `.vsix` que TI instala. **No** es lo mismo que una "extensión de Pi".
→ *Siempre desambiguar:* "extensión de Pi" ≠ "extensión VS Code".

**Perímetro de seguridad:**
Un control que **impide** la fuga. Este proyecto **no** lo es (ver §2 / ADR-0001).
*Evitar:* aplicar "perímetro"/"candado" a esta herramienta.

**Disuasivo:**
Hacer lo correcto fácil y por defecto; lo incorrecto requiere esfuerzo consciente. Es la postura real del proyecto (no un candado). Con recursos abiertos (ADR-0005), la fricción *dentro de la herramienta* se reduce.

**Egress:**
Salida de datos de la máquina del desarrollador hacia un endpoint. El modelo de amenaza es la **fuga por egress** hacia modelos/endpoints no autorizados.

**Gate (de aprobación):**
El paso de confirmación antes de ejecutar un tool, implementado con el evento `tool_call` de Pi (bloquea con `{block:true}`) más un puente al webview. Clasificación: **libres** = `read`/`grep`/`find`/`ls`; **diff** = `edit`/`write`; **siempre** = `bash`.

**Toggle de sesión:**
Bandera per-session que silencia los gates de `edit`+`write` ("aceptar todas esta sesión"). **Nunca** cubre `bash`.

**Proveedor exclusivo (por defecto):**
El router + modelo fijo es el valor **por defecto** y lo único que el onboarding configura — pero **no** está *enforced*: un desarrollador puede registrar otro proveedor (ADR-0005).
*Evitar:* "candado", o "exclusivo" sin el "(por defecto)".

**Onboarding de key:**
Flujo que pide al dev su API key personal (guardada en `SecretStorage`) al activar, y la re-pide ante un 401.

**MVP / Piloto:**
El `.vsix` inicial, instalado por TI para un puñado de desarrolladores.

---

## 4. Decisiones

Las marcadas con **ADR** son difíciles de revertir y sorprendentes sin contexto;
el resto son reversibles o el camino obvio y se detallan aquí.

| # | Decisión | Resumen / Ref |
| --- | ---------- | --------------- |
| 1 | Modelo de amenaza | Fuga de datos (egress) — *ver [ADR-0001](./docs/adr/0001-alcance-disuasivo-no-perimetro.md)* |
| 2 | Perímetro de seguridad | Red + router (red pendiente). La extensión es UX, **no** candado — *ver [ADR-0001](./docs/adr/0001-alcance-disuasivo-no-perimetro.md)* |
| 3 | UX objetivo | Panel lateral completo tipo Claude Code (chat + tool-cards + diffs aprobables) |
| 4 | Motor | **Pi** (no oh-my-pi). Empezar básico; subagentes/MCP/planeación como extensiones después |
| 5 | Integración de Pi | **SDK embebido en-proceso** — *ver [ADR-0002](./docs/adr/0002-sdk-en-proceso-no-rpc.md)* |
| 6 | Conexión / proveedor | Router hardcoded en código + key en `SecretStorage` + modelo único (default) — detalle abajo |
| 7 | Aprobación de acciones | Gates vía `tool_call`; libres/diff/siempre — detalle abajo |
| 8 | Distribución | **`.vsix` solo por TI**, key por dev — *ver [ADR-0003](./docs/adr/0003-instalacion-por-ti-key-por-dev.md)* |
| 9 | Mantenimiento | **Depender + pin exacto, no forkear** — *ver [ADR-0004](./docs/adr/0004-depender-y-pin-sin-forkear.md)* |
| 10 | Carga de recursos del agente | **Descubrimiento propio `~/.frida`** (revierte ADR-0005 para el agentDir): las extensiones de `~/.pi` fallan en el runtime de VS Code (`import.meta.resolve`) y chocan con el CLI. Frida usa su propio `agentDir` — *ver [ADR-0010](./docs/adr/0010-frida-agentdir-propio.md)* |
| 11 | Phone-home a pi.dev | **Desactivado** (detalle abajo) |
| 12 | Bump de Pi | Pin exacto + vigilancia out-of-band en CI + rebuild+test. **Responsable: PSG** (detalle abajo) |
| 13 | Sesiones (JSONL) | `context.globalStorageUri`, desacoplado del `agentDir` (detalle abajo) |
| 14 | Preguntar al usuario (`ask_user_question`) | Tool dedicado nativo vía puente al webview, **no** `ExtensionUIContext` general — *ver [ADR-0006](./docs/adr/0006-preguntar-al-usuario-tool-dedicado.md)* |
| 15 | Lista de tareas (`todo`) + Configuración | Tool `todo` nativo (porte de rpiv-todo, sin overlay TUI) + panel en el webview + Configuración conmutable (settings ↔ webview) — *ver [ADR-0007](./docs/adr/0007-todo-nativo-configuracion-conmutable.md)* |
| 16 | pi-lens: capa semántica del *agente* | Distinto del LSP de VS Code (que sirve al *humano* que edita). Se aprovechan los tools de pi-lens orientados al modelo (ast_grep, funnel, blast-radius, read-guard); **no** se publican squiggles/formato en el editor (redundante con VS Code); auto-format/autofix de pi-lens desactivados y diagnósticos visibles como resumen por turno en el panel (ver ADR-0008) — *detalle D16*
| 17 | Reintentos del provider | Cuando el gateway devuelve un error retriable, el SDK reintenta (maxRetries:3) y Frida lo muestra como el TUI: countdown "Reintentando (n/3)…", doble Esc para cancelar (abortRetry) y error final si todos fallan — *detalle D17*
| 18 | Alineación con el TUI de pi | Paridad de eventos que el TUI cubría y Frida no: reintentos de compactación, progreso de tools (toolCallId), feedback de abort, skill blocks colapsables, branch summary y sync de thinking — *detalle D18*
| 19 | DevEngine: round-trip de `reasoning_content` | El gateway devuelve reasoning pero lo rechaza de vuelta → 500 al continuar sesiones con razonamiento. Workaround `requiresThinkingAsText: true` (reenvía thinking como texto); **quitarlo** cuando DevEngine arregle el round-trip — *ver [ADR-0009](./docs/adr/0009-devengine-reasoning-roundtrip.md)*
| 20 | agentDir propio (`~/.frida`) | Frida ya no lee `~/.pi` para extensiones/skills/auth/models; usa `~/.frida`. Evita errores de carga (`import.meta.resolve`) y choque con el CLI `pi`. **pi-lens queda fuera** hasta Fase 2 (adaptar/polyfill) — *ver [ADR-0010](./docs/adr/0010-frida-agentdir-propio.md)*

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
registrar otro proveedor; la empresa controla el *default* vía código + router,
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
Post-MVP **implementado**: validación runtime exhaustiva + reserved labels (`Otro`/`Escribe algo`/`Type something.`/`Other`/`Next`/`Siguiente`), previews markdown en la UI (side-by-side en single-select), pestañas tipo rpiv con pestaña Revisar (multregunta tabbed), y refactor `DialogBridge<T>` (base común de `ApprovalBridge`/`QuestionBridge`). Pendiente: i18n. *Detalle en [ADR-0006](./docs/adr/0006-preguntar-al-usuario-tool-dedicado.md) → «Post-MVP resuelto».*
**No reabre ADR-0005:** es código propio en `src/`, no una extensión ajena
descubierta.

**Migración a fridaWeb (D21/ADR-0012):** la implementación web dejó de usar
`QuestionBridge`+`QuestionCard` (puente propio + `postMessage`) y ahora se monta como
UI React en el host vía `fridaWeb(factory)` → **`WebQuestionnaire`** (tabs, multiSelect
con checkbox visual ☑/☐, preview markdown side-by-side, texto libre).
`QuestionBridge`/`QuestionCard`/`question-bridge.ts`/`ask-user-question.ts` fueron
**retirados** en la limpieza. La decisión del tool dedicado se mantiene; migró solo el
canal de UI.

### D15 — Lista de tareas (`todo`) + Configuración

Herramienta para que el modelo **planee y siga trabajo multi-paso** (máquina
`pending → in_progress → completed`, más `deleted`; dependencias `blockedBy` con
validación de transiciones/ciclos). Equivalente en **idea** a
`@juicesharp/rpiv-todo`, pero **nativa de Frida**: porte de su lógica (reducer,
replay, schema) a `src/tools/todo/`, registrado como factory inline. El **overlay
TUI** (`setWidget`/`aboveEditor`) **no aplica** (host en `print`/`hasUI=false` por
ADR-0006): su equivalente es un `TodoPanel` en el webview, fijo arriba del
transcript y auto-oculto si la lista vacía.

Sin puente bloqueante: a diferencia de D14, el tool **no** espera respuesta del
usuario — el `execute` muta un holder en memoria (`src/todo-state.ts`) y el host
publica el estado al webview desde `tool_execution_end` (canal unidireccional). La
lista **sobrevive sin disco**: cada `toolResult` "todo" lleva el snapshot en
`details` y `replayFromBranch` lo reconstruye al crear/abrir sesión (resiste
recarga, switch y compaction).

**Configuración conmutable** (formalizada en
[ADR-0007](./docs/adr/0007-todo-nativo-configuracion-conmutable.md)): settings de
VS Code (`frida.todo.enabled`, `frida.askUserQuestion.enabled`, default `true`)
como fuente de verdad de intención, expuestos en una vista "Configuración" del
webview (botón ⚙). Las factories se envuelven con `toggleable(getEnabled,
factory)`; un cambio persiste el setting y dispara `session.reload()`, que
re-ejecuta las factories y re-evalúa los getters → el tool aparece/desaparece **en
caliente sin perder el historial**. El panel se oculta cuando el toggle está
apagado, aunque haya tareas en el historial.

**No reabre ADR-0005:** es código propio en `src/`, no una extensión ajena
descubierta. *Detalle en [ADR-0007](./docs/adr/0007-todo-nativo-configuracion-conmutable.md)*

### D16 — pi-lens es la capa semántica del *agente*, distinta del LSP del editor

`pi-lens` ya está instalado en `~/.pi/agent` y, con el descubrimiento abierto
(ADR-0005), **ya se carga en-proceso** al crear la sesión: el
`DefaultResourceLoader` lo resuelve vía `packageManager` desde el `agentDir`. Por
lo tanto, **no requiere registro ni empaquetado extra** en Frida — sus binarios
N-API (`@ast-grep/napi`), WASM (`web-tree-sitter`) y grammars viven en el
`agentDir` del dev.

**Distinción clave (no es redundancia):** el LSP de VS Code sirve al ***humano***
que teclea en el editor (squiggles, Problems, formateo on-save, go-to-definition
bajo el cursor). pi-lens sirve al ***agente*** que edita vía tools (`read`/`edit`/
`write`): le da capacidades semánticas afinadas para **ahorrar tokens** y para
**operar sobre archivos que el humano ni siquiera tiene abiertos**. Operan en
planos distintos — compiten por **proceso** (pueden correr dos servers del mismo
lenguaje a la vez), no por **función**.

**Decisión: aprovechar los tools que dan al *agente* lo que VS Code no le da;
no replicar el *editor*.**

- **Se aprovecha tal cual** (ya disponible para el modelo; aparece como tarjetas
  de tool normales; **VS Code no los sustituye**):
  - `ast_grep_search` / `ast_grep_replace`: búsqueda/reemplazo **estructural** con
    metavariables (`$VAR`, `$$$ARGS`) en ~40 lenguajes. Sin equivalente nativo en
    VS Code — evita regex frágiles al reescribir código. Probablemente lo más
    valioso para un agente que muta código.
  - Funnel de descubrimiento: `module_report` → `read_symbol` → `read_enclosing`
    (outline navegable **rankeado** con `usedBy`, `recommendedReads`,
    `blastRadius`, en ~¼ de tokens que un `read` entero). VS Code expone
    `documentSymbol`, pero **sin ranking, sin blast-radius, sin who-uses-this**.
  - `symbol_search`: índice BM25 siempre caliente de identificadores del proyecto
    ("¿qué archivos son relevantes a X?", demoviendo tests/vendor/docs). VS Code
    tiene `workspaceSymbol` (busca *definiciones*), no *rankea archivos*.
  - Review graph + blast radius: grafo `file → symbol → dependency` precomputado
    ("si tocas esto, *estos* archivos dependen de ello"). VS Code solo da
    `findReferences` uno-por-uno (lento) o `callHierarchy` (no todos los LSP).
  - `lsp_navigation` / `lsp_diagnostics` / `lens_diagnostics` como **consulta
    puntual del modelo** (definition/references/rename/diagnósticos bajo demanda).
  - **Read-before-edit guard**: bloquea al **modelo** de editar archivos que no ha
    leído en la sesión (zero-read / out-of-range / stale-hash). Es una **política
    sobre el agente**; VS Code no tiene concepto de "lo que el agente leyó".
    Complementa los gates de D7 → conviene **dejarlo activo**.

- **NO se integra al editor** (esto sí sería redundante con VS Code):
  - Publicar diagnósticos LSP como squiggles / panel *Problems*: VS Code ya corre su
    propio LSP (TS/ESLint/Python…) y ya los muestra. (Opción descartada por
    duplicación visible.)
  - Auto-format / autofix de pi-lens: VS Code formatea on-save; el de pi-lens
    competiría y, además, mutaría archivos **fuera** del gate (D7). **Desactivado
    en Frida** vía `PI_LENS_CONFIG_PATH` (merge de la config del usuario forzando
    `format.enabled`/`autofix.enabled` = false; sólo afecta al proceso de Frida,
    no al CLI `pi` del usuario).

**Trade-off de proceso (si el doble LSP pesa):** pi-lens permite `--no-lsp` para
apagar su propio LSP. Se **pierde** `lsp_navigation`, `lsp_diagnostics` y la
cascada de diagnósticos; se **conserva** (basado en tree-sitter WASM, no LSP):
`module_report`, `read_symbol`, `read_enclosing`, `symbol_search`,
`ast_grep_search/replace`, read-guard y review-graph/blast-radius. Es decir, el
~80 % más valioso para el agente sobrevive sin LSP. Opción a considerar si el
overhead de correr dos servers del mismo lenguaje resulta notorio.

**¿Construir tools propios sobre el LSP de VS Code en su lugar?** Técnicamente
posible (`vscode.executeDefinitionProvider`, `getDiagnostics`, …), pero implicaría
**reinventar** el funnel, el ranking y el blast-radius encima de primitivos sin
afinar, y amarrar al agente a lo que VS Code tenga indexado/abierto y a las
extensiones de lenguaje instaladas. Descartado: pi-lens ya cumple ese rol y ya
está cargado.

**Realización (implementado, *ver [ADR-0008](./docs/adr/0008-pi-lens-mutaciones-y-panel.md)*):**
(1) el auto-format/autofix de pi-lens está desactivado en Frida (`src/pilens-config.ts`

- `PI_LENS_CONFIG_PATH`, seteado antes de `loader.reload()`); (2) los diagnósticos de
pi-lens se muestran como **resumen por turno en el panel del webview** (NO en el
editor) escuchando el evento `pilens:diagnostics` del bus (`src/lens-diagnostics-bridge.ts`
- `webview/components/LensDiagnostics.tsx`). El estado LSP explícito (activo/fallido)
y el advisory textual del turno quedan fuera: pi-lens los publica vía `ctx.ui`
(`hasUI=false` en Frida) o los persiste en archivos internos, sin canal del bus
viable (ver ADR-0008, parte 2-C).

**No reabre ADR-0005:** no cargamos ni instalamos ninguna extensión ajena nueva;
sólo **consumimos** la ya descubierta. Tampoco genera egress ni mutaciones por
parte del host: los tools operan sobre texto local y el read-guard es una política
interna de pi-lens (ver la sección *Read-Before-Edit Guard* de
`pi-lens/docs/features.md`).

---

### D17 — Reintentos del provider: visibilidad y cancel (alineado al TUI de pi)

**Problema.** Cuando el gateway (Softtek DevEngine) devuelve un error
**retriable** (429 / 5xx / timeout), el SDK de Pi reintenta automáticamente
(`settings.retry.maxRetries` = **3** por defecto, backoff exponencial): por cada
intento emite `agent_start` → (fallo, sin texto) → `agent_end {willRetry:true}`

- `auto_retry_start {attempt, maxAttempts, delayMs, errorMessage}`, y al final
`auto_retry_end {success, finalError}`. La primera versión de Frida **ignoraba**
todos estos eventos → el indicador "Procesando…" parpadeaba 3 veces **en silencio**
sin respuesta ni error visible.

**Decisión: alinear el manejo con el TUI de pi** (la referencia canónica del
comportamiento del agente, igual que `/compact`, message queue, etc.). El TUI
usa un `RetryStatusIndicator` con **cuenta regresiva**, `Esc → session.abortRetry()`,
y `showError` solo si los reintentos se agotan.

**Realización (implementado):**

- `case "auto_retry_start"` en `wireSession` → `inRetry=true` + `post retry_start`
  al webview → el footer muestra **`Reintentando (n/3) en Xs… (doble Esc para cancelar)`**
  con countdown en vivo (`useState`+`useEffect` cada 250 ms sobre `state.retry.delayMs`).
- `case "auto_retry_end"` → `inRetry=false` + `post retry_end`; si `!success`,
  `post error` con el `finalError` del gateway → se pinta como `turn.error`
  (`Turn.tsx` ya lo renderizaba). **Esto revela la causa raíz** (429/5xx/timeout).
- `case "agent_end"` → si `errorMessage && !willRetry`, `post error` (errores
  terminales no-retriables).
- `abortRun()` → si `inRetry`, llama `session.abortRetry()` (cancela sólo el
  reintento) antes que `session.abort()` (el run entero). El doble-Esc del webview
  sigue posteando `abort`; el host decide cuál.

**Mismo mecanismo para los reintentos de la compactación:** la sumarización que
hace `/compact` (y la auto-compaction) también reintenta con el mismo presupuesto
(`summarization_retry_scheduled` / `_attempt_start` / `_finished`). Frida **reusa**
`state.retry` y el countdown: `summarization_retry_scheduled` → `retry_start`
(el countdown se muestra dentro del proc-bar "Compactando…" como
"Reintentando compactación (n/3) en Xs…"); `_attempt_start` / `_finished` →
`retry_end` (vuelve a "Compactando…"). El error final ya llega por
`compaction_end.errorMessage` (que Frida ya mostraba). Cancelar sigue siendo el
botón `Cancelar` → `cancel_compaction` (`abortCompaction`), no `abortRetry`.

**No es un candado ni introduce egress:** sólo consume eventos del SDK y los
reenvía al webview. El error que se muestra viene del provider (texto local).

**Punto frágil a regresar en cada bump de Pi** (junto a D12/ADR-0006): los
eventos `auto_retry_start`/`auto_retry_end` y su payload
(`{attempt, maxAttempts, delayMs, errorMessage}` / `{success, attempt, finalError}`),
el flag `willRetry` en `agent_end`, los eventos `summarization_retry_*`
(`{attempt, maxAttempts, delayMs, errorMessage}` / `{source, reason?}` / `{}`),
y el método `session.abortRetry()`.

---

### D18 — Alineación con el TUI de pi (paridad de eventos/features)

El TUI de pi (`modes/interactive/`) es la referencia canónica del comportamiento del
agente. Frida ya alineaba varios (`/compact`, message queue, `/fork`…); esta ronda
cerró los **huecos** que el TUI cubría y Frida no. Cada uno consume eventos del SDK
que antes se ignoraban (salvo #4/#5, que parsean mensajes) y los reenvía al webview.

- **Reintentos de la compactación** (`summarization_retry_scheduled/_attempt_start/
  _finished`, #1): reúso del `state.retry` y countdown de D17; el proc-bar "Compactando…"
  muestra "Reintentando compactación (n/3) en Xs…" y vuelve entre intentos. El error
  final ya venía por `compaction_end.errorMessage`.
- **Progreso de tools largos** (`tool_execution_update`, #2): Frida ahora propaga
  `toolCallId` en `tool_start`/`tool_end` y empareja por id (antes por nombre);
  `tool_update` acumula `partialResult` y `ToolCard` lo muestra en vivo (borde azul)
  mientras el tool sigue running. Hoy pocos tools lo emiten (los built-in no); es
  forward-compat para MCP/extensiones.
- **Feedback de cancelación** (`message_end` con `stopReason:"aborted"`, #3): post
  `info "Operación cancelada"`. Los errores de provider ya van por `agent_end`/
  `auto_retry_end` (D17).
- **Skill block colapsable** (#4): `parseSkillBlock` (regex del SDK) detecta
  `<skill name=…>…</skill>` en el mensaje del usuario y `SkillBlockCard` lo colapsa
  en `[skill] nombre` expandible (antes el SKILL.md crudo inundaba el transcript).
- **Branch summary** (`role:"branchSummary"`, #5): `postHistory` ya no lo ignora;
  `BranchSummaryCard` lo muestra colapsado al inicio del transcript (resumen del
  contexto previo al bifurcar).
- **Sync del thinking** (`thinking_level_changed`, #6): `sendModelInfo()` → el
  selector del webview se actualiza si el thinking cambia fuera de él.

**Descartado:** `queue_update` (#7) — Frida ya gestiona su `pendingQueue` sincronizada
con `session.prompt({streamingBehavior})`; escucharlo sería doble-gestión redundante.
`agent_settled` — sólo auto-shutdown del proceso TUI, no aplica a una extensión VS
Code. Estado LSP por idioma — va por `ctx.ui` (`hasUI=false`, ver ADR-0008).

**Punto frágil a regresar en cada bump de Pi:** los eventos `summarization_retry_*`,
`tool_execution_update` (`{toolCallId, toolName, args, partialResult}`), el
`toolCallId` en `tool_execution_start/end`, `message_end` (`{message}` con
`stopReason`/`errorMessage`), `thinking_level_changed` (`{level}`), la regex de
`parseSkillBlock` (`<skill name="…" location="…">…</skill>`), el `role:"branchSummary"`
y el helper `sendModelInfo` (lee `session.thinkingLevel`).

### D19 — ExtensionUIContext web: el mismo mecanismo de extensión del TUI (ADR-0011)

Frida implementa el slice **data-oriented** del `ExtensionUIContext` del SDK
(`pi.ui.select`/`input`/`confirm`/`notify`) y lo inyecta vía
`session.bindExtensions({ uiContext, mode: "rpc" })`. Así las **extensiones nativas de
pi que respetan el patrón RPC** funcionan en el webview **sin modificaciones**, usando
diálogos en vez de la factory Ink del TUI. El SDK ya separa «qué pide la extensión» de
«cómo lo muestra el cliente» (modo RPC de `rpc-mode.js`); `rpiv-ask-user-question` lo
explota con `runRpcQuestionnaire` (camina preguntas con `select`/`input` cuando
`ctx.mode==="rpc"` y `hasDialogUI(ctx.ui)`).

- **`src/ui-bridge.ts`** (`UiBridge extends DialogBridge`) + **`src/extension-ui-context.ts`**
  (`createFridaUiContext`): `select`/`input`/`confirm`/`editor` al webview; factories Ink
  (`setFooter`/`custom`/…) como **no-op**. `custom()` resuelve `undefined` a propósito →
  backstop de rpiv al dialog walker.
- **Cableado:** `await session.bindExtensions({ uiContext, mode: "rpc" })` tras
  `createAgentSession`. Antes Frida **no** llamaba `bindExtensions` → `pi.ui` era no-op.
- **Webview:** `UiDialog.tsx` (select/input/confirm) + estado `uiRequests`; mensajes
  `ui_requests`/`ui_notify`/`ui_response`.
- **`rpiv-ask-user-question`** se instala en `~/.frida/npm` y se declara en
  `settings.json` → el resourceLoader la carga con jiti (es `.ts`, no `import()` nativo).
- **Transición:** el `ask_user_question` **empotrado** sigue como **fallback** y se
desactiva (`!rpivAskPresent`) si rpiv está instalada (evita tool duplicado). Se elimina
  (464 líneas) cuando se confirme rpiv en runtime.

**No portado:** factories Ink (`setFooter`/`setHeader`/`custom(factory)`/`renderCall`) —
Ink (terminal) y web (navegador) son incompatibles; no-op como el propio RPC del SDK.
Trade-offs RPC: sin preview side-by-side, sin tabs, multi-select como texto `"1,3"`.

**Punto frágil a regresar en cada bump de Pi:** `AgentSession.bindExtensions({uiContext,
mode})` (agent-session.js), el contrato `ExtensionUIContext`/`ExtensionUIDialogOptions`
(`{signal?, timeout?}`), y la detección de modo en `ctx` (`ctx.mode`, `ctx.hasUI`,
`ctx.ui`) que consume `rpiv-ask-user-question/ask-user-question.ts`.

### D20 — frida-webview: Remote React para UI rica de extensiones (opción A, ADR-0012)

Las extensiones escriben UI con **JSX + React + estado** que corre en el **host**, y un
custom renderer (`react-reconciler`) **serializa** cada commit a un árbol `WebNode` que
el webview materializa. Es la opción A (frente a B = extensión-en-webview, descartada; y
C = declarativo, descartada por gestión manual de estado). No reusa `pi.ui.custom()`
(devuelve `Component` pi-tui, no React) — Frida añade su canal `pi.ui.fridaWeb(factory)`.

- **`src/frida-webview/index.ts`** — catálogo de tags intrinsic (`fbox`/`ftext`/
  `fbutton`/`finput`/`fselect`) tipados vía `declare global JSX.IntrinsicElements`.
- **`src/web-renderer.ts`** — custom renderer `react-reconciler@0.29.2` (LegacyRoot,
  mutation mode). `createWebRenderer(el, send)`; serializa snapshots por commit.
- **`src/web-bridge.ts`** — `WebBridge`: `render(factory)→Promise<T>` (resuelve al
  `done(result)`), `fireEvent` enruta `web_event`→handler.
- **`webview/components/RemoteRoot.tsx`** — espejo: `WebNode`→DOM, handlerIds→`web_event`.
- **Demo validado** (`src/demo/web-demo.tsx` + cmd `frida.demoWebReact`): contador con
  `useState`; ciclo commit↔event↔re-render funciona end-to-end.

**Gotcha crítico (bug real encontrado):** React pasa los children **dos veces** al host
config — en `props.children` (como elementos React con `_owner: FiberNode`) y vía
`appendChild`. Si `createInstance` copia `props` enteros, `JSON.stringify` del `web_commit`
choca con la circular `_owner→props→children`. **Fix:** `createInstance`/`commitUpdate`
excluyen `children` de los props serializados. Mantener al extender el host config.

**No cubierto aún:** catálogo limitado (falta Markdown/SelectList rica/Editor); snapshot
completo por commit (no diffing); rpiv sigue en modo RPC (reescribirlo con `fridaWeb`
recuperaría tabs/preview side-by-side). React+reconciler en el bundle host (+~500 KB).

### D21 — ask_user_question reimplementado sobre fridaWeb (fmarkdown, previews, checkbox)

El tool `ask_user_question` dejó de pasar por el `DialogBridge` (diálogos secuenciales) y
ahora se monta como **UI React en el host** vía `fridaWeb(factory)` (D20), igual que una
extensión nativa del TUI. Recupera la fidelidad completa del cuestionario del TUI:

- **`src/web-questionnaire.tsx`** — `WebQuestionnaire`: tabs (multi-pregunta), opciones
  con descripción, **multiSelect con checkbox visual ☑/☐**, **texto libre**, y
  **preview markdown side-by-side** cuando una opción single-select trae `preview`
  (layout 2 columnas; el preview sigue a la opción seleccionada o la primera con preview).
- **`fmarkdown`** en el catálogo (`src/frida-webview/index.ts` + `RemoteRoot.tsx`): reusa el
  renderer del webview (`react-markdown` + gfm + highlight). Sin deps nuevas.
- **`flex`** en `fbox` para repartir columnas.
- Reemplazó a `QuestionBridge`/`QuestionCard` y al modo RPC de rpiv (desactivado).

**Bug intermedio resuelto — `rpivAskPresent`:** la detección de rpiv miraba si existía el
**directorio** en `~/.frida/npm/node_modules` (queda tras un uninstall) → falso positivo →
la factory web se auto-desactivaba → `ask_user_question` **no figuraba en el `tools` del
request** y el modelo respondía en texto. **Fix:** detectar por `settings.json` packages
(lo que realmente carga el resourceLoader). El directorio se limpió con `npm uninstall`.

**Empaquetado como extensión externa — descartado (evaluado):** se consideró mover
`web-questionnaire.tsx` + `ask-user-question-web.ts` a `~/.frida/npm` (paridad con
pi-lens), pero el análisis mostró que `react` + `react-reconciler` (~500 KB) **deben
quedar en el bundle del host** (el renderer vive ahí), y `WebQuestionnaire` (~5 KB)
usa `useState` → requiere el **mismo** React que el reconciler, así que una extensión
externa necesitaría react inyectado vía `make(React)` + pragma `/** @jsx React.createElement */`.
Complejidad alta, ahorro de vsix nulo → se deja como factory inline.

### D22 — CONFIG_DIR_NAME de proyecto: posponer el aislamiento (`.pi` → `.frida`)

Evaluado y **pospuesto** (ADR-0013). `CONFIG_DIR_NAME` (const `.pi`) tiene dos niveles:
el **global** (`~/.pi/agent`) ya está aislado por ADR-0010 (pasamos `agentDir: ~/.frida`
explícito); el **de proyecto** (`<cwd>/.pi/{skills,prompts,themes,extensions}`) lo
consume `DefaultResourceLoader` sin override. Se consideró simetrizar (un `<cwd>/.frida`),
pero el SDK no expone override (es `export const`); las salidas son feature request
upstream (limpio), monkey-patch (frágil) o subclass del loader (deuda alta). Valor hoy
medio-bajo (las extensions de proyecto son raras y compatibles), costo medio-alto →
posponer y registrar como feature request a pi (`DefaultResourceLoader.projectDirs`).

### D23 — Tool `todo` como extensión web persistente (Remote React, ADR-0014)

El `todo` dejó de ser un porte **nativo** inline (`src/tools/todo/todo.ts` + panel
nativo `TodoPanel.tsx` + conducto `post {type:"todos"}`) y pasó a ser una
**extensión** con UI en frida-webview, reescrita a partir de `rpiv-todo` pero con UI
web. Segunda extensión web (tras `ask_user_question`, D21) y **primera con UI
persistente** (no diálogo).

- **Salto diálogo→persistente**: `fridaWeb` (bloquea hasta `done()`) no servía. Se
  añadió `WebBridge.mountPersistent(factory): {unmount}` (no bloquea) + un **store
  reactivo** (`todo-web/store`: `setTodoState` **emite**) que el componente consume
  con `useSyncExternalStore` → re-renderiza solo ante cada mutation. El host ya no
  publica nada.
- **Handshake recarga**: `WebBridge.republish()` (cachea el último árbol por rootId)
  se llama en `webview_ready` para re-publicar los roots persistentes ya montados
  cuando el webview se recarga (sesión existente → no hay `session_start` nuevo).
- **Extensión** (`todo-web/index.ts`): registra el tool + monta el panel al
  `session_start` + replay en session_compact + unmount en session_shutdown.
- **Reutilizado** intacto: `state-reducer`, `types`, `replay`, `response-envelope`,
  `task-graph`, `invariants`. **Eliminado**: `todo.ts`, `todo-state.ts`,
  `TodoPanel.tsx`, `postTodos()`, reducer/estado/tipos `todos` del webview, CSS
  `.todo-*`. **Preservado**: comando `/todos` (lee del nuevo store).
- **Inline** en `src/` (paridad D21: `useSyncExternalStore` exige el mismo React
  que el reconciler → extensión externa requeriría react inyectado).
- **Validado aislado** primero con `frida.demoWebPersistent` (timer + botón +
  `useSyncExternalStore`) antes de tocar el todo.
- **Placement footer + coexistencia**: el panel vive en el footer (no como overlay
  en el cuerpo), paridad con el `TodoPanel` nativo. Para eso se añadió
  `WebPlacement` ("overlay"|"footer") en `WebCommitMessage`, `mountPersistent(factory,
  placement)`, y `state.webRoot` → **`webRoots: Record<rootId,{tree,placement}>`**
  (antes era un solo root → panel persistente + diálogo se habrían pisado). `App.tsx`
  particiona por placement; `.web-footer` da el marco.
- `mountPersistent`/`republish` son **infraestructura reusable** para futuros paneles
  de extensión que vivan toda la sesión.

### D24 — ask_user_question: paridad con rpiv sobre cuándo mostrar el preview

Revisión de `@juicesharp/rpiv-ask-user-question` reveló que `WebQuestionnaire`
mostraba el preview **siempre**, a diferencia de rpiv nativo. Tres correcciones
(código: `src/web-questionnaire.tsx`, `src/tools/ask-user-question-web.ts`):

1. **Guía del tool + schema (causa raíz):** la descripción del tool y el campo
   `options[].preview` del schema TypeBox ahora dicen *"úsalo SOLO para artefactos
   concretos a comparar (mockups/código/diagramas/configs); NO para preguntas simples
   de preferencia"*. rpiv lo dice; Frida lo omitía → el modelo abusaba del preview.
2. **Sin fallback agresivo:** `activePreviewOpt` ya no cae a la primera opción con
   `preview`. El pane sigue al focus; opción sin `preview` → "Vista previa no
   disponible" (`NO_PREVIEW_TEXT` de rpiv).
3. **Gate `inputMode`:** el preview se oculta mientras se escribe respuesta custom
   (`customText[tab]` no vacío) — opciones+input toman ancho completo. rpiv hace lo
   mismo (`PreviewPane.render`: `if (inputMode) return optionList.render(width)`).

rpiv oculta además el pane en `multiSelect` y cuando ninguna opción trae `preview`
(`!hasAnyPreview()`) — ambos ya cubiertos por `hasPreviews`. El gate de ancho (≥100
cols) no aplica: el webview es flexible. ADR-0006 §"Paridad con rpiv".

### D25 — Tool `todo`: paridad rpiv-todo en el render del tool call

El header de la tarjeta del tool `todo` (ToolCard del webview) ahora sigue el formato
de rpiv-todo (`view/format.ts`: `renderTodoCall` + `renderTodoResult`):

- **Glyph de acción + subject resuelto** (antes `create "…"` / `update #id` sin
  subject): `+ Subject` (create), `→ #id Subject` (update), `× #id Subject` (delete),
  `› #id Subject` (get), `☰ status` (list), `∅` (clear).
- **Status echo como badge** en el header: `○ pendiente` / `◐ en progreso` /
  `✓ completado` / `✗ eliminado`, coloreado, parseado del `content` del resultado.

**Obstáculo:** el `ToolCard` (webview) no ve el store del todo (vive en el host,
consumido por el `TodoWebPanel` vía Remote React). Para resolver el subject de
update/get/delete, el host **enriquece los args** con `_subject` desde `getTodoState()`
— en `tool_execution_start` (sesión viva) y `postHistory` (tras recarga). ADR-0014
§"Render del tool call".

### D26 — Panel del todo: árbol de tareas (paridad rpiv-todo overlay)

El `TodoWebPanel` ahora renderiza las tareas como un **árbol** con ramas (paridad con
el overlay de rpiv-todo, `todo-overlay.ts:177-194`):

```
● Todos (0/3)
├─ ○ Eliminar ask-user-question propio de Frida (464 líneas)
├─ ◐ Revisar cómo lo hace pi
└─ ✓ Aplicar ajustes a frida
```

- **Ramas `├─`/`└─`**: cada `TaskRow` lleva `├─` (intermedia) o `└─` (última) en color
  tenue antes del glyph de status — agrupa las tareas bajo el heading como un árbol,
  más legible que las filas planas.
- **"Tareas" → "Todos"** (paridad rpiv-todo, `OVERLAY_HEADING`).
- Antes las filas eran planas (sin ramas). Código: `src/tools/todo-web/todo-web.tsx`.
  ADR-0014 §"Render del panel".

### D27 — frida-context: observabilidad de la capacidad del contexto (ADR-0015)

Extensión `frida-context` (`src/tools/frida-context/index.ts`) que registra el tool
**`context`** (sin prefijo supi), porte conceptual de `@mrclrchtr/supi-context`. El
agente YA NO es ciego a su propia presión de contexto:

- **Tool `context`** (agent-facing, MVP fase A): devuelve un snapshot JSON constante
  (`ContextPressureSnapshot`: contextWindow, usedTokens, usagePercent, headroomTokens,
  **pressurePercent** ajustado por reserve, compactionEnabled, compacted,
  approximationNote). El agente lo consulta antes de operaciones grandes para decidir
  si compactar/ser conciso. Datos del SDK: `ctx.getContextUsage()`,
  `SettingsManager.getCompaction{Enabled,ReserveTokens}`, `getLatestCompactionEntry`.
- **Medidor para el humano:** `ContextBar` ya existía (barra % low/mid/high + tokens);
  ahora usa `pressurePercent` (ajustado por reserve, calculado en `postUsage`) para
  anticipar la compactación, en vez del `usagePercent` bruto.
- **Toggle** `frida.context.enabled` (default true), mismo patrón `toggleable` que
  todo/ask_user_question.
- **Fase B (reporte detallado):** comando `/context` → overlay Remote React (barra
  segmentada estilo Claude Code + leyenda coloreada + métricas; `ContextReport.tsx`, vía
  `mountPersistent(…,"overlay")`) con categorías de uso + composición del system
  prompt con **atribución detallada** (paridad supi-context): instruction files
  (AGENTS/CLAUDE separados, origin global/project), skills (tokens por skill vía
  formatSkillsForPrompt), guidelines (bullets + fuente default/tool/extensions vía
  `classifyGuidelines` parseando la sección "Guidelines:"), tool snippets (por tool) y
  **tool definitions** (count + tokens + descripción, vía `pi.getAllTools()`/
  `getActiveTools()` cacheados en `before_agent_start`). `prompt-inference.ts` porta
  extractGuidelinesSection/classifyGuidelines/determineOrigin. Tool
  `context({mode:"full"})` → mismo análisis en JSON. Filosofía: snapshot=operativo
  (al agente), reporte=diagnóstico (al humano, fuera del LLM). ADR-0015.
- **Fix `/context` systemPrompt en tiempo real:** el comando leía systemPrompt +
  options + tools de un cache poblado en `before_agent_start` (solo dispara en un
  turno del agente). Si dabas `/context` sin turno previo (reabrir VS Code + sesión
  existente), el cache estaba vacío → "Composición del system prompt" toda en 0 (aunque
  el uso total sí venía de `getContextUsage()`). Ahora `postContextCommand` lee en
  tiempo real de `frida.session` (`.systemPrompt`, `.getAllTools()`,
  `._baseSystemPromptOptions`, `.getActiveToolNames()`) con fallback al cache. ADR-0015.

### D28 — frida-permission-system: permisos declarativos + webcontent (ADR-0016)

Migrar los gates de aprobación (`src/gates/approval-gates.ts`, política hardcodeada
en sets de TS + 3 modos) a una **extensión independiente** `frida-permission-system`
(mismo patrón que `todo-web` y `frida-context`) con **política declarativa**
(`~/.frida/permission.json`, estados `allow`/`ask`/`deny` por superficie `tool`/`path`/
`bash`/`external_directory`, paridad adaptada de `@gotgenes/pi-permission-system`).

- **Modelo:** declarativo + los 3 modos (`manual`/`auto-edit`/`auto`) como **override**
  rápido. `deny` siempre gana (como yoloMode de gotgenes). Evaluación en 4 capas
  (most-restrictive-wins): `path` → `external_directory` → per-tool → `bash`.
- **force-ask** (heredado del diseño actual): bash compuesto/wrapper
  (`hasShellIndirection`) o path externo (`isExternalPath`) → marca `forceAsk: true`,
  que **sobrevive al modo `auto`** (preserva el disuasivo: en auto el usuario no mira).
- **Filosofía disuasiva, NO candado** (ADR-0001): sin symlink-resolve ni project-trust
  (gotgenes sí los tiene). El operador puede evadir; lo que evitamos son accidentes
  del modelo.
- **DEFAULT_POLICY = behavior actual** → Fase 0-1 es migración sin surprise (126 tests
  en verde, logger + fail-closed intactos).
- **Webcontent (Remote React):** AuditPanel (`/gates`, JSONL navegable), Stats footer
  (modo + contadores ✓N ✗M ⚡Z), ApprovalDialog (reemplaza ApprovalCard nativo),
  ConfigPanel (`/gates-config`, editor visual allow/ask/deny).
- **Plan por fases:** 0 estructura+config · 1 evaluación declarativa (core) · 2
  AuditPanel · 3 Stats · 4 session approvals por patrón · 5 ConfigPanel · 6
  ApprovalDialog · 7 hide-tools deny (requiere investigar API del SDK).
- **Helpers** (`sensitive-paths`, `dangerous-commands`, `bash-indirection`,
  `external-paths`) se quedan en `src/gates/` en Fase 0-1 (sus tests los importan);
  `policy.ts` los consume. Moverlos a `surfaces/` es cleanup posterior.
- **Estado:** Fases 0-7 + 5b **todas implementadas — extensión completa**
  (declarativo + `createPermissionSystem` + AuditPanel `/gates` + Stats footer
  ✓N/✗M/⚡Z + Session approvals por patrón + ConfigPanel `/gates-config` con las 3
  superficies tool/path/bash + ApprovalDialog Remote React + hide-tools deny +
  editor de wildcards: evaluate() aplica policy.path/bash most-restrictive-wins).
  163 tests.

---

### D29 — Proveedor Z.ai + registry de API-key providers (ADR-0017)

Añadir **Z.ai** (Zhipu AI / GLM) como tercer proveedor (con DevEngine y GitHub
Copilot), con API key como DevEngine, y **explorar dinámicamente** los modelos
expuestos por su endpoint `GET /models`. Antes el manejo de API key estaba
**acoplado a DevEngine** (`SECRET_KEY` único, `keyCache` único, `setKey(key)` que
siempre llamaba `setRuntimeApiKey(SOFTTEK_PROVIDER,…)`).

- **Decisión: generalizar** (no duplicar). Registry `src/providers/api-key-providers.ts`
  con `API_KEY_PROVIDERS` (`id` → `{secretKey, authMode}`): DevEngine
  (`frida.devengineKey`, `x-api-key`) + Z.ai (`frida.zaiKey`, `bearer`). Añadir un
  4º proveedor = 1 entrada + 1 archivo `providers/<id>-provider.ts`.
- **Hallazgo clave: z.ai es un provider BUILT-IN de pi-ai** (`providers/zai` +
  `data/zai.json`): id `"zai"`, baseUrl `https://api.z.ai/api/coding/paas/v4`
  (endpoint de CODING), modelos `glm-4.5-air`/`glm-4.7`/`glm-5.x`, y sobre todo
  `compat.thinkingFormat:"zai"` → el SDK inyecta el `thinking` de GLM, así que el
  **razonamiento funciona nativamente** (sin el workaround de DevEngine). Por eso NO
  se hace `registerProvider` de z.ai ni se define su config: el `ModelRuntime` ya lo
  carga; sólo falta la API key (`setRuntimeApiKey("zai",key)`).
- **Exploración de modelos:** `discoverZaiModels(baseUrl,key)` → `GET /models` →
  `buildZaiCatalogOverride(builtin, ids)` **preserva los modelos built-in completos**
  (con `thinkingFormat:"zai"`) + añade los descubiertos nuevos (vía `ZAI_MODEL_META`);
  `registerProvider("zai",{models})` sólo si hay nuevos (si no, el built-in queda
  intacto). Crítico: `applyExtension` del SDK **reemplaza** el array y los override sólo
  heredan api/baseUrl (no `compat`) → sin preservar thinkingFormat, el thinking se
  rompería. Se dispara al setKey(zai) **y** con botón ⟳ "Explorar modelos" en el
  ModelPanel. Best-effort (si falla, built-in intacto).
- **El bug `requiresThinkingAsText`/`requiresAssistantAfterToolResult` es EXCLUSIVO
  de DevEngine** (sin thinkingFormat, rechaza reasoning al reanudar sesión — ADR-0009).
  z.ai NO lo necesita: el thinking va por `thinkingFormat:"zai"` y se permite para
  todos los modelos GLM que lo soportan.
- **Generalización del flujo:** `getKey`→`getKeyFor(id)`, `onUnauthorized`→`(id)`,
  `setKey`→`(id,key)`+`discoverModels(id)`, `promptKey`→`(id,reason)`, comando
  `frida.setKey`→`pickApiKeyProvider()` (QuickPick si >1).
- **UI:** `Onboarding.tsx` 3 opciones (softtek/z.ai/copilot); `ModelPanel` botón
  **Key** para providers `apiKey` + **Explorar** (z.ai) + (Copilot) login OAuth.
- **Settings** `frida.zai.{baseUrl,contextWindow,maxTokens}`.
- DevEngine NO cambia (su `X-Api-Key`+dump requests+compat intactos; sólo `getKey`→
  `getKeyFor`). 163 tests en verde.

---

### D30 — Selector de modelos: refresh asíncrono + info rica (ADR-0018)

Revisión del **TUI de pi**: refresca catálogos **en background** con degradación por
proveedor y muestra info rica por modelo. Frida tiene un selector **estático** (botón
"Explorar" manual sólo para z.ai; filas con sólo `name`). La API del ModelRuntime
necesaria **ya está disponible**; la exploración Fase 0 (`explore-providers.mjs`)
confirmó 39 built-ins y que `zai` aparece solo.

- **Decisión de producto: lista EXPLÍCITA del registry (NO discovery de los 39).** El
  selector lista sólo los proveedores del registry de Frida (ampliable editando el
  vsix), no los 39 built-ins. Añadir un built-in = **1 entrada** en `API_KEY_PROVIDERS`
  (`{id, secretKey, authMode}`) — sin `providers/<id>.ts` ni `registerProvider`, sólo
  `setRuntimeApiKey`. `zai` ya no necesita el registry para el registro (sólo conserva
  `z-ai-provider.ts` para `discoverZaiModels`). **Auth:** SecretStorage de VS Code para
  TODOS los API-key providers (consistencia + aislamiento; la key no vive en auth.json
  plano).
- **B — Refresh asíncrono (Fase 2):** al abrir el ModelPanel, `getAvailableSnapshot()`
  render inmediato + `refresh({allowNetwork})` en background → refresca los catálogos
  de TODOS los proveedores configurados del registry, no sólo z.ai. Degradación por
  proveedor (`{aborted, errors:Map}`), timeout 15s. Reemplaza el botón "Explorar".
- **C — Info rica por modelo (Fase 1):** filas pasan de `name` a
  `glm-4.7 [zai] · 200K · ✓thinking · 🖼️` (`contextWindow`/`maxTokens`/`reasoning`/
  `input` del `Model` del SDK).
- **Plan por fases:** 0 ✅ exploración · 1 C info rica · 2 B refresh asíncrono ·
  3 A simplificar añadir built-ins al registry.
- DevEngine NO cambia (sigue en el registry como excepción con sus hooks).

---

### D31 — Resolución del contextWindow del modelo DevEngine (ADR-0019)

DevEngine expone `gpt-5.4-mini` pero no provee fiablemente su ventana de contexto;
Frida la **hardcodeaba** en 300000 (conservador, por los `500` del gateway con
historial grande — ADR-0009). El SDK pi-ai **ya conoce** gpt-5.4-mini: está en 5
catálogos built-in con `contextWindow=400000` (azure/openai/copilot/opencode); el TUI
lo obtiene del **catálogo** (dato estático), no de una consulta en vivo.

- **Decisión: resolver por prioridad** (dejar de hardcodear):
  `1) override settings (si ≠ null)` > `2) gateway (GET /models DevEngine → context_window)`
  > `3) catálogo canónico (azure/openai → 400000)` > `4) default 300000`. El override
  del usuario **siempre gana** (control total).
- **`lookupCanonicalModelMeta(mr, modelId)`** (`softtek-provider.ts`): busca gpt-5.4-mini
  en azure-openai-responses → openai → copilot → opencode (prioriza Azure porque
  DevEngine enruta a Azure; excluye openai-codex por su contexto de codificación
  272000). Devuelve contextWindow/maxTokens/reasoning/input/thinkingLevelMap del modelo
  **nativo**.
- **`fetchDevengineContextWindow(baseUrl, key, modelId)`**: `GET /models` con X-Api-Key
  (reutiliza el patrón de diagnoseGateway), lee context_window/context_length.
  Best-effort (timeout 10s); si DevEngine no lo expone o falla, fallback al catálogo.
- **Metadatos canónicos** (reasoning/input/thinkingLevelMap/maxTokens) del catálogo;
  `buildSofttekProviderConfig({meta})`. El `compat` de DevEngine
  (`requiresThinkingAsText`/`requiresAssistantAfterToolResult`) **se conserva intacto**
  (bug del gateway, ADR-0009; NO se toma del catálogo).
- **Settings:** `frida.devengine.contextWindow`/`maxTokens` ahora **nullables** (default
  `null` = sin override → el caller resuelve). Cambio de behavior: quien no los tocó
  pasa de 300000 al valor resuelto (gateway o 400000).
- **Resolución** en `pi-session.ts` antes de `registerProvider(SOFTTEK_PROVIDER,…)`.
- **El `GET /models` a DevEngine SÓLO se llama si DevEngine va a ser el modelo usado**
  en la sesión (`willUseDevengine`: es el activo, o el fallback si el activo no está
  autenticado). Así no se llama al gateway cuando el usuario usa z.ai/Copilot pero
  tiene la key de DevEngine guardada.

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
