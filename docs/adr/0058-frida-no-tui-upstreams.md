# ADR-0058: Las extensiones upstream no renderizan TUI en frida

- **Estado**: Aceptado
- **Fecha**: 2025-10-24
- **Contexto**: issues #21 (frida-hermes-memory) y #29 (frida-knowledge-base) — errores de activación e2e
- **Decisión relacionada**: ADR-0014 (Remote React / fridaWebMount), ADR-0027 (ask_user_question nativo)

## Contexto

frida-code es un host VS Code/webview, no una terminal. Los upstreams que
empaqueta (pi-hermes-memory, @zosmaai/pi-llm-wiki, futuros) se escriben para
pi real, cuya UI es una TUI (Ink). Varios importan `@earendil-works/pi-tui`
como peer:

- **Utilidades de texto** (`truncateToWidth`, `visibleWidth`,
  `wrapTextWithAnsi`, `sliceByColumn`): strings/ANSI puros, funcionan en
  cualquier host. Son la mayoría del uso real (verificado contra
  pi-hermes-memory@0.9.5).
- **Componentes TUI** (`new Text(...)`, modales con `matchesKey`): solo
  tienen sentido con un reconciler de terminal y una TUI viva.

pi-hermes-memory tiene un modal completo (`SkillsManagerModal`,
`/memory-skills`) con keymap de teclado — interacción terminal pura. Y ya
contiene, por diseño propio, la degradación correcta:

```ts
if (!ctx.hasUI || typeof ctx.ui.custom !== "function") {
  ctx.ui.notify(formatSkillsList(rows, projectName), "info");
  return;
}
```

## Decisión

1. **frida no renderiza TUI ni la emulará**. No se implementa ningún puente
   genérico Component TUI → webview: la interfaz (`render(width): string[]`,
   keymaps, focus) no se mapea fiel, y el costo no compra nada que la webview
   no dé mejor.
2. **`ctx.ui.custom` NO se define** en el ExtensionUIContext de frida. Las
   extensiones upstream con guarda (`typeof ctx.ui.custom !== "function"`)
   degradan solas a texto plano por `notify`. Un no-op
   `custom: async () => undefined` se salta la guarda y deja el comando
   MUDO (ni texto ni modal) — fue el bug hallado en la revisión e2e.
3. **El alias jiti de `@earendil-works/pi-tui` es solo resolución de
   módulos** (necesario para cargar factories que importan utilidades de
   texto como valor): apunta a la copia nested que el SDK ya shipea en el
   VSIX. No habilita ningún render.
4. **UI rica de extensión en frida = `fridaWeb`/`fridaWebMount`** (ADR-0014,
   Remote React), o componentes nativos del webview (ADR-0027). Ese es el
   canal de rediseño cuando un caso lo merezca — por caso, nunca genérico.

## Verificaciones hechas

- rpiv-ask-user-question (el motivo histórico del no-op, issue #78 de rpiv)
  **no lo necesita**: enruta por `ctx.mode === "rpc"` + `hasDialogUI(ctx.ui)`
  (select/input — frida los implementa) al dialog walker secuencial y jamás
  alcanza `custom` en frida.
- `renderView()` (el `new Text` de pi-hermes-memory) no lo llama nadie:
  código muerto sin registro de renderer.
- La extensión llama del SDK (`extensions/llama/ui.js`, único caller interno
  de `ui.custom`) no se carga en frida.
- @zosmaai/pi-llm-wiki no usa `ui.custom`.

## Consecuencias

- `/memory-skills` (y cualquier comando upstream con guarda) muestra lista
  de texto plano en el chat. Aceptable hoy; si la gestión de skills merece
  UI rica, se rediseña con quickpick/fridaWeb puntual.
- Una extensión que llame `ctx.ui.custom(...)` SIN guarda tirará TypeError
  al invocarlo — mismo comportamiento que cualquier host sin TUI (Zed,
  Paseo, RPC). No es responsabilidad de frida simularla.
- Contrato blindado por tests: `test/extension-ui-context.test.ts` (custom
  ausente + select/input presentes + fridaWeb vivo) y el contract-scan de
  `test/frida-hermes-memory/constants.test.ts` (prefix-match del alias map).
