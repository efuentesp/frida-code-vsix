# Changelog

Todos los cambios notables de **Frida Code** se documentan aquí.
El formato se basa en [Keep a Changelog](https://keepachangelog.com/es/1.1.0/)
y el proyecto se adhiere a [SemVer](https://semver.org/lang/es/).

VS Code muestra este archivo en la pestaña **Changelog** de los detalles de la
extensión. Las versiones se distribuyen como `.vsix` adjuntos a cada
[GitHub Release](https://github.com/efuentesp/frida-code-vsix/releases); dentro de
Frida usa `/version` (qué tienes) y `/update` (¿hay una nueva?).

## [Unreleased]

## [0.1.0] - 2026-07-30

### Añadido

- **Vista lateral en la barra de actividad.** Frida Code abre en el sidebar (con el
  icono lila del favicon) en vez de como tab de editor. Es arrastrable al sidebar
  secundario (como Copilot).
- **Badge de versión** `vX.Y.Z` en el sub-header + comando **`/version`**.
- **Comando `/update`**: consulta la última release en GitHub y avisa si hay versión
  nueva (soporta `GITHUB_TOKEN` para repos privados).
- **`CHANGELOG.md`** (esta pestaña).
- Banner del **código de dispositivo OAuth** (login de Copilot) visible en el chat
  principal, no solo en onboarding/model-panel.
- Diálogo de `ask_user_question`: tabs, filas de opción (radio/checkbox) y pestañas
  por pregunta.

### Cambiado

- **`media/frida-logo.png`** regenerado desde `favicon.svg` (coincide con el favicon
  y el icono de la barra de actividad).
- **Modelo de distribución:** el `.vsix` ya **no** se versiona en el repo
  (`*.vsix` en `.gitignore`); se regenera con `npm run package` y se distribuye por
  GitHub Releases.
- Toasts rediseñados (niveles info/warning/error/success, iconos, errores
  persistentes); razonamiento y ToolCards con estilo de tarjeta.

### Corregido

- **Login de GitHub Copilot:** `ERR_MODULE_NOT_FOUND` del OAuth — los flujos OAuth
  ahora se bundle estáticamente (`registerBunOAuthFlows` de pi-ai).
- **Persistencia de provider/model** entre recargas (z.ai / Copilot).
- **Errores de login vacíos** serializados correctamente (`describeLoginError`).
- Errores terminales del provider visibles (401 silencioso del gateway).

### Interno

- `package.json`: campo `repository`, `viewsContainers`/`views` (vista lateral),
  flag `--allow-missing-repository` en el script `package`.

## [0.0.1] - 2026-07-21

PoC inicial: Pi SDK + Softtek DevEngine Gateway, gates de aprobación tipo Claude
Code, webview React, y las herramientas frida-workflow, frida-agent-browser,
frida-permission-system, frida-context, todo y ask-user-question-web.
