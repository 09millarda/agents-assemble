export type LiveLogStreamStatus =
  | "locked"
  | "inactive"
  | "streaming"
  | "warning"
  | "paused";

export interface LiveLogStreamState {
  status: LiveLogStreamStatus;
  secondsRemaining: number | null;
}

interface ClosableStream {
  close(): void;
}

const WARNING_AFTER_MS = 4 * 60_000 + 30_000;
const PAUSE_AFTER_MS = 5 * 60_000;

export class LiveLogStreamController {
  private state: LiveLogStreamState = { status: "locked", secondsRemaining: null };
  private acknowledged = false;
  private active = true;
  private stream: ClosableStream | null = null;
  private warningTimer: ReturnType<typeof setTimeout> | number | null = null;
  private pauseTimer: ReturnType<typeof setTimeout> | number | null = null;
  private countdownTimer: ReturnType<typeof setTimeout> | number | null = null;

  constructor(private readonly dependencies: {
    openStream: () => ClosableStream;
    onStateChange: (state: LiveLogStreamState) => void;
    schedule?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout> | number;
    clearScheduled?: (timer: ReturnType<typeof setTimeout> | number) => void;
  }) {}

  getState(): LiveLogStreamState {
    return this.state;
  }

  acknowledgeAndStart(): void {
    this.acknowledged = true;
    if (this.active) this.openNewStream();
  }

  continueStreaming(): void {
    if (!this.acknowledged || !this.active) return;
    this.openNewStream();
  }

  recordMeaningfulInteraction(): void {
    if (!this.stream) return;
    this.setState({ status: "streaming", secondsRemaining: null });
    this.scheduleInactivity();
  }

  dismissWarning(): void {
    if (this.state.status === "warning") {
      this.setState({ status: "streaming", secondsRemaining: null });
    }
  }

  setActive(active: boolean): void {
    if (this.active === active) return;
    this.active = active;
    if (!active) {
      this.closeStream();
      this.setState({ status: "inactive", secondsRemaining: null });
      return;
    }
    if (this.acknowledged) this.openNewStream();
    else this.setState({ status: "locked", secondsRemaining: null });
  }

  dispose(): void {
    this.closeStream();
  }

  private openNewStream(): void {
    this.closeStream();
    this.stream = this.dependencies.openStream();
    this.setState({ status: "streaming", secondsRemaining: null });
    this.scheduleInactivity();
  }

  private scheduleInactivity(): void {
    this.clearTimers();
    this.warningTimer = this.schedule(() => {
      this.setState({ status: "warning", secondsRemaining: 30 });
      this.scheduleCountdown(29);
    }, WARNING_AFTER_MS);
    this.pauseTimer = this.schedule(() => this.pause(), PAUSE_AFTER_MS);
  }

  private scheduleCountdown(secondsRemaining: number): void {
    if (secondsRemaining <= 0 || !this.stream) return;
    this.countdownTimer = this.schedule(() => {
      if (this.state.status === "warning") {
        this.setState({ status: "warning", secondsRemaining });
      }
      this.scheduleCountdown(secondsRemaining - 1);
    }, 1_000);
  }

  private pause(): void {
    this.closeStream();
    this.setState({ status: "paused", secondsRemaining: null });
  }

  private closeStream(): void {
    this.clearTimers();
    this.stream?.close();
    this.stream = null;
  }

  private clearTimers(): void {
    for (const timer of [this.warningTimer, this.pauseTimer, this.countdownTimer]) {
      if (timer !== null) this.clear(timer);
    }
    this.warningTimer = null;
    this.pauseTimer = null;
    this.countdownTimer = null;
  }

  private schedule(callback: () => void, delayMs: number) {
    return (this.dependencies.schedule ?? setTimeout)(callback, delayMs);
  }

  private clear(timer: ReturnType<typeof setTimeout> | number): void {
    (this.dependencies.clearScheduled ?? clearTimeout)(timer as ReturnType<typeof setTimeout>);
  }

  private setState(state: LiveLogStreamState): void {
    this.state = state;
    this.dependencies.onStateChange(state);
  }
}
