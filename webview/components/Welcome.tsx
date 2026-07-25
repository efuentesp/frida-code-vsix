import { useState } from "react";
import { Brain, Key, Lightbulb, RotateCw } from "lucide-react";
import logo from "../assets/frida-logo.png";

// Cada característica se renderiza como JSX (no markdown) para resaltar atajos con <code>/<kbd>.
// El mismo contenido se reutiliza para el "tip del día" y para la lista completa de instrucciones.
interface Feature {
  key: string;
  title: string;
  body: React.ReactNode;
}

const FEATURES: Feature[] = [
  {
    key: "files",
    title: "Archivos e imágenes",
    body: (
      <>
        escribe <code>@</code> para adjuntar archivos (búsqueda difusa, navega carpetas con{" "}
        <code>/</code>, comillas para espacios: <code>@&quot;ruta con espacios&quot;</code>). Pega una{" "}
        <strong>imagen</strong> del portapapeles para enviarla al modelo (visión).
      </>
    ),
  },
  {
    key: "bash",
    title: "Bash rápido",
    body: (
      <>
        <code>!comando</code> envía el resultado al modelo; <code>!!comando</code> lo ejecuta sin
        enviarlo (solo lo ves tú).
      </>
    ),
  },
  {
    key: "slash",
    title: "Comandos /",
    body: (
      <>
        <em>skills</em> y <em>prompts</em>, además de acciones <code>/compact</code>{" "}
        <code>/reload</code> <code>/new</code> <code>/model</code> <code>/login</code>{" "}
        <code>/name</code> <code>/copy</code> <code>/clone</code> <code>/fork</code>{" "}
        <code>/help</code>. Filtra escribiendo, <kbd>↑</kbd>/<kbd>↓</kbd> navega,{" "}
        <kbd>Enter</kbd> selecciona.
      </>
    ),
  },
  {
    key: "send",
    title: "Envío",
    body: (
      <>
        <kbd>Enter</kbd> envía · <kbd>Shift</kbd>+<kbd>Enter</kbd> salto de línea ·{" "}
        <kbd>Alt</kbd>+<kbd>Enter</kbd> encola un <em>follow-up</em>. <kbd>↑</kbd>/<kbd>↓</kbd>{" "}
        recupera mensajes anteriores. Botón <strong>expandir</strong> para prompts largos.
      </>
    ),
  },
  {
    key: "ctx",
    title: "Contexto y razonamiento",
    body: (
      <>
        la barra inferior muestra uso del contexto y tokens (<code>↑↓ RW CH</code>). Botón de
        razonamiento (<Brain size={12} />) para ocultar/mostrar el <em>thinking</em>; <code>/compact</code> resume el
        contexto y se puede cancelar.
      </>
    ),
  },
  {
    key: "model",
    title: "Modelos y sesión",
    body: (
      <>
        elige proveedor/modelo en el selector (Softtek o GitHub Copilot, con <code>/login</code> para
        suscripciones); botón API key (<Key size={12} />) para rotarla. Copia cualquier turno con su icono.{" "}
        <code>/fork</code> y <code>/clone</code> bifurcan la conversación.
      </>
    ),
  },
  {
    key: "resources",
    title: "Recursos",
    body: (
      <>
        <em>skills</em>, <em>prompts</em> y extensiones se cargan de <code>~/.pi/agent</code> (global)
        y <code>.pi</code> (proyecto). Botón <strong>Recursos</strong> para verlos;{" "}
        <strong>Recargar</strong> tras añadirlos.
      </>
    ),
  },
  {
    key: "esc",
    title: "Detener respuesta",
    body: (
      <>
        pulsa <kbd>Esc</kbd> dos veces para detener una respuesta en curso.
      </>
    ),
  },
];

export function Welcome() {
  // Un tip aleatorio al cargar; no cambia salvo que el usuario lo pida.
  const [tipIndex, setTipIndex] = useState(() => Math.floor(Math.random() * FEATURES.length));

  const nextTip = () => {
    if (FEATURES.length <= 1) return;
    setTipIndex((prev) => {
      let n = Math.floor(Math.random() * FEATURES.length);
      while (n === prev) n = Math.floor(Math.random() * FEATURES.length);
      return n;
    });
  };

  const tip = FEATURES[tipIndex];

  return (
    <div className="welcome">
      <div className="welcome-logo">
        <img src={logo} className="welcome-logo-img" alt="Frida Code" />
      </div>
      <h1>Softtek</h1>
      <p className="welcome-sub">Tu asistente de código sobre Frida DevEngine.</p>

      <div className="tip-day">
        <div className="tip-day-label">
          <span><Lightbulb size={12} /> Tip del día</span>
          <button
            className="tip-day-refresh"
            onClick={nextTip}
            title="Ver otro tip"
            aria-label="Ver otro tip"
          >
            <RotateCw size={13} />
          </button>
        </div>
        <p className="tip-day-body">
          <strong>{tip.title}:</strong> {tip.body}
        </p>
      </div>

      <details className="welcome-help">
        <summary>Ver todas las instrucciones</summary>
        <ul className="tips">
          {FEATURES.map((f) => (
            <li key={f.key}>
              <strong>{f.title}:</strong> {f.body}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
