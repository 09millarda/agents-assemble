import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { DaemonRowActions, buildDaemonRowOptions } from "./DaemonRowActions";
import type { DaemonSummary } from "@factory/shared-domain";

function daemon(daemonId: string, machineName: string, status: "online" | "offline"): DaemonSummary {
  return { daemonId, machineName, displayName: machineName, status, maxParallelHarnesses: 1, appliedMaxParallelHarnesses: 1, activeHarnesses: 0, queuedCommands: 0 };
}

describe("buildDaemonRowOptions", () => {
  test("offers removal when the handler is provided", () => {
    const options = buildDaemonRowOptions(
      daemon("daemon-1", "studio", "online"),
      { canDeregister: true }
    );

    expect(options).toEqual([
      { id: "deregister", label: "Remove", disabled: false },
    ]);
  });

  test("hides all options without a handler", () => {
    const options = buildDaemonRowOptions(
      daemon("daemon-1", "studio", "online"),
      { canDeregister: false }
    );

    expect(options).toEqual([]);
  });

  test("offers removal while the daemon is offline", () => {
    const options = buildDaemonRowOptions(
      daemon("daemon-2", "laptop", "offline"),
      { canDeregister: true }
    );

    expect(options.find((option) => option.id === "deregister")?.disabled).toBe(false);
  });
});

describe("DaemonRowActions", () => {
  test("renders a three-dots trigger with the menu closed", () => {
    const html = renderToString(
      <DaemonRowActions
        daemon={daemon("daemon-1", "studio", "online")}
        canDeregister={true}
        onDeregister={() => {}}
      />
    );

    expect(html).toContain("Actions for studio");
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).not.toContain("Open chat");
    expect(html).not.toContain("Remove");
  });
});
