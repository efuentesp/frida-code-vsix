---
date: 2026-08-28T17:29:53-0600
author: Edgar F. Fuentes Perea
commit: abb1640
branch: main
repository: frida-code
topic: "Comandos slash + cards de inicio para los patrones de la Pista M"
tags: [intent, frd, pista-m, slash-commands, welcome, registerCommand, frida-app-walkthrough, frida-understand-app, frida-size-app, frida-extensible-workflows]
status: ready
last_updated: 2026-08-28T17:29:53-0600
last_updated_by: Edgar F. Fuentes Perea
---

# FRD: Comandos slash + cards de inicio para los patrones de la Pista M

## Summary

Registra tres comandos slash — `/walkthrough`, `/understand`, `/size` — que disparan los patrones builtin `app-walkthrough` (M8), `understand-app` (M1) y `size-app` (M10) desde el `/` del chat con presupuesto vía QuickPicks nativos (cero round-trips con el LLM para preguntar args), y agrega las tres capacidades como cards en la página de inicio (Welcome) que insertan el comando en el composer. El handler vive en cada skill-pack junto a `registerBuiltinPattern`; el lanzamiento delega al chat vía `pi.sendUserMessage` (seam único del tool `workflow`); el motor `frida-extensible-workflows` queda intacto.

## Problem & Intent

En palabras del desarrollador: **"Descubrimiento ciego"** — las capacidades bandera de la Pista M existen pero son invisibles: nadie sabe qué pedir. El éxito es **"escribir `/` y verlas ahí con descripción"**. Además: **"y agregarlos en la página de inicio"** — las capacidades también deben aterrizar donde el usuario nuevo abre Frida por primera vez.

Hoy el disparo depende de lenguaje natural en el chat (hay que saber el nombre) o del picker `/wf` (hay que saber que existe). La mitigación actual (skills launcher personales en `~/.frida/skills/`) es por-usuario y LLM-mediated.

## Goals

- Los 3 patrones bandera aparecen al teclear `/` en el chat, con descripción en es-MX y handler programático (`pi.registerCommand`, mismo mecanismo que `/fridasync`).
- El presupuesto (args requeridos) se pregunta con QuickPicks/InputBox nativos, sin round-trips con el LLM para resolverlo.
- Las 3 capacidades son visibles en la página de inicio (Welcome) como cards que insertan el comando en el composer — el usuario también **aprende** el comando al verlo.
- UX consistente con `/fridasync` y con las cards starter existentes.
- How-to de los 3 packs actualizado: el flujo típico ahora empieza con el comando.

## Non-Goals

- Comando/carden para `traffic2api` (M9) — requiere modo (walk/devtools/mitmproxy) y HAR externo; se agrega después si duele (decisión de la entrevista).
- Pre-autenticación orquestada desde el handler de `/walkthrough` — el patrón M8 ya abre y gatea su propia sesión navegador internamente (el criterio original del issue quedó obsoleto con M8 construido).
- Extender `BuiltinPatternMeta` del motor con un campo `slashCommand` (meta-driven) — decisión explícita: handler por-pack, motor intacto.
- Lanzar el workflow llamando `runWorkflowInStore` directamente desde el handler.
- Preguntar `maxMinutes`/`review`/`language` en los comandos — se quedan en defaults (0=tope · manual · es-MX); el usuario avanzado usa lenguaje natural o `/wf`.
- Tocar la selección de las 4 cards starter existentes del Welcome.

## Functional Requirements

1. El sistema REGISTRA el comando slash `walkthrough` desde la factory de `frida-app-walkthrough` (`pi.registerCommand`), visible en el `/` del chat con descripción en es-MX.
2. El sistema REGISTRA el comando slash `understand` desde la factory de `frida-understand-app`, con descripción en es-MX.
3. El sistema REGISTRA el comando slash `size` desde la factory de `frida-size-app`, con descripción en es-MX.
4. `/walkthrough [url?]`: si falta `url` → InputBox de URL; después QuickPick de `maxScreens` (10 recomendado · 5 · 25 · todo). Con ambos valores arma el mensaje de lanzamiento y lo envía al chat vía `pi.sendUserMessage`.
5. `/understand`: QuickPick de `maxHotspots` (8 · 15 · todo) → arma el mensaje y lo envía al chat.
6. `/size`: QuickPick de `cocomoType` (semi-detached recomendado · organic · embedded) + InputBox de `wage` (número > 0; opcionalmente moneda MXN 35,000 / USD 6,000 / propio como QuickPick previo) → arma el mensaje y lo envía al chat.
7. El mensaje enviado al chat delega el lanzamiento al agente (que invoca el tool `workflow`) con los args ya resueltos — determinista, sin preguntas adicionales del LLM para el presupuesto.
8. Si el usuario cancela un QuickPick/InputBox (Esc), el comando NO envía nada al chat.
9. El Welcome agrega 3 cards data-driven (una por comando, `actionType: "insert"`, `prompt: "/walkthrough "` etc.) al array `STARTER_CARDS` existente, sin tocar las 4 actuales.
10. Los how-to de los 3 packs documentan el comando como punto de partida del flujo típico.

## Non-Functional Requirements

- **Performance**: los handlers son interactivos y ligeros (QuickPicks + armado de string); sin I/O pesada. El round-trip LLM posterior al envío es exactamente 1 (interpretación + invocación del tool `workflow`).
- **UX / Consistencia**: mismas convenciones que los 6 slash commands existentes (`fridasync`, `worktree`, `detached`, `sandbox`, `ccplugin`, `goal`): nombre EN corto kebab, descripción es-MX; QuickPicks con opción recomendada marcada; cancelación = no-op silenciosa.
- **Reliability**: un comando registrado con un patrón que no existe en runtime no debe tumbar la sesión (registro idempotente; el error llega como mensaje accionable si el usuario lo invoca).
- **Seguridad**: ninguna nueva superficie — los QuickPicks solo recogen valores ya validados eager por los `validate*Args` de cada patrón; sin credenciales ni secretos en juego.

## Constraints & Assumptions

- **Motor intacto**: `src/tools/frida-extensible-workflows/` no se toca (disciplina M8/M9/M10 — "señal de alerta si el plan lo pide").
- **Constraint técnico**: los handlers usan `vscode.window.showQuickPick/showInputBox` (precedente del repo); `ctx.ui` de pi existe pero no lo usa nadie — no somos los primeros en ejercitarlo.
- **Assumption**: `pi.sendUserMessage(content, { deliverAs })` (ExtensionAPI) entrega el mensaje al chat de la sesión activa; el agente lo interpreta e invoca el tool `workflow` — mismo contrato que hoy cumple el prompt armado por `/wf` (`extension.ts:4495`). Research debe verificar el seam exacto desde una factory (el handler recibe `ctx: ExtensionCommandContext`, no el `pi` — la factory captura `pi` en closure).
- **Assumption**: agregar entradas a `STARTER_CARDS` no rompe el layout (grid 2x2 pasa a 7 cards); el ajuste visual fino queda en design.
- **Convención de nombres**: verbos/sustantivos EN cortos (`/walkthrough`, `/understand`, `/size`), sin prefijo — igual que los 6 existentes.

## Acceptance Criteria

- [ ] Al teclear `/` en el chat aparecen `walkthrough`, `understand` y `size` con descripción (visible en el menú de comandos).
- [ ] `/walkthrough https://ejemplo.app` pregunta solo `maxScreens` (url ya presente como arg) y envía exactamente 1 mensaje al chat con los args resueltos.
- [ ] `/understand` pregunta `maxHotspots` y envía el mensaje de lanzamiento.
- [ ] `/size` pregunta COCOMO + salario y envía el mensaje con `wage`/`cocomoType` resueltos; el workflow resultante arranca sin que el LLM vuelva a preguntar el presupuesto.
- [ ] Presionar Esc en cualquier QuickPick no envía nada (sin mensaje huérfano en el transcript).
- [ ] La página de inicio (transcript vacío) muestra las 3 cards nuevas; hacer clic en una inserta `/walkthrough` (etc.) en el composer sin enviar.
- [ ] `git diff --stat src/tools/frida-extensible-workflows/` queda vacío tras la implementación.
- [ ] `npm test` en verde (con tests nuevos: registro de comandos, cancelación, armado del mensaje, cards del Welcome).
- [ ] How-to de los 3 packs (`docs/how-to-frida-app-walkthrough.md`, `docs/how-to-frida-understand-app.md`, `docs/how-to-frida-size-app.md`) documentan el comando como inicio del flujo.

## Recommended Approach

Tres handlers por-pack: cada factory (`createFridaAppWalkthrough` / `createFridaUnderstandApp` / `createFridaSizeApp`) registra su `pi.registerCommand` en el setup que hoy recibe `_pi` sin usar; el handler hace QuickPicks `vscode.window` por los args requeridos del patrón y envía el mensaje de lanzamiento vía `pi.sendUserMessage` (capturado en closure), delegando al tool `workflow` como único orquestador. Tres entradas nuevas en `STARTER_CARDS` (`webview/components/Welcome.tsx`) con `actionType: "insert"` y el comando como prompt. Cero cambios al motor.

## Decisions

### Seam de lanzamiento: delegar al chat

**Question**: ¿El handler llama al motor (`runWorkflowInStore`) o arma un mensaje determinista y lo envía al chat?
**Recommended**: Delegar al chat (vía `pi.sendUserMessage`).
**Chosen**: Delegar al chat.
**Rationale**: El picker `/wf` ya funciona así (`extension.ts:4495`) y el tool `workflow` sigue siendo el único orquestador (`frida-extensible-workflows/index.ts:301`) — visibilidad completa del run en el transcript por 1 round-trip LLM trivial.

### Dónde vive el handler: por-pack

**Question**: ¿Handler en cada skill-pack o meta-driven en el motor?
**Recommended**: Por-pack.
**Chosen**: Por-pack (motor intacto).
**Rationale**: `BuiltinPatternMeta` es tipo cerrado sin campo command (`builtin-patterns.ts:348-373`) y las factories ya reciben `ExtensionAPI` sin usar (`_pi`, p. ej. `frida-size-app/index.ts:158`) — extender el motor costaría un esquema declarativo `meta.args.ui` por ~30 líneas repetidas por pack.

### API de QuickPicks: vscode.window

**Question**: ¿QuickPicks con `ctx.ui` de pi o `vscode.window`?
**Recommended**: `vscode.window`.
**Chosen**: `vscode.window`.
**Rationale**: Precedente 100% del repo en handlers de slash (`worktree/command.ts:87/106`, `postWfCommand` `extension.ts:4460/4479`); `ctx.ui` (`types.d.ts:68-78`) no tiene ni un uso — Frida es una extensión VS Code, el acoplamiento es irrelevante.

### Welcome: insert del comando

**Question**: ¿Cómo aparecen las capacidades en la página de inicio?
**Recommended**: Cards con `actionType: "insert"` que dejan el comando en el composer.
**Chosen**: Insert del comando.
**Rationale**: Reusa el mecanismo tal cual (precedente `/wf aidd-plan`, `Welcome.tsx:22-23`) y el usuario aprende el comando al verlo; los QuickPicks del comando toman el relevo al enviarlo.

### Alcance: solo los 3 comandos del issue

**Question**: ¿traffic2api (M9) entra al lote?
**Recommended**: Solo los 3 del issue.
**Chosen**: Solo `/walkthrough` `/understand` `/size`.
**Rationale**: M9 requiere modo (walk/devtools/mitmproxy) y HAR externo — más nicho; agregarlo crece el alcance y los flujos a probar sin necesidad demostrada.

### Pre-autenticación de /walkthrough: la maneja el patrón

**Question**: ¿El handler orquesta la pre-autenticación (criterio original del issue) o M8 la cubre?
**Recommended**: El patrón la maneja.
**Chosen**: El patrón la maneja.
**Rationale**: M8 ya abre su propia sesión navegador autenticada con gate de sesión muerta (D12/D34); el criterio del issue se escribió antes de que M8 existiera — cero estado en el handler.

### Nombres: EN corto

**Question**: ¿Verbos EN cortos o sustantivos es-MX?
**Recommended**: EN corto.
**Chosen**: `/walkthrough` `/understand` `/size` (descripciones en es-MX).
**Rationale**: Consistente con los 6 slash existentes (`fridasync`, `worktree`, `detached`, `sandbox`, `ccplugin`, `goal` — todos EN, sin prefijo).

### Presupuesto: solo args requeridos

**Question**: ¿QuickPicks mínimos o completos (maxMinutes/review)?
**Recommended**: Solo requeridos.
**Chosen**: url+maxScreens · maxHotspots · cocomoType+wage; el resto en defaults.
**Rationale**: 2-3 clics por comando para el caso común; `maxMinutes`/`review`/`language` siguen disponibles vía lenguaje natural o `/wf` para el usuario avanzado.

### Cards: agregar sin tocar

**Question**: ¿Las 3 cards nuevas reemplazan alguna existente?
**Recommended**: Agregar sin tocar.
**Chosen**: `STARTER_CARDS` pasa de 4 a 7 entradas.
**Rationale**: Menor riesgo (solo objetos nuevos al array, `Welcome.tsx:15-51`); la curación visual de las 4 actuales es otra conversación.

## Open Questions

- Ninguna — todas las ramas quedaron resueltas con decisión y rationale.

## Suggested Follow-ups

- `/t2a` para traffic2api (M9) si el nicho lo pide — QuickPick de modo walk/devtools/mitmproxy.
- Curar las 4 starter cards actuales del Welcome (p. ej. "Auditar Codebase"/"Explicar Arquitectura" solapan conceptualmente con `understand-app`) — observado en `Welcome.tsx:15-51`.
- `ctx.ui` (superficie pi de QuickPicks portátil, `types.d.ts:68-78`) sigue sin usuarios en el repo — candidato a adoptar en un futuro refactor de comandos si Frida deja de ser solo-VS Code.
- Skills launcher personales en `~/.frida/skills/documentar-app/` y `~/.frida/skills/entender-app/` quedan obsoletos con los comandos nativos — retirarlos después de validar.

## References

- Issue #140 (GitHub `efuentesp/frida-code-vsix`) — input principal.
- Patrones: `src/tools/frida-app-walkthrough/` (#133), `src/tools/frida-understand-app/` (#134), `src/tools/frida-size-app/` (#139).
- Mecanismo: `pi.registerCommand` en `src/tools/frida-git-sync/index.ts:141`; seam de lanzamiento `/wf` → `s.session.prompt` (`src/extension.ts:4495`); tool `workflow` (`src/tools/frida-extensible-workflows/index.ts:301`).
- Welcome: `webview/components/Welcome.tsx:15-51` (`STARTER_CARDS`), `webview/App.tsx:541-550` (montaje y acciones).
- Roadmap: `docs/roadmap-extensiones.md` (Pista M).
