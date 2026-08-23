Todas las conversaciones con los agentes, creación y modificación de archivos deben hacerse en español de México.

## Versionado y releases

Antes de cambiar el número de versión o hacer un deploy, lee
[docs/versioning.md](docs/versioning.md) — política SemVer + Conventional
Commits. El bump de versión es automático: `npm run release` (determina el tipo
de cambio según los commits y actualiza `package.json` + `CHANGELOG.md`).

## Gestión de issues

Toda **funcionalidad nueva**, **cambio** o **defecto** reportado se captura
en un issue de GitHub, clasificado con la etiqueta correcta:

| Tipo de trabajo | Etiqueta |
| --- | --- |
| Funcionalidad nueva o mejora | `enhancement` |
| Defecto / algo no funciona | `bug` |
| Mejora de documentación | `documentation` |
| Trivial / buen primer issue | `good first issue` |

El agente **no crea, modifica ni reabre** un issue por iniciativa propia:
confirma con el usuario antes de esas acciones (salvo que éste la haya
pedido explícitamente en el turno). **Cerrar sí es responsabilidad del
agente** cuando el issue queda resuelto y verificado (ver *Cierre de
issues*). Operar con `gh issue create | view | edit | close | reopen`.

Todo commit que aborde un issue debe **referenciarlo** en el cuerpo (footer
`Refs #N`) para que queden vinculados en GitHub. No usar `Closes #N` (ver
*Cierre de issues*).

## Cierre de issues

Un issue se cierra **cuando el agente lo resuelve y su verificación es
verde** (compila, typecheck, tests, smoke cuando aplique). No se espera la
prueba e2e del usuario para cerrar. Secuencia:

1. El agente implementa y verifica de su lado (compila, typecheck, tests,
   smoke/e2e automatizado cuando aplique).
2. Cierra el issue con `gh issue close` dejando un comentario de evidencia:
   qué se hizo, cómo se verificó y en qué commit.
3. El usuario valida después en su entorno; si encuentra un defecto, **abre
   un issue nuevo de `bug`** (o se lo reporta al agente para que lo abra tras
   confirmar) — no se reabre el original salvo decisión explícita del usuario.

Operativamente: en los commits usa **`Refs #N`** (no `Closes #N`), porque el
cierre lo hace el agente con `gh issue close` + comentario de evidencia
después de la verificación, no automáticamente al pushear.

Si la verificación del agente NO puede cubrir un aspecto crítico del cambio
(p. ej. flujo interactivo que sólo el usuario puede ejercitar), deja el issue
abierto y explícalo en el comentario — ese es el único caso de espera.

## Diagnóstico de defectos en extensiones portadas de Pi

Cada vez que se detecte un defecto o comportamiento anómalo en alguna extensión
de Frida (p. ej. `frida-extensible-workflows`, `frida-todo`,
`frida-ask-user-questions`, `frida-agent-browser`, `frida-subagents`,
`frida-permission-system`, etc.), el agente debe **revisar primero el código
fuente de la extensión original de Pi** (ubicadas habitualmente en
`~/.pi/agent/npm/node_modules/` o en `@earendil-works/pi-coding-agent`) antes de
proponer o ensayar soluciones.

Objetivo:

1. Comparar la estructura original, firmas, ciclo de vida (`reload`,
   `bindExtensions`, etc.) y manejo de estado contra la adaptación en Frida.
2. Identificar de raíz si el fallo proviene de omisiones o divergencias
   introducidas al portar la funcionalidad.
3. Evitar ciclos de prueba y error basados en suposiciones cuando el upstream
   ya resuelve el caso de forma probada.
