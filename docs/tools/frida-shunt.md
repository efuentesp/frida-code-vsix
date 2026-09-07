# frida-shunt — delegación de I/O (router de costos)

> **frida-shunt** (#202): redirige lecturas costosas del agente a rutas más
> baratas. Patrón [shunt de Spotify Portal](https://engineering.atspotify.com/2026/9/portal-by-spotify-cut-my-claude-code-token-usage-by-90)
> (82–94% de ahorro reportado), adaptado con una ventaja extra: el peldaño
> determinístico de pi-lens (0 tokens, 0 latencia). Análisis completo en
> [docs/research/2026-09-06-shunt-portal-spotify.md](../research/2026-09-06-shunt-portal-spotify.md)
> · benchmark en [2026-09-06-shunt-benchmark.md](../research/2026-09-06-shunt-benchmark.md)
> (media 90% pi-lens, 99% mejor peldaño).

## Qué bloquea (y qué no)

| Tool | Se redirige cuando | Siempre pasa |
| --- | --- | --- |
| `read` | Sin `offset`/`limit` sobre archivo de texto > `frida.shunt.minLines` (default 350) | Reads dirigidos (offset/limit) — la ruta de edición |
| `bash` | `cat/head/tail/less/more` sin pipe sobre archivos grandes | Pipes (`cat x \| grep`), `head/tail -n K` con K ≤ umbral |

Extensiones binarias (png/pdf/zip/…) fuera de scope: read las sirve como
adjuntos, no como texto.

## La escalera de delegación (el reason del block)

1. **Estructura** → pi-lens: `module_report` (outline navegable) o
   `read_symbol` (un símbolo exacto). Determinístico: 0 tokens, 0 latencia.
2. **Pregunta profunda / multi-archivo** → subagent tipo Explore (corre en el
   rol `smol`, barato): el corpus vive en SU contexto; vuelve sólo la respuesta
   destilada.
3. **Edición** → read con `offset`/`limit` de la sección exacta. Siempre
   permitido: los resúmenes NO traen números de línea confiables (límite
   documentado del patrón upstream — no delegues edición).

Las skills globales `bulk-reader` y `code-writer` (`~/.frida/skills/`) enseñan
el patrón completo; el gate protege aunque la skill no se lea (degradación
elegante, igual que el upstream).

## Settings

- `frida.shunt.enabled` (default `true`)
- `frida.shunt.minLines` (default `350`, el default calibrado de Spotify)

Ambos aplican en vivo (se releen en cada tool_call).

## Precedencia en el bus `tool_call`

El runner del SDK (`emitToolCall`) ejecuta los handlers por orden de registro
y **el primer `block` cortocircuita**. Orden en frida:

1. **frida-permission-system** (el candado: deny de seguridad, force-ask,
   niveles #197) — un `rm -rf /` recibe el bloqueo de seguridad, nunca un
   redirect pedagógico.
2. **frida-shunt** (este router de costo) — sólo se evalúa lo que el candado
   dejó pasar.

TTSR (#201) no compite en `tool_call`: monitorea `message_update` (stream).

**Sólo sesión principal**: el gate NO se registra en las sesiones hijas
(subagents) — ellas son los workers baratos de la escalera; bloquear sus
lecturas sería contraproducente.

## Semáforo de fallos

- **Fail-open**: cualquier error del gate se traga (router de costo, no
  candado — a diferencia del permission-system, que es fail-closed).
- Archivo inexistente/binario ilegible → pasa (el read fallará con su error
  natural, que es información útil para el modelo).
- Conteo de líneas con corte temprano: un archivo de 100 MB no se lee completo
  para decidir si es grande (`countLinesUpTo` lee por chunks hasta max+1).

## Arquitectura

| Módulo | Rol |
| --- | --- |
| `src/gates/expensive-reads.ts` | Decisión pura + conteo de líneas acotado. |
| `src/tools/frida-shunt/index.ts` | Factory: handler `tool_call` (fail-open, early-out barato). |
| `src/pi-session.ts` | Registro DESPUÉS del permission-system, sólo en la sesión principal. |
| `scripts/shunt-benchmark.mjs` | Benchmark reproducible (fixtures deterministas, chars/4). |
| `~/.frida/skills/bulk-reader` · `code-writer` | Guía suave (escalera completa). |
