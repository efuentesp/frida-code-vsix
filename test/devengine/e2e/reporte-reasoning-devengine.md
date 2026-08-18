# Reporte E2E reasoning — gpt-5.4-mini (2026-08-18T05:04:47.578Z)

Endpoint: https://mywork.softtek.com/apg/devengine/v1/chat/completions · Adapter: openai-completions

## Resumen

- **4/4** efforts funcionan correctamente

| Effort | Resultado | Reasoning tokens | Texto (primeros 200 chars) | ms |
|---|---|---|---|---|
| none | ✅ | 9 | 391 | 1506 |
| low | ✅ | 0 | El cielo es azul porque la luz solar, al atravesar la atmósfera, se dispersa en todas direcciones. Las moléculas del aire dispersan más las longitudes de onda cortas, como el azul y el violeta; como n | 1567 |
| medium | ✅ | 68 | - `GET /posts` - `POST /posts` - `GET /posts/{postId}` - `PATCH /posts/{postId}` - `DELETE /posts/{postId}` - `GET /posts/{postId}/comments` - `POST /posts/{postId}/comments` - `GET /posts/{postId}/co | 2234 |
| high | ✅ | 4608 | Si se permite **vaciar jarras y desechar agua**, haz lo siguiente. Representamos el estado como **(jarra de 8 L, jarra de 5 L, jarra de 3 L)**:  1. Vacía las jarras de 5 L y 3 L: **(8, 0, 0)**. 2. Vie | 46796 |

## Prompts usados

- **none**: ¿Cuánto es 17×23? Responde solo el número.
- **low**: Explica brevemente por qué el cielo es azul.
- **medium**: Diseña una API REST minimalista para un blog con posts y comentarios. Lista solo los endpoints.
- **high**: Resuelve: tienes 3 jarras [8L, 5L, 3L] llenas de agua. ¿Cómo obtienes exactamente 4L en la jarra de 8L? Explica los pasos.