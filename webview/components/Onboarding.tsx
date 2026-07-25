import { useState } from "react";
import { Bot, KeyRound, Sparkles } from "lucide-react";

export function Onboarding({
  deviceCode,
  onSubmit,
  onLoginCopilot,
}: {
  deviceCode?: { userCode: string; verificationUri: string };
  onSubmit: (key: string) => void;
  onLoginCopilot: () => void;
}) {
  const [provider, setProvider] = useState<"softtek" | "copilot">("softtek");
  const [key, setKey] = useState("");

  return (
    <div className="overlay">
      <h2>
        <span className="avatar ai">
          <Bot size={15} />
        </span>{" "}
        Frida Code
      </h2>
      <p className="onb-intro">Elige cómo conectarte para empezar.</p>

      <div className="onb-providers">
        <button
          className={"onb-opt" + (provider === "softtek" ? " selected" : "")}
          onClick={() => setProvider("softtek")}
        >
          <KeyRound size={16} />
          <div>
            <div className="onb-opt-title">Softtek DevEngine</div>
            <div className="onb-opt-sub">API key (X-Api-Key)</div>
          </div>
        </button>
        <button
          className={"onb-opt" + (provider === "copilot" ? " selected" : "")}
          onClick={() => setProvider("copilot")}
        >
          <Sparkles size={16} />
          <div>
            <div className="onb-opt-title">GitHub Copilot</div>
            <div className="onb-opt-sub">Suscripción · inicia sesión con GitHub</div>
          </div>
        </button>
      </div>

      {provider === "softtek" ? (
        <>
          <input
            type="password"
            placeholder="mwr-sk-..."
            value={key}
            onChange={(e) => setKey(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && key.trim()) onSubmit(key.trim());
            }}
          />
          <button onClick={() => key.trim() && onSubmit(key.trim())}>Guardar key y empezar</button>
        </>
      ) : deviceCode ? (
        <div className="oauth-banner">
          <div className="oauth-title">Iniciando sesión…</div>
          <div className="oauth-hint">Entra este código en el navegador que se abrió:</div>
          <div className="oauth-code">{deviceCode.userCode}</div>
          <a className="oauth-link" href={deviceCode.verificationUri} target="_blank" rel="noreferrer">
            {deviceCode.verificationUri}
          </a>
        </div>
      ) : (
        <button className="primary-btn" onClick={onLoginCopilot}>
          Iniciar sesión con GitHub
        </button>
      )}
    </div>
  );
}
