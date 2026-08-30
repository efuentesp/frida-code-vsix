# Reporte E2E tools — gpt-5.4-mini, gpt-5.6-luna, gpt-5.6-sol, gpt-5.6-terra (reasoning: medium)

Fecha: 2026-08-29T17:07:32.998Z · endpoint: <https://mywork.softtek.com/apg/devengine/v1/chat/completions> · adapter openai-completions

## gpt-5.4-mini

- Nivel A (ciclo real, tools core): **7/7**
- Nivel B (generación, tools host): **14/14**

| Nivel | Tool | Resultado | Fase | Detalle | ms |
| --- | --- | --- | --- | --- | --- |
| A | read | ✅ | — | thinking=0chr · 2 hops · ok | 2470 |
| A | write | ✅ | — | thinking=0chr · 2 hops · ok | 2362 |
| A | edit | ✅ | — | thinking=0chr · 3 hops · ok | 2995 |
| A | bash | ✅ | — | thinking=0chr · 2 hops · ok | 2039 |
| A | grep | ✅ | — | thinking=0chr · 2 hops · ok | 2394 |
| A | find | ✅ | — | thinking=0chr · 2 hops · ok | 2320 |
| A | ls | ✅ | — | thinking=0chr · 2 hops · ok | 2415 |
| B | ask_user_question | ✅ | — | args ok: {"questions":[{"question":"¿Qué framework prefieres para añadir los tests al proyecto?","header":"El | 1268 |
| B | todo | ✅ | — | args ok: {"action":"create","subject":"Investigar el bug del login","status":"pending"} | 1496 |
| B | context | ✅ | — | args ok: {"query":"componentes de tabla React","maxTokens":2000} | 941 |
| B | read_skills | ✅ | — | args ok: {"search":"commit messages"} | 779 |
| B | agent_browser | ✅ | — | args ok: {"url":"<https://example.com","qa":{"questions":["¿Cuál> es el título de la página?"]}} | 1045 |
| B | workflow | ✅ | — | args ok: {"name":"probe","script":"return 42;","description":"Flujo de trabajo inline que retorna 42."} | 981 |
| B | get_subagent_result | ✅ | — | args ok: {"agent_id":"agent-123","wait":false} | 1169 |
| B | steer_subagent | ✅ | — | args ok: {"agent_id":"agent-123","message":"prioriza los tests"} | 1025 |
| B | Agent | ✅ | — | args ok: {"description":"Averiguar la versión de TypeScript usada por el repositorio","subagent_type":"codeba | 1577 |
| B | kb_search | ✅ | — | args ok: {"query":"pipeline de release","limit":10} | 1166 |
| B | sandbox_create | ✅ | — | args ok: {"name":"python-3.12-slim-ephemeral","image":"python:3.12-slim","workdir":"/workspace"} | 997 |
| B | sandbox_exec | ✅ | — | args ok: {"id":"sbx-1","command":"python --version"} | 982 |
| B | workflow_catalog | ✅ | — | args ok: {"verbose":true} | 1314 |
| B | goal_complete | ✅ | — | args ok: {"goal_id":"goal-42","summary":"migración completada sin regresiones"} | 956 |

## gpt-5.6-luna

- Nivel A (ciclo real, tools core): **6/7**
- Nivel B (generación, tools host): **14/14**

| Nivel | Tool | Resultado | Fase | Detalle | ms |
| --- | --- | --- | --- | --- | --- |
| A | read | ✅ | — | thinking=0chr · 2 hops · ok | 2313 |
| A | write | ✅ | — | thinking=0chr · 2 hops · ok | 1610 |
| A | edit | ❌ | tool_call | hop0: edit execute ERROR Could not find the exact text in config.txt. The old text must match exactly including all · hop0: edit({"path":"config.txt","edits":[{ | 3112 |
| A | bash | ✅ | — | thinking=0chr · 2 hops · ok | 1490 |
| A | grep | ✅ | — | thinking=0chr · 2 hops · ok | 1807 |
| A | find | ✅ | — | thinking=0chr · 2 hops · ok | 1721 |
| A | ls | ✅ | — | thinking=0chr · 2 hops · ok | 1741 |
| B | ask_user_question | ✅ | — | args ok: {"questions":[{"header":"Framework de tests","question":"¿Qué framework prefieres para añadir los te | 1559 |
| B | todo | ✅ | — | args ok: {"action":"create","subject":"Investigar el bug del login","status":"pending"} | 1049 |
| B | context | ✅ | — | args ok: {"query":"componentes de tabla React","maxTokens":6000} | 1088 |
| B | read_skills | ✅ | — | args ok: {"search":"commit messages"} | 858 |
| B | agent_browser | ✅ | — | args ok: {"url":"<https://example.com","job":"Abre> la página y extrae el título visible o el título del docume | 1592 |
| B | workflow | ✅ | — | args ok: {"name":"probe","script":"return 42;"} | 1062 |
| B | get_subagent_result | ✅ | — | args ok: {"agent_id":"agent-123","wait":false} | 873 |
| B | steer_subagent | ✅ | — | args ok: {"agent_id":"agent-123","message":"prioriza los tests"} | 780 |
| B | Agent | ✅ | — | args ok: {"description":"Averiguar versión de TypeScript del repositorio","prompt":"Inspecciona el repositori | 1624 |
| B | kb_search | ✅ | — | args ok: {"query":"pipeline de release","limit":10} | 857 |
| B | sandbox_create | ✅ | — | args ok: {"name":"python-test","image":"python:3.12-slim","workdir":"/workspace"} | 1048 |
| B | sandbox_exec | ✅ | — | args ok: {"id":"sbx-1","command":"python --version"} | 817 |
| B | workflow_catalog | ✅ | — | args ok: {} | 1218 |
| B | goal_complete | ✅ | — | args ok: {"goal_id":"goal-42","summary":"migración completada sin regresiones"} | 1078 |

## gpt-5.6-sol

- Nivel A (ciclo real, tools core): **6/7**
- Nivel B (generación, tools host): **14/14**

| Nivel | Tool | Resultado | Fase | Detalle | ms |
| --- | --- | --- | --- | --- | --- |
| A | read | ✅ | — | thinking=0chr · 2 hops · ok | 7035 |
| A | write | ✅ | — | thinking=0chr · 2 hops · ok | 2218 |
| A | edit | ❌ | tool_call | hop0: read({"path":"config.txt"}) → [{"type":"text","text":"color=azul\nsize · hop1: sin tool_call (stop=stop) | 2210 |
| A | bash | ✅ | — | thinking=0chr · 2 hops · ok | 3136 |
| A | grep | ✅ | — | thinking=0chr · 2 hops · ok | 2592 |
| A | find | ✅ | — | thinking=0chr · 2 hops · ok | 2722 |
| A | ls | ✅ | — | thinking=0chr · 2 hops · ok | 4645 |
| B | ask_user_question | ✅ | — | args ok: {"questions":[{"header":"Framework de tests","question":"¿Qué framework prefieres para añadir los te | 3070 |
| B | todo | ✅ | — | args ok: {"action":"create","subject":"Investigar el bug del login","status":"pending"} | 1020 |
| B | context | ✅ | — | args ok: {"query":"componentes de tabla React para este proyecto","maxTokens":5000} | 1418 |
| B | read_skills | ✅ | — | args ok: {"search":"commit messages"} | 1143 |
| B | agent_browser | ✅ | — | args ok: {"url":"<https://example.com","job":{"type":"read","goal":"Obtener> el título de la página."}} | 1324 |
| B | workflow | ✅ | — | args ok: {"name":"probe","script":"return 42;","description":"Flujo de trabajo inline que retorna 42."} | 898 |
| B | get_subagent_result | ✅ | — | args ok: {"agent_id":"agent-123","wait":false} | 1635 |
| B | steer_subagent | ✅ | — | args ok: {"agent_id":"agent-123","message":"prioriza los tests"} | 1164 |
| B | Agent | ✅ | — | args ok: {"description":"Averiguar versión de TypeScript","prompt":"Inspecciona este repositorio y determina | 2141 |
| B | kb_search | ✅ | — | args ok: {"query":"pipeline de release","limit":10} | 1320 |
| B | sandbox_create | ✅ | — | args ok: {"name":"python-3-12-pruebas","image":"python:3.12-slim","workdir":"/workspace"} | 1229 |
| B | sandbox_exec | ✅ | — | args ok: {"id":"sbx-1","command":"python --version"} | 1011 |
| B | workflow_catalog | ✅ | — | args ok: {"verbose":true} | 851 |
| B | goal_complete | ✅ | — | args ok: {"goal_id":"goal-42","summary":"migración completada sin regresiones"} | 1092 |

## gpt-5.6-terra

- Nivel A (ciclo real, tools core): **6/7**
- Nivel B (generación, tools host): **14/14**

| Nivel | Tool | Resultado | Fase | Detalle | ms |
| --- | --- | --- | --- | --- | --- |
| A | read | ✅ | — | thinking=0chr · 2 hops · ok | 2777 |
| A | write | ✅ | — | thinking=0chr · 2 hops · ok | 2357 |
| A | edit | ❌ | tool_call | hop0: read({"path":"config.txt"}) → [{"type":"text","text":"color=azul\nsize · hop1: sin tool_call (stop=stop) | 2207 |
| A | bash | ✅ | — | thinking=0chr · 2 hops · ok | 2911 |
| A | grep | ✅ | — | thinking=0chr · 2 hops · ok | 2665 |
| A | find | ✅ | — | thinking=0chr · 2 hops · ok | 2354 |
| A | ls | ✅ | — | thinking=0chr · 2 hops · ok | 2664 |
| B | ask_user_question | ✅ | — | args ok: {"questions":[{"header":"Framework de tests","question":"¿Qué framework prefieres usar para añadir l | 1425 |
| B | todo | ✅ | — | args ok: {"action":"create","subject":"Investigar el bug del login","status":"pending"} | 838 |
| B | context | ✅ | — | args ok: {"query":"componentes de tabla React","maxTokens":6000} | 847 |
| B | read_skills | ✅ | — | args ok: {"search":"commit messages"} | 704 |
| B | agent_browser | ✅ | — | args ok: {"url":"<https://example.com","semanticAction":{"type":"read","goal":"Obtener> el título de la página" | 933 |
| B | workflow | ✅ | — | args ok: {"name":"probe","script":"return 42;"} | 978 |
| B | get_subagent_result | ✅ | — | args ok: {"agent_id":"agent-123","wait":false} | 869 |
| B | steer_subagent | ✅ | — | args ok: {"agent_id":"agent-123","message":"prioriza los tests"} | 840 |
| B | Agent | ✅ | — | args ok: {"description":"Detectar versión de TypeScript","subagent_type":"explorer","run_in_background":false | 1540 |
| B | kb_search | ✅ | — | args ok: {"query":"pipeline de release","limit":10} | 1370 |
| B | sandbox_create | ✅ | — | args ok: {"name":"python312-slim-disposable","image":"python:3.12-slim","workdir":"/workspace"} | 1107 |
| B | sandbox_exec | ✅ | — | args ok: {"id":"sbx-1","command":"python --version"} | 1565 |
| B | workflow_catalog | ✅ | — | args ok: {"verbose":true} | 793 |
| B | goal_complete | ✅ | — | args ok: {"goal_id":"goal-42","summary":"migración completada sin regresiones"} | 1142 |

## Prompts usados

- **read**: Lee el archivo poema.txt y dime el número de 4 dígitos que aparece en él.
- **write**: Crea el archivo resumen.txt con el contenido exacto: HOLA-DEVENGINE-E2E
- **edit**: En config.txt cambia la línea color=rojo para que diga color=azul (con búsqueda y reemplazo exacto).
- **bash**: Ejecuta el comando echo $((6*7)) y dime el resultado numérico.
- **grep**: Busca el patrón 'aguacate' en este directorio y dime en QUÉ archivo aparece.
- **find**: Localiza el archivo que se llama tesoro.txt (está en un subdirectorio) y dime su ruta.
- **ls**: Lista el contenido del directorio actual y dime los nombres de los archivos .md que ves.
- **ask_user_question**: Quiero añadir tests a este proyecto. Antes de empezar, formulame una pregunta con opciones concretas sobre qué framework prefiero (vitest o jest).
- **todo**: Registra en la lista de tareas una nueva tarea: 'Investigar el bug del login' con estado pending.
- **context**: Consulta el contexto documental del equipo sobre 'componentes de tabla React' para este proyecto.
- **read_skills**: Busca skills remotas sobre 'commit messages'.
- **agent_browser**: Navega a <https://example.com> y dime el título de la página.
- **workflow**: Lanza un flujo de trabajo llamado 'probe' con un script inline que retorne 42.
- **get_subagent_result**: Consulta el resultado del sub-agente agent-123 (sin esperar).
- **steer_subagent**: Envía el mensaje 'prioriza los tests' al sub-agente agent-123.
- **Agent**: Delega a un sub-agente especializado la tarea de averiguar qué versión de TypeScript usa este repo.
- **kb_search**: Busca en la base de conocimiento del equipo notas sobre 'pipeline de release'.
- **sandbox_create**: Necesito un entorno desechable y aislado con la imagen python:3.12-slim para probar un script sin tocar mi máquina.
- **sandbox_exec**: En el sandbox sbx-1 corre el comando 'python --version' y dime la salida.
- **workflow_catalog**: Muéstrame el catálogo de flujos de trabajo predefinidos que puedo correr en este proyecto.
- **goal_complete**: El objetivo goal-42 ya quedó logrado: registra el resumen 'migración completada sin regresiones'.
