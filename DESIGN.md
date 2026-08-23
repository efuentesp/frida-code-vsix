# DESIGN.md — Dirección estética de Frida Code

Spec de diseño del webview de la extensión (sigue el formato DESIGN.md de
Google). Este documento fija las decisiones del checkpoint estético para que
cada pantalla nueva nazca con intención, no con defaults. La guía operativa de
componentes/estilos vive en [`docs/webview-ui-styles.md`](docs/webview-ui-styles.md);
éste es el *porqué* visual, aquél es el *cómo* diario.

## Overview

Frida Code es un asistente de código (estilo Claude Code) que vive dentro de
VS Code. Su UI es un webview React con Remote React para paneles de extensión
(tags `fbox/ftext/fbutton`). La dirección estética comprometida es:

> **Instrumento técnico denso.** La UI se lee como un instrumento de medición,
> no como una landing page. Mono, datos como protagonistas, jerarquía por peso
> y alineación. Densidad como estética: cada píxel tiene trabajo.

Las dos caras de Frida (chat conversacional + superficies de datos como
`/context`, paneles de workflows, dashboards de uso) comparten este lenguaje.

## Feel — las 7 dimensiones comprometidas

| Dimensión | Decisión | Manifestación |
| --- | --- | --- |
| **Tone** | Instrumento técnico | Cifras tabulares, conectores de árbol (`├ └`), chips de estado, cero decoración gratuita |
| **Color** | Sistema temático VS Code | 100% variables `--vscode-*` con fallbacks; nunca azul inyectado |
| **Typography** | Mono del editor para superficies de datos | `--vscode-editor-font-family` + `font-variant-numeric: tabular-nums`; jerarquía por peso (700/400) y columna, no por tamaño |
| **Motion** | Coreografía sutil | Una revelación orquestada al montar (~400ms, CSS puro) + hovers a 120ms; se siente sin notarse; respeta `prefers-reduced-motion` |
| **Spatial** | Denso info-rich | Dos columnas de datos que colapsan con `flex-wrap`; tablas compactas; simetría sólo a propósito |
| **Backgrounds** | Sólido + retícula sutil | Retícula 1px cada ~16px a ~4% de opacidad sobre el fondo del tema; hatch diagonal para estados "vacío/libre" |
| **Differentiation** | El dato como instrumento interactivo | Superficies de datos donde el elemento gráfico principal (ej. la barra segmentada de `/context`) ES el control: hover/click cruzado con su leyenda |

## Color

- Fuente de verdad: variables del tema activo con fallbacks GitHub-dark
  (`webview/styles.css`).
- Semántica de estado: ok `--vscode-charts-green` (#3fb950), warning
  `--vscode-editorWarning-foreground` (#cca700), error
  `--vscode-errorForeground` (#f14c4c).
- Presión/umbrales (paridad `ContextBar`): verde <70 · ámbar 70–89 (pulso) ·
  rojo ≥90.
- Paleta charts para categorías: `--vscode-charts-{blue,purple,green,orange,yellow,red}`.

## Typography

- Superficies de datos (reportes, dashboards, stats): mono del editor
  (`var(--vscode-editor-font-family, ui-monospace, monospace)`) con
  `tabular-nums`. **No se bundlean fuentes propias** — la fuente mono del
  editor es la que el usuario eligió; respetarla es parte del contrato con el
  tema.
- Chat/markdown: `--vscode-font-family` (13px base), como hoy.
- Escala compacta: 10/11/12px para meta, tamaños grandes (30px) sólo para la
  cifra héroe de un instrumento.

## Motion

- **Una** coreografía de entrada por superficie: revelación escalonada
  (~40ms por elemento, ease-out expo, `animation-fill-mode: backwards`).
- Hover/focus: transiciones de 120ms (`opacity`, `filter`, `background`).
- Los fades masivos los resuelve CSS (clases de estado + `transition`), nunca
  re-renders por frame.
- `@media (prefers-reduced-motion: reduce)` apaga TODAS las animaciones.

## Backgrounds & texture

- Tarjetas de instrumento: fondo sólido del tema + retícula sutil
  (`repeating-linear-gradient` 1px/16px, rgba(127,127,127,~.045)).
- Estados "libre/vacío": hatch diagonal (135°, 1px/5px, ~.28) — el mismo
  lenguaje de la retícula, más denso.

## Layout

- Superficies de datos: columnas `flex` con `flex-wrap` y `min-width` por
  columna (~280–300px) — densas en panel ancho, columna única en angosto.
- Conectores de árbol (`├`/`└` + indent) para listas jerárquicas dentro de
  secciones; el header de sección va en bold sin conector.
- Radios: 4–8px. Bordes 1px `--vscode-panel-border`.

## Aplicación de referencia

`/context` (ContextReport, `src/tools/frida-context/ContextReport.tsx`, #124)
es la implementación canónica de estas directrices: hero de presión con color
por umbral, barra-instrumento con hover cruzado segmento↔fila y pin por click,
dos columnas densas, retícula + hatch, coreografía de entrada escalonada,
botón de acción (Compactar) en el footer.

## NEVER

- Fuentes default como display: Inter, Roboto, Arial, system-ui; ni las
  "distinctivas sobreusadas" (Space Grotesk, Geist, Satoshi, Fraunces).
- Colores inyectados fuera del tema (hex hardcodeados salvo como fallback de
  variable); gradientes morado-azul; "SaaS blue" #3B82F6.
- Hero + tres tarjetas centradas; `max-w-7xl mx-auto` en todo; navbars
  genéricas.
- Componentes cookie-cutter (`rounded-xl shadow-md` idénticos, ghost buttons
  genéricos).
- Movimiento genérico: fade-in en cada scroll, bounces idénticos, diez
  micro-interacciones sin coreografía.
- **Superficies inertes**: todo lo que parezca clicable debe serlo (handlers
  reales en `fbox`/`fbutton`; si un elemento no hace nada, no debe tener
  `cursor: pointer`).

## Cambios

- 2026-01 (issue #124): checkpoint estético inicial (7 dimensiones) +
  aplicación canónica en ContextReport `/context`.
