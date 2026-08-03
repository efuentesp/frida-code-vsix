---
name: create-frida-extension
description: Portea una extensión nativa de Pi (pi-*) a una extensión frida-* nativa dentro de este repo. Recibe el nombre de la extensión pi base y el de la frida a crear, y ejecuta el porte siguiendo las reglas canónicas y lecciones acumuladas. Úsala cuando se quiera portear una extensión pi existente al modelo de frida (porte nativo, cero deps nuevas, agentDir ~/.frida, UI webview).
argument-hint: "<pi-extension-base> <frida-extension-a-crear>"
disable-model-invocation: true
allowed-tools: Bash(find *), Bash(grep *), Bash(ls *), Bash(wc *), Bash(cp *), Bash(sed *), Bash(node *), Bash(npx tsc *), Bash(npx vitest *), Bash(git *), Read, Edit, Write, Glob, Grep
shell-timeout: 30
progressive_disclosure:
  entry_point:
    summary: "Portear una extensión nativa de Pi (pi-*) a una extensión frida-* nativa dentro del repo, siguiendo las reglas canónicas y lecciones acumuladas en references/how-to-create-frida-extensions.md."
    when_to_use: "Cuando se quiere portear una extensión pi existente al modelo de frida: porte nativo (no pi install del upstream), cero dependencias npm nuevas, agentDir ~/.frida, UI en webview (no TUI de Pi)."
    quick_start: "1. Leer references/how-to-create-frida-extensions.md COMPLETO 2. Estudiar el upstream (package.json, index.ts, árbol, seams) 3. Confirmar decisiones con el usuario 4. Copiar árbol + normalizar imports + adaptar seams 5. Escribir index.ts factory y registrar en pi-session.ts 6. Verificar (tsc/vitest) 7. Documentar (ADR/doc/CHANGELOG) 8. Testear 9. Commitear por fases"
  references:
    - references/how-to-create-frida-extensions.md
---

# Portear una extensión pi-*a frida-*

Portea una extensión nativa de Pi al modelo nativo de frida dentro de
`src/tools/frida-<nombre>/`. La extensión resultante es código propio (porte
nativo), sin `pi install` del upstream, con cero dependencias npm nuevas.

## Argumentos

- `$1` = nombre de la extensión **pi** base a portear (ej. `pi-git-sync`).
- `$2` = nombre de la extensión **frida** a crear (ej. `frida-git-sync`).

Si falta alguno, **pedirlo al usuario** antes de continuar.

## Regla de oro (consulta obligatoria)

**Antes de tocar código, leer `references/how-to-create-frida-extensions.md`
COMPLETO.** Es la **fuente de verdad única** del porte: reglas canónicas,
anatomía, runtime/UI, acoplamientos pi→frida y —sobre todo— la sección
**Errores y lecciones registradas** (para no repetir errores previos).

- **Decisiones clave** → resolverlas en el how-to primero; si no están resueltas,
  ir al código (extensiones frida-* existentes + el ADR correspondiente).
- **Errores nuevos** encontrados durante el porte → **documentarlos** en la
  sección *Errores y lecciones* del how-to (síntoma → causa → solución). **No
  crear documentos adicionales** de porte.

## Cuándo usarlo

- Portear una extensión `pi-*` existente al modelo de frida.
- Crear una extensión frida-*nueva basada en el patrón de una pi-* existente.

No usarlo para: instalar una extensión pi tal cual (frida requiere porte nativo,
no `pi install`), ni para extensiones que ya existan como frida-*.

## Pasos del porte

> Seguir el **Patrón porte probado** del how-to. Resumen ejecutivo:

1. **Estudiar el upstream.** Localizarlo en `node_modules` (buscar por `$1` con
   `find ~/.pi ~/.nvm -type d -name "*$1*"`). Leer su `package.json` (peerDeps:
   ¿`pi-tui`?, `files`), su `index.ts`/entrada, y mapear el árbol + dependencias
   entre capas. **Identificar los seams de acoplamiento a Pi.**

2. **Confirmar las decisiones de porte** con el usuario (shell, paquetes, UI,
   alcance) vía `ask_user_question`. Documentar cada decisión en el ADR final.

3. **Copiar el árbol casi literal** preservando la estructura (mantiene imports
   relativos) y normalizar imports (quitar extensión `.ts`). Verificar typecheck
   base.

4. **Adaptar SOLO los seams** (`pi-tui`, `ctx.ui` no-op, `getAgentDir`/paths,
   spawn de shell → `pi.exec` vía setter, CLI `pi`, strings con el nombre
   upstream). Aplicar las lecciones del how-to (L1–L6).

5. **Escribir el `index.ts` factory** `createFrida<$2>(): (pi) => void`.

6. **Registrar** la factory en `src/pi-session.ts` (`extensionFactories`). Si hay
   widget footer (`fridaWebMount`) o comando con VS Code APIs, cablear en
   `src/extension.ts` (`wire<$2>Widget`, `BUILTIN_COMMANDS`).

7. **Verificar**: `npx tsc --noEmit` (0 errores en `src/`) y `npx vitest run`
   (suite del módulo verde).

8. **Documentar**: ADR `docs/adr/00XX-frida-<$2>-porter-<$1>.md`, doc
   `docs/tools/frida-<$2>.md`, CHANGELOG `[Unreleased] > ### Añadido`.

9. **Testear**: portear los tests del upstream si los incluye `files`; si no,
   escribir tests de las capas puras + integración.

10. **Commitear por fases** (árbol+adaptaciones / factory+integración / widget /
    docs / tests), mensajes estilo Conventional Commits (`feat(frida-<$2>): ...`).

Al terminar, **reportar** al usuario: commits hechos, typecheck/tests, y qué
queda pendiente (ej. prueba en vivo, revisión manual de archivos grandes).

## Reglas canónicas (recordatorio — ver how-to para detalle)

- **R1** Porte nativo (no `pi install` del upstream). **R2** Cero deps npm
  nuevas. **R3** SDK en proceso. **R4** agentDir `~/.frida`. **R6** UI en webview
  (`setStatus`/`custom` son no-op; `pi-tui` NO disponible). **R9** shell vía
  `pi.exec`. **R11** reexportar desde `index.ts`.

## Red Flags — STOP

**Detenerse y revisar el how-to cuando** surja cualquiera de estos impulsos:

- **"Voy a suprimir `duplicate-function-arg` (pi-lens) con un ignore"** → NO.
  Es síntoma de un **error de tipo real** subyacente; corregir ese error y los
  falsos positivos desaparecen (lección L1).
- **"Voy a reescribir el árbol del upstream desde cero"** → NO. Hacer `cp` del
  árbol + normalizar imports + adaptar solo los seams (L4). Preserva imports
  relativos.
- **"Voy a portear `pi install/remove` por `handlePackageCommand` del SDK"** →
  Verificar PRIMERO si es **export público del barrel** del SDK y si el CLI `pi`
  está en PATH. Suele funcionar tal cual (L2).
- **"Voy a tocar `getAgentDir()`/paths `~/.pi` en cada call-site"** → NO. La
  factory setea `process.env.PI_CODING_AGENT_DIR = ~/.frida` una vez (L5).
- **"Voy a reescribir las ~40 funciones de la capa shell y sus callers"** → NO.
  Usar **inyección por setter** (`setExecutor`) para preservar la API pública
  (L3).
- **"Voy a crear otro documento de porte"** → NO. Ampliar el how-to (única fuente
  de verdad; "info lives in ONE place").
- **"Voy a poner el detalle del skill en un doc externo (`docs/...`)"** → NO.
  El detalle vive en `references/` del skill (autocontenido, siempre accesible
  sin importar el cwd). Forma `skill-creator`.
- **"El entry point del skill supera 200 líneas"** → Aplicar progressive
  disclosure (mover detalle a `references/`).

## Navigation

### Fuente de verdad (cargar siempre primero)

- **[references/how-to-create-frida-extensions.md](./references/how-to-create-frida-extensions.md)**
  — Todo el conocimiento de porte: reglas canónicas (ADRs 0002–0026), anatomía
  de una extensión frida-*, modelo runtime/UI (ExtensionAPI completo, ctx.ui
  parcial, pi-tui no disponible), agentDir `~/.frida` + mapeo de rutas,
  integración en el host, patrón porte probado, inyección por setter, widget
  fridaWeb, acoplamientos pi→frida, decisiones frecuentes, **Errores y lecciones
  registradas (L1–L6)** y checklist de portes anteriores.
