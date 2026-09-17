import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { DaemonList } from "./DaemonList";

async function renderWithRouter(ui: React.ReactElement): Promise<string> {
  const rootRoute = createRootRoute({ component: () => ui });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  return renderToString(<RouterProvider router={router} />);
}

describe("DaemonList", () => {
  test("empty registry hints at cli auth login and device approval", async () => {
    const html = await renderWithRouter(
      <DaemonList
        daemons={[]}
        onRefresh={() => {}}
        isLoading={false}
      />
    );
    expect(html).toContain("No daemons match");
    expect(html).toContain("cli auth login");
  });

  test("surfaces load errors", async () => {
    const html = await renderWithRouter(
      <DaemonList
        daemons={[]}
        onRefresh={() => {}}
        isLoading={false}
        loadError="Factory API is down."
      />
    );
    expect(html).toContain("Factory API is down");
  });

  test("lists daemons with status and a row actions menu", async () => {
    const html = await renderWithRouter(
      <DaemonList
        daemons={[
          { daemonId: "daemon-1", machineName: "studio", status: "online" },
          { daemonId: "daemon-2", machineName: "laptop", status: "offline" },
        ]}
        onRefresh={() => {}}
        isLoading={false}
      />
    );
    expect(html).toContain("studio");
    expect(html).toContain("laptop");
    expect(html).toContain("online");
    expect(html).toContain("Actions for studio");
    expect(html).toContain("Actions for laptop");
    expect(html).not.toContain('href="/daemons/daemon-1"');
    expect(html).not.toContain('href="/daemons/daemon-2"');
    expect(html).not.toContain("Open chat");
  });

  test("row actions stay behind the menu trigger with or without a deregister handler", async () => {
    async function renderWithDeregister(withHandler: boolean): Promise<string> {
      return renderWithRouter(
        <DaemonList
          daemons={[{ daemonId: "daemon-1", machineName: "studio", status: "online" }]}
          onRefresh={() => {}}
          isLoading={false}
          {...(withHandler ? { onDeregisterDaemon: async () => {} } : {})}
        />
      );
    }
    for (const withHandler of [true, false]) {
      const html = await renderWithDeregister(withHandler);
      expect(html).toContain("Actions for studio");
      expect(html).not.toContain("Open chat");
      expect(html).not.toContain("Remove");
    }
  });
});
