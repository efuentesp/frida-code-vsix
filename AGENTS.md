Todas las conversaciones con los agentes, creación y modificación de archivos deben hacerse en español de México.

## Versionado y releases

Antes de cambiar el número de versión o hacer un deploy, lee
[docs/versioning.md](docs/versioning.md) — política SemVer + Conventional
Commits. El bump de versión es automático: `npm run release` (determina el tipo
de cambio según los commits y actualiza `package.json` + `CHANGELOG.md`).

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
