# Reporte de embeddings en vivo (matriz RAG-ready)

Generado por `live-embeddings.e2e.test.ts` (opt-in) — 2026-08-16T23:43:11.251Z. Re-correr:

```bash
FRIDA_ENTERPRISE_LIVE=1 npx vitest run test/frida-enterprise/e2e/live-embeddings.e2e.test.ts
```

Contrato verificado: Bearer idToken + user_id/email en el body (Errata-2 aplica a embeddings) + POST {COMPATIBLE_API_URL}/v1/embeddings.
Semántica: benchmark de 6 tripletas ES/EN (query · chunk relevante · distractor); cos(rel)/cos(unrel) son MEDIAS de las 6.

| Modelo | HTTP | Dims | Batch | Determinista | Semántica | cos(rel) | cos(unrel) | Margen medio | Margen mín | Wins | prompt_tokens | Fallo |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| MNEMOSYNE-THREAD | 200 | 1536 | ✓ | ✓ | ✓ | 0.8163 | 0.6917 | 0.1246 | 0.0764 | 6/6 | 3 | — |
| URANIA-VAST | 200 | 3072 | ✓ | ✓ | ✓ | 0.512 | 0.096 | 0.4159 | 0.3336 | 6/6 | 3 | — |
| CALLIOPE-GRAIN | 200 | 1536 | ✓ | ✓ | ✓ | 0.4838 | 0.0796 | 0.4042 | 0.3329 | 6/6 | 3 | — |
| CLIO-RELIC | 200 | 1536 | ✓ | ✓ | ✓ | 0.8163 | 0.6917 | 0.1246 | 0.0764 | 6/6 | 3 | — |

## Ranking de discriminación (por margen mínimo, peor caso)

1. **URANIA-VAST** — margen medio 0.4159, mínimo 0.3336 (6/6 tripletas, 3072 dims)
2. **CALLIOPE-GRAIN** — margen medio 0.4042, mínimo 0.3329 (6/6 tripletas, 1536 dims)
3. **MNEMOSYNE-THREAD** — margen medio 0.1246, mínimo 0.0764 (6/6 tripletas, 1536 dims)
4. **CLIO-RELIC** — margen medio 0.1246, mínimo 0.0764 (6/6 tripletas, 1536 dims)

## Notas para el RAG de frida code

- **Dims por modelo**: una colección vectorial exige dims fijas — los valores de la columna Dims son los que hay que configurar por modelo.
- **Determinista** (FLAKY, observado 2026-08-17: ✓/✗ entre corridas en URANIA/CALLIOPE — réplicas del backend): mismo input ⇒ mismo vector SÓLO dentro de una corrida. Para el RAG: NO comparar embeddings entre corridas (similitud≠1.0); re-indexar documentos completos juntos, nunca parcialmente.
- **Batch**: el gateway acepta `input: string[]` (indexado por lotes).
- **Semántica**: benchmark de 6 tripletas ES/EN — la query se acerca más al chunk relevante que al distractor en TODAS (requisito mínimo de recuperación).
- **Ranking**: ordenado por margen MÍNIMO (peor caso). Márgenes ≲0.15 indican anisotropía (distractores a cos alto de la query ⇒ falsos positivos con umbral de similitud). Dos modelos con vectores idénticos son el mismo backend subyacente.
- Ejemplo mínimo en Python: `frida-enterprise/examples/embedding_example.py`.
