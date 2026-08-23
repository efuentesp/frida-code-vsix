---
date: 2026-08-19T17:15:00-0600
author: Edgar F. Fuentes Perea
commit: 0f3d849
branch: main
repository: frida-code
topic: "Hoja de Ruta UI/UX Frida Code × GitHub Copilot — Rediseño visual gradual del Webview"
tags: [ui-ux, copilot-chat, webview, codicons, tool-flat, transcript, input-stack, roadmap]
status: ready
phase_count: 13
phases:
  - { n: 1, title: "Fundaciones Visuales y Primitivas CSS (@vscode/codicons, shimmer, tokens)", files: [package.json, webview/main.tsx, webview/components/Codicon.tsx, webview/styles.css, test/codicon.test.ts], depends_on: [] }
  - { n: 2, title: "Fila de Tools Plana y Catálogo Tool por Tool (tool-phrases, .tool-flat, 20 tools)", files: [webview/tool-phrases.ts, webview/components/CollapsibleCard.tsx, webview/components/ToolCard.tsx, test/webview-tool-phrases.test.ts], depends_on: [1] }
  - { n: 3, title: "Estructura de Turnos, Thinking y Agrupación (Disclosure colapsable)", files: [webview/components/Turn.tsx, webview/styles.css, test/turn-grouping.test.ts], depends_on: [2] }
  - { n: 4, title: "Footer — Input Stack, Composer y Border Beam (.working, botón circular ↑/■)", files: [webview/components/Composer.tsx, webview/components/ContextBar.tsx, webview/styles.css], depends_on: [1] }
  - { n: 5, title: "Footer — Paneles Dockeados en Píldora Única y Followups (Todo, Preguntas, Aprobación)", files: [webview/components/Followups.tsx, webview/followup-rules.ts, webview/components/QuestionsPanel.tsx, webview/components/ApprovalCard.tsx, webview/App.tsx, test/followup-rules.test.ts], depends_on: [4] }
  - { n: 6, title: "Header, Overlays y Botón Scroll-to-Bottom Flotante", files: [webview/components/WorkspaceBar.tsx, webview/components/SettingsHub.tsx, webview/components/SessionsPanel.tsx, webview/App.tsx, webview/styles.css], depends_on: [3, 5] }
  - { n: 7, title: "Roles de Modelo y Routing por Intención (default/smol/commit + fallback chains)", files: [src/settings.ts, package.json, src/providers/, webview/components/ModelPanel.tsx, webview/components/Composer.tsx], depends_on: [] }
  - { n: 8, title: "Advisor en Vivo con WATCHDOG.md (revisor por turno, severidades, emission guard)", files: [src/advisor/, webview/components/Turn.tsx, webview/components/Composer.tsx, webview/types.ts], depends_on: [7] }
  - { n: 9, title: "Búsqueda Web Nativa con Piso Keyless (web_search builtin, cadena de backends)", files: [src/tools/frida-web-search/, package.json], depends_on: [] }
  - { n: 10, title: "Edición Hashline (anclas por hash de contenido, port del paquete MIT)", files: [src/tools/frida-hashline/, src/extension.ts], depends_on: [] }
  - { n: 11, title: "Agent Hub — Supervisión de Subagentes (roster vivo, steer, revive, kill)", files: [webview/components/AgentHub.tsx, src/tools/frida-subagents/, webview/App.tsx], depends_on: [6] }
  - { n: 12, title: "TTSR — Reglas de Stream (regex/AST → abort + inyecta + reintenta)", files: [src/ttsr/, src/extension.ts], depends_on: ["fix #85/#90/#96"] }
  - { n: 13, title: "Extensiones Menores (memoria 2-fase, conflict://, dictado 🎤, magic keywords)", files: [src/tools/frida-hermes-memory/, src/worktree.ts, webview/components/Composer.tsx], depends_on: [7] }
last_updated: 2026-08-22T20:00:00-0600
last_updated_by: Edgar F. Fuentes Perea
---

# Hoja de Ruta UI/UX Frida Code × GitHub Copilot

## 1. Visión y Objetivos

Esta hoja de ruta establece la adopción gradual de la identidad visual y patrones de experiencia de usuario de **GitHub Copilot Chat (VS Code)** en el Webview de **Frida Code**, manteniendo 100% la compatibilidad con el backend de Pi Agent y la suite completa de herramientas y extensiones.

### Principios de Diseño

1. **Nativo VS Code**: Utilizar exclusivamente tokens temáticos `--vscode-*` y la fuente `@vscode/codicons` para garantizar perfecta armonía en temas Oscuros (Dark+), Claros (Light+) y de Alto Contraste.
2. **Bajo Ruido Visual**: Migrar de tarjetas pesadas con bordes (`.card`) a filas planas discretas (`.tool-flat`), con shimmer en verbos y agrupación colapsable de herramientas por turno.
3. **Píldora Única en Footer**: Unificar el cuadro de entrada y los paneles interactivos (Todo, Preguntas, Aprobación) en una sola estructura sin cajas flotantes desconectadas.
4. **Desarrollo Incremental y Seguro (TDD)**: Cada fase es autónoma, verificable con pruebas unitarias y sin regresiones visuales ni de protocolo.

---

## 2. Mapa Arquitectónico

```text
 ┌──────────────────────────────────────────────────────────────────────────────────────────────────────┐
 │ HEADER (WorkspaceBar & Overlays)                                                                     │
 │ ├─ WorkspaceBar (Repo, rama git-branch, sesión actual, acciones rápidas con Codicons)                 │
 │ └─ Overlays (SessionsPanel, SettingsHub, DetachedPanel, ForkPanel armonizados)                       │
 ├──────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ CONTENIDO (Transcript)                                                                               │
 │ ├─ Turnos & Thinking: Fila plana «Razonando…» con shimmer → «Razonó 3.2s · 420 tok»                 │
 │ ├─ Agrupación de Tools: Disclosure colapsable «N herramientas · duración · tokens» + línea guía        │
 │ └─ Filas Planas Tool por Tool (.tool-flat):                                                          │
 │    • Archivos: read, write, edit                                                                     │
 │    • Terminal: bash                                                                                  │
 │    • Búsqueda: ffgrep, fffind, symbol_search, module_report                                          │
 │    • Diagnósticos: lens_diagnostics, lsp_diagnostics, ast_grep_*                                     │
 │    • Subagentes: Agent, get_subagent_result, steer_subagent, subagent_gate                           │
 │    • Workflows: workflow, workflow_status, workflow_resume, workflow_retry                           │
 │    • Interacción: ask_user_question, todo, context                                                   │
 │    • Web & Docs: agent_browser, web_search, web_fetch, web_docs_*                                    │
 │    • Extensibilidad: mcp, mcpScript, read_skills, wiki_*                                             │
 ├──────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ FOOTER (Input Stack & Composer)                                                                      │
 │ ├─ Followups: Enlaces sugeridos (textLink) sobre el input stack                                      │
 │ ├─ Docked Panels: Widget persistente de Todo + Questions carousel + Approval card                  │
 │ ├─ Composer: Border Beam animado (.working), Botón Submit circular (↑ ↔ ■), Selectores inferiores    │
 │ └─ ContextBar: «Trabajando… 4.2s» + porcentaje y tokens integrados                                   │
 └──────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Fases de Implementación

---

### Fase 1: Fundaciones Visuales y Primitivas CSS

**Objetivo**: Introducir la iconografía `@vscode/codicons` y el sistema base de estilos de Copilot sin alterar la estructura existente.

#### Entregables

1. **Paquete `@vscode/codicons`**:
   - Dependencia instalada e importada en `webview/main.tsx` (`@vscode/codicons/dist/codicon.css`).
   - Componente `webview/components/Codicon.tsx`:

     ```tsx
     export function Codicon({ name, size = 16, className, ariaLabel }: CodiconProps) { ... }
     ```

   - Preservación de íconos de marca (Bot / Brain de Frida).
2. **Primitivas CSS en `webview/styles.css`**:
   - Keyframes de shimmer en texto:

     ```css
     @keyframes chat-thinking-shimmer {
       0% { background-position: 120% 0; }
       100% { background-position: -120% 0; }
     }
     .tc-shimmer {
       background: linear-gradient(90deg, var(--vscode-descriptionForeground) 0%, var(--vscode-editor-foreground) 50%, var(--vscode-descriptionForeground) 100%);
       background-size: 200% 100%;
       -webkit-background-clip: text;
       -webkit-text-fill-color: transparent;
       animation: chat-thinking-shimmer 2s linear infinite;
     }
     ```

   - Números tabulares (`font-variant-numeric: tabular-nums`).
   - Soporte de accesibilidad `@media (prefers-reduced-motion: reduce)`.
   - Variables de color temáticas (`--vscode-descriptionForeground`, `--vscode-textLink-foreground`, `--vscode-progressBar-background`).

#### Criterios de Éxito

- `npm test` y `npm run build:host` pasando sin errores.
- Fuentes `codicon.ttf` presentes en `dist-webview/assets/`.
- Renderizado de prueba de `<Codicon name="sparkle" />` limpio y sin glifos rotos.

---

### Fase 2: Fila de Tools Plana y Catálogo Tool por Tool

**Objetivo**: Reemplazar las cajas de herramientas por filas planas `.tool-flat` con frases dinámicas en gerundio/pasado y expansión perezosa.

#### Entregables

1. **Catálogo de frases por Tool (`webview/tool-phrases.ts`)**:
   Módulo puro con tests TDD (`test/webview-tool-phrases.test.ts`) que mapea cada tool y sus argumentos a etiquetas claras:
   - **`read`**: *«Leyendo src/app.ts»* $\rightarrow$ *«✓ Leyó src/app.ts – 84 líneas»*.
   - **`write`**: *«Escribiendo src/nuevo.ts»* $\rightarrow$ *«✓ Escribió src/nuevo.ts – 120 líneas»*.
   - **`edit`**: *«Editando src/component.tsx»* $\rightarrow$ *«✓ Editó src/component.tsx – 3 reemplazos»*.
   - **`bash`**: *«Ejecutando npm test»* $\rightarrow$ *«✓ Ejecutó npm test – exit 0 (1.4s)»*.
   - **`ffgrep` / `grep`**: *«Buscando texto "createSession"»* $\rightarrow$ *«✓ Buscó "createSession" – 12 resultados»*.
   - **`fffind` / `find` / `ls`**: *«Buscando archivos "*.ts"»* $\rightarrow$ *«✓ Encontró 18 archivos»*.
   - **`symbol_search` / `module_report`**: *«Analizando símbolo "Composer"»* $\rightarrow$ *«✓ Analizó símbolo "Composer"»*.
   - **`lens_diagnostics` / `lsp_diagnostics`**: *«Comprobando diagnósticos»* $\rightarrow$ *«✓ 0 errores · 2 avisos»*.
   - **`Agent`**: *«Lanzando sub-agente [Plan]»* $\rightarrow$ *«✓ Sub-agente [Plan] completó tarea (12.4s)»*.
   - **`workflow`**: *«Ejecutando workflow "aidd-plan"»* $\rightarrow$ *«✓ Workflow "aidd-plan" completado (4 fases)»*.
   - **`agent_browser`**: *«Navegando a docs.github.com»* $\rightarrow$ *«✓ Navegó a docs.github.com – snapshot tomado»*.
   - **`web_search` / `web_fetch`**: *«Buscando en la web "vitest"»* $\rightarrow$ *«✓ 5 resultados web obtenidos»*.
   - **`mcp`**: *«Llamando servidor MCP "sqlite"»* $\rightarrow$ *«✓ MCP "sqlite" respondió (24 filas)»*.
2. **Componente `CollapsibleCard.tsx` (Variante `flat`)**:
   - Fila tipo botón de ancho completo (12px, gris tenue).
   - Chevron derecho tenue que rota 90° al expandirse.
   - Contenedor de animación `grid-template-rows: 1fr → 0fr` para bloques Input / Output.

#### Criterios de Éxito

- Pruebas unitarias de `tool-phrases.ts` con cobertura del 100% de herramientas.
- Las herramientas en ejecución muestran shimmer sobre el verbo y transicionan a check verde y mensaje en pasado al completar.

---

### Fase 3: Estructura de Turnos, Thinking y Agrupación

**Objetivo**: Limpiar el transcript en conversaciones extensas agrupando herramientas y afinando el bloque de pensamiento.

#### Entregables

1. **ThinkingSegment Copilot (`webview/components/Turn.tsx`)**:
   - Reemplazo de `.card--thinking` por fila plana con ícono de cerebro.
   - En vivo: *«Razonando…»* con sweep de brillo.
   - Completado: *«Razonó 3.2s · 420 tokens»* con contenido colapsable.
2. **Agrupación de Herramientas (`completed-response-disclosure`)**:
   - Cuando el turno del modelo termina, las $N$ herramientas intermedias se colapsan detrás de una píldora resumen:
     `▼ 4 herramientas usadas · 1.8s · 840 tokens`
   - Línea guía vertical tenue a la izquierda (`border-inline-start`) que delimita el grupo.
   - Apertura / cierre manual con animación suave.

#### Criterios de Éxito

- Conversaciones multiturno con 10+ tool calls se leen de forma compacta y fluida.
- El estado `isLive` mantiene las herramientas visibles en vivo y las condensa al finalizar el turno.

---

### Fase 4: Footer — Input Stack, Composer y Border Beam

**Objetivo**: Rediseñar el cuadro de entrada principal con el estilo moderno de Copilot.

#### Entregables

1. **Píldora del Input Stack (`.chat-input-stack`)**:
   - Contenedor con borde continuo (`var(--vscode-input-border)`), esquinas redondeadas y fondo unificado.
2. **Border Beam Animado (`.working`)**:
   - Gradiente cónico giratorio (`conic-gradient`) de 2 anillos (beam nítido + glow suave) en el perímetro del input mientras el agente trabaja.
3. **Botón Submit Circular**:
   - Estado Idle: Círculo con flecha `↑`.
   - Estado Activo: Transición fluida a cuadrado `■` (Stop/Abort).
4. **Toolbars Integradas**:
   - Selectores compactos en la fila inferior: `[ Normal ▾ ]` `[ Proveedor / Modelo ▾ ]` `[ Thinking ▾ ]`.
   - Botones de adjuntar imagen y maximizar editor.

#### Criterios de Éxito

- El border beam se activa únicamente durante llamadas activas y se congela bajo `prefers-reduced-motion`.
- El botón circular aborta la sesión de forma inmediata al hacer clic en `■`.

---

### Fase 5: Footer — Paneles Dockeados y Followups

**Objetivo**: Integrar los componentes interactivos directamente en el stack del Footer.

#### Entregables

1. **Followups Contextuales (`webview/components/Followups.tsx`)**:
   - Módulo `webview/followup-rules.ts` con reglas estáticas de sugerencia (tras `edit` $\rightarrow$ *«Ejecutar tests»*, tras error $\rightarrow$ *«Reintentar»*, etc.).
   - Fila de enlaces discretos (`textLink-foreground`) arriba del input.
2. **Widget Persistente de Tareas (`TodoWidget.tsx`)**:
   - Barra dockeada sobre el input con indicador pulsante `● 2/4 tareas`.
   - Menú expandible para marcar o gestionar tareas del plan.
3. **Carousel de Preguntas (`QuestionsPanel.tsx`) & Aprobación (`ApprovalCard.tsx`)**:
   - Ajuste de esquinas para cuadrar con el input (`.chat-input-stack-continues`).
   - Flujo de navegación entre preguntas con teclado y botones estilizados.

#### Criterios de Éxito

- Todos los paneles auxiliares se integran sin desplazar bruscamente el scroll del transcript.
- Las sugerencias de followups responden inmediatamente al contexto de la conversación.

---

### Fase 6: Header, Overlays y Botón Scroll-to-Bottom

**Objetivo**: Pulir la barra superior, estandarizar modales y facilitar la navegación.

#### Entregables

1. **`WorkspaceBar` Compacto**:
   - Barra superior estilizada con ícono de carpeta, selector de sesión y acciones rápidas (`+`, historial, configuración, compactar) con Codicons.
2. **Armonización de Overlays**:
   - `SessionsPanel`, `SettingsHub`, `ModelPanel`, `DetachedPanel` y `ForkPanel` adoptan la misma jerarquía tipográfica y bordes redondeados.
3. **Botón Scroll-to-Bottom Flotante**:
   - Botón circular flotante (`codicon-arrow-down`) con sombra que aparece al alejarse del final.
   - Badge indicador de nuevos mensajes si el asistente responde mientras se lee arriba.

#### Criterios de Éxito

- Transición consistente entre todos los diálogos y vistas de configuración.
- El botón de scroll aparece y desaparece con detección precisa de posición.

---

## 3-B. Fases 7–13: Capacidades del Harness (inspiradas en oh-my-pi)

> Fuente: investigación competitiva 2026-08-22 contra fuentes primarias de
> [`can1357/oh-my-pi`](https://github.com/can1357/oh-my-pi) (fork de pi-mono, MIT) — ver
> [research/2026-08-22_oh-my-pi-vs-frida.md](../research/2026-08-22_oh-my-pi-vs-frida.md).
> Tesis adoptada: **el harness —no el modelo— mueve las métricas** (edición confiable,
> routing por intención, revisión en vivo, reglas oportunas). Frida ya ganó en host UX
> (webview) y corporativo (Enterprise/AIDD/permission-system); estas fases atacan el delta.

---

### Fase 7: Roles de Modelo y Routing por Intención

**Objetivo**: Pasar de "un modelo activo con cambio manual" a roles que enrutan trabajo
por intención, con cadenas de resiliencia. Base habilitadora de las Fases 8, 13 y de la
consolidación de memoria barata.

#### Entregables

1. **Roles iniciales** (`frida.modelRoles.*` en settings):
   - `default` — el modelo principal actual.
   - `smol` — subagents, extracciones de memoria, resúmenes (default: Ollama local, costo 0).
   - `commit` — changelogs/commits (default: mismo que default).
2. **Fallback chain por rol**: `Enterprise → Ollama` (429/quota → siguiente en la cadena;
restauración al enfriarse). Prueba TDD del resolvedor con catálogo simulado.
3. **UI**: selector de rol en `Composer.tsx` junto al selector de modelo; pestaña Roles en
`ModelPanel.tsx` con asignación por rol (incluye estado "sin configurar → hereda default").
4. **Atribución**: session-stats y usage reportan por rol.

#### Criterios de Éxito

- Un subagent lanzado con rol `smol` usa Ollama sin tocar cuota Enterprise.
- Al fallar Enterprise (simulado en test), el turno cae a Ollama y se restaura después.
- Suite verde, tsc ×2, build OK.

---

### Fase 8: Advisor en Vivo con WATCHDOG.md

**Objetivo**: Un modelo revisor leyendo el **delta** de cada turno del agente principal,
inyectando notas con severidad y guard anti-ruido. Port del patrón advisor/watchdog de OMP
adaptado a la webview y a la cultura de issues de Frida.

Dependencia: Fase 7 (el advisor corre en el rol `smol` de Ollama, costo 0).

#### Entregables

1. **Runtime advisor** (`src/advisor/`): sesión propia (contexto aislado, toolset
   read/grep/glob), cursor de delta sobre el transcript principal, manejo de
   compactación (re-prime).
2. **Tool `advise`** con severidades: `nit` (aside no interruptivo) · `concern` (steer del
turno en vivo) · `blocker` (interrumpe incluso tras respuesta terminal).
3. **Emission guard** (port del diseño OMP): normalización NFKC, filtro de frases vacías
("lgtm", "ok"), dedupe exacto FIFO, máx 1 nota por update.
4. **`WATCHDOG.md`**: descubrimiento user-level + project-level (misma convención que
AGENTS.md) con prioridades de revisión SOLO del advisor (es-MX, `Refs #N`, tokens
`--vscode-*`, TDD).
5. **UI webview**: tarjetas de nota embebidas en `Turn.tsx` (borde ámbar/rojo por
severidad, estilo chat-notice), toggle advisor en Composer, `/advisor status` con costo/tokens.
6. **Persistencia**: `__advisor.jsonl` por sesión (uso atribuido en usage dashboard).

#### Criterios de Éxito

- Con advisor activo, una violación de regla (p. ej. commit sin `Refs #N`) produce una nota
`concern` visible en el turno sin duplicarse en updates siguientes.
- El costo del advisor se reporta separado y el toggle lo apaga sin reinicio de ventana.

---

### Fase 9: Búsqueda Web Nativa con Piso Keyless

**Objetivo**: `web_search` builtin con cadena de backends y piso sin API key (la sesión de
research 2026-08-22 quedó coja sin keys; duckduckgo/startpage habrían funcionado).

#### Entregables

1. **Tool `web_search`** host-side: cadena `provider configurado → backends con key →
backends keyless (duckduckgo/startpage)`; resultados rankeados con URL+snippet.
2. **Extracción site-aware básica** en `web_fetch`: GitHub (ya vía API), npm, docs oficiales
→ markdown con anchors.
3. **Settings** por proveedor + estado en Entorno doctor ("web_search: 2/5 backends
disponibles").
4. **UI**: fila tool-flat en transcript (Fase 2) para web_search/web_fetch.

#### Criterios de Éxito

- Búsqueda funciona sin ninguna API key configurada (piso keyless).
- La cadena degrada con mensaje claro cuando un backend falla.

---

### Fase 10: Edición Hashline

**Objetivo**: Port del paquete MIT `@oh-my-pi/hashline` como variante del edit: anclas por
hash de contenido (`[PATH#TAG]`), rechazo de ediciones rancias ANTES de escribir,
anclas de bloque tree-sitter. Los números de OMP (Grok Code Fast 6.7%→68.3% éxito;
Grok 4 Fast −61% tokens) lo hacen el mayor multiplicador calidad/token.

#### Entregables

1. **Port del core** (`src/tools/frida-hashline/`): parser/applier de la gramática
   (`PUT N.=M:`, `CUT N*`, registros, `MV`), snapshot tags de 4 hex, recovery unívoco.
2. **Integración con read/edit**: read/grep publican tags de snapshot; edit en modo hashline
los exige; edición fuera de rango visto se rechaza con guía de re-lectura.
3. **Selección de modo** (`resolveEditMode`): hashline default, `replace` de fallback por
modelo — configurable por setting.
4. **UI**: el preview de diff existente ya sirve; carta (proposed) + Accept para MV/REM.

#### Criterios de Éxito

- Editar un archivo modificado desde el último read se RECHAZA limpio (test con carrera
simulada), nunca corrompe.
- Benchmark local antes/después de tokens de edición en 3 tareas típicas.

---

### Fase 11: Agent Hub — Supervisión de Subagentes

**Objetivo**: Tab de la webview para ver y controlar subagents en vivo: roster con estado,
costo y actividad; transcript en tiempo real; steering; revive de parked; kill.

Dependencia suave: Fase 6 (overlays armonizados).

#### Entregables

1. **Roster vivo** (`AgentHub.tsx`): status (running/idle/parked/aborted), modelo/rol,
   costo, tokens, toolCalls, edad desde última actividad; vista árbol padre/hijo.
2. **Inspector**: transcript en vivo del subagent (tail del JSONL), tool actual y args,
   uso de contexto.
3. **Controles**: input de steering (usa el prompt path normal → queda persistido), revive
   de parked, kill con confirmación (sin abortar la sesión padre).
4. **Descubrimiento al resumir**: JSONL de subagents de sesiones previas → filas parked.

#### Criterios de Éxito

- Steer en caliente a un subagent corriendo desde la UI, visible en su transcript.
- Kill no aborta la sesión principal y el roster refleja el tombstone.

---

### Fase 12: TTSR — Reglas de Stream

**Objetivo**: Reglas de proyecto que DUERMEN hasta que el modelo las viola: match
regex/AST sobre el stream en vivo → abort del parcial → inyección
`<system-interrupt>` → reintento desde el mismo punto. Cero context tax por turno.

**Prerrequisito bloqueante**: reparar el clúster de abort (#85, #90, #96 — abortRun
sobre undefined y run escapado). OMP demuestra que abort limpio es la base de TTSR.

#### Entregables

1. **Fix previo**: issues #85/#90/#96 (abort consistente en chat/workflow/detached).
2. **TtsrManager**: reglas con `condition` (regex) y `astCondition` (ast-grep vía
   pi-lens), scope (texto/thinking/toolargs), `repeatMode` once/after-gap.
3. **Coordinator**: monitoreo de deltas → abort acotado al tool-call ofensor → descarte
   del parcial (`contextMode: discard`) → inyección → `continue()`; guards de carrera
   (retry token + generación).
4. **Reglas builtin Frida**: es-MX, `Refs #N` (no `Closes #N`), tokens `--vscode-*` en UI,
TDD sin marcar completo.
5. **Persistencia**: `ttsr_injection` en la sesión (sobrevive resume/compactación).
6. **UI**: tarjeta TTSR-notification (ámbar) en Turn.tsx; gestión de reglas en Settings.

#### Criterios de Éxito

- Un commit sin `Refs #N` en un repo con la regla activa se aborta mid-stream y se
reintenta con el recordatorio inyectado.
- Sin reglas violadas, el costo por turno es idéntico al baseline (0 tax).

---

### Fase 13: Extensiones Menores

**Objetivo**: Capacidades de menor alcance que completan la adopción selectiva.

#### Entregables

1. **Memoria 2-fase sobre hermes-memory**: extracción por sesión (rol smol) →
   consolidación cruzada (`MEMORY.md` + summary + lecciones) inyectada al arranque con
   cap de tokens; descubrimiento en background con leases.
2. **`conflict://N` en worktrees**: cada conflicto de merge como URL resoluble con
   `@theirs/@ours/@base` (bulk `conflict://*`); integra con `src/worktree.ts` y la guía
   de worktrees.
3. **Dictado 🎤 (#95)**: port del crate MIT `pi-voice` (captura, Opus) para STT local en el
   Composer — cierra el issue existente.
4. **Magic keywords**: `ultrathink` (thinking máximo), `orchestrate` (subagent_gate),
   `workflowz` (frida-extensible-workflows) — match solo en prosa, nunca en código/paths.

#### Criterios de Éxito

- Cada ítem con su test TDD y su issue propio vinculado; sin regresiones.

---

## 4. Matriz de Compatibilidad y Verificación Visual

| Elemento | Tema Oscuro (Dark+) | Tema Claro (Light+) | Alto Contraste | Reduced Motion |
| :--- | :---: | :---: | :---: | :---: |
| **Fila `.tool-flat`** | `descriptionForeground` | `descriptionForeground` | `contrastBorder` | Sin transición |
| **Shimmer de Verbo** | Gradiente azul/gris | Gradiente azul tenue | Texto plano estático | Estático |
| **Border Beam** | Beam azul brillante | Beam azul oscuro | Borde sólido resaltado | Borde fijo |
| **Codicons** | Glifos vectoriales | Glifos vectoriales | Alto contraste nativo | Estático |
| **Agrupación Turno** | Línea guía tenue | Línea guía tenue | Borde de contraste | Inmediato |

---

## 5. Estado y Próximos Pasos

- [x] **Fase 1 (Fundaciones Visuales y Primitivas CSS)**: `@vscode/codicons`, `Codicon.tsx`, `.tc-shimmer`, `font-variant-numeric: tabular-nums`, accesibilidad `prefers-reduced-motion` (`431d5ec`).
- [x] **Fase 2 (Fila de Tools Plana y Catálogo Tool por Tool)**: `tool-phrases.ts` para 20+ herramientas con soporte de verbos en gerundio/pasado, `.tool-flat` y lazy grid expansion (`01ae60c`).
- [x] **Fase 3 (Estructura de Turnos, Thinking y Agrupación)**: `turn-grouping.ts` con partición cronológica, fila plana `ThinkingSegment` (`Razonando…` $\rightarrow$ `Razonó`), y disclosure `ToolGroup` con línea guía vertical (`5cc1232`).
- [x] **Fase 4 (Footer — Input Stack, Composer y Border Beam)**: `.chat-input-stack` con borde unificado, border beam `.working` animado con conic-gradient, botón circular Submit/Abort (↑/■) y toolbars integradas (`98a8b65`).
- [x] **Fase 5 (Footer — Paneles Dockeados y Followups)**: `Followups.tsx` con reglas contextuales inteligentes en `followup-rules.ts` y chips clicables (`d693f07`).
- [x] **Fase 6 (Header, Overlays y Botón Scroll-to-Bottom)**: `WorkspaceBar` modernizado con Codicons y botón flotante `.jump-bottom` (`c01d332`).
- [ ] **Fase 7 (Roles de Modelo y Routing)** — habilitadora: smol→Ollama, fallback Enterprise→Ollama.
- [ ] **Fase 8 (Advisor en Vivo + WATCHDOG.md)** — depende de 7.
- [ ] **Fase 9 (web_search Nativo Keyless)**.
- [ ] **Fase 10 (Edición Hashline)**.
- [ ] **Fase 11 (Agent Hub)** — depende de 6 (ya lista).
- [ ] **Fase 12 (TTSR)** — bloqueada por el clúster de abort #85/#90/#96.
- [ ] **Fase 13 (Menores: memoria 2-fase, conflict://, dictado #95, magic keywords)** — depende de 7.
