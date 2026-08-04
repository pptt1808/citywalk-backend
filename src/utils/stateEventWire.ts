import { StateEvent } from "../types/plan";

/** Keeps SSE payloads small while preserving inspectability of tool results. */
export function compactStateEventForWire(ev: StateEvent): StateEvent {
  const tc = ev.tool_call;
  if (!tc?.output) return ev;
  const out = tc.output;
  if (Array.isArray(out) && out.length > 12) {
    return {
      ...ev,
      tool_call: {
        ...tc,
        output: { _truncated: true, length: out.length, preview: out.slice(0, 6) }
      }
    };
  }
  const serialized = typeof out === "object" ? JSON.stringify(out) : String(out);
  if (serialized.length > 4000) {
    return {
      ...ev,
      tool_call: {
        ...tc,
        output: { _truncated: true, preview: serialized.slice(0, 2000) + "…" }
      }
    };
  }
  return ev;
}

export function compactStateEventsForWire(events: StateEvent[]): StateEvent[] {
  return events.map(compactStateEventForWire);
}
