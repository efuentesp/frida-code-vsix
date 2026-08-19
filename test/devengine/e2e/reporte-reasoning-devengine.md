# Reporte E2E reasoning — gpt-5.4-mini (2026-08-19T15:06:40.505Z)

Endpoint: https://mywork.softtek.com/apg/devengine/v1/chat/completions · Adapter: openai-completions

## Resumen

- **4/4** efforts funcionan correctamente

| Effort | Resultado | Reasoning tokens | Texto (primeros 200 chars) | ms |
|---|---|---|---|---|
| none | ✅ | 0 | 391 | 4612 |
| low | ✅ | 0 | El cielo es azul porque la luz del Sol, que contiene muchos colores, se dispersa al atravesar la atmósfera. Las moléculas del aire dispersan más las ondas cortas, como el azul y el violeta; como nuest | 1551 |
| medium | ✅ | 68 | - `GET /posts` - `POST /posts` - `GET /posts/{postId}` - `PATCH /posts/{postId}` - `DELETE /posts/{postId}` - `GET /posts/{postId}/comments` - `POST /posts/{postId}/comments` - `GET /posts/{postId}/co | 2398 |
| high | ✅ | 1184 | Sea el estado **(jarra de 8 L, jarra de 5 L, jarra de 3 L)**.  Primero hay que vaciar las jarras de 5 L y 3 L, ya que, sin desechar agua, sería imposible: quedarían 16 L en total y las otras dos jarra | 18985 |

## Prompts usados

- **none**: ¿Cuánto es 17×23? Responde solo el número.
- **low**: Explica brevemente por qué el cielo es azul.
- **medium**: Diseña una API REST minimalista para un blog con posts y comentarios. Lista solo los endpoints.
- **high**: Resuelve: tienes 3 jarras [8L, 5L, 3L] llenas de agua. ¿Cómo obtienes exactamente 4L en la jarra de 8L? Explica los pasos.