import { describe, expect, test } from "bun:test";
import {
  DaemonConfigurationSchema,
  DaemonDtoSchema,
  DeregisterDaemonResponseSchema,
  ListDaemonsQuerySchema,
} from "./daemonDto";
import { encodeCursor } from "../../../../../infrastructure/http/pagination";

describe("DaemonDto", () => {
  const daemon = {
    daemonId: "d1",
    machineName: "workstation",
    displayName: "Builder",
    status: "online",
    maxParallelHarnesses: 2,
    appliedMaxParallelHarnesses: 1,
    activeHarnesses: 1,
    queuedCommands: 0,
  };

  test("rejects a blank machine name", () => {
    expect(DaemonDtoSchema.safeParse({ ...daemon, machineName: "  " }).success).toBe(false);
  });

  test("rejects an unknown status", () => {
    expect(DaemonDtoSchema.safeParse({ ...daemon, status: "ghost" }).success).toBe(false);
  });

  test("accepts deregistered as a terminal status", () => {
    expect(
      DaemonDtoSchema.safeParse({ ...daemon, status: "deregistered" }).success
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

describe("DaemonConfiguration", () => {
  const configuration = {
    displayName: "Build machine",
    maxParallelHarnesses: 1,
    location: "London",
    deviceLabel: "Workstation",
    purpose: "Feature delivery",
    ownerTeam: "Platform",
    tags: ["linux"],
    notes: "",
  };

  test("accepts a complete configuration with capacity from one through ten", () => {
    expect(DaemonConfigurationSchema.parse(configuration)).toEqual(
      configuration,
    );
    expect(
      DaemonConfigurationSchema.parse({
        ...configuration,
        maxParallelHarnesses: 10,
      }).maxParallelHarnesses,
    ).toBe(10);
  });

  test("rejects blank display names and capacity above ten", () => {
    expect(
      DaemonConfigurationSchema.safeParse({
        ...configuration,
        displayName: "  ",
      }).success,
    ).toBe(false);
    expect(
      DaemonConfigurationSchema.safeParse({
        ...configuration,
        maxParallelHarnesses: 11,
      }).success,
    ).toBe(false);
  });
});
