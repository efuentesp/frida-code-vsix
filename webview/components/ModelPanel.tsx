import type { ProviderOption } from "../types";
import { Tooltip } from "./Tooltip";
import { Check, Dot, LogIn, LogOut, X } from "lucide-react";

export function ModelPanel({
  providers,
  active,
  deviceCode,
  onClose,
  onSelect,
  onLogin,
  onLogout,
}: {
  providers: ProviderOption[];
  active?: { provider: string; modelId: string };
  deviceCode?: { userCode: string; verificationUri: string };
  onClose: () => void;
  onSelect: (provider: string, model: string) => void;
  onLogin: (provider: string) => void;
  onLogout: (provider: string) => void;
}) {
  return (
    <div className="sessions-overlay" onClick={onClose}>
      <div className="sessions-panel" onClick={(e) => e.stopPropagation()}>
        <div className="sessions-head">
          <span>Modelos y proveedores</span>
          <Tooltip label="Cerrar" side="top">
            <button className="icon-btn" onClick={onClose}><X size={15} /></button>
          </Tooltip>
        </div>

        {deviceCode && (
          <div className="oauth-banner">
            <div className="oauth-title">Iniciando sesión…</div>
            <div className="oauth-hint">Abre el navegador y entra este código:</div>
            <div className="oauth-code">{deviceCode.userCode}</div>
            <a className="oauth-link" href={deviceCode.verificationUri} target="_blank" rel="noreferrer">
              {deviceCode.verificationUri}
            </a>
          </div>
        )}

        <div className="sessions-list">
          {providers.map((p) => {
            const isActiveProvider = active?.provider === p.id;
            return (
              <div key={p.id} className="provider-block">
                <div className="provider-head">
                  <span className="provider-name">
                    {p.name}
                    {p.oauth && <span className="provider-tag">suscripción</span>}
                  </span>
                  <span className={"provider-badge " + (p.authed ? "ok" : "off")}>
                    {p.authed ? <><Check size={12} /> conectado</> : "sin conexión"}
                  </span>
                  {p.oauth && (
                    p.authed ? (
                      <Tooltip label="Cerrar sesión" side="top">
                        <button className="icon-btn" onClick={() => onLogout(p.id)}><LogOut size={14} /></button>
                      </Tooltip>
                    ) : (
                      <Tooltip label="Iniciar sesión" side="top">
                        <button className="icon-btn primary" onClick={() => onLogin(p.id)}><LogIn size={14} /> Iniciar sesión</button>
                      </Tooltip>
                    )
                  )}
                </div>
                <div className="model-list">
                  {p.models.map((mm) => {
                    const selected = isActiveProvider && active?.modelId === mm.id;
                    const disabled = !p.authed;
                    return (
                      <button
                        key={mm.id}
                        className={"model-row" + (selected ? " selected" : "") + (disabled ? " disabled" : "")}
                        disabled={disabled}
                        onClick={() => onSelect(p.id, mm.id)}
                      >
                        <span className="model-radio">{selected && <Dot size={16} />}</span>
                        <span className="model-name">{mm.name}</span>
                      </button>
                    );
                  })}
                  {p.models.length === 0 && <div className="model-empty">Sin modelos disponibles.</div>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
