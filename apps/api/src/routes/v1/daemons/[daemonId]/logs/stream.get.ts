import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { streamSSE } from "hono/streaming";
import { DaemonParamsSchema } from "../../../../../features/daemon-connection/adapters/inbound/dto/daemonDto";
import type { DaemonQueryPort } from "../../../../../features/daemon-connection/domain/DaemonConfigurationPort";
import type { DaemonLogSubscriptionPort } from "../../../../../features/daemon-connection/domain/DaemonLogPort";
import {
  PROBLEM_MEDIA_TYPE,
  ProblemDetailSchema,
  buildProblemDetail,
} from "../../../../../infrastructure/http/problemDetails";

const StreamDaemonLogsQuerySchema = z.object({
  acknowledgeSensitiveData: z.literal("true"),
});

const streamDaemonLogsRoute = createRoute({
  method: "get",
  path: "/v1/daemons/{daemonId}/logs/stream",
  request: {
    params: DaemonParamsSchema,
    query: StreamDaemonLogsQuerySchema,
  },
  responses: {
    200: {
      content: { "text/event-stream": { schema: z.string() } },
      description: "New-only, connection-scoped daemon diagnostics.",
    },
    404: {
      content: { "application/problem+json": { schema: ProblemDetailSchema } },
      description: "Daemon not found.",
    },
    422: {
      content: { "application/problem+json": { schema: ProblemDetailSchema } },
      description: "Sensitive-data acknowledgement is required.",
    },
  },
});

export function registerStreamDaemonLogsRoute(
  app: OpenAPIHono,
  dependencies: {
    registry: DaemonQueryPort;
    logs: DaemonLogSubscriptionPort;
  },
): void {
  app.openapi(streamDaemonLogsRoute, async (context) => {
    const { daemonId } = context.req.valid("param");
    if (!(await dependencies.registry.findDaemon(daemonId))) {
      return context.json(
        buildProblemDetail({
          status: 404,
          code: "DAEMON_NOT_FOUND",
          detail: `No daemon ${daemonId} exists.`,
          instance: context.req.path,
        }),
        404,
        { "content-type": PROBLEM_MEDIA_TYPE },
      );
    }
    return streamSSE(context, async (stream) => {
      let finish!: () => void;
      const closed = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const unsubscribe = dependencies.logs.subscribe(daemonId, async (event) => {
        try {
          if (event.type === "dropped") {
            await stream.writeSSE({
              event: "daemon.logs.dropped",
              data: JSON.stringify({ droppedCount: event.droppedCount }),
            });
            return;
          }
          await stream.writeSSE({
            id: event.log.eventId,
            event: "daemon.log",
            data: JSON.stringify(event.log),
          });
        } catch {
          finish();
        }
      });
      stream.onAbort(() => finish());
      try {
        await closed;
      } finally {
        unsubscribe();
      }
    });
  });
}
