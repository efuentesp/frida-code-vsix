# Estilos de UI del webview — tabs y botones

Guía canónica de los patrones de **tabs** y **botones** del webview de Frida.
Todo requerimiento nuevo que agregue tabs o botones debe replicar estos
estilos. Historial: el panel de cc-plugins (#49) impulsó la unificación
(commits `364d462`…`7720019`, `86a95ec`).

## ⚠️ Regla de cascada (leé esto antes de escribir CSS de botones)

Al final de `webview/styles.css` hay reglas **globales**:

```css
button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
button:hover { background: var(--vscode-button-hoverBackground); }
```

`button:hover` tiene especificidad **(0,1,1)** y **vence** a cualquier regla de
una sola clase **(0,1,0)** — p. ej. `.mi-boton:hover { background: none; }`
**pierde** y el hover se vuelve azul primario aunque lo declares. Tres salidas:

1. **Selector compuesto** (0,2,0) — `.ctx .mi-boton:hover` o `.mi-boton.algo:hover`.
2. **Declarar el fondo en el `:hover` de la misma clase** solo funciona si tu
   regla tiene ≥ (0,1,1) — con clase única no alcanza: usá compuesto.
3. Envolver el estilo en el selector de contexto del componente.

Síntoma del bug: *"hover pone fondo de color pero las letras quedan
blancas/ilegibles"* — es `button:hover` inyectando el azul primario sobre una
identidad de color distinta.

## Tabs — patrón unificado

Tres implementaciones vigentes: `.cfg-tab` (Configuración/SettingsHub),
`.ccp-tab` (panel cc-plugins) y `.q-tab` (QuestionsPanel). Receta:

```css
.mi-tab {
 /* base: fondo transparente, texto descriptionForeground */
 background: transparent;
 color: var(--vscode-descriptionForeground);
}
.mi-tab:hover {
 /* hover = par COMPLETO de selección (fondo + texto juntos) */
 background: var(--vscode-list-activeSelectionBackground);
 color: var(--vscode-list-activeSelectionForeground);
}
.mi-tab.active {
 /* activa = azul textLink + subrayado; NUNCA bloque sólido */
 background: transparent;
 color: var(--vscode-textLink-foreground, #4daafc);
 box-shadow: inset 0 -2px 0 0 var(--vscode-textLink-foreground, #4daafc);
}
```

Reglas del patrón:

- **Subrayado con `box-shadow inset`**, no `border-bottom`: un border suma
  2px de alto y la tab "salta" al activarse. El inset no desplaza layout.
- **Hover con el par completo** (`activeSelectionBackground` +
  `activeSelectionForeground`) — el tema garantiza el contraste.
- **Activa = `textLink` + subrayado**, fondo transparente (estilo VS Code).
- Contadores/badges (p. ej. `✻ 9`) heredan el color del texto activo.

**Fuera del patrón a propósito**: `.seg-toggle .seg` (SessionsPanel,
UsageDashboard) es un *control segmentado* (toggle de 2 opciones), no una tab
bar — mantiene su estilo propio (segmento activo con fondo secundario).

## Botones — catálogo por tipo

| Tipo | Clases ejemplo | Base | Hover |
| --- | --- | --- | --- |
| **Primario** | `.ccp-btn-primary`, `.pc-save`, `.primary-btn`, `.ui-dialog-send`, `.yes` | `button-background` + `button-foreground` | `button-hoverBackground` (par nativo) |
| **Secundario** | `.ccp-btn` ("Ver plugin →", "Desinstalar") | `button-secondaryBackground` + `secondaryForeground` | `button-secondaryHoverBackground` — **nunca** el azul primario |
| **Fantasma / enlace** | `.ccp-back` ("← Volver"), `.onb-link-btn` | fondo transparente, texto description/textLink | tenue (`list-hoverBackground`) o solo texto, **sin azul inyectado** |
| **Icono** | `.turn-copy` (📋), `.chip-x` (×), `.info-toast-close` (×) | `background: none` + color de intención | `background: none` explícito + su color de intención |
| **Switch pill** | `.ccp-switch`, `.switch` | color de ESTADO (rojo off / verde on) | conserva estado + `brightness(1.25)` — jamás azul |

El **primario de referencia** es el botón "Instalar" de Discover en cc-plugins.

### Verificación obligatoria

Los cambios de CSS se verifican en el **bundle servido**, no solo en fuente:

```bash
npm run build
grep -o "mi-selector{[^}]*}" dist-webview/assets/index-*.css
```

Lección de `e7bdb06`: una regla insertada *antes* en el archivo pierde ante
una posterior de igual especificidad — el `width:100%` "existía" en fuente y
**nunca aplicó**. Si dos reglas compiten por igual especificidad, ganará la
última: preferí selectores compuestos que ganen por especificidad, no por orden.

## Inventario auditado (86a95ec)

Clases `<button>` auditadas en `webview/`: `.ap-item`, `.chip-x`,
`.info-toast-close`, `.yes`/`.no`, `.onb-link-btn`, `.pc-save`, `.primary`,
`.primary-btn`, `.seg`, `.stop`, `.sub-version`, `.switch`, `.turn-copy`,
`.ui-dialog-send`, más la familia `.ccp-*`. Si agregás un botón nuevo,
incluilo en este inventario y verificá su hover contra `button:hover`.
