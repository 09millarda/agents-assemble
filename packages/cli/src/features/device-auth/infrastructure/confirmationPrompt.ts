import { createInterface } from "node:readline";

export const CONFIRMATION_PROMPT = "Hit Enter to continue: ";

export async function waitForConfirmationFromStdin(): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const finishResolve = (): void => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const finishReject = (): void => {
      if (settled) return;
      settled = true;
      reject(new Error("Login cancelled before approval."));
    };
    process.stdin.resume();
    const readline = createInterface({ input: process.stdin, output: process.stdout });
    readline.on("close", () => {
      finishReject();
    });
    readline.question(CONFIRMATION_PROMPT, () => {
      finishResolve();
      readline.close();
    });
  });
}

export async function confirmDaemonDeletionFromStdin(daemonId: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    process.stdin.resume();
    const readline = createInterface({ input: process.stdin, output: process.stdout });
    readline.question(`Delete daemon ${daemonId}? Type the daemon ID to confirm: `, (answer) => {
      readline.close();
      resolve(answer.trim() === daemonId);
    });
  });
}
