import { Tooltip } from "./Tooltip";
import { Codicon } from "./Codicon";

export function ForkPanel({
  points,
  onClose,
  onFork,
}: {
  points: { entryId: string; text: string }[];
  onClose: () => void;
  onFork: (entryId: string) => void;
}) {
  return (
    <div className="sessions-overlay" onClick={onClose}>
      <div className="sessions-panel" onClick={(e) => e.stopPropagation()}>
        <div className="sessions-head">
          <span
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <Codicon name="git-branch" size={14} /> Bifurcar desde un mensaje
          </span>
          <Tooltip label="Cerrar" side="top">
            <button className="icon-btn" onClick={onClose}>
              <Codicon name="close" size={15} />
            </button>
          </Tooltip>
        </div>
        <div className="sessions-list">
          {points.map((p, i) => (
            <button
              key={p.entryId}
              className="fork-row"
              onClick={() => {
                onFork(p.entryId);
                onClose();
              }}
            >
              <span className="fork-idx">#{points.length - i}</span>
              <span className="fork-text">
                {p.text.slice(0, 140) || "(vacío)"}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
