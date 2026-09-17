import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
export interface AppServerTransport {
  request(
    method: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
  notify(method: string, params?: Record<string, unknown>): void;
  respond(id: string | number, result: unknown): void;
  onMessage: (message: Record<string, unknown>) => void;
  close(): void;
}

export class StdioAppServerTransport implements AppServerTransport {
  private readonly process: ChildProcessWithoutNullStreams;
  private nextId = 0;
  private readonly pending = new Map<
    number,
    {
      resolve: (value: Record<string, unknown>) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  onMessage: (message: Record<string, unknown>) => void = () => {};
  constructor(
    private readonly publishLog: (
      source: "harness-stdout" | "harness-stderr",
      payload: string,
    ) => void = () => {},
  ) {
    this.process = spawn("codex", ["app-server", "--listen", "stdio://"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stderr = "";
    this.process.stderr.on("data", (chunk: Buffer) => {
      const payload = chunk.toString();
      this.publishLog("harness-stderr", payload);
      stderr = (stderr + payload).slice(-16000);
    });
    this.process.stdout.on("data", (chunk: Buffer) => {
      this.publishLog("harness-stdout", chunk.toString());
    });
    createInterface({ input: this.process.stdout }).on("line", (line) => {
      try {
        const message = JSON.parse(line) as Record<string, unknown>;
        const pending =
          typeof message.id === "number" && !message.method
            ? this.pending.get(message.id)
            : undefined;
        if (pending) {
          this.pending.delete(message.id as number);
          clearTimeout(pending.timer);
          if (message.error)
            pending.reject(new Error(JSON.stringify(message.error)));
          else
            pending.resolve((message.result ?? {}) as Record<string, unknown>);
        } else this.onMessage(message);
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error(String(error)));
      }
    });
    this.process.on("error", (error) => this.fail(error));
    this.process.on("close", (code) =>
      this.fail(
        new Error(`Codex app-server closed (${String(code)}): ${stderr}`),
      ),
    );
  }
  private fail(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    this.onMessage({
      method: "factory/transportError",
      params: { message: error.message },
    });
  }
  request(
    method: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex app-server ${method} timed out.`));
      }, 30000);
      this.pending.set(id, { resolve, reject, timer });
      this.process.stdin.write(JSON.stringify({ id, method, params }) + "\n");
    });
  }
  notify(method: string, params?: Record<string, unknown>): void {
    this.process.stdin.write(
      JSON.stringify({ method, ...(params ? { params } : {}) }) + "\n",
    );
  }
  respond(id: string | number, result: unknown): void {
    this.process.stdin.write(JSON.stringify({ id, result }) + "\n");
  }
  close(): void {
    this.onMessage = () => {};
    this.process.stdin.end();
    this.process.kill("SIGTERM");
  }
}
