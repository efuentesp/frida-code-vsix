# Frida Code

Extensión de VS Code que embebe el SDK de **[Pi]** y se conecta por defecto al
**Softtek DevEngine Gateway**, con **gates de aprobación** tipo Claude Code y un
conjunto de herramientas (workflows, permisos, contexto, tareas) integradas en el
chat.

[Pi]: https://github.com/earendil-works/pi-coding-agent

> ⚠️ **No es un perímetro de seguridad.** Los gates son **disuasivos**: ralentizan y
> hacen visible la acción de un modelo, pero un agente determinado puede saltárselos.
> Ver [`CONTEXT.md`](./CONTEXT.md) §2 y [ADR-0001](./docs/adr/0001-alcance-disuasivo-no-perimetro.md).

---

## Tabla de contenidos

- [Quick Start](#quick-start)
- [Proveedores y modelos](#proveedores-y-modelos)
- [Modo interactivo](#modo-interactivo)
- [Sesiones](#sesiones)
- [Gates de aprobación](#gates-de-aprobación)
- [Herramientas](#herramientas)
- [Settings](#settings)
- [Variables de entorno](#variables-de-entorno)
- [Context files](#context-files)
- [Ayuda](#ayuda)
- [Desarrollo y empaquetado](#desarrollo-y-empaquetado)
- [Cómo añadir una herramienta](#cómo-añadir-una-herramienta)

---

## Quick Start

1. **Instala la extensión** desde el `.vsix` precompilado:

   - **Desde VS Code:** paleta *Extensions* → icono `⋯` (*Views and More Actions*)
     → **Install from VSIX…** → selecciona `frida-code-<version>.vsix`.
   - **Desde terminal:**

     ```bash
     code --install-extension frida-code-<version>.vsix --force
     ```

   Tras instalar, **reinicia por completo VS Code** (`Cmd+Q` en macOS, no vale solo
   *Reload Window*) para que aplique el modelo de activación. Aparecerá el icono de
   Frida (lila) en la barra de actividad a la izquierda.

   > ¿Desarrollas desde fuente? Ver [Desarrollo y empaquetado](#desarrollo-y-empaquetado):
   > `npm install && npm run build` y **F5** (*Launch Extension*).

2. **Configura tu API key.** Al primer uso, Frida te pide la key del gateway
   DevEngine y la guarda en `SecretStorage` (nunca se versiona ni se escribe a
   disco en claro). También puedes rotarla con el comando **Frida: Actualizar API
   key** o `/login devengine`.

3. **Abre Frida Code:** haz click en el icono de Frida de la barra de actividad
   (o ejecuta **Frida: Abrir panel**). La vista abre en el sidebar — si la prefieres
   a la derecha como Copilot, arrástrala al sidebar secundario (VS Code lo recuerda).
   Escribe tu primer mensaje; las acciones del agente (`bash`, `edit`, `write`)
   pasarán por el gate de aprobación según el modo activo.

> Si el gateway responde `401`, Frida te ofrece rotar la key en el momento.

---

## Proveedores y modelos

Frida habla con modelos a través de **proveedores**. Cada proveedor define su
endpoint, auth y catálogo de modelos.

| Proveedor | Auth | Cómo se configura |
| --- | --- | --- |
| **DevEngine** (por defecto) | Header `X-Api-Key` (OpenAI-compatible) | Key en `SecretStorage` + comando **Actualizar API key** |
| **Z.ai** (GLM-4.x / GLM-5) | `Authorization: Bearer` | `/login zai` + ajustes `frida.zai.*` ([ADR-0017](./docs/adr/)) |
| Otros built-in de Pi | según el proveedor | `/login <provider>` (ej. `github-copilot`) |

**Comandos relacionados:**

- `/model` — abre el selector de modelos.
- `/model <provider>/<model>` — cambia directo (ej. `/model zai/glm-4.6`).
- `/login <provider>` / `/logout <provider>` — gestiona la key de un proveedor.

La **API key nunca** vive en variables de entorno ni en disco en claro: se inyecta
en memoria por el hook `before_provider_headers`. Para aprovisionar keys sin
interacción, usa las variables [`PI_KEY_PROVIDERS`](#variables-de-entorno).

La **ventana de contexto** se resuelve automáticamente por prioridad (ver
[ADR-0019](./docs/adr/)): (1) `GET /models` del gateway, (2) catálogo canónico del
modelo, (3) 300 000 conservador. Si necesitas forzarla, usa `frida.devengine.contextWindow`.

---

## Modo interactivo

El panel es un chat (webview React) que se comunica con el host por `postMessage`.

**Entrada del chat:**

- `Enter` — enviar mensaje.
- `Alt+Enter` — enviar como *follow-up* (encadena con la respuesta anterior).
- `Esc` — detener la respuesta en curso.
- `@<archivo>` — adjuntar un archivo al contexto.
- `!<comando>` — ejecutar `bash` y volver a inyectar su salida; `!!` ejecuta **sin**
  añadirlo al contexto.
- `/<comando>` — ver [slash commands](#slash-commands) abajo.

### Slash commands

| Comando | Acción |
| --- | --- |
| `/ask [tema]` | Formular preguntas o decisiones interactivas con opciones (`ask_user_question`) |
| `/tree` | Navegar el árbol de la sesión activa: saltar a cualquier punto, ramificar desde un mensaje, etiquetar y resumir ramas (misma sesión; ver [Árbol de sesión](#árbol-de-sesión-tree)) |
| `/help [herramienta]` | Abre esta ayuda (o la doc de la herramienta indicada) en el preview de markdown |
| `/new` | Nueva sesión |
| `/clone` · `/fork` | Clonar / bifurcar la sesión actual |
| `/name <texto>` | Renombrar la sesión |
| `/compact` | Compactar el contexto (resumir historial) |
| `/copy` | Copiar el último mensaje |
| `/model` · `/login` · `/logout` | Gestión de proveedores (ver arriba) |
| `/todos` | Imprime la lista de tareas agrupada por estado |
| `/context` | Snapshot de presión del contexto |
| `/gates` | Auditoría navegable de permisos (overlay) |
| `/gates-config` | Configuración actual de gates |
| `/wf <nombre> [input]` | Corre un workflow ([frida-workflow](./docs/tools/frida-workflow.md)) |
| `/reload` | Recargar extensiones, skills y recursos |
| `/version` | Muestra la versión instalada y el enlace a releases |
| `/update` | Comprueba si hay una versión nueva en GitHub Releases (soporta `GITHUB_TOKEN` para repo privado) |

Los `/<cmd>` que no sean built-in se envían tal cual al agente (p.ej. `/skill:...`
o prompts guardados).

### Comandos de la paleta (Command Palette)

`Frida: Abrir panel` · `Frida: Actualizar API key` · `Frida: Compactar contexto` ·
`Frida: Recargar extensiones y recursos` · `Frida: Detener respuesta` ·
`Frida: Nueva sesión` · `Frida: Cambiar modo de aprobación` ·
`Frida: Diagnosticar gateway DevEngine` · `Frida: Diagnosticar thinking` ·
`Frida: Open Help`.

---

## Sesiones

Las sesiones se guardan en `globalStorageUri/sessions` (desacoplado del
[`agentDir`](#context-files), ver [D13](./CONTEXT.md)). El *trail* de aprobaciones
del gate se escribe como JSONL `chmod 0600`.

- **`/new`** — sesión en blanco.
- **`/clone`** — duplica la sesión actual (mismo historial).
- **`/fork`** — bifurca desde el punto actual (rama independiente).
- **`/name`** — da un nombre legible a la sesión.
- **`/compact`** — resume el historial para liberar contexto sin perder hilo.

---

## Gates de aprobación

Los gates interceptan las acciones del agente (`bash`, `edit`, `write`) **antes** de
que se ejecuten y piden tu visto bueno. Hay tres modos (conmutables con el botón de
modo del panel o **Frida: Cambiar modo de aprobación**):

| Modo | Qué aprueba |
| --- | --- |
| **`manual`** (por defecto) | Todo: cada `bash`, `edit` y `write` pide confirmación |
| **`auto-edit`** | Aprueba ediciones de archivo; `bash` y borrados siguen pidiendo |
| **`auto`** | Aprueba todo automáticamente (úsalo solo en entornos desechables) |

**Bloqueos sin preguntar.** Ciertos patrones se bloquean siempre (incluso en `auto`),
porque son clásicamente destructivos o filtran secretos:

- **Archivos sensibles** por extensión (`.env`, `.pem`, `.key`, `.p12`, …) o por
  nombre exacto (`credentials.json`, …).
- **Comandos destructivos** (`rm -rf /`, `mkfs`, …).

Puedes **ampliar** estas listas con settings (aplican en vivo, sin recargar) — ver
[`frida.gates.*`](#settings).

**Auditoría.** `/gates` abre un overlay navegable con el historial de aprobaciones
(filtros + colores), leído del JSONL del gate.

> Recordatorio: el gate es **disuasivo**, no un perímetro ([ADR-0001](./docs/adr/0001-alcance-disuasivo-no-perimetro.md)).

---

## Herramientas

Las **herramientas** son los módulos internos de Frida (`src/tools/`), cada una con su
documentación profunda en [`docs/tools/`](./docs/tools/). Habilita/deshabilita las que
tengan setting con la clave `frida.<tool>.enabled` (aplica al recargar con `/reload`).

| Herramienta | Qué hace | Doc |
| --- | --- | --- |
| **frida-workflow** | Motor de workflows: cadenas de etapas (skills en sesiones hijas) con routing, loops y jueces | [→](./docs/tools/frida-workflow.md) |
| **frida-permission-system** | Sistema de permisos y gates (registro, auditoría) | [→](./docs/tools/frida-permission-system.md) · [guía](./docs/how-to-frida-permissions.md) |
| **frida-context** | Snapshot de presión del contexto para auto-regulación | [→](./docs/tools/frida-context.md) |
| **frida-agent-browser** | Automatización de navegador real + búsqueda web (Exa/Brave) + apps Electron (tools `agent_browser` / `agent_browser_web_search`) | [→](./docs/tools/frida-agent-browser.md) |
| **frida-supi-web** | Fetch de URL pública → Markdown + docs de librerías vía Context7 (tools `web_fetch_md` / `web_docs_search` / `web_docs_fetch`) — porte de `@mrclrchtr/supi-web` | [→](./docs/tools/frida-supi-web.md) |
| **frida-args** | Argumentos (`$1`/`$ARGUMENTS`) y shell (`!`cmd``) en skills — porte de rpiv-args | [→](./docs/tools/frida-args.md) |
| **frida-multi-skills** | Invoca skills desde cualquier parte del prompt con `$name` y combina varias por mensaje — porte de pi-multi-skills | [→](./docs/tools/frida-multi-skills.md) |
| **frida-pix-skills** | Carga skills on-demand con el tool `read_skills`, interpola `!`cmd`` vivo y accede a Skills.sh — porte de pix-skills | [→](./docs/tools/frida-pix-skills.md) |
| **ask-user-question-web** | El agente pregunta con opciones estructuradas (UI web) | [→](./docs/tools/ask-user-question-web.md) |
| **todo** / **todo-web** | Seguimiento multi-paso de tareas + panel | [→](./docs/tools/todo.md) |
| **frida-pipeline** | Orquestador con 27 skills, 15 sub-agentes y 3 workflows (porte de rpiv-pi) | [→](./docs/tools/frida-pipeline.md) |
| **frida-subagents** | Sub-agentes autónomos estilo Claude Code (Agent, get_subagent_result, steer_subagent) | [→](./docs/tools/frida-subagents.md) · [guía](./docs/how-to-frida-subagents.md) |
| **frida-mcp-adapter** | Integración MCP — un proxy tool da acceso a cientos de servidores sin quemar contexto | [→](./docs/tools/frida-mcp-adapter.md) |
| **frida-extensible-workflows** | Workflows deterministas con sub-agentes desechables: `parallel`/`pipeline`, checkpoints, budget y 4 patrones curados (multi-perspective, codebase-audit, adversarial-review, code-review) — porte de pi-dynamic-workflows | [→](./docs/tools/frida-extensible-workflows.md) · [guía](./docs/how-to-frida-workflows.md) |
| **frida-goal** | Modo goal — la sesión se auto-continúa hasta completar un objetivo, con guards (cap de continuaciones, no-progreso, budget de tokens) — porte de pi-goal | [→](./docs/tools/frida-goal.md) · [guía](./docs/how-to-frida-goal.md) |
| **frida-aidd** | Metodología AiDD (BMAD) adaptada: `aidd-plan` (idea → PRD → arquitectura → specs) + `aidd-ship` (loop determinista por historia con lie-detector y commit del orquestador) | [→](./docs/tools/frida-aidd.md) · [guía](./docs/how-to-frida-aidd.md) |
| **frida-enterprise** | Proveedor corporativo Frida Platform (SSO OAuth + gateway Compatible API): catálogo tras login, dual-endpoint responses/chat, razonamiento nativo en modelos `responses` | [→](./docs/tools/frida-enterprise.md) |
| **frida-tea** | QA dirigido por riesgo (BMAD TEA adaptado): `tea-test-design` (plan P0-P3), `tea-framework`, `tea-automate` (fan-out por target), `tea-ci`, `tea-nfr` (evidencia + gate determinista), `tea-trace` (matriz de cobertura), `tea-atdd` (fase roja), `tea-test-review` (score 0-100), `tea-teach` (academia) | [→](./docs/tools/frida-tea.md) · [guía](./docs/how-to-frida-tea.md) |
| **frida-app-walkthrough** | Documenta una app web usándola como usuario real (sesión de navegador pre-autenticada): exploración pantalla por pantalla, fan-out de 4 escritores (catálogo, journeys, reglas, roles) y juez PASS/CONCERNS/FAIL — entregables en `docs/funcional/` + dashboard | [→](./docs/tools/frida-app-walkthrough.md) · [guía](./docs/how-to-frida-app-walkthrough.md) |
| **frida-understand-app** | Entiende un códigobase desconocido con las tools del moat inyectadas en las sesiones hijas (pi-lens + codebase-index): overview cartógrafo, fan-out de scouts por áreas de riesgo, 3 escritores (entendimiento §Q1–§Q7 con evidencia `file:line`, mapa de riesgos, LikeC4 semilla) y juez PASS/CONCERNS/FAIL — entregables en `docs/entendimiento/` | [→](./docs/tools/frida-understand-app.md) · [guía](./docs/how-to-frida-understand-app.md) |
| **frida-traffic2api** | Documenta la API real de una app web desde su tráfico HTTP observado: walk agéntico grabando HAR sobre una sesión pre-autenticada (o HAR externo devtools/mitmproxy) → `docs/api/` con spec OpenAPI 3.1, matriz funcionalidad↔endpoint↔módulo (grounding moat), huérfanos, zona muerta calificada y grafo de navegación | [→](./docs/tools/frida-traffic2api.md) · [guía](./docs/how-to-frida-traffic2api.md) |
| **frida-sandboxes** | Contenedores Docker desechables por agente para bash aislado, con políticas por host | [→](./docs/tools/frida-sandboxes.md) · [guía](./docs/how-to-frida-sandboxes.md) |
| **frida-codebase-index** | Aprende el código: índice simbólico consultable por el agente | [guía](./docs/how-to-frida-learn.md) |
| **frida-hermes-memory** | Memoria persistente entre sesiones vía hermes — creencias verificadas con decay | [→](./docs/tools/frida-hermes-memory.md) · [guía](./docs/how-to-frida-learn.md) |
| **frida-knowledge-base** | Base de conocimiento OKF/Obsidian — búsqueda e ingesta de notas | [→](./docs/tools/frida-knowledge-base.md) · [guía](./docs/how-to-frida-learn.md) |
| **frida-cc-plugins** | Carga plugins de Claude Code (`.claude/plugins`) como herramientas nativas | [→](./docs/tools/frida-cc-plugins.md) · [guía](./docs/how-to-cc-plugins.md) |
| **frida-git-sync** | Sincronización de paquetes y estado del sistema vía repos git | [→](./docs/tools/frida-git-sync.md) |
| **extension-toggles** | Activa/desactiva extensiones individuales desde el hub de ajustes | [→](./docs/tools/extension-toggles.md) |

## Extensiones

Frida **hereda** el sistema de extensiones de Pi: archivos `.ts` que viven **fuera del
`.vsix`** — en `~/.frida/extensions/` (global) o `.frida/extensions/` (proyecto) — y
registran **tools**, **providers** y **hooks** para el agente. Se cargan al arrancar y
se recargan con `/reload`, sin tocar el código de Frida. Las **skills** (markdown con
instrucciones) van en `~/.frida/skills/` o `.frida/skills/`. Ver
[extensiones](./docs/tools/extensions.md).

---

## Settings

Configuración en `settings.json` (ámbito `Frida Code`).

### Herramientas

| Clave | Default | Descripción |
| --- | --- | --- |
| `frida.askUserQuestion.enabled` | `true` | Habilita el tool `ask_user_question` (preguntas con opciones). Aplica al recargar. |
| `frida.todo.enabled` | `true` | Habilita el tool `todo` y el panel de Tareas. Aplica al recargar. |
| `frida.context.enabled` | `true` | Habilita el tool `context` (auto-regulación). La barra ContextBar siempre visible. Aplica al recargar. |

### Gates

| Clave | Default | Descripción |
| --- | --- | --- |
| `frida.gates.sensitiveExtensions` | `[]` | Extensiones extra bloqueadas sin preguntar (sin el punto). Ej. `["properties","keystore"]`. En vivo. |
| `frida.gates.sensitiveBasenames` | `[]` | Nombres exactos extra bloqueados. Ej. `["credentials.json"]`. En vivo. |
| `frida.gates.sensitiveAllowBasenames` | `[]` | Nombres a **permitir** pese a coincidir con un patrón sensible. Ej. `[".env.local.dev"]`. En vivo. |
| `frida.gates.dangerousCommandSubstrings` | `[]` | Substrings que bloquean `bash` sin preguntar (literal, sensible a mayúsculas). Ej. `["dropdb","truncate table"]`. En vivo. |

### Proveedores

| Clave | Default | Descripción |
| --- | --- | --- |
| `frida.devengine.contextWindow` | `null` | Override de la ventana de contexto (tokens). `null` = auto. [ADR-0019](./docs/adr/). |
| `frida.devengine.maxTokens` | `null` | Override del `max_tokens` de salida. `null` = catálogo. |
| `frida.zai.baseUrl` | `https://api.z.ai/api/coding/paas/v4` | Base URL de Z.ai ([ADR-0017](./docs/adr/)). |
| `frida.zai.contextWindow` | `200000` | Ventana de contexto por defecto para Z.ai no listado. |
| `frida.zai.maxTokens` | `16000` | `max_tokens` por defecto para Z.ai. |

---

## Variables de entorno

| Variable | Descripción |
| --- | --- |
| `PI_OFFLINE=1` | Catálogos built-in estáticos, sin red (útil para sesiones hijas offline). |
| `PI_KEY_PROVIDERS` | Lista de proveedores con key aprovisionada (sin prompt de login). |
| `PI_KEY_PROVIDER_IDS` | IDs de proveedores asociados a las keys. |
| `PI_SKIP_VERSION_CHECK` | Omitir la verificación de versión de Pi al arrancar. |
| `PI_LENS_CONFIG_PATH` | Path a un config propio de pi-lens (Frida apunta al suyo en `globalStorageUri`). |
| `FRIDA_LENS_TOOLS` | Activa/desactiva herramientas individuales de pi-lens. |
| `FRIDA_HOST_PREFIX` | Prefijo para rutas de host (entornos multi-instancia). |

---

## Context files

Frida usa un **`agentDir` propio** en `~/.frida` (desacoplado de `~/.pi` —
[ADR-0010](./docs/adr/)), donde guarda: auth/models, skills, extensiones y el
loader.

- **`AGENTS.md`** (en la raíz del workspace) — instrucciones de proyecto que el
  agente carga automáticamente. Es el lugar para convenciones de código, reglas del
  repo y preferencias (p.ej. "responde en español").
- **`~/.frida/`** — skills, extensiones y auth globales.
- **`.frida/`** (en el workspace, donde aplique) — recursos de proyecto.

---

## Ayuda

- **`/help`** — abre este README en el preview de markdown.
- **`/help <herramienta>`** — abre la doc de la herramienta (ej. `/help workflow`).
- **Frida: Open Help** (paleta) — picker para elegir la doc a abrir.

La ayuda vive en [`docs/tools/`](./docs/tools/) (una doc por herramienta, generada de
una [plantilla](./docs/tools/TEMPLATE.md)) más este README como índice general.

---

## Desarrollo y empaquetado

Build dual: **esbuild** para el host (`dist/extension.js` + `dist/frida-workflow.js`)
y **Vite** para el webview de React (`dist-webview/`).

```bash
npm install
npm run build       # host + webview
npm run watch       # solo el host, en watch
npm run typecheck   # host + webview
npm run typecheck:test  # tests
npm test            # vitest run
```

En VS Code: **F5** (*Launch Extension*); el `preLaunchTask` recompila ambos. Al
editar el webview hay que recompilar (no hay HMR cableado).

**Empaquetar e instalar:**

```bash
npm run package     # build + produce frida-code-<version>.vsix

# instala el .vsix recién creado (o desde la UI: Extensions → ⋯ → Install from VSIX…)
code --install-extension frida-code-<version>.vsix --force
```

Tras instalar, reinicia por completo VS Code (`Cmd+Q` en macOS, no *Reload Window*).

> **Tarea de empaquetado ([ADR-0002](./docs/adr/)):** los nativos de Pi (`photon-node`
> `.wasm` y `clipboard-*` `.node` por plataforma) deben incluirse en el `.vsix` con
> target platforms. Resolver su inclusión es parte del MVP, no de este PoC.

---

## Cómo añadir una herramienta

1. Crea el módulo en `src/tools/<nombre>/`.
2. Regístralo en `src/extension.ts` (mounter / slash command / setting
   `frida.<nombre>.enabled`).
3. **Documenta:** copia [`docs/tools/TEMPLATE.md`](./docs/tools/TEMPLATE.md) a
   `docs/tools/<nombre>.md` y rellena las secciones fijas.
4. Añade una fila a la tabla de [Herramientas](#herramientas) de arriba.

La plantilla garantiza que cada herramienta tenga el mismo nivel de detalle y que
`/help <nombre>` funcione sin más wiring.

---

## Filosofía y decisiones

Las decisiones de arquitectura están registradas como ADRs en
[`docs/adr/`](./docs/adr/) y el contexto vivo del proyecto en
[`CONTEXT.md`](./CONTEXT.md). Referencias clave:

- [ADR-0001](./docs/adr/0001-alcance-disuasivo-no-perimetro.md) — el gate es
  disuasivo, no un perímetro de seguridad.
- [ADR-0010](./docs/adr/) — `agentDir` propio en `~/.frida`.
- [ADR-0017](./docs/adr/) — proveedor Z.ai.
- [ADR-0019](./docs/adr/) — resolución de la ventana de contexto.
- [ADR-0020](./docs/adr/0020-frida-workflow-porte-nativo.md) — porte nativo de
  frida-workflow.

## Licencia

`UNLICENSED` (uso interno).
