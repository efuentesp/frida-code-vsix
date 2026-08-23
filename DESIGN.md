# DESIGN.md — Sistema de Diseño de Frida Code

Este documento define la especificación visual y arquitectónica completa de
**Frida Code**, asegurando coherencia con la experiencia nativa de **GitHub
Copilot Chat** y la interfaz de usuario de **VS Code**.

Cubre todas las superficies de la extensión: **Chat conversacional**, **Paneles
de Configuración (Settings Hub)**, **Superficies de Datos (Tree Views /
Contexto)** y **Diálogos de Aprobación/Cuestionarios**.

La normativa técnica de cascada para tabs y botones se detalla en
[`docs/webview-ui-styles.md`](docs/webview-ui-styles.md).

---

## 1. Filosofía de Diseño: Copilot Chat & VS Code Nativo

> **Integración Silenciosa y Precisa.**
> Frida se percibe como una parte orgánica del editor. No añade ruido visual,
> no inventa esquemas de color arbitrarios ni simula interfaces retro.
> Todo elemento visual utiliza el lenguaje nativo de VS Code: superficies planas,
> bordes continuos de 1px, iconografía vectorial `@vscode/codicons`,
> tipografía del sistema y contraste asegurado por las variables del tema activo.

### Pilares de Diseño

1. **Fidelidad Absoluta al Tema**: El 100% de fondos, textos y bordes consumen variables `--vscode-*`. Jamás se inyectan colores hexadecimales directos ni fondos fuera del tema.
2. **Jerarquía Estructurada**: La información densa se expone mediante **Tree Views** y tarjetas colapsables, evitando volcados de texto plano.
3. **Micro-interacciones Fluidas**: Transiciones rápidas (100–150ms), shimmers sutiles en procesos activos (`.tc-shimmer`) y hovers discretos (`--vscode-list-hoverBackground`).
4. **Accesibilidad y Rendimiento**: Soporte riguroso para `prefers-reduced-motion` y foco navegable por teclado en modales y cuestionarios.

---

## 2. Fundaciones y Tokens de Estilo

### 2.1. Colores y Superficies

- **Fondo de chat y paneles**: `--vscode-editor-background`, `--vscode-sideBar-background`.
- **Contenedores y modales**: `--vscode-editorWidget-background` con borde `--vscode-widget-border` / `--vscode-panel-border` (1px).
- **Líneas de separación**: `--vscode-panel-border` o `rgba(128, 128, 128, 0.15)`.
- **Estados Semánticos**:
  - **Éxito / Conectado**: `--vscode-testing-iconPassed` (#73c991) o `--vscode-charts-green` (#3fb950).
  - **Advertencia / Activo**: `--vscode-list-warningForeground` (#cca700) o `--vscode-editorWarning-foreground`.
  - **Error / Desconectado**: `--vscode-errorForeground` (#f14c4c) o `--vscode-gitDecoration-deletedResourceForeground` (#f85149).
- **Métricas y Gráficos**: Paleta canónica `--vscode-charts-{blue,purple,green,orange,yellow,red}`.

### 2.2. Tipografía y Números

- **UI y Chat General**: `var(--vscode-font-family)` (13px tamaño base).
- **Código, Diffs y Cifras Tabulares**: `var(--vscode-editor-font-family, ui-monospace, monospace)` exclusivamente para bloques de código, nombres de comandos en terminal y columnas numéricas con `font-variant-numeric: tabular-nums`.
- **Escala Tipográfica**:
  - Encabezados principales / Modales: 13–14px bold.
  - Títulos de sección / Headers de árbol: 12px bold.
  - Filas de lista / Texto de chat: 12–13px (11.5px en árboles compactos).
  - Metadatos, badges, timestamps y chips: 10–11px tenue (`--vscode-descriptionForeground`).

### 2.3. Radios y Elevación

- Tarjetas, modales y Hub de Configuración: `6–8px` (`box-shadow: 0 4px 20px rgba(0,0,0,0.25)`).
- Filas de árbol, botones y chips: `3–4px`.
- Inputs y textareas: `4–6px`.
- Botón submit/abort del footer: `50%` (26px × 26px).

---

## 3. Arquitectura del Chat y Estructura de Turnos

```text
┌─────────────────────────────────────────────────────────────┐
│ 👤 Tú                                                       │
│    ¿Cómo optimizo esta consulta SQL?                        │
├─────────────────────────────────────────────────────────────┤
│ 🤖 Frida                                              [ 📋 ]│
│    ▾ ✨ Razonó 1.4s · 320 tok                                │
│    ▾ 🛠 3 herramientas usadas · 2.1s · 1.2k tok              │
│      ├─ 📖 Leyendo src/db/query.ts (45L)                    │
│      └─ ✏️ Editando src/db/query.ts (+12 -4)                │
│                                                             │
│    Aquí tienes la versión optimizada utilizando índices...  │
│    ```sql                                                   │
│    SELECT id, name FROM users WHERE active = true;          │
│    ```                                                      │
│                                                             │
│  [ ✨ Explicar cambios ] [ ✨ Ejecutar tests ]               │
└─────────────────────────────────────────────────────────────┘
```

### 3.1. Turnos y Mensajes (`Turn.tsx`)

- **Fila de Usuario**: Avatar `account` (Codicon) con etiqueta "Tú" y burbuja de texto plano o tarjeta de skill colapsable (`SkillBlockCard`).
- **Fila de Frida**: Avatar oficial `FridaRobotIcon` (`{ > _ }`) con etiqueta "Frida" y botón fantasma de copiado (`turn-copy`).

### 3.2. Razonamiento (`ThinkingSegment`)

- **En vivo**: Fila plana con texto "Razonando…" acompañado de brillo continuo `.tc-shimmer` y cronómetro en vivo.
- **Completado**: Fila colapsable plana "Razonó X.Xs · Y tok" con chevron (`chevron-down`/`chevron-right`), expandible para inspeccionar el pensamiento completo en texto tenue.

### 3.3. Agrupación de Herramientas (`ToolGroup` / `.tool-flat`)

- Las secuencias contiguas de herramientas se agrupan en una fila resumen plana (`.tool-group-header`): "N herramientas usadas · X.Xs · Y tok".
- En vivo se muestra expandido; al finalizar el turno se colapsa automáticamente.
- **Tarjetas de herramientas (`ToolCard`, `BashCard`)**:
  - Icono de estado: `sync` giratorio (en ejecución), `pass-filled` (éxito), `error` (fallo).
  - Badges contextuales: líneas leídas (`readStats`: `12–45 (34L)`), diferencias git (`countDiff`: `+12 -4`), o estado de tareas (`TODO_STATUS_GLYPH`).
  - Frases en gerundio/pasado derivadas con `getToolPhrase` (ej. "Leyendo...", "Editando...", "Ejecutando en terminal...").

### 3.4. Footer e Input Stack (`Composer.tsx`)

- **Contenedor `.chat-input-stack`**: Borde continuo unificado de 1px que envuelve el textarea de entrada y las toolbars inferiores.
- **Border Beam (`.working`)**: Gradiente suave animado alrededor del input mientras el asistente procesa la solicitud.
- **Botón Submit / Abort**: Botón circular integrado de 26px (flecha arriba `arrow-up` en reposo, stop `debug-stop` durante la ejecución).
- **Toolbars integradas**: Selectores compactos para proveedor, modelo y nivel de pensamiento integrados en la base del input stack.

### 3.5. Sugerencias Contextuales (`Followups.tsx`)

- Píldoras de acción rápida post-turno (`.chat-followup-btn`) con icono `sparkle`, derivadas inteligentemente del último turno (ej. "Ejecutar tests", "Revisar diff").

### 3.6. Barras de Estado y Workspace (`WorkspaceBar`, `ContextBar`)

- **WorkspaceBar**: Barra superior compacta con chips de rama git (`git-branch`), carpeta workspace (`folder`), target y worktree activo.
- **ContextBar**: Medidor permanente en el footer con mini barra de presión, porcentaje de contexto, tokens usados/ventana y estadísticas de caché (R/W/HitRate).

---

## 4. Pantallas de Configuración (Settings Hub & Panels)

```text
┌─────────────────────────────────────────────────────────────┐
│ ⚙ Configuración                              [ 🔍 Buscar… ] │
│ ─────────────────────────────────────────────────────────── │
│ [ 🔌 Proveedores ] [ ✨ Modelos ] [ 🛡 Aprobación ] [ 📦 Tools ]│
│                                                             │
│ ▾ 🔌 Configurados (2)                                       │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ 🔑 DevEngine Gateway           [ ✓ Conectado (API Key) ]│ │
│ │    Endpoint corporativo Softtek DevEngine                 │ │
│ │    [ ≡ 3 modelos disponibles: gpt-5.4-mini (En uso) ]   │ │
│ │    [ Cambiar Key ] [ Olvidar ]                          │ │
│ └─────────────────────────────────────────────────────────┘ │
│ ▾ 🔌 Disponibles (1)                                        │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ ✨ GitHub Copilot                      [ ○ Sin conexión ]│ │
│ │    [ Iniciar sesión con GitHub ]                        │ │
│ └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### 4.1. Navegación del Hub (`SettingsHub.tsx`)

- **Modal centrado o vista de panel** con fondo `--vscode-editorWidget-background`.
- **Buscador global integrado (`.settings-search`)**: Filtra en tiempo real a través de proveedores, modelos, herramientas, directrices y variables de entorno.
- **Tabs de Configuración (`.cfg-tab`)**: Pestañas unificadas con Codicons (`plug`, `sparkle`, `shield`, `library`, `tools`, `graph`, `database`, `pulse`).

### 4.2. Tarjetas de Proveedor (`ProviderConfig.tsx` / `ProveedoresTab.tsx`)

- **Cabecera de Tarjeta (`.pc-head`)**: Icono del tipo de proveedor, nombre y badge de estado semántico:
  - `ok`: `pass-filled` verde con texto "Conectado (API Key)" o "Conectado (OAuth)".
  - `off`: `circle-outline` gris con texto "Sin conexión".
- **Catálogo de Modelos (`.pc-models-list`)**: Chips compactos (`.pc-model-chip`) con tag azul tenue "En uso" para el modelo activo.
- **Formularios de Autenticación**:
  - API Key: input protegido con botón de revelar contraseña (`eye` / `eye-closed`), botón "Guardar" y confirmación de dos pasos para "Olvidar".
  - OAuth: botón "Iniciar sesión" con flujo de device code (`copy` con feedback visual temporal).

### 4.3. Switches, Toggles y Controles de Formulario

- **Interruptor tipo Switch (`.switch`, `.ccp-switch`)**:
  - Componente accesible con estado visual verde (on) y gris/rojo (off).
  - Hover con `brightness(1.2)` que **nunca** inyecta el azul de `button:hover`.
- **Selects y Dropdowns (`fselect`, `.cfg-select`)**: Opciones con borde transparente y hover `--vscode-list-hoverBackground`.

### 4.4. Acordeones de Herramientas y Recursos (`IndexTab.tsx`, `ResourcesPanel.tsx`)

- Módulos organizados en acordeones colapsables (`.tools-module-card`, `.ci-accordion`) con header interactivo, contador de herramientas/comandos, badges `project`/`global` y descripciones en `descriptionForeground`.

### 4.5. Diagnósticos, Índices y Productividad

- **Barras de progreso continuas** con temporizador en formato `m:ss` (`fmtElapsed`).
- **Contadores numéricos** formateados con separador de miles (`fmtCount`, ej. `1,240`).
- **Semáforos de salud**: badges con iconos `pass-filled`, `warning` y `error`.

---

## 5. Superficies de Datos: Tree Views Jerárquicos

Las superficies de datos densas (como el reporte `/context` o el panel de tareas `todo`) se estructuran como **Tree Views estilo VS Code Explorer / Test Explorer**.

```text
┌─────────────────────────────────────────────────────────────┐
│ ▾ 🖥 Uso de Contexto (gpt-5.4-mini)             ● 22% presión│
│   [████████████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░] │
│   87.2k de 400k tokens (22%) · headroom: 313k · sin compactar│
│                                                             │
│ ┌─ Tree View ─────────────────────────────────────────────┐ │
│ │ ▾ 📊 Uso por categoría                     (87.2k usados)│ │
│ │   ├─ ■ 🤖 System prompt                        24.1k (6%)│ │
│ │   ├─ ■ 💬 Mensajes de usuario                  12.1k (3%)│ │
│ │   ├─ ■ 🤖 Mensajes del asistente                6.2k (2%)│ │
│ │   ├─ ■ 🛠 Tool calls (llamadas)                 3.1k (1%)│ │
│ │   └─ ■ ⭕ Espacio libre                       312.8k (78%)│ │
│ │ ▾ 🤖 Composición del System Prompt                 24.1k │ │
│ │   ├─ 📦 Base (pi core)                         8.2k (2%) │ │
│ │   ├─ ▸ 📄 Archivos de instrucción (3)               9.4k │ │
│ │   ├─ ▸ ✨ Skills habilitadas (14)                  11.2k │ │
│ │   └─ ▸ ☑ Directrices / Guidelines (12)             0.9k │ │
│ │ ▸ 🛠 Definición de Herramientas (47 activas)       21.5k │ │
│ └───────────────────────────────────────────────────────────┘ │
│                                    [ ⤢ Compactar ] [ Cerrar ]│
└─────────────────────────────────────────────────────────────┘
```

### 5.1. Reglas de Estructura de Árbol

1. **Secciones Colapsables**: Cada nodo raíz o sub-nodo lleva chevron vectorial (`chevron-down` / `chevron-right`), icono temático Codicon, título bold, contador de elementos y métricas resumidas.
2. **Filas de Árbol (`.ctx-tree-row`, `.todo-tree-row`)**:
   - Indentación visual mediante `paddingLeft` proporcional al nivel.
   - Hover nativo de lista (`var(--vscode-list-hoverBackground)`).
   - Chip de color de gráfico o icono Codicon para cada tipo de nodo.
   - **Alineación tabular estricta**: Las columnas de tokens y porcentajes a la derecha utilizan flexbox (`flex: 1` spacer) y `font-variant-numeric: tabular-nums` sobre `var(--vscode-editor-font-family)`.
3. **Interacción cruzada**: Al pasar el cursor por un elemento gráfico (ej. segmento de la barra de progreso) o por su fila en el árbol, el par se resalta con `is-hot` y el resto se atenúa suavemente a 35% de opacidad.

---

## 6. Diálogos Modales e Interacción Guiada (`QuestionsPanel`, `ApprovalCard`)

- **Navegación por Zonas de Teclado**:
  - `Tab` / `Shift+Tab`: Cicla entre zonas (Opciones → Campo de texto → Botones de acción).
  - `1–9` / `↑↓`: Selección directa de opciones.
  - `←/→`: Cambio de pestaña en cuestionarios multipaso.
  - `Shift+Enter`: Envío directo.
- **Pestaña final de Revisión ("✓ Enviar")**: Resume las opciones elegidas, señala campos pendientes y valida antes de confirmar.

---

## 7. Normativa de Tabs y Botones (Resumen de `docs/webview-ui-styles.md`)

### 7.1. Tabs Unificadas (`.cfg-tab`, `.ccp-tab`, `.q-tab`)

- **Base**: Fondo transparente, texto `descriptionForeground`.
- **Hover**: Par completo nativo (`activeSelectionBackground` + `activeSelectionForeground`).
- **Activa**: Texto `textLink-foreground` (#4daafc) con subrayado `box-shadow: inset 0 -2px 0 0 var(--vscode-textLink-foreground)`. Jamás bloque sólido de fondo.

### 7.2. Catálogo de Botones

- **Primario**: `button-background` + `button-foreground` (hover: `button-hoverBackground`).
- **Secundario**: `button-secondaryBackground` + `button-secondaryForeground` (hover: `button-secondaryHoverBackground` — **nunca** azul primario).
- **Fantasma / Enlace**: Fondo transparente, texto tenue (hover: `list-hoverBackground` o `toolbar-hoverBackground`).
- **Icono**: `background: none` explícito con color de intención en reposo y hover.

---

## 8. Anti-Patrones Estrictos (Lo que NUNCA se debe generar)

1. ❌ **Texturas artificiales o scanlines CRT**: Nada de `repeating-linear-gradient` simulando tramas de terminal antigua.
2. ❌ **Árboles de texto plano con unicode**: Prohibido simular jerarquías mediante cadenas fijas con `\u00A0\u00A0├─` que se desalinean al cambiar de fuente o ancho. Todo árbol debe ser un layout DOM/Remote React estructurado.
3. ❌ **Colores inyectados fuera del tema**: Prohibido usar `#3B82F6` (SaaS blue) o valores hexadecimales sin variables CSS.
4. ❌ **Monospace universal**: No aplicar fuentes monoespaciadas a etiquetas o textos descriptivos; el monospace se reserva para código y números tabulares.
5. ❌ **Componentes inertes**: Si un elemento parece clicable o tiene `cursor: pointer`, debe tener una acción real asociada.
6. ❌ **Azul inyectado en hovers secundarios**: Cumplir estrictamente la regla de especificidad compuesta para evitar que `button:hover` tiña de azul los botones secundarios o fantasmas.
