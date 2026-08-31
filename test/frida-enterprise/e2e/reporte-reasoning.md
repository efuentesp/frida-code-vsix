# Reporte de razonamiento en vivo (matriz modelo × effort)

Generado por `live-reasoning.e2e.test.ts` (opt-in). Re-correr para refrescar:

```bash
FRIDA_ENTERPRISE_LIVE=1 npx vitest run test/frida-enterprise/e2e/live-reasoning.e2e.test.ts
```

| Modelo | Canal | Effort | HTTP | response.failed | Texto | Razonó | reasoning_tokens |
| --- | --- | --- | --- | --- | --- | --- | --- |
| NIKE-VICTORY | responses | high | 200 | — | ✓ | ✓ | 341 |
| ATHENA-LANCE | responses | high | 502 | — | ✗ | ✗ | — |
| SELENE-CIPHER | chat | none | 200 | — | ✓ | ✓ | — |
| SELENE-CIPHER | chat | low | 200 | — | ✓ | ✓ | — |
| SELENE-CIPHER | chat | medium | 200 | — | ✓ | ✓ | — |
| SELENE-CIPHER | chat | high | 200 | — | ✓ | ✓ | — |
| TIRESIAS-PRISM | chat | none | 200 | — | ✓ | ✗ | — |
| TIRESIAS-PRISM | chat | low | 200 | — | ✓ | ✗ | — |
| TIRESIAS-PRISM | chat | medium | 200 | — | ✓ | ✗ | — |
| TIRESIAS-PRISM | chat | high | 200 | — | ✓ | ✗ | — |
| AEOLUS-GALE | chat | none | 200 | — | ✓ | ✗ | — |
| AEOLUS-GALE | chat | low | 200 | — | ✓ | ✗ | — |
| AEOLUS-GALE | chat | medium | 200 | — | ✓ | ✗ | — |
| AEOLUS-GALE | chat | high | 200 | — | ✓ | ✗ | — |
| NIKE-VICTORY | responses | low | 200 | — | ✓ | ✓ | 35 |
| NIKE-VICTORY | responses | medium | 200 | — | ✓ | ✗ | 0 |
| NIKE-VICTORY | responses | high | 200 | — | ✓ | ✓ | 204 |
| ATHENA-LANCE | responses | low | 502 | — | ✗ | ✗ | — |
| SELENE-CIPHER | chat | high | 200 | — | ✓ | ✓ | — |
| ATHENA-LANCE | responses | high | 502 | — | ✗ | ✗ | — |
| ORPHEUS-VERSE | responses | high | 200 | — | ✓ | ✗ | 0 |
| AEOLUS-GALE | responses | high | 200 | — | ✓ | ✓ | 615 |
| ZEUS-THUNDER | responses | high | 200 | — | ✓ | ✓ | 622 |
| POSEIDON-DEEP | responses | high | 200 | — | ✓ | ✓ | 327 |
| KRONOS-VEIL | responses | high | 200 | — | ✓ | ✓ | 58 |
| HADES-PRIME | responses | high | 200 | — | ✓ | ✓ | 78 |
| OURANOS-CROWN | responses | high | 200 | — | ✓ | ✓ | 160 |
| DEMETER-BLOOM | responses | high | 200 | — | ✓ | ✓ | 620 |
| NIKE-VICTORY | responses | high | 200 | — | ✓ | ✓ | 220 |
| SATURN-RING | responses | high | 200 | — | ✓ | ✗ | 0 |
| MARS-SHIELD | responses | high | 200 | — | ✓ | ✗ | 0 |
| PHOEBE-DUST | chat | high | 200 | — | ✓ | ✗ | — |
| MERCURY-WING | responses | high | 200 | — | ✓ | ✗ | 0 |
| PUCK-SWIFT | responses | high | 200 | — | ✓ | ✗ | 0 |
| TITAN-CROWN | responses | high | 200 | — | ✓ | ✓ | 779 |
| AEGIS-WAVE | responses | high | 502 | — | ✗ | ✗ | — |
| HELIOS-BRIGHT | responses | high | 200 | — | ✓ | ✗ | 0 |
| OLYMPUS-PEAK | responses | high | 502 | — | ✗ | ✗ | — |
| OLYMPUS-GUST | responses | high | 502 | — | ✗ | ✗ | — |
| ATLAS-CROWN | responses | high | 200 | — | ✓ | ✓ | 330 |
| GAIA-GLEAM | responses | high | 200 | — | ✓ | ✗ | 0 |
| GAIA-FLARE | responses | high | 200 | — | ✓ | ✗ | 0 |
| GAIA-LOOM | responses | high | 200 | — | ✓ | ✓ | 191 |
| MIDAS-GOLD | responses | high | 200 | — | ✓ | ✓ | 124 |
| JANUS-GATE | chat | high | 502 | — | ✗ | ✗ | — |
| ORACLE-SIGHT | responses | high | 200 | — | ✓ | ✓ | 363 |
| PYTHIA-LENS | responses | high | 200 | — | ✓ | ✓ | 482 |
| SIBYL-GLASS | responses | high | 200 | — | ✓ | ✓ | 330 |
| TIRESIAS-PRISM | responses | high | 200 | — | ✓ | ✗ | 0 |
| model-router | responses | high | 200 | — | ✓ | ✓ | 767 |

## ¿Qué modelos razonan visible? (agregado por modelo)

- **NIKE-VICTORY** (responses) — ✅ razona visible · reasoning_tokens=220
- **ATHENA-LANCE** (responses) — ❌ no expone razonamiento
- **SELENE-CIPHER** (chat) — ✅ razona visible
- **TIRESIAS-PRISM** (responses) — ❌ no expone razonamiento
- **AEOLUS-GALE** (responses) — ✅ razona visible · reasoning_tokens=615
- **ORPHEUS-VERSE** (responses) — ❌ no expone razonamiento
- **ZEUS-THUNDER** (responses) — ✅ razona visible · reasoning_tokens=622
- **POSEIDON-DEEP** (responses) — ✅ razona visible · reasoning_tokens=327
- **KRONOS-VEIL** (responses) — ✅ razona visible · reasoning_tokens=58
- **HADES-PRIME** (responses) — ✅ razona visible · reasoning_tokens=78
- **OURANOS-CROWN** (responses) — ✅ razona visible · reasoning_tokens=160
- **DEMETER-BLOOM** (responses) — ✅ razona visible · reasoning_tokens=620
- **SATURN-RING** (responses) — ❌ no expone razonamiento
- **MARS-SHIELD** (responses) — ❌ no expone razonamiento
- **PHOEBE-DUST** (chat) — ❌ no expone razonamiento
- **MERCURY-WING** (responses) — ❌ no expone razonamiento
- **PUCK-SWIFT** (responses) — ❌ no expone razonamiento
- **TITAN-CROWN** (responses) — ✅ razona visible · reasoning_tokens=779
- **AEGIS-WAVE** (responses) — ❌ no expone razonamiento
- **HELIOS-BRIGHT** (responses) — ❌ no expone razonamiento
- **OLYMPUS-PEAK** (responses) — ❌ no expone razonamiento
- **OLYMPUS-GUST** (responses) — ❌ no expone razonamiento
- **ATLAS-CROWN** (responses) — ✅ razona visible · reasoning_tokens=330
- **GAIA-GLEAM** (responses) — ❌ no expone razonamiento
- **GAIA-FLARE** (responses) — ❌ no expone razonamiento
- **GAIA-LOOM** (responses) — ✅ razona visible · reasoning_tokens=191
- **MIDAS-GOLD** (responses) — ✅ razona visible · reasoning_tokens=124
- **JANUS-GATE** (chat) — ❌ no expone razonamiento
- **ORACLE-SIGHT** (responses) — ✅ razona visible · reasoning_tokens=363
- **PYTHIA-LENS** (responses) — ✅ razona visible · reasoning_tokens=482
- **SIBYL-GLASS** (responses) — ✅ razona visible · reasoning_tokens=330
- **model-router** (responses) — ✅ razona visible · reasoning_tokens=767
