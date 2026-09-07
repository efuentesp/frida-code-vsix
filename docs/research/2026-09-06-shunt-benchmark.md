# Benchmark de frida-shunt — ahorro de tokens (input del contexto padre)

> Generado por `scripts/shunt-benchmark.mjs` (#202) · 2026-09-06 · Metodología del
> [upstream de Spotify](https://github.com/spotify/portal-ai-plugins/tree/main/plugins/shunt/evals):
> estimación conservadora **chars/4**, fixtures deterministas, 4 escenarios.
> Mide los tokens de ENTRADA que consumiría el contexto del modelo PRINCIPAL
> (lo que ahorra el gate); el costo del worker (rol smol / Ollama local) corre
> por fuera y en el caso local es ~0.

## Escenarios

| # | Escenario | Sin shunt (tokens) | Con shunt — escalera mínima (pi-lens) | Con shunt — peldaño 2 (subagent) | Ahorro pi-lens | Ahorro subagent |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | single-large-file<br/><sub>Leer un servicio de 602 líneas y resumir sus exports</sub> | 10726 | 1130 | 134 | 89% | 99% |
| 2 | multi-file-cross-read<br/><sub>3 archivos, pregunta transversal (exports y relaciones)</sub> | 22330 | 2825 | 134 | 87% | 99% |
| 3 | source-plus-test<br/><sub>Par fuente+test para entender cobertura</sub> | 11604 | 1757 | 134 | 85% | 99% |
| 4 | code-generation<br/><sub>Generar tests de UserService siguiendo el patrón de OrderService (input-side)</sub> | 11604 | 120 | — | 99% | —% |

**Ahorro medio (peldaño 1, pi-lens): 90% · (mejor peldaño por escenario): 99%**

## Lecturas honestas

- **Peldaño 1 (pi-lens/module_report)** domina cuando la pregunta es de
  estructura: es determinístico (0 tokens de worker, 0 latencia). El proxy del
  outline (firmas acotadas a 60 líneas) es conservador: el module_report real
  incluye rangos y who-uses-this, igualmente acotado.
- **Peldaño 2 (subagent smol)** gana cuando la pregunta es semántica: vuelve
  sólo la respuesta destilada (proxy: resumen fijo). Con Ollama local el
  worker es costo 0; con un modelo pequeño remoto, su costo NO entra al
  contexto del padre (la propiedad clave del patrón).
- **Escenario 4 (code-writer)** mide sólo el lado INPUT (spec + resumen): el
  output va directo a disco y el principal jamás lo ve — el ahorro real incluye
  TODO el output no generado por el principal (no medible con chars/4 contra
  un baseline que no existe).
- Comparativa con el upstream: Spotify reporta 82–94% en bulk-read (media ~90%)
  con delegación a worker remoto; frida obtiene el mismo orden con el gate
  local + el peldaño determinístico extra que Spotify no tiene.

## Reproducir

```bash
node scripts/shunt-benchmark.mjs          # escribe este archivo
node scripts/shunt-benchmark.mjs --dry    # sólo imprime la tabla
```
