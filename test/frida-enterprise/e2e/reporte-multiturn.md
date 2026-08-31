# Reporte multi-turno /v1/responses (Errata-13)

2026-08-29 16:51 UTC · modelo: DEMETER-BLOOM

| prueba | modelo | resultado |
| --- | --- | --- |
| T1 turno 1 | DEMETER-BLOOM | toolCall ✓ (stop=toolUse) |
| T1 turno 2 | DEMETER-BLOOM | OK (stop=stop) |
| T2a assistant(input_text) | DEMETER-BLOOM | HTTP 200 |
| T2b assistant(string) | DEMETER-BLOOM | HTTP 200 |
| T2c fc/fc_out | DEMETER-BLOOM | HTTP 200 |
| T3 chat multi-turno+tools | SELENE-CIPHER | HTTP 200 |
| T4a assistant(output_text) [forma pi-ai] | DEMETER-BLOOM | HTTP 500 ← incidente |
| T4b reasoning item | DEMETER-BLOOM | HTTP 500 ← incidente |

## Lectura

- T1 verde = el ciclo completo usuario→tool→respuesta funciona (incidente corregido o workaround activo).
- T4a/T4b en 500 = el gateway sigue sin aceptar assistant(output_text) / items reasoning (forma estándar de OpenAI).
- T3 verde = chat/completions no está afectado; sólo /v1/responses.
