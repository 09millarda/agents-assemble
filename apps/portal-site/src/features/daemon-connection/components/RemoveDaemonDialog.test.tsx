import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { REMOVE_CONFIRM_TEXT, RemoveDaemonDialog } from "./RemoveDaemonDialog";

describe("RemoveDaemonDialog", () => {
  test("asks for the word confirm in plain language", () => {
    const html = renderToString(
      <RemoveDaemonDialog machineName="studio" isConfirming={false} confirmError={null} onConfirm={() => {}} onCancel={() => {}} />
    );
    expect(html).toContain('aria-label="Remove studio"');
    expect(html).toContain("disconnects the machine straight away");
    expect(html).toContain("Type confirm to remove");
    expect(html).toContain(REMOVE_CONFIRM_TEXT);
    expect(html).not.toContain("registry");
    expect(html).not.toContain("token");
  });

  test("surfaces confirm errors", () => {
    const html = renderToString(
      <RemoveDaemonDialog
        machineName="studio"
        isConfirming={false}
        confirmError="Failed to remove daemon."
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );
    expect(html).toContain("Failed to remove daemon.");
  });
});
