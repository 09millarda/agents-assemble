import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { DaemonRowActions, buildDaemonRowOptions } from "./DaemonRowActions";

describe("buildDaemonRowOptions", () => {
  test("offers removal when the handler is provided", () => {
    const options = buildDaemonRowOptions(
      { daemonId: "daemon-1", machineName: "studio", status: "online" },
      { canDeregister: true }
    );

    expect(options).toEqual([
      { id: "deregister", label: "Remove", disabled: false },
    ]);
  });

  test("hides all options without a handler", () => {
    const options = buildDaemonRowOptions(
      { daemonId: "daemon-1", machineName: "studio", status: "online" },
      { canDeregister: false }
    );

    expect(options).toEqual([]);
  });

  test("offers removal while the daemon is offline", () => {
    const options = buildDaemonRowOptions(
      { daemonId: "daemon-2", machineName: "laptop", status: "offline" },
      { canDeregister: true }
    );

    expect(options.find((option) => option.id === "deregister")?.disabled).toBe(false);
  });
});

describe("DaemonRowActions", () => {
  test("renders a three-dots trigger with the menu closed", () => {
    const html = renderToString(
      <DaemonRowActions
        daemon={{ daemonId: "daemon-1", machineName: "studio", status: "online" }}
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
