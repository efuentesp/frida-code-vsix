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

El agente **no crea, modifica, cierra ni reabre** un issue por iniciativa propia:
confirma con el usuario antes de cualquier acción del ciclo de vida (salvo que
éste la haya pedido explícitamente en el turno). Operar con
`gh issue create | view | edit | close | reopen`.

## Cierre de issues

Un issue **no se cierra** cuando el código está implementado y pasó las
pruebas del agente. Se cierra **únicamente después de que el usuario lo
prueba** en su entorno y confirma que funciona bien. Secuencia:

1. El agente implementa y prueba de su lado (compila, typecheck, smoke test).
2. Deja el issue **abierto** y entrega instrucciones para que el usuario
   pruebe.
3. El usuario valida y confirma.
4. Sólo entonces el agente cierra el issue (con `gh issue close`).

Operativamente: en los commits usa **`Refs #N`** (no `Closes #N`), porque
`Closes #N` cierra el issue automáticamente en GitHub al pushear. El cierre
manual ocurre al final del paso 4.

Excepción: issues puramente internos (tooling, docs, refactor sin UX visible)
sí pueden cerrarse tras la verificación del agente, sin validación del usuario.
