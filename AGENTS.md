Todas las conversaciones con los agentes, creación y modificación de archivos deben hacerse en español de México.

## Diseño del webview (obligatorio)

Antes de crear o modificar CUALQUIER cosa en `webview/` —componentes,
estilos, íconos, colores, animaciones— lee completa
[DESIGN-SYSTEM-WEBVIEW.md](DESIGN-SYSTEM-WEBVIEW.md): sistema de diseño
estilo Copilot Chat (sólo tokens `--vscode-*`, Codicons como familia objetivo
con Lucide de legado, anatomía por
zona, tabla de brecha actual→objetivo y definition of done para UI con
verificación en 3 temas). Copia canónica espejo en
`../frida-llops/DESIGN-SYSTEM-WEBVIEW.md` (mantener el diff vacío al editar).

**Documento vivo (regla dura):** toda regla de estilo NUEVA que surja al
ajustar la UI de este árbol (token, patrón CSS/DOM, animación, errata de
cascada/accesibilidad, componente migrado) se documenta EN EL MISMO CAMBIO en
`DESIGN-SYSTEM-WEBVIEW.md` (§1/§2/§3/§5/§6/§8/§10 según corresponda) y se
sincroniza la copia espejo de frida-llops (diff vacío). Ese documento es la
especificación autocontenida que se entrega al equipo de frida code: si una
decisión visual no está ahí, no existe.

**Decisiones de layout autorizadas por el usuario (regla dura):** antes de
MOVER o REPOSICIONAR cualquier elemento existente del webview (mover una
barra, reordenar zonas, eliminar un elemento, cambiar dónde vive un estado),
pregunta PRIMERO al usuario con opciones concretas vía `ask_user_question` —
los usuarios están acostumbrados al posicionamiento actual; sugerir con
justificación está bien, aplicar sin autorización no. Los cambios de PIEL
(tokens, colores, tipografía, íconos, animaciones, espaciado) sí se aplican
directamente siguiendo el design doc (§0 distingue ambas clases; §8 nota de
autorización lista las filas afectadas). Toda decisión autorizada se registra
en el design doc en el mismo cambio.

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

Todo commit que aborde un issue debe **referenciarlo** en el cuerpo (footer
`Refs #N`) para que queden vinculados en GitHub. No usar `Closes #N` (ver
*Cierre de issues*).

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
