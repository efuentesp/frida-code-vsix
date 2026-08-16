# Búsqueda en Frida — ripgrep vs FFF/ffgrep vs grep: si vale una extensión nueva

**Tipo:** nota de investigación (sustenta la decisión de crear — o no — un issue de búsqueda).
**Fecha:** 2026-08-17.
**Pregunta:** ¿Tiene valor crear una extensión nueva de frida para mejorar las
búsquedas — cuáles son las diferencias reales entre ripgrep, "fffgrep" y el
"grep normal" que usamos?
**Fuentes:** [`grep.js` del pi embebido en el VSIX](#) (primaria, código) ·
[pi.dev/packages/@ff-labs/pi-fff](https://pi.dev/packages/@ff-labs/pi-fff) (primaria, autor) ·
[README de dmtrKovalenko/fff](https://github.com/dmtrKovalenko/fff) (primaria, autor; sección
"What is FFF and why use it over ripgrep or fzf?") ·
[blog de ripgrep de BurntSushi](https://blog.burntsushi.net/ripgrep/) (primaria, autor; benchmarks) ·
npm registry (verificación de existencia de paquetes).

## TL;DR — veredicto

**No crear issue de extensión de búsqueda.** La premisa se disuelve al
inspeccionar el código: **Frida ya no usa "grep normal" — el builtin `grep`
de pi ejecuta ripgrep internamente** (`ensureTool("rg")`, descargándolo si
falta), igual que `find` ejecuta `fd`. Y **no existe extensión pi de
ripgrep** (npm ×3 y pi.dev verificados) — lo que aparece buscando "ripgrep"
en pi.dev es `@ff-labs/pi-fff`, cuyo pitch es exactamente lo contrario:
**reemplazar** a rg con un índice residente.

La tecnología de FFF es legítima (32.7K descargas/mes, impulsa la búsqueda
de opencode y nushell, core Rust con SIMD), pero para el workload de Frida
(repos chicos-medianos, subagentes = procesos propios) el costo pesa más que
la ganancia. **Recomendación: evaluarla empíricamente con `pi install` (costo
cero, ya que frida hereda extensiones del agentDir) antes de cualquier
decisión de producto.**

## Ronda 1 — qué usa Frida HOY (inspección de código)

`node_modules/@earendil-works/pi-coding-agent/dist/core/tools/grep.js`, L99:

```js
const rgPath = await ensureTool("rg");
if (!rgPath) {
    reject(new Error("ripgrep (rg) is not available and could not be downloaded"));
    ...
}
```

- El builtin `grep` **requiere** ripgrep; no hay fallback a GNU/BSD grep.
- `ensureTool` lo resuelve y **lo descarga** si no está (host de dev: rg
  15.1.0 en `~/.pi/agent/bin/rg`).
- El builtin `find` sigue el mismo patrón con `fd`.
- El agente `Explore` de frida-subagents declara
  `builtinToolNames: ["read", "bash", "grep", "find", "ls"]` → sus búsquedas
  pasan por ese mismo rg.

**Implicación:** en las sesiones del agente, "grep vs ripgrep" no es una
elección abierta — todo ya es rg. Lo único mejorable por encima de esto es el
**modo de invocación** (subprocess efímero por llamada), que es exactamente
lo que ataca FFF.

## Ronda 2 — qué es "fffgrep" y qué hay en pi.dev

### @ff-labs/pi-fff (el paquete real)

| Dato | Valor |
| --- | --- |
| Autor | dmtr.kovalenko (autor de fff.nvim) |
| Versión / licencia | 0.10.5 · MIT |
| Adopción | **32.7K descargas/mes** · publicado hace horas de la consulta (activo) |
| Peso | 65.3 KB (+ `@ff-labs/fff-node` / `fff-bun`, binding nativo Rust) |
| Modos | `tools-and-ui` (default: agrega tools) · `tools-only` · `override` (reemplaza builtins) |
| Tools | `fffind` (fuzzy + frecency) · `ffgrep` (contenido, cursor-paginado) · `fff-multi-grep` (OR multi-patrón, Aho-Corasick) |
| Seguridad | sin shell, sin red, sin telemetría; 2 BDs LMDB locales (frecency + historia) |
| Comandos | `/fff-health` · `/fff-rescan` · `/fff-mode` |

FFF como librería ya potencia la búsqueda de **opencode** y **nushell**.

### "Extensión de ripgrep": no existe

Verificado contra npm (`pi-ripgrep`, `pi-rg`, `@ff-labs/pi-ripgrep` → 404 ×3)
y el índice de pi.dev. Los resultados de búsqueda de pi.dev para "ripgrep"
mostrarán pi-fff (que menciona rg en su pitch de reemplazo). Además, sería
redundante: el motor rg ya está integrado de fábrica (Ronda 1).

### Referencia: ugrep (el otro contender que salió en la investigación)

[ugrep](https://github.com/Genivia/ugrep) 7.8 (BSD-3, 3.2k★) — grep drop-in
más rápido con TUI, búsqueda booleana, archivos comprimidos/pdfs. Relevante
como *CLI humano*, pero sin binding Node ni extensión pi: para el agente no
aporta nada sobre el rg ya integrado.

## Ronda 3 — comparativa de fondo (fuentes primarias)

### Fundamentos de velocidad

| | GNU grep | ripgrep | FFF |
| --- | --- | --- | --- |
| Motor regex | DFA propio + Commentz-Walter multi-literal | Rust regex (DFA + SIMD "Teddy"), paralelo | Mismo Rust regex **+** memmem SIMD / Aho-Corasick / Smith-Waterman |
| Estado por llamada | — (arranca y muere) | re-lee `.gitignore`, re-walkea directorios, re-construye estado en cada spawn | **índice residente**: un walk, caché mmap, watcher incremental |
| Latencia típica | — | ~10-50ms por spawn en repo chico; **3-9 s** por spawn en checkout de 500k archivos (Chromium) | **sub-10 ms** desde la 2ª llamada (proceso cálido) |
| Ranking de resultados | ninguno | ninguno | frecency (aprende entre sesiones) + git-status + typo-tolerancia |
| Memoria | 0 (efímero) | 0 (efímero) | **residente**: ~26 MB @ 14k archivos · ~36 MB de índice @ 100k · cientos de MB @ 500k |
| Cuándo gana | una búsqueda desde la shell | búsquedas sueltas / cold start | **workload de agente**: decenas-cientos de búsquedas en el mismo proceso |

*(Números: README de fff §"What is FFF…" y §"Memory allocation"; blog de
BurntSushi §benchmarks para rg vs grep/ag/ucg.)*

### El trade-off real, dicho por el propio autor de FFF

> "If you are running one grep from a terminal, `rg` is still the right tool.
> If you run dozens of them inside the same process, FFF will pay for itself
> starting from the second call."

FFF **pierde** en: grep-una-vez-y-salir, cold start (indexa al inicio de
sesión), y memoria (es la fuente misma del speedup).

## Ronda 4 — evaluación para Frida específicamente

### Argumentos a favor de adoptar FFF

1. **El workload del agente ES el caso de uso de FFF**: cientos de búsquedas
   por sesión sobre el mismo repo; el índice cálido ataca exactamente el
   overhead de spawn que rg paga en cada llamada.
2. **Calidad de resultados, no solo velocidad**: frecency + git-boost
   (archivos modificados rankean arriba) + typo-tolerancia → menos
   roundtrips del modelo para encontrar el archivo correcto.
3. **Evidencia de adopción seria**: opencode y nushell lo usan en producción;
   32.7K/mes no es vaporware.
4. **Costo de prueba = 0**: frida hereda extensiones pi del agentDir
   (`PI_CODING_AGENT_DIR=~/.frida`) → `pi install npm:@ff-labs/pi-fff` en el
   Dev Host lo deja disponible para TODAS las sesiones de frida sin tocar el
   VSIX. Modo `tools-only` agrega sin reemplazar builtins.

### Argumentos en contra (por qué NO bundle/recomendar por defecto hoy)

1. **Dependencia nativa en el VSIX**: `@ff-labs/fff-node` es un binding N-API
   → prebuilds por plataforma (darwin-arm64/x64, linux, win32) o compilación
   en el host. Peso y fragilidad de release ×6 plataformas — el mismo vector
   de riesgo que descartamos en season-decisions anteriores.
2. **RAM × multiplicidad de procesos**: frida-subagents detached (#26) corre
   cada subagente en **proceso propio** → cada uno montaría su propio índice
   residente. 26 MB × N subagentes vivos simultáneos.
3. **Madurez**: v0.10.x pre-1.0, mantenedor único. Para pieza central del
   stack de búsqueda, mejor dejarla madurar o adoptarla por el borde
   (instalación opt-in del usuario, no bundle).
4. **Nuestros repos son chicos-medianos** (~1-2k archivos): el spawn de rg no
   es cuello de botella medible en frida; el pain real de FFF vive en
   repos tipo Chromium.

### Veredicto final

| Opción | Recomendación |
| --- | --- |
| Crear extensión frida "ripgrep" | ❌ sin sentido (rg ya es el motor integrado) |
| Bundle de FFF en el VSIX | ❌ por ahora (nativo ×6 plataformas + RAM × subagentes + pre-1.0) |
| **Issue de `enhancement` para adoptar FFF** | ⏸️ prematuro sin evidencia local — primero evaluar |
| **Evaluar empíricamente en Dev Host** | ✅ `pi install npm:@ff-labs/pi-fff` (modo `tools-only`), 1-2 semanas de uso real, observar si el agente elige `ffgrep`/`fffind` sobre `grep`/`find` y si el rendimiento/ranking se nota. Con evidencia positiva → issue de enhancement con datos; con evidencia negativa → esta nota queda como registro del por-qué-no |

## Cómo reproducir la verificación

```bash
# 1. rg integrado en el builtin grep del pi embebido
grep -n "ensureTool(\"rg\")" node_modules/@earendil-works/pi-coding-agent/dist/core/tools/grep.js

# 2. inexistencia de extensión pi de ripgrep
npm view pi-ripgrep name        # 404
npm view @ff-labs/pi-ripgrep name  # 404

# 3. existencia y salud de pi-fff
npm view @ff-labs/pi-fff version dependencies

# 4. evaluación local (Dev Host — no toca el VSIX)
pi install npm:@ff-labs/pi-fff
```

## Notas de trazabilidad

- Investigación pedida por el usuario tras ver "fffgrep y ripgrep" en
  pi.dev/packages; regla de la sesión: solo lectura, nada de issues/commits
  sin indicación explícita (por eso esta nota NO crea issue).
- "fffgrep" = la tool `ffgrep` de `@ff-labs/pi-fff`, no un paquete homónimo
  (npm `fffgrep` → 404).
