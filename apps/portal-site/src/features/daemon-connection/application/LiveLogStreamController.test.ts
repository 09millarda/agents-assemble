import { describe, expect, test } from "bun:test";
import { LiveLogStreamController } from "./LiveLogStreamController";

class FakeClock {
  now = 0;
  nextId = 0;
  timers = new Map<number, { due: number; callback: () => void }>();

  schedule = (callback: () => void, delay: number) => {
    const id = ++this.nextId;
    this.timers.set(id, { due: this.now + delay, callback });
    return id;
  };
  clear = (id: number | ReturnType<typeof setTimeout>) => {
    this.timers.delete(id as number);
  };
  advance(milliseconds: number): void {
    const target = this.now + milliseconds;
    for (;;) {
      const next = [...this.timers.entries()]
        .filter(([, timer]) => timer.due <= target)
        .sort((left, right) => left[1].due - right[1].due)[0];
      if (!next) break;
      this.now = next[1].due;
      this.timers.delete(next[0]);
      next[1].callback();
    }
    this.now = target;
  }
}

describe("LiveLogStreamController", () => {
  test("requires acknowledgement, warns at 4:30, pauses at 5:00, and resumes new-only", () => {
    const clock = new FakeClock();
    const streams: Array<{ closed: boolean }> = [];
    const states: unknown[] = [];
    const controller = new LiveLogStreamController({
      openStream: () => {
        const stream = { closed: false };
        streams.push(stream);
        return { close: () => { stream.closed = true; } };
      },
      onStateChange: (state) => states.push(state),
      schedule: clock.schedule,
      clearScheduled: clock.clear,
    });

    expect(controller.getState()).toEqual({ status: "locked", secondsRemaining: null });
    controller.acknowledgeAndStart();
    expect(streams).toHaveLength(1);
    clock.advance(270_000);
    expect(controller.getState()).toEqual({ status: "warning", secondsRemaining: 30 });
    clock.advance(30_000);
    expect(controller.getState()).toEqual({ status: "paused", secondsRemaining: null });
    expect(streams[0]?.closed).toBe(true);

    controller.continueStreaming();
    expect(streams).toHaveLength(2);
    expect(controller.getState().status).toBe("streaming");
    expect(states.length).toBeGreaterThan(0);
  });

  test("meaningful interaction resets inactivity and leaving the tab closes the stream", () => {
    const clock = new FakeClock();
    let closes = 0;
    const controller = new LiveLogStreamController({
      openStream: () => ({ close: () => { closes += 1; } }),
      onStateChange: () => {},
      schedule: clock.schedule,
      clearScheduled: clock.clear,
    });
    controller.acknowledgeAndStart();
    clock.advance(260_000);
    controller.recordMeaningfulInteraction();
    clock.advance(20_000);
    expect(controller.getState().status).toBe("streaming");

    controller.setActive(false);
    expect(controller.getState().status).toBe("inactive");
    expect(closes).toBe(1);
    controller.setActive(true);
    expect(controller.getState().status).toBe("streaming");
    controller.dispose();
    expect(closes).toBe(2);
  });
});
