 Qué debe cambiar el equipo de DevEngine (fix de fondo)

 Esto es lo que le pasarías al equipo del gateway, con la causa técnica precisa:

 ### Síntoma

 POST /chat/completions devuelve 500 Internal Server Error cuando el body incluye un mensaje de assistant del historial con el campo reasoning_content, p. ej.:

 ```json
   {
     "model": "gpt-5.4-mini",
     "messages": [
       { "role": "user", "content": "..." },
       { "role": "assistant", "content": "respuesta...", "reasoning_content": "el razonamiento que el modelo devolvió antes..." },
       { "role": "user", "content": "continúa" }
     ],
     "reasoning_effort": "medium"
   }
 ```

 Las sesiones nuevas (sin ese campo) funcionan; las que continúan un historial con razonamiento previo fallan.

 ### Causa raíz — round-trip inconsistente

 1. El gateway emite reasoning_content en el stream de respuesta (delta.reasoning_content) cuando se le pide reasoning_effort.
 2. Los clientes (pi, y cualquier cliente OpenAI-compat que respete la extensión de DeepSeek) lo persisten en el historial.
 3. Al reenviar ese mensaje en el array messages, el gateway no lo acepta como input y responde 500.

 Es decir: el campo que el gateway produce en responses, lo rechaza en requests.

 ### Qué cambiar (en orden de preferencia)

 1. Aceptar reasoning_content en mensajes assistant del historial (round-trip consistente). Es lo que hace DeepSeek (la referencia canónica de esta extensión).
    Así cualquier cliente puede reenviar el razonamiento sin romper, y ya no haría falta el workaround requiresThinkingAsText.
 2. Hacer el proxy tolerante: si un mensaje trae un campo que el backend no reconoce (reasoning_content u otro), ignorarlo, no responder 500. Un gateway
    robusto no debería crashear por un campo extra en messages.
 3. Confirmar la causa exacta en sus logs: el "500 Internal Server Error" es genérico; el log del proxy (LiteLLM/proxy interno) dirá la excepción real.
    Conviene reproducir con el JSON de arriba y verificar que efectivamente es reasoning_content (y no otra cosa, p. ej. un tool_call o un tamaño).

 ### Notas para el equipo

 - Estándar: reasoning_content NO es parte del spec oficial de OpenAI Chat Completions; es una extensión de proveedores de reasoning (DeepSeek, etc.) para el
   output. Lo correcto es ser consistente: si se emite, se acepta de vuelta; si no se quiere aceptar, no emitirlo (o emitirlo por el canal estándar de OpenAI
   para reasoning).
 - Impacto del workaround de Frida: con requiresThinkingAsText, los clientes Frida ya no envían reasoning_content (lo convierten a texto) → no verán el bug.
   Pero otros clientes pi (la TUI, o si se quitara el workaround) sí lo enviarían y sufrirían el 500. Y el workaround infla el contexto (el razonamiento viaja
   como texto). Por eso el fix del gateway sigue valiendo.