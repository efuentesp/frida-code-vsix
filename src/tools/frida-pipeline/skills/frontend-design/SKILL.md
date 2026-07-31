---
name: frontend-design
description: "Inyecta guía de diseño visual adaptada para trabajo frontend. Scope: frontends web (HTML/CSS/JS, React, Vue, Svelte, Astro, etc.). Úsala cuando el usuario pida construir una página, layout completo, o aplicación nueva, o quiera dirección de diseño explícita. SKIP para requests de un solo componente en codebases con un sistema de estilo establecido. La skill auto-adapta: scan vacío → micro-entrevista de 2 preguntas; sistema establecido → inyección scan-only; sino checkpoint completo de 7 dimensiones."
argument-hint: "[--headless]"
disable-model-invocation: true
contract:
  produces:
    kind: side-effect
    meta:
      effect: design-guidelines-injection
---

# Frontend Design

Inyecta guía de diseño visual para trabajo frontend.

## Flujo

1. Escanear codebase → 2. Checkpoint de diseño → 3. Inyectar guidelines

## Pasos

### Paso 1: Escanear codebase

Busca sistema de diseño existente:

- `tailwind.config.*`, `theme.*`, `tokens.*` → design tokens.
- Componentes UI existentes (`components/`, `ui/`).
- CSS/SCSS variables y mixins.
- Storybook o catálogo de componentes.

**Auto-adapta**:
- **Scan vacío** (greenfield): micro-entrevista de 2 preguntas (estilo + audiencia).
- **Sistema establecido**: inyección scan-only (referencia el sistema existente).
- **Mixto**: checkpoint completo de 7 dimensiones con skip logic.

### Paso 2: Checkpoint de 7 dimensiones (si aplica)

1. **Tipografía**: escala, jerarquía, legibilidad.
2. **Color**: paleta, contraste, semántica.
3. **Espaciado**: escala, ritmo vertical.
4. **Layout**: grid, flex, breakpoints responsive.
5. **Componentes**: consistencia, reutilización.
6. **Interacción**: estados hover/focus/disabled, transiciones.
7. **Accesibilidad**: contraste WCAG, focus visible, ARIA.

Salta dimensiones donde el codebase ya tiene un sistema establecido.

### Paso 3: Inyectar guidelines

Produce guidelines de diseño concretos para el trabajo solicitado:

- **Tokens recomendados**: colores, tipografía, espaciado.
- **Patrones de layout**: grid/flex para el componente/página.
- **Referencias al sistema existente**: qué reusar vs qué crear.

Las guidelines se inyectan como contexto adicional para el trabajo de implementación.

## Notas

- **Auto-adapta**: no fuerza un checkpoint completo si ya hay sistema.
- **SKIP para un solo componente** en codebases con estilo establecido.
- **Accesibilidad**: WCAG AA mínimo (contraste 4.5:1 para texto normal).
