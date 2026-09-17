const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export interface AuthorizationWaitIndicator {
  start(): void;
  stop(): void;
}

interface WaitIndicatorOutput {
  write(chunk: string): void;
  isTTY?: boolean;
}

export function createAuthorizationWaitIndicator(
  output: WaitIndicatorOutput = process.stdout,
  intervalMs = 80
): AuthorizationWaitIndicator {
  let timer: ReturnType<typeof setInterval> | null = null;
  let started = false;
  let frame = 0;
  return {
    start(): void {
      if (started) return;
      started = true;
      if (output.isTTY !== true) {
        output.write("Waiting for authorization...\n");
        return;
      }
      timer = setInterval(() => {
        output.write(`\rWaiting for authorization ${FRAMES[frame % FRAMES.length]}`);
        frame += 1;
      }, intervalMs);
      const withUnref = timer as unknown as { unref?: () => void };
      if (typeof withUnref.unref === "function") withUnref.unref();
    },
    stop(): void {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
        output.write("\r\x1b[K\n");
      }
      started = false;
    },
  };
}
