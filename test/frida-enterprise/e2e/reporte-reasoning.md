# Reporte de razonamiento en vivo (matriz modelo × effort)

Generado por `live-reasoning.e2e.test.ts` (opt-in). Re-correr para refrescar:

```bash
FRIDA_ENTERPRISE_LIVE=1 npx vitest run test/frida-enterprise/e2e/live-reasoning.e2e.test.ts
```

| Modelo | Canal | Effort | HTTP | response.failed | Texto | Razonó | reasoning_tokens |
|---|---|---|---|---|---|---|---|
| NIKE-VICTORY | responses | high | 200 | — | ✓ | ✗ | 0 |
| ATHENA-LANCE | responses | high | 200 | **Bedrock API request failed: An error occurred (ValidationExc** | ✗ | ✗ | — |
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
| NIKE-VICTORY | responses | low | 200 | — | ✓ | ✗ | 0 |
| NIKE-VICTORY | responses | medium | 200 | — | ✓ | ✗ | 0 |
| NIKE-VICTORY | responses | high | 200 | — | ✓ | ✗ | 0 |
| SELENE-CIPHER | chat | high | 200 | — | ✓ | ✓ | — |
| ATHENA-LANCE | responses | high | 200 | **Bedrock API request failed: An error occurred (ValidationExc** | ✗ | ✗ | — |
| ORPHEUS-VERSE | responses | high | 200 | — | ✓ | ✗ | 0 |
| AEOLUS-GALE | responses | high | 200 | — | ✓ | ✓ | 854 |
| ZEUS-THUNDER | responses | high | 200 | — | ✓ | ✓ | 656 |
| POSEIDON-DEEP | responses | high | 200 | — | ✓ | ✓ | 312 |
| KRONOS-VEIL | responses | high | 200 | — | ✓ | ✓ | 43 |
| HADES-PRIME | responses | high | 200 | — | ✓ | ✓ | 65 |
| OURANOS-CROWN | responses | high | 200 | — | ✓ | ✓ | 122 |
| DEMETER-BLOOM | responses | high | 200 | — | ✓ | ✓ | 686 |
| NIKE-VICTORY | responses | high | 200 | — | ✓ | ✗ | 0 |
| SATURN-RING | responses | high | 200 | — | ✓ | ✗ | 0 |
| MARS-SHIELD | responses | high | 200 | — | ✓ | ✗ | 0 |
| PHOEBE-DUST | chat | high | 200 | — | ✓ | ✗ | — |
| MERCURY-WING | responses | high | 200 | — | ✓ | ✗ | 0 |
| PUCK-SWIFT | responses | high | 200 | — | ✓ | ✗ | 0 |
| TITAN-CROWN | responses | high | 200 | — | ✓ | ✓ | 721 |
| AEGIS-WAVE | responses | high | 200 | **The request could not be completed.** | ✗ | ✗ | — |
| HELIOS-BRIGHT | responses | high | 200 | — | ✓ | ✗ | 0 |
| OLYMPUS-PEAK | responses | high | 200 | **The request could not be completed.** | ✗ | ✗ | — |
| OLYMPUS-GUST | responses | high | 200 | **The request could not be completed.** | ✗ | ✗ | — |
| ATLAS-CROWN | responses | high | 200 | — | ✓ | ✓ | 194 |
| GAIA-GLEAM | responses | high | 200 | — | ✓ | ✓ | 84 |
| GAIA-FLARE | responses | high | 200 | — | ✓ | ✓ | 364 |
| GAIA-LOOM | responses | high | 200 | — | ✓ | ✓ | 108 |
| MIDAS-GOLD | responses | high | 200 | — | ✓ | ✓ | 805 |
| JANUS-GATE | chat | high | 200 | — | ✓ | ✗ | — |
| ORACLE-SIGHT | responses | high | 200 | — | ✓ | ✓ | 471 |
| PYTHIA-LENS | responses | high | 200 | — | ✓ | ✓ | 112 |
| SIBYL-GLASS | responses | high | 200 | — | ✓ | ✓ | 498 |
| TIRESIAS-PRISM | responses | high | 200 | — | ✓ | ✓ | 264 |
| model-router | responses | high | 200 | — | ✓ | ✓ | 874 |

## ¿Qué modelos razonan visible? (agregado por modelo)

- **NIKE-VICTORY** (responses) — ❌ no expone razonamiento
- **ATHENA-LANCE** (responses) — ❌ no expone razonamiento · ⚠️ backend roto: Bedrock API request failed: An error occurred (ValidationExc
- **SELENE-CIPHER** (chat) — ✅ razona visible
- **TIRESIAS-PRISM** (responses) — ✅ razona visible · reasoning_tokens=264
- **AEOLUS-GALE** (responses) — ✅ razona visible · reasoning_tokens=854
- **ORPHEUS-VERSE** (responses) — ❌ no expone razonamiento
- **ZEUS-THUNDER** (responses) — ✅ razona visible · reasoning_tokens=656
- **POSEIDON-DEEP** (responses) — ✅ razona visible · reasoning_tokens=312
- **KRONOS-VEIL** (responses) — ✅ razona visible · reasoning_tokens=43
- **HADES-PRIME** (responses) — ✅ razona visible · reasoning_tokens=65
- **OURANOS-CROWN** (responses) — ✅ razona visible · reasoning_tokens=122
- **DEMETER-BLOOM** (responses) — ✅ razona visible · reasoning_tokens=686
- **SATURN-RING** (responses) — ❌ no expone razonamiento
- **MARS-SHIELD** (responses) — ❌ no expone razonamiento
- **PHOEBE-DUST** (chat) — ❌ no expone razonamiento
- **MERCURY-WING** (responses) — ❌ no expone razonamiento
- **PUCK-SWIFT** (responses) — ❌ no expone razonamiento
- **TITAN-CROWN** (responses) — ✅ razona visible · reasoning_tokens=721
- **AEGIS-WAVE** (responses) — ❌ no expone razonamiento · ⚠️ backend roto: The request could not be completed.
- **HELIOS-BRIGHT** (responses) — ❌ no expone razonamiento
- **OLYMPUS-PEAK** (responses) — ❌ no expone razonamiento · ⚠️ backend roto: The request could not be completed.
- **OLYMPUS-GUST** (responses) — ❌ no expone razonamiento · ⚠️ backend roto: The request could not be completed.
- **ATLAS-CROWN** (responses) — ✅ razona visible · reasoning_tokens=194
- **GAIA-GLEAM** (responses) — ✅ razona visible · reasoning_tokens=84
- **GAIA-FLARE** (responses) — ✅ razona visible · reasoning_tokens=364
- **GAIA-LOOM** (responses) — ✅ razona visible · reasoning_tokens=108
- **MIDAS-GOLD** (responses) — ✅ razona visible · reasoning_tokens=805
- **JANUS-GATE** (chat) — ❌ no expone razonamiento
- **ORACLE-SIGHT** (responses) — ✅ razona visible · reasoning_tokens=471
- **PYTHIA-LENS** (responses) — ✅ razona visible · reasoning_tokens=112
- **SIBYL-GLASS** (responses) — ✅ razona visible · reasoning_tokens=498
- **model-router** (responses) — ✅ razona visible · reasoning_tokens=874
