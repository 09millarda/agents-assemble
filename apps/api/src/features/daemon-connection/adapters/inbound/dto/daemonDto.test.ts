import { describe, expect, test } from "bun:test";
import { DaemonDtoSchema, DeregisterDaemonResponseSchema, ListDaemonsQuerySchema } from "./daemonDto";
import { encodeCursor } from "../../../../../infrastructure/http/pagination";

describe("DaemonDto", () => {
  test("rejects a blank machine name", () => {
    expect(DaemonDtoSchema.safeParse({ daemonId: "d1", machineName: "  ", status: "online" }).success).toBe(false);
  });

  test("rejects an unknown status", () => {
    expect(DaemonDtoSchema.safeParse({ daemonId: "d1", machineName: "workstation", status: "ghost" }).success).toBe(false);
  });

  test("accepts deregistered as a terminal status", () => {
    expect(
      DaemonDtoSchema.safeParse({ daemonId: "d1", machineName: "workstation", status: "deregistered" }).success
    ).toBe(true);
  });
});

describe("ListDaemonsQuery", () => {
  test("defaults the limit to 20", () => {
    expect(ListDaemonsQuerySchema.parse({}).limit).toBe(20);
  });

  test("rejects a limit above 100", () => {
    expect(ListDaemonsQuerySchema.safeParse({ limit: "101" }).success).toBe(false);
  });

  test("rejects a tampered cursor", () => {
    expect(ListDaemonsQuerySchema.safeParse({ cursor: "!!!not-base64!!!" }).success).toBe(false);
  });

  test("accepts an encoded cursor", () => {
    expect(ListDaemonsQuerySchema.parse({ cursor: encodeCursor("daemon-1") }).cursor).toBeDefined();
  });
});

describe("DeregisterDaemonResponse", () => {
  test("accepts the bare deregistered DTO", () => {
    expect(DeregisterDaemonResponseSchema.parse({ daemonId: "d1", status: "deregistered" })).toEqual({
      daemonId: "d1",
      status: "deregistered",
    });
  });
});
