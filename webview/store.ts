import type { InMessage, State, Turn } from "./types";

export const initialState: State = {
  keyNeeded: false,
  turns: [],
  approvals: [],
  nextId: 1,
};

function withLast(turns: Turn[], fn: (t: Turn) => Turn): Turn[] {
  if (turns.length === 0) return turns;
  const last = turns[turns.length - 1];
  return [...turns.slice(0, -1), fn(last)];
}

export function reduce(state: State, msg: InMessage): State {
  switch (msg.type) {
    case "need_key":
      return { ...state, keyNeeded: true };
    case "key_set":
    case "session_ready":
      return { ...state, keyNeeded: false };

    case "user": {
      const turn: Turn = { id: state.nextId, user: msg.text, assistantMd: "", status: null, tools: [] };
      return { ...state, turns: [...state.turns, turn], nextId: state.nextId + 1 };
    }
    case "turn_start":
      return { ...state, turns: withLast(state.turns, (t) => ({ ...t, status: "thinking" })) };

    case "delta":
      return {
        ...state,
        turns: withLast(state.turns, (t) => ({ ...t, assistantMd: t.assistantMd + msg.text })),
      };

    case "tool_start":
      return {
        ...state,
        turns: withLast(state.turns, (t) => ({
          ...t,
          status: "executing",
          executingTool: msg.tool,
          tools: [...t.tools, { tool: msg.tool, args: msg.args ?? "", state: "running" }],
        })),
      };

    case "tool_end":
      return {
        ...state,
        turns: withLast(state.turns, (t) => {
          let done = false;
          const tools = t.tools.map((tc) => {
            if (!done && tc.state === "running" && tc.tool === msg.tool) {
              done = true;
              return { ...tc, state: (msg.isError ? "error" : "ok") as "error" | "ok" };
            }
            return tc;
          });
          return { ...t, tools };
        }),
      };

    case "turn_end":
      return {
        ...state,
        turns: withLast(state.turns, (t) => ({ ...t, status: null, executingTool: undefined })),
      };

    case "approvals":
      return { ...state, approvals: msg.approvals };

    case "error":
      return { ...state, turns: withLast(state.turns, (t) => ({ ...t, error: msg.text })) };

    default:
      return state;
  }
}
