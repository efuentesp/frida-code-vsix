# Frida con `agentDir` propio (`~/.frida`), desacoplado de `~/.pi`

**Estado:** aceptado (revierte ADR-0005 para el `agentDir`).

Frida pasa a usar un **agentDir propio (`~/.frida`)** en vez de `~/.pi/agent`. Es decir, las
**extensiones, skills, auth y models** que Frida carga viven en `~/.frida`, **desacoplados** del
`~/.pi` del CLI `pi`. El proyecto (`.pi` → `.frida`) queda fuera de esta decisión por ahora (ver
"Fuera de alcance").

## Razón

Con el descubrimiento abierto (ADR-0005), Frida cargaba las extensiones del `~/.pi` del dev. Eso
provoca dos problemas reales (verificados):

1. **Errores de carga en el runtime de Frida**: las extensiones de pi (`pi-lens`, `rpiv-*`,
   `pi-permission-system`) están escritas para el **runtime Node CLI** y usan APIs que no existen
   en el **extension host de VS Code** (Node/Electron). Fallan todas con el mismo error:
   `import_meta.resolve is not a function` (`import.meta.resolve` es estable sólo desde Node 20.6).
2. **Choque con el `pi` de consola**: mismo `~/.pi` para dos runtimes distintos → versiones,
   config y auth compartidos de forma frágil.

Aislar a `~/.frida` da **estabilidad** (extensiones probadas en el runtime de Frida), **aislamiento**
(no toca el `~/.pi` del CLI) y **determinismo** (Frida sabe qué carga).

## Decisión

- `defaultAgentDir()` retorna `~/.frida` (antes `~/.pi/agent`).
- `createFridaSession` crea el dir (`mkdirSync recursive`) y pasa a `ModelRuntime.create` los
  paths propios: `authPath`, `modelsPath`, `modelsStorePath` bajo `~/.frida`.
- El `DefaultResourceLoader` ya usaba `agentDir` → ahora descubre extensiones/skills en `~/.frida`.

## Qué se aísla (efectos)

- **Extensiones**: ya no se cargan las de `~/.pi` (que fallaban). Frida funciona con sus
  **implementaciones embebidas** (gates, `ask_user_question`, `todo`, puente pi-lens). Para
  cargar extensiones en Frida, viven en `~/.frida` y **deben ser compatibles con el runtime de
  VS Code** (sin `import.meta.resolve` — ver "Fase 2").
- **Skills**: las skills globales de pi (code-review, tdd, etc., en `~/.pi/agent/skills`) **no
  cargan**. Si se quieren en Frida, copiarlas/adaptarlas a `~/.frida/skills`.
- **Auth (Copilot OAuth)**: `auth.json` propio en `~/.frida` → si usabas Copilot logueado en
  `~/.pi`, **requiere re-login** en Frida. **Softtek no se afecta**: su key vive en
  `vscode.SecretStorage` (D6), no en `auth.json`.
- **Models**: `~/.frida/models.json` propio (vacío inicialmente). Softtek se registra en código
  (D6); los providers builtin cargan igual.

## Opciones consideradas

- **(A) `agentDir` propio `~/.frida` (elegida).** Aislamiento completo y limpio.
- **(B) Aislar sólo extensiones, mantener skills/auth/models de `~/.pi`.** Descartada: el
  `DefaultResourceLoader` usa un único `agentDir` para todo; separar requeriría un loader custom.
- **(C) Polyfill de `import.meta.resolve` + seguir en `~/.pi`.** Descartada: `import.meta` no es
  mutable en runtime; requeriría transformar el código al cargar (frágil) y NO resuelve el choque
  con el CLI. Se evalúa aparte (Fase 2) si se quiere cargar pi-lens adaptado en `~/.frida`.

## Consecuencias / reversión de ADR-0005

- **Reabre ADR-0005** hacia un descubrimiento **propio** para Frida: la fricción "dentro de la
  herramienta" aumenta (hay que poner/copiar extensiones en `~/.frida`), pero a cambio el candado
  por defecto es **estable** (no rompe por incompatibilidad de runtime). Coherente con el alcance
  (b) de ADR-0001 (UX + disuasivo, no perímetro).
- **pi-lens queda fuera** (no carga) hasta que se decida: adaptarlo (polyfill/patch de
  `import.meta.resolve`) o dejarlo fuera. Mientras tanto, las integraciones de D16/ADR-0008
  (badge, panel de diagnósticos, puente) están **inactivas** (no rompen; simplemente no reciben
  eventos). Re-abrir esa decisión es la **Fase 2**.
- **Duplicación**: si quieres una extensión tanto en `pi` CLI como en Frida, la mantienes en dos
  sitios (`~/.pi` original + `~/.frida` adaptada).

## Fuera de alcance (futuras fases)

- **Proyecto `.frida`** (en vez de `.pi` en el cwd): el `DefaultResourceLoader` escanea el
  proyecto con `CONFIG_DIR_NAME` (`.pi`); cambiarlo a `.frida` requiere un loader custom o parche.
  Pendiente.
- **Fase 2 — modelo de extensiones en `~/.frida`**: definir cómo se cargan y la compatibilidad
  (polyfill `import.meta.resolve` o exigir extensiones adaptadas); decidir pi-lens.
- **Fase 3 — mover embebidas a extensiones**: gates / `ask_user_question` / `todo` / puente pi-lens
  → extensiones en `~/.frida`. Requiere diseñar un **bus host↔extensión** (para que una extensión
  hable con el webview; hoy esas factories acceden directo a `ApprovalBridge`/`QuestionBridge`/
  `todo-state`).

## Punto frágil a regresar en cada bump de Pi

- `defaultAgentDir()` y el `agentDir` que Frida pasa al `DefaultResourceLoader` y a
  `ModelRuntime.create({authPath, modelsPath, modelsStorePath})`. Si Pi cambia cómo se configura el
  `agentDir` del `ModelRuntime` o añade otros usos de `getAgentDir()`, revisar (podrían quedar
  apuntando a `~/.pi`).
- `getAgentDir()` del SDK sigue siendo `~/.pi/agent`; Frida **no** lo usa directamente (pasa los
  paths), pero si alguna otra parte del SDK lo invoca, apuntaría a `~/.pi`.
