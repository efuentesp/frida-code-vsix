# DESIGN.md — Sistema de Diseño de Frida Code (Estilo Copilot Chat)

Este documento define las directrices y estándares visuales de **Frida Code**,
garantizando coherencia con la experiencia nativa de **GitHub Copilot Chat**
y la interfaz de usuario de **VS Code**.

La guía operativa de estilos para tabs y botones se documenta en
[`docs/webview-ui-styles.md`](docs/webview-ui-styles.md). Este archivo establece
los principios rectores de arquitectura visual y componentes.

---

## 1. Filosofía y Dirección Estética

> **Integración Nativa y Limpia (Copilot Chat Style).**
> Frida no busca parecer una aplicación externa ni una terminal retro de 1985.
> Se integra de forma fluida, silenciosa y precisa en el ecosistema de VS Code:
> superficies planas, bordes finos de 1px, tipografía nativa, iconografía
> vectorial `@vscode/codicons` y contraste garantizado por las variables del tema.

### Pilares Fundamentales

1. **Fidelidad al Tema Activo**: El 100% de colores, fondos y bordes provienen de variables `--vscode-*`. Nunca se inyectan colores fijos ni fondos artificiales.
2. **Jerarquía Clara y Estructurada**: Los datos densos se organizan mediante **Tree Views** colapsables (estilo Explorer / Test Explorer), no como volcados de texto plano.
3. **Micro-interacciones Sutiles**: Transiciones rápidas (100–120ms), shimmers tenues de actividad y estados de hover discretos (`--vscode-list-hoverBackground`).
4. **Respeto a la Accesibilidad**: Cumplimiento estricto de contrastes nativos y soporte completo para `prefers-reduced-motion`.

---

## 2. Patrones de Componentes (Fases Copilot Consolidadas)

Frida implementa los patrones consolidados de Copilot Chat estructurados en las fases de modernización:

### 2.1. Header y Navegación

- **Acciones y Herramientas**: Botones fantasma con `@vscode/codicons` (`add`, `history`, `collapse-all`, `settings-gear`).
- **WorkspaceBar**: Chips compactos de estado (rama git, workspace, worktree) con iconos vectoriales.
- **Tabs Unificadas**: Regla canónica de `docs/webview-ui-styles.md`: fondo transparente, texto `descriptionForeground`, hover con par completo y tab activa con subrayado `box-shadow: inset 0 -2px 0 0 var(--vscode-textLink-foreground)`.

### 2.2. Estructura de Turnos y Chat

- **Avatares y Marca**: Identidad oficial `FridaRobotIcon` (`{ > _ }`) para turnos del asistente.
- **ThinkingSegment**: Fila plana con shimmer continuo durante el razonamiento (`.tc-shimmer`, "Razonando…") y estado colapsable completado ("Razonó X.Xs · Y tok").
- **ToolGroup (Disclosure de Herramientas)**: Agrupación de secuencias contiguas de herramientas en una fila resumen plana (`.tool-flat`), expandible bajo demanda con línea guía vertical.
- **Followups Contextuales**: Sugerencias de acción rápida post-turno (`.chat-followups`) con icono `sparkle` y hover sutil.

### 2.3. Footer e Input Stack

- **Contenedor `.chat-input-stack`**: Borde continuo unificado de 1px (`--vscode-panel-border`), textarea integrado y toolbars de selección rápida (proveedor, modelo, thinking).
- **Border Beam (`.working`)**: Gradiente suave animado durante la generación activa.
- **Botón Submit/Abort**: Círculo compacto de 26px con transición entre flecha arriba (`arrow-up`) y parada (`debug-stop`).

### 2.4. Controles Tree View (Jerarquías y Reportes de Datos)

Las superficies de datos (reporte de `/context`, lista de tareas `todo`, inspectores de workflows) utilizan el patrón de **Tree View estilo VS Code**:

- **Secciones Colapsables**: Encabezados con chevron (`chevron-down` / `chevron-right`), títulos en negrita, contadores de elementos e indicadores de resumen.
- **Filas de Árbol (`.tree-row`)**:
  - Icono semántico Codicon (`file-text`, `sparkle`, `list-checks`, `tools`, `comment-discussion`).
  - Líneas guía de indentación (`--vscode-tree-indentGuidesStroke`).
  - Hover nativo de lista (`--vscode-list-hoverBackground`).
  - Columnas tabulares de métricas (tokens, porcentajes, líneas) alineadas a la derecha con `tabular-nums`.

---

## 3. Especificaciones de Estilo

### 3.1. Color y Semántica

- **Fondos principales**: `--vscode-editor-background`, `--vscode-sideBar-background`, `--vscode-editorWidget-background`.
- **Bordes y separadores**: 1px continuo con `--vscode-panel-border` o `--vscode-widget-border`.
- **Estados y Semáforos**:
  - **Éxito / Pasado**: `--vscode-testing-iconPassed` (#73c991) o `--vscode-charts-green` (#3fb950).
  - **Advertencia / Activo**: `--vscode-list-warningForeground` o `--vscode-editorWarning-foreground` (#cca700 / #d29922).
  - **Error / Crítico**: `--vscode-errorForeground` (#f14c4c / #f85149).
- **Gráficos y Barras Métricas**: Paleta canónica `--vscode-charts-{blue,purple,green,orange,yellow,red}`.

### 3.2. Tipografía

- **Interfaz y Prosa**: `var(--vscode-font-family)` (13px tamaño base).
- **Código, Diffs y Cifras Tabulares**: `var(--vscode-editor-font-family, ui-monospace, monospace)` exclusivamente para bloques de código, comandos de terminal y columnas numéricas en tablas/árboles con `font-variant-numeric: tabular-nums`.
- **Jerarquía de Tamaños**:
  - Títulos de tarjeta / modal: 13–14px bold.
  - Encabezados de sección / árbol: 12px bold.
  - Filas de lista / árbol: 11.5–12px.
  - Metadatos, badges y tooltips: 10–11px.

### 3.3. Espaciado y Radios

- **Radios de borde**:
  - Tarjetas y paneles contenedores: `6px`.
  - Filas de árbol y botones: `3–4px`.
  - Inputs y badges: `4–6px`.
  - Botón submit circular: `50%` (26px × 26px).
- **Paddings**:
  - Paneles y modales: 10–14px.
  - Filas de árbol compactas: 3–4px vertical, 6–8px horizontal.

---

## 4. Lo que NUNCA se debe generar (Anti-Patrones)

1. **Texturas o Grillas Artificiales**: Nada de `repeating-linear-gradient` simulando scanlines CRT o retículas de terminal.
2. **Volcados de Texto Plano con Unicode**: Prohibido usar cadenas fijas con `\u00A0\u00A0├─` para simular árboles. Todo árbol debe construirse con elementos DOM/Remote React alineados con flexbox.
3. **Colores Inyectados**: Prohibido hardcodear colores hexadecimales sin fallback o fuera de la paleta del tema de VS Code (especialmente el clásico "azul inyectado" en hovers secundarios).
4. **Monospace Universal**: No aplicar fuentes monoespaciadas a etiquetas o textos descriptivos; el monospace se reserva para código y números tabulares.
5. **Componentes Inertes**: Cualquier fila o elemento con `cursor: pointer` o apariencia interactiva debe tener un comportamiento real asignado.

---

## 5. Implementación de Referencia: `/context`

El reporte del comando `/context` (`src/tools/frida-context/ContextReport.tsx`) es el ejemplo canónico de este diseño:

- **Resumen métrico limpio**: Barra de progreso segmentada sin texturas con paleta charts, selector rápido de modelo y chip de estado de presión.
- **Tree View interactivo**: Árbol colapsable por secciones (Uso por categoría, System prompt y Tool definitions) con iconos Codicon y alineación tabular a la derecha.
- **Acciones integradas**: Botones nativos (`Compactar` y `Cerrar`) en el pie del panel.
