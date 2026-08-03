---
name: create-frida-extension
description: Portea una extensión nativa de Pi (pi-*) a una extensión frida-* nativa dentro de este repo. Recibe el nombre de la extensión pi base y el de la extensión frida a crear, y ejecuta el porte siguiendo las reglas canónicas y lecciones acumuladas. Úsala cuando quieras portearte una extensión pi existente al modelo de frida (porte nativo, cero deps nuevas, agentDir ~/.frida, UI webview).
argument-hint: "<pi-extension-base> <frida-extension-a-crear>"
disable-model-invocation: true
allowed-tools: Bash(find *), Bash(grep *), Bash(ls *), Bash(wc *), Bash(cp *), Bash(sed *), Bash(node *), Bash(npx tsc *), Bash(npx vitest *), Bash(git *), Read, Edit, Write, Glob, Grep
shell-timeout: 30
---

# Portea una extensión pi-*a frida-*

Argumentos: `$1` = nombre de la extensión **pi** base a portear (ej. `pi-git-sync`),
`$2` = nombre de la extensión **frida** a crear (ej. `frida-git-sync`).

Si falta alguno, **pídelo al usuario** antes de continuar.

## Regla de oro (consulta obligatoria)

**Antes de tocar código, lee `docs/how-to-create-frida-extensions.md` (en la raíz del repo)
COMPLETO.** Es la **fuente de verdad única** de porte: reglas canónicas, anatomía,
runtime/UI, acoplamientos pi→frida, y —sobre todo— la sección
**Errores y lecciones registradas** (para no repetir errores previos).

- **Decisiones clave** → resuélvelas en el how-to primero; si no están, ve al
  código (extensiones frida-* existentes + el ADR correspondiente).
- **Errores nuevos** que encuentres durante el porte → **documéntalos** en la
  sección *Errores y lecciones* del how-to (síntoma → causa → solución). No crees
  documentos adicionales.

## Pasos del porte

> Sigue el **Patrón porte probado** del how-to. Resumen ejecutivo:

1. **Estudia el upstream.** Localízalo en `node_modules` (busca por el nombre
   `$1` con `find ~/.pi ~/.nvm -type d -name "*$1*"`). Lee su `package.json`
   (peerDeps: ¿`pi-tui`?, `files`), su `index.ts`/entrada y mapea el árbol +
   dependencias entre capas. Identifica los **seams de acoplamiento a Pi**.

2. **Confirma las decisiones de porte** con el usuario (shell, paquetes, UI,
   alcance) — usa `ask_user_question`. Documenta cada decisión en el ADR final.

3. **Copia el árbol casi literal** preservando la estructura (mantiene imports
   relativos) y normaliza imports (quita extensión `.ts`). Ver typecheck base.

4. **Adapta SOLO los seams** (`pi-tui`, `ctx.ui` no-op, `getAgentDir`/paths,
   spawn de shell → `pi.exec` vía setter, CLI `pi`, strings con el nombre
   upstream). Aplica las lecciones del how-to.

5. **Escribe el `index.ts` factory** `createFrida<$2>(): (pi) => void`.

6. **Registra** la factory en `src/pi-session.ts` (`extensionFactories`). Si hay
   widget footer (`fridaWebMount`) o comando con VS Code APIs, cablea en
   `src/extension.ts` (`wire<$2>Widget`, `BUILTIN_COMMANDS`).

7. **Verifica**: `npx tsc --noEmit` (0 errores en `src/`) y `npx vitest run`
   (suite del módulo verde).

8. **Documenta**: ADR `docs/adr/00XX-frida-<$2>-porter-<$1>.md`, doc
   `docs/tools/frida-<$2>.md`, CHANGELOG `[Unreleased] > ### Añadido`.

9. **Testea**: portea los tests del upstream si los incluye `files`; si no,
   escribe tests de las capas puras + integración.

10. **Commitea por fases** (árbol+adaptaciones / factory+integración / widget /
    docs / tests), mensajes estilo Conventional Commits (`feat(frida-<$2>): ...`).

## Reglas canónicas (recordatorio rápido — ver how-to para detalle)

- **R1** Porte nativo (no `pi install` del upstream). **R2** Cero deps npm
  nuevas. **R3** SDK en proceso. **R4** agentDir `~/.frida`. **R6** UI en webview
  (`setStatus`/`custom` son no-op; `pi-tui` NO disponible). **R9** shell vía
  `pi.exec`. **R11** reexporta desde `index.ts`.

## Errores conocidos a vigilar (ver how-to § Errores y lecciones)

- **`duplicate-function-arg` (pi-lens)**: si brota, busca el **error de tipo real**
  subyacente y corrígelo; los falsos positivos desaparecen. No suprimas a lo loco.
- **API del SDK**: verifica que una función sea **export público del barrel**
  antes de diseñar sobre ella (lección `handlePackageCommand`).
- **Strings con el nombre upstream**: `sed` global seguro de `"pi-<ext>: "` →
  `"frida-<ext>: "`; preserva nombres de paquete (`npm:.../pi-<ext>`).
- **Inyección por setter** para capas shell gruesas: preserva la API pública.

Al terminar, **reporta** al usuario: commits hechos, typecheck/tests, y qué
queda pendiente (ej. prueba en vivo, revisión manual de archivos grandes).
