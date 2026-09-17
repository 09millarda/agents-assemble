import { describe, expect, test } from "bun:test";
import { buildProblemDetail } from "./problemDetails";

describe("buildProblemDetail", () => {
  test("returns an RFC 9457 shape with known-good literals", () => {
    expect(
      buildProblemDetail({ status: 403, code: "ACCESS_DENIED", detail: "Device authorization was denied.", instance: "/v1/device/token" })
    ).toEqual({
      type: "https://factory.local/problems/access-denied",
      title: "Forbidden",
      status: 403,
      detail: "Device authorization was denied.",
      code: "ACCESS_DENIED",
      instance: "/v1/device/token",
    });
  });

  test("defaults the title from the status code", () => {
    expect(buildProblemDetail({ status: 410, code: "EXPIRED_TOKEN", detail: "Expired.", instance: "/v1/device/token" }).title).toBe("Gone");
    expect(buildProblemDetail({ status: 422, code: "VALIDATION_FAILED", detail: "Bad.", instance: "/v1/daemons" }).title).toBe(
      "Unprocessable Entity"
    );
  });
});
