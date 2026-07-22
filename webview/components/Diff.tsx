export function Diff({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div className="diff">
      {lines.map((line, i) => {
        const cls = line.startsWith("+ ") ? "ln add" : line.startsWith("- ") ? "ln del" : "ln ctx";
        return (
          <div key={i} className={cls}>
            {line}
          </div>
        );
      })}
    </div>
  );
}
