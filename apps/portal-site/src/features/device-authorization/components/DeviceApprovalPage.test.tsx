import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { AuthorizedDeviceCard, DeviceApprovalPage, readInitialUserCodeFromHash, readInitialUserCodeFromSearch } from "./DeviceApprovalPage";

describe("readInitialUserCodeFromHash", () => {
  test("prefills a valid dashed code from the device deep link", () => {
    expect(readInitialUserCodeFromHash("#/device?code=ABCD-2345")).toBe("ABCD-2345");
  });

  test("accepts an undashed code via normalization", () => {
    expect(readInitialUserCodeFromHash("#/device?code=abcd2345")).toBe("ABCD-2345");
  });

  test("returns empty for a missing or invalid code", () => {
    expect(readInitialUserCodeFromHash("#/device")).toBe("");
    expect(readInitialUserCodeFromHash("#/device?code=nope")).toBe("");
  });
});

describe("DeviceApprovalPage", () => {
  test("authorized state displays a completion card without approval controls", () => {
    const html = renderToString(<AuthorizedDeviceCard daemonId="daemon-1" />);

    expect(html).toContain("Machine authorized");
    expect(html).toContain("daemon-1");
    expect(html).toContain("can now connect");
    expect(html).toContain("You can now close this tab or window.");
    expect(html).not.toContain("Approve this machine");
    expect(html).not.toContain("User code");
    expect(html).not.toContain(">Approve<");
    expect(html).not.toContain(">Deny<");
  });

  test("renders prefilled code with the approve confirmation", () => {
    const html = renderToString(<DeviceApprovalPage initialUserCode="ABCD-2345" />);

    expect(html).toContain('value="ABCD-2345"');
    expect(html).toContain("Are you sure you want to approve this machine?");
    expect(html).toContain("matches the code in your terminal");
    expect(html).toContain("ABCD-2345");
    expect(html).toContain("Approve");
  });

  test("invalid initial code renders an empty input with no confirmation block", () => {
    const html = renderToString(<DeviceApprovalPage initialUserCode="nope" />);

    expect(html).toContain('value="nope"');
    expect(html).not.toContain("Are you sure you want to approve this machine?");
  });
});

describe("readInitialUserCodeFromSearch", () => {
  test("prefills a valid code from the router search params", () => {
    expect(readInitialUserCodeFromSearch("?code=ABCD-2345")).toBe("ABCD-2345");
    expect(readInitialUserCodeFromSearch("?code=abcd2345")).toBe("ABCD-2345");
  });

  test("returns empty for a missing or invalid code", () => {
    expect(readInitialUserCodeFromSearch("")).toBe("");
    expect(readInitialUserCodeFromSearch("?code=nope")).toBe("");
  });
});
