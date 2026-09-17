import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { buildSpecFactoryApi, generateFactoryOpenApiDocument } from "./factoryApi";

const SPEC_URL = new URL("../../../openapi.json", import.meta.url);

describe("factory OpenAPI document", () => {
  test("the committed spec matches the generated document", () => {
    expect(JSON.parse(readFileSync(SPEC_URL, "utf8"))).toEqual(generateFactoryOpenApiDocument());
  });

  test("the v1 surface is declared on OpenAPI 3.1", () => {
    const document = generateFactoryOpenApiDocument() as { openapi: string; paths: Record<string, unknown> };
    expect(document.openapi).toBe("3.1.0");
    expect(Object.keys(document.paths).sort()).toEqual([
      "/health",
      "/v1/browser-recipients",
      "/v1/browser-recipients/{recipientId}",
      "/v1/browser-recipients/{recipientId}/subscription",
      "/v1/daemons",
      "/v1/daemons/{daemonId}",
      "/v1/daemons/{daemonId}/capabilities",
      "/v1/daemons/{daemonId}/configuration",
      "/v1/daemons/{daemonId}/deregister",
      "/v1/daemons/{daemonId}/logs/stream",
      "/v1/device/approve",
      "/v1/device/authorizations",
      "/v1/device/authorizations/{deviceCode}",
      "/v1/device/deny",
      "/v1/device/token",
      "/v1/documents/{revisionId}",
      "/v1/projects",
      "/v1/projects/{projectId}/assign",
      "/v1/projects/{projectId}/enabled-workflows",
      "/v1/projects/{projectId}/name",
      "/v1/projects/{projectId}/settings",
      "/v1/workflow-runs",
      "/v1/workflow-runs/{runId}",
      "/v1/workflow-runs/{runId}/commands",
      "/v1/workflow-runs/{runId}/documents",
      "/v1/workflow-runs/{runId}/human-interactions",
      "/v1/workflow-runs/{runId}/notifications",
      "/v1/workflows",
      "/v1/workflows/{workflowId}",
      "/v1/workflows/{workflowId}/delete",
      "/v1/workflows/{workflowId}/publish",
      "/v1/workflows/{workflowId}/unpublish",
      "/v1/workflows/{workflowId}/update",
    ]);
  });
});

describe("factory OpenAPI endpoints", () => {
  test("serves the generated spec and the docs UI", async () => {
    const app = buildSpecFactoryApi();

    const spec = await app.request("/v1/openapi.json");
    expect(spec.status).toBe(200);
    expect((await spec.json() as { openapi: string }).openapi).toBe("3.1.0");

    const docs = await app.request("/v1/docs");
    expect(docs.status).toBe(200);
    expect(docs.headers.get("content-type")).toContain("text/html");
  });
});

describe("factory health contract", () => {
  test("health is declared in the spec and served live", async () => {
    const app = buildSpecFactoryApi();

    const response = await app.request("/health");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });

    const document = generateFactoryOpenApiDocument() as { paths: Record<string, unknown> };
    expect(Object.keys(document.paths)).toContain("/health");
  });
});
