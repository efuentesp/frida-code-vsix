import type { Usage } from "../types";

function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1000) return (n / 1000).toFixed(n >= 10_000 ? 0 : 1) + "k";
  return String(n);
}

export function ContextBar({ usage }: { usage: Usage }) {
  const pct = Math.round(usage.contextPercent);
  const level = pct >= 90 ? "high" : pct >= 70 ? "mid" : "low";
  return (
    <div className="status-bar">
      <span className="ctx-label">Contexto</span>
      <span className={"ctx-bar " + level}>
        <span className="ctx-fill" style={{ width: Math.min(100, pct) + "%" }} />
      </span>
      <span className="ctx-pct">{pct}%</span>
      <span className="ctx-tokens">
        {fmt(usage.inputTokens)} / {fmt(usage.contextWindow)}
      </span>
      <span className="ctx-sep">·</span>
      <span className="ctx-session">Sesión {fmt(usage.sessionTokens)} tok</span>
    </div>
  );
}
