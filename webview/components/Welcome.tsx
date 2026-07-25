import logo from "../assets/frida-logo.png";

// Los tips se renderizan como JSX (no markdown) para resaltar atajos con <code>/<kbd>.
const TIPS: React.ReactNode[] = [
  <li key="files">
    <strong>Archivos e imágenes:</strong> escribe <code>@</code> para adjuntar archivos (búsqueda
    difusa, navega carpetas con <code>/</code>, comillas para espacios: <code>@&quot;ruta con espacios&quot;</code>).
    Pega una <strong>imagen</strong> del portapapeles para enviarla al modelo (visión).
  </li>,
  <li key="bash">
    <strong>Bash rápido:</strong> <code>!comando</code> envía el resultado al modelo;{" "}
    <code>!!comando</code> lo ejecuta sin enviarlo (solo lo ves tú).
  </li>,
  <li key="slash">
    <strong>Comandos <code>/</code>:</strong> <em>skills</em> y <em>prompts</em>, además de acciones{" "}
    <code>/compact</code> <code>/reload</code> <code>/new</code> <code>/model</code> <code>/login</code>{" "}
    <code>/name</code> <code>/copy</code> <code>/clone</code> <code>/fork</code> <code>/help</code>.{" "}
    Filtra escribiendo, <kbd>↑</kbd>/<kbd>↓</kbd> navega, <kbd>Enter</kbd> selecciona.
  </li>,
  <li key="send">
    <strong>Envío:</strong> <kbd>Enter</kbd> envía · <kbd>Shift</kbd>+<kbd>Enter</kbd> salto de línea ·{" "}
    <kbd>Alt</kbd>+<kbd>Enter</kbd> encola un <em>follow-up</em>. <kbd>↑</kbd>/<kbd>↓</kbd> recupera mensajes
    anteriores. Botón <strong>expandir</strong> para prompts largos.
  </li>,
  <li key="ctx">
    <strong>Contexto y razonamiento:</strong> la barra inferior muestra uso del contexto y tokens{" "}
    (<code>↑↓ RW CH</code>). Botón de razonamiento (🧠) para ocultar/mostrar el <em>thinking</em>;{" "}
    <code>/compact</code> resume el contexto y se puede cancelar.
  </li>,
  <li key="model">
    <strong>Modelos y sesión:</strong> elige proveedor/modelo en el selector (Softtek o GitHub Copilot,
    con <code>/login</code> para suscripciones); botón API key (🔑) para rotarla. Copia cualquier turno
    con su icono. <code>/fork</code> y <code>/clone</code> bifurcan la conversación.
  </li>,
  <li key="resources">
    <strong>Recursos:</strong> <em>skills</em>, <em>prompts</em> y extensiones se cargan de{" "}
    <code>~/.pi/agent</code> (global) y <code>.pi</code> (proyecto). Botón <strong>Recursos</strong> para
    verlos; <strong>Recargar</strong> tras añadirlos.
  </li>,
  <li key="esc">Pulsa <kbd>Esc</kbd> dos veces para detener una respuesta.</li>,
];

export function Welcome() {
  return (
    <div className="welcome">
      <div className="welcome-logo">
        <img src={logo} className="welcome-logo-img" alt="Frida Code" />
      </div>
      <h1>Softtek</h1>
      <p className="welcome-sub">Tu asistente de código sobre Frida DevEngine.</p>
      <ul className="tips">{TIPS}</ul>
    </div>
  );
}
