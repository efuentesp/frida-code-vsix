import type { Usage } from "../types";

function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1000) return (n / 1000).toFixed(n >= 10_000 ? 0 : 1) + "k";
  return String(n);
}

export function ContextBar({ usage }: { usage: Usage }) {
  const pct = Math.round(usage.contextPercent);
  const level = pct >= 90 ? "high" : pct >= 70 ? "mid" : "low";
  const hasCache = usage.cacheRead > 0 || usage.cacheWrite > 0;
  return (
    <div className="status-bar">
      <span className="ctx-label">Contexto</span>
      <span className={"ctx-bar " + level}>
        <span className="ctx-fill" style={{ width: Math.min(100, pct) + "%" }} />
      </span>
      <span className="ctx-pct">{pct}%</span>
      <span className="ctx-tokens">
        {usage.contextWindow > 0 ? `${fmt(usage.contextTokens)} / ${fmt(usage.contextWindow)}` : "…"}
      </span>
      {(usage.inputTotal > 0 || usage.outputTotal > 0) && (
        <>
          <span className="ctx-sep">·</span>
          <span className="ctx-stats">
            <span>↑{fmt(usage.inputTotal)}</span>
            <span>↓{fmt(usage.outputTotal)}</span>
            {hasCache && <span>R{fmt(usage.cacheRead)}</span>}
            {hasCache && <span>W{fmt(usage.cacheWrite)}</span>}
            {usage.cacheHitRate !== undefined && <span>CH{usage.cacheHitRate.toFixed(0)}%</span>}
            {usage.cost > 0 && <span>${usage.cost.toFixed(3)}</span>}
          </span>
        </>
      )}
    </div>
  );
}
