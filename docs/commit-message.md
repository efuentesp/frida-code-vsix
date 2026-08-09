# Generar mensaje de commit (botón del Source Control)

> **Disclosure**: este documento describe la feature del **issue #9**: un botón
> **✨ Frida: Generar mensaje de commit** en el panel de Source Control que
> genera el mensaje a partir del diff *staged* con el LLM activo de Frida y lo
> coloca en el textbox para commit **manual**. Replica lo que hacen GitHub
> Copilot y Kilo Code, pero usando el modelo/proveedor configurado en Frida.

---

## 1. Qué hace

Lee el **diff staged** (`git add`), lo manda al LLM activo de Frida en una
llamada **one-shot sin tools** y escribe el mensaje resultante en el textbox de
commit. **Nunca commitea**: el usuario revisa, edita si quiere y da *Commit*
(`Ctrl+Enter`) explícitamente.

- **Formato por defecto**: [Conventional Commits](https://www.conventionalcommits.org/es/)
  en español (`feat(scope): descripción`), coherente con
  [docs/versioning.md](./versioning.md).
- **Scope**: inferido del módulo/directorio principal tocado (ej.
  `src/providers/` → `feat(providers):`).
- **Cuerpo**: se incluye con viñetas sólo si el cambio es complejo.

## 2. Cómo se usa

1. `git add` los archivos a commitear (stage).
2. Pulsa **✨ Frida** en el header del panel Source Control, o usa el atajo
   **`Cmd+Alt+C`** (mac) / **`Ctrl+Alt+C`** (Win/Linux), o búscalo en la
   Command Palette como **`Frida: Generar mensaje de commit`**.
3. Frida genera el mensaje (con un indicador de progreso en el panel SCM) y lo
   deja en el textbox.
4. Revísalo, edítalo si quieres, y dale **Commit** (`Ctrl+Enter`).

> El botón **nunca commitea**. El commit es siempre explícito y manual.

## 3. Configuración (`frida.commitMessage.*`)

| Setting | Valores | Default | Descripción |
| --- | --- | --- | --- |
| `format` | `conventional` \| `free` | `conventional` | `conventional` = Conventional Commits con scope; `free` = descripción libre. |
| `language` | `es` \| `en` | `es` | Idioma del mensaje. |
| `includeBody` | boolean | `true` | Incluye cuerpo con viñetas si el diff lo justifica. |
| `maxSubjectLength` | número | `50` | Longitud máxima de la primera línea (asunto). |
| `templatePath` | string | `""` | Ruta a un template markdown que **reemplaza** el prompt default. |

## 4. Template custom (reglas de equipo)

Si necesitas reglas propias (ticket JIRA obligatorio, scope fijo, sin emoji,
etc.), crea un archivo markdown y apúntalo en `frida.commitMessage.templatePath`
(o déjalo en `""` y usa el default `~/.frida/commit-message-prompt.md`, que se
detecta automáticamente si existe). El contenido **reemplaza** el prompt default
y soporta los placeholders:

- `{language}` → `es` o `en`
- `{maxSubjectLength}` → `50` (o el configurado)
- `{types}` → `feat, fix, docs, style, refactor, perf, test, chore, ci, build, revert`

Ejemplo (`~/.frida/commit-message-prompt.md`):

```markdown
Eres un generador de mensajes de commit en Conventional Commits en {language}.
Reglas del equipo:
- Línea 1: `tipo(scope): [PROJ-XXXX] descripción` (máx {language} {maxSubjectLength} car.)
- Tipos válidos: {types}.
- Sin emoji, sin co-author.
Responde SOLO el mensaje.
```

## 5. Casos borde

- **No hay cambios staged** → avisa: *"No hay cambios staged. Ejecuta `git add`…"*.
- **Git deshabilitado o sin repo** → avisa: *"No hay un repositorio Git abierto…"*.
- **Diff muy grande** → se trunca a ~10 000 caracteres (con nota) para no reventar
  el contexto del modelo.
- **El LLM no responde / modelo sin configurar** → avisa y no toca el textbox.

## 6. Cómo funciona por dentro

Reutiliza el patrón del auto-título de sesión (issue #4): una **sesión efímera**
con `noTools: "all"` y un *system prompt* propio, que se descarta al terminar.
No instancia un agente con tools ni interactúa. Código en
[`src/commit-message/`](../src/commit-message/):

- `git.ts` — wrapper de la API pública de `vscode.git` (`inputBox.value`,
  `diff(cached)`).
- `generator.ts` — construye el prompt (bilingüe, Conventional/Free) y llama al
  LLM en la sesión efímera.
- `config.ts` — lee las settings + resuelve el template.
- `index.ts` — *command handler*: orquesta repo → diff → config → LLM →
  `inputBox.value`.

## 7. Diferencia con el agente/skill `commit`

**No es lo mismo** y no se reemplazan:

| | **Botón ✨ (esta feature)** | **Skill `commit`** (agente) |
| --- | --- | --- |
| Naturaleza | One-shot, sin tools | Agente con tools (`git`, `Read`…) |
| Entrada | Sólo diff staged | Staged + unstaged + historial + sesión |
| Salida | Texto en el textbox (**no commitea**) | **Commits reales** |
| Agrupa | 1 mensaje | N commits atómicos |
| Interactúa | No | `ask_user_question` para confirmar |
| Cuándo | "dame el mensaje rápido" | "hazme el commit con criterio" |

El botón es **UX de panel SCM** (estilo Copilot); el skill `commit` es **flujo
de agente** (subagente/workflow). Coexisten a propósito.
