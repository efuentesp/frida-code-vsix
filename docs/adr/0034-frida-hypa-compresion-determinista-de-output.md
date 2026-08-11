# Extensión `frida-hypa`: compresión determinista de output (porte de `@hypabolic/pi-hypa`)

**Estado:** aceptado (#23).

## Contexto

Frida tiene `frida-context`, que **mide y reporta** la presión de contexto (snapshot), pero **no
reduce** el consumo. El mecanismo de *compaction* de pi es **grueso y post-hoc**: comprime la
historia ya consumida cuando se acerca al límite.

[`@hypabolic/pi-hypa`](https://pi.dev/packages/@hypabolic/pi-hypa) cierra la brecha opuesta:
**compresión fina y pre-entrada**. Ejecuta comandos shell y comprime el output ruidoso **antes** de
que llegue al contexto del agente. Es **determinista y local** (no es un LLM summarizer): *reducers*
de first-class para `git`/`dotnet`/`kubectl`/`docker`, filtros DSL declarativos para
linters/builders/CLIs, *token accounting* con `o200k_base`, y *tee* del output completo a artifacts
locales para recuperación. Cada comando comprimido añade un footer medible:
`[hypa: 1200→340 tok, -72%, reducer=dotnet-build]`.

## Decisión

**D1 — Extensión nativa `frida-hypa`.** El agente obtiene un camino de ejecución compactador. **No
reemplaza `bash`**; lo envuelve/intercepta para el output de comandos ruidosos. La interfaz exacta
(wrapper sobre bash vs. tool separada `compacted_shell`) se decide en implementación.

**D2 — Determinista y local, no LLM.** Preserva *errors/warnings/file paths/exit codes*. Nunca
resume con un modelo; la reducción es testable y reproducible.

**D3 — Sin pérdida: tee a artifacts.** El output completo se guarda en disco local; el agente puede
recuperarlo bajo demanda. El output compacto puede quedarse pequeño sin sacrificar evidencia.

**D4 — Ortogonal, sinergia con `frida-context`.** Hypa **reduce** el consumo; `frida-context` **mide**
el resultado. Juntos cierran el bucle medir→reducir→medir.

**D5 — Cero conflicto.** Superficie nueva (compresión pre-contexto). No toca tools existentes.

## Alternativas consideradas

- **A — LLM summarizer del output.** Descartado: no determinista, gasta tokens adicionales, riesgo de
  alucinación sobre errores reales.
- **B — Truncar el output.** Descartado: pierde errores/warnings al final del log (justo lo que
  importa).
- **C — Depender sólo de *compaction* de pi.** Descartado: es gruesa y post-hoc; no evita el consumo
  fino turno a turno.

## Consecuencias

**Positivas**

- **Más turnos útiles por sesión** — cada comando ruidoso ocupa menos contexto, medible
  (`-X%` por comando).
- Recuperable: nada de información se pierde (artifacts).
- Complementa `frida-context` sin duplicar.

**Negativas**

- Porte del runtime de Hypa (SQLite, tokenizers `o200k_base`, reducers DSL, filtros declarativos).
- Decisión de interfaz (wrapper vs. tool) y de cuándo compactar automáticamente vs. on-demand.
- Mantenimiento del upstream de Hypa.

## Referencias

- Issue **#23**.
- Upstream: <https://pi.dev/packages/@hypabolic/pi-hypa> · <https://github.com/Hypabolic/Hypa>
- Sinergia: `frida-context` (ADR-0015) — medir vs. reducir.
