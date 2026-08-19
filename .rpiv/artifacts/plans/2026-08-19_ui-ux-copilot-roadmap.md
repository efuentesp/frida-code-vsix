---
date: 2026-08-19T17:15:00-0600
author: Edgar F. Fuentes Perea
commit: 0f3d849
branch: main
repository: frida-code
topic: "Hoja de Ruta UI/UX Frida Code × GitHub Copilot — Rediseño visual gradual del Webview"
tags: [ui-ux, copilot-chat, webview, codicons, tool-flat, transcript, input-stack, roadmap]
status: ready
phase_count: 6
phases:
  - { n: 1, title: "Fundaciones Visuales y Primitivas CSS (@vscode/codicons, shimmer, tokens)", files: [package.json, webview/main.tsx, webview/components/Codicon.tsx, webview/styles.css, test/codicon.test.ts], depends_on: [] }
  - { n: 2, title: "Fila de Tools Plana y Catálogo Tool por Tool (tool-phrases, .tool-flat, 20 tools)", files: [webview/tool-phrases.ts, webview/components/CollapsibleCard.tsx, webview/components/ToolCard.tsx, test/webview-tool-phrases.test.ts], depends_on: [1] }
  - { n: 3, title: "Estructura de Turnos, Thinking y Agrupación (Disclosure colapsable)", files: [webview/components/Turn.tsx, webview/styles.css, test/turn-grouping.test.ts], depends_on: [2] }
  - { n: 4, title: "Footer — Input Stack, Composer y Border Beam (.working, botón circular ↑/■)", files: [webview/components/Composer.tsx, webview/components/ContextBar.tsx, webview/styles.css], depends_on: [1] }
  - { n: 5, title: "Footer — Paneles Dockeados en Píldora Única y Followups (Todo, Preguntas, Aprobación)", files: [webview/components/Followups.tsx, webview/followup-rules.ts, webview/components/QuestionsPanel.tsx, webview/components/ApprovalCard.tsx, webview/App.tsx, test/followup-rules.test.ts], depends_on: [4] }
  - { n: 6, title: "Header, Overlays y Botón Scroll-to-Bottom Flotante", files: [webview/components/WorkspaceBar.tsx, webview/components/SettingsHub.tsx, webview/components/SessionsPanel.tsx, webview/App.tsx, webview/styles.css], depends_on: [3, 5] }
last_updated: 2026-08-19T17:15:00-0600
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

## 4. Matriz de Compatibilidad y Verificación Visual

| Elemento | Tema Oscuro (Dark+) | Tema Claro (Light+) | Alto Contraste | Reduced Motion |
| :--- | :---: | :---: | :---: | :---: |
| **Fila `.tool-flat`** | `descriptionForeground` | `descriptionForeground` | `contrastBorder` | Sin transición |
| **Shimmer de Verbo** | Gradiente azul/gris | Gradiente azul tenue | Texto plano estático | Estático |
| **Border Beam** | Beam azul brillante | Beam azul oscuro | Borde sólido resaltado | Borde fijo |
| **Codicons** | Glifos vectoriales | Glifos vectoriales | Alto contraste nativo | Estático |
| **Agrupación Turno** | Línea guía tenue | Línea guía tenue | Borde de contraste | Inmediato |

---

## 5. Próximos Pasos

1. Validar esta hoja de ruta.
2. Iniciar con la **Fase 1 (Fundaciones Visuales y Primitivas CSS)** creando los tests base y la integración de `@vscode/codicons`.
