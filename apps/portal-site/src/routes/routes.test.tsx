import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { routeTree } from "../routeTree.gen";
import { createPortalRouter } from "../router";

function createFakeBrowserWindow(hash: string) {
  const fakeHistory = {
    state: null as Record<string, unknown> | null,
    length: 1,
    replaceState(nextState: Record<string, unknown>) {
      fakeHistory.state = nextState;
    },
    pushState() {},
    back() {},
    forward() {},
    go() {},
  };

  return {
    location: {
      pathname: "/",
      search: "",
      hash,
      href: `http://localhost:3000/${hash}`,
    },
    history: fakeHistory,
    addEventListener() {},
    removeEventListener() {},
    document: { baseURI: "http://localhost:3000/" },
  };
}

async function renderAtPortalHash(hash: string): Promise<string> {
  const router = createPortalRouter(createFakeBrowserWindow(hash));
  await router.load();
  const html = renderToString(<RouterProvider router={router} />);
  router.history.destroy();
  return html;
}

async function renderAtPath(path: string): Promise<string> {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await router.load();
  return renderToString(<RouterProvider router={router} />);
}

async function matchedRouteIds(path: string): Promise<string[]> {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await router.load();
  return router.state.matches.map((match) => match.routeId);
}

describe("console routes", () => {
  test("hash device deep links match the device approval route", async () => {
    const router = createPortalRouter(createFakeBrowserWindow("#/device?code=ABCD-2345"));

    await router.load();

    expect(router.state.location.pathname).toBe("/device");
    expect(router.state.location.search).toEqual({ code: "ABCD-2345" });
    router.history.destroy();
  });

  test("hash device deep links prefill the approval code", async () => {
    const html = await renderAtPortalHash("#/device?code=ABCD-2345");

    expect(html).toContain('value="ABCD-2345"');
  });

  test("desktop sidebar stays pinned at viewport height", async () => {
    const html = await renderAtPath("/projects/project-7");
    const sidebarClassName = html.match(/<aside class="([^"]+)"/)?.[1] ?? "";

    expect(sidebarClassName.split(/\s+/)).toEqual(
      expect.arrayContaining(["h-screen", "sticky", "top-0", "overflow-y-auto"]),
    );
  });

  test("shell renders console nav on overview without Device", async () => {
    const html = await renderAtPath("/");
    expect(html).toContain("Factory Console");
    expect(html).toContain("Overview");
    expect(html).toContain("Daemons");
    expect(html).toContain("Projects");
    expect(html).toContain("Workflows");
    expect(html).toContain("Activity");
    expect(html).not.toContain(">Device<");
    expect(html).not.toContain("/device");
  });

  test("connection health exposes the daemon refresh control and 30-second cadence", async () => {
    const html = await renderAtPath("/");

    expect(html).toContain("Connection health");
    expect(html).toContain('aria-label="Refresh daemon connection health"');
    expect(html).toContain('title="Daemon status refreshes every 30 seconds"');
  });

  test("daemon management route has no conversation controls", async () => {
    const html = await renderAtPath("/daemons");
    expect(html).toContain("manage the machine-run daemons");
    expect(html).toContain("Refreshing daemons");
    expect(html).not.toContain("streaming conversation");
    expect(html).not.toContain("Open chat");
  });

  test("daemon detail route is no longer registered", async () => {
    expect(await matchedRouteIds("/daemons/daemon-1")).toEqual(["__root__"]);
  });

  test("device route floats outside the console shell", async () => {
    const html = await renderAtPath("/device");
    expect(html).toContain("Approve this machine");
    expect(html).toContain("User code");
    expect(html).not.toContain('aria-label="Console"');
    expect(html).not.toContain("daemons online");
    expect(html).not.toContain(">Daemons<");
  });
});

describe("workflow and project routes", () => {
  test("workflows index renders the global workflow section", async () => {
    const html = await renderAtPath("/workflows");
    expect(html).toContain("Workflows");
    expect(html).toContain("All workflows");
    expect(html).toContain("Create workflow");
    expect(html).not.toContain("Starter blueprint");
    expect(html).not.toContain("Create editable starter");
  });

  test("project detail route carries the projectId param", async () => {
    const html = await renderAtPath("/projects/project-7");
    expect(html).toContain("grid gap-4");
    expect(html).not.toContain("Execution settings");
    expect(html).not.toContain("Enabled workflows");
  });

  test("project settings route is registered separately from project runs", async () => {
    expect(await matchedRouteIds("/projects/project-7/settings")).toEqual([
      "__root__",
      "/projects/$projectId",
      "/projects/$projectId/settings",
    ]);
  });

  test("workflow detail and editor routes are separate", async () => {
    expect(await matchedRouteIds("/workflows/workflow-7")).toEqual([
      "__root__",
      "/workflows/$workflowId",
      "/workflows/$workflowId/",
    ]);
    expect(await matchedRouteIds("/workflows/workflow-7/edit")).toEqual([
      "__root__",
      "/workflows/$workflowId",
      "/workflows/$workflowId/edit",
    ]);
  });

  test("new run route is registered separately from project runs", async () => {
    expect(await matchedRouteIds("/projects/project-7/runs/new")).toEqual([
      "__root__",
      "/projects/$projectId",
      "/projects/$projectId/runs/new",
    ]);
  });
});
