# Reporte E2E multiturn — gpt-5.4-mini, gpt-5.6-luna, gpt-5.6-sol, gpt-5.6-terra (2026-08-29T17:05:22.022Z)

Endpoint: <https://mywork.softtek.com/apg/devengine/v1/chat/completions> · Adapter: openai-completions

## gpt-5.4-mini

### Resumen

- **2/2** casos mantienen contexto

| Caso | Resultado | Respuesta final (200 chars) | ms |
| --- | --- | --- | --- |
| T1-memory | ✅ | Tu nombre es **Alice** y tu color favorito es **azul**. | 1667 |
| T2-context | ✅ | 126 | 921 |

## gpt-5.6-luna

### Resumen

- **2/2** casos mantienen contexto

| Caso | Resultado | Respuesta final (200 chars) | ms |
| --- | --- | --- | --- |
| T1-memory | ✅ | Tu nombre es Alice y tu color favorito es el azul. | 820 |
| T2-context | ✅ | 126 | 613 |

## gpt-5.6-sol

### Resumen

- **2/2** casos mantienen contexto

| Caso | Resultado | Respuesta final (200 chars) | ms |
| --- | --- | --- | --- |
| T1-memory | ✅ | Tu nombre es Alice y tu color favorito es azul. | 1128 |
| T2-context | ✅ | 126 | 1110 |

## gpt-5.6-terra

### Resumen

- **2/2** casos mantienen contexto

| Caso | Resultado | Respuesta final (200 chars) | ms |
| --- | --- | --- | --- |
| T1-memory | ✅ | Tu nombre es Alice y tu color favorito es azul. | 849 |
| T2-context | ✅ | 126 | 1009 |

## Conversaciones

### T1-memory

- **user**: Mi nombre es Alice y mi color favorito es azul.
- **assistant**: Entendido, Alice. Tu color favorito es azul.
- **user**: ¿Cuál es mi nombre y mi color favorito?

### T2-context

- **user**: Suma 15 + 27
- **assistant**: 42
- **user**: Ahora multiplícalo por 3
