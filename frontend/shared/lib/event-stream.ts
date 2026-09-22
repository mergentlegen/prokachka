// Streaming responses can split an event (or a UTF-8 character) at any byte.
export class EventStreamParser {
  private buffer = "";
  constructor(private onEvent: (event: string, data: string) => void) {}
  push(chunk: string) {
    this.buffer += chunk;
    if (this.buffer.length > 64_000) throw new Error("Oversized event stream");
    for (;;) {
      const match = /\r?\n\r?\n/.exec(this.buffer);
      if (!match) break;
      const frame = this.buffer.slice(0, match.index);
      this.buffer = this.buffer.slice(match.index + match[0].length);
      let event = "message";
      const data: string[] = [];
      for (const line of frame.split(/\r?\n/)) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
      }
      if (data.length) this.onEvent(event, data.join("\n"));
    }
  }
}
