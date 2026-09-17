import {
  OpenAPIHono,
  createRoute,
  type RouteHandler,
} from "@hono/zod-openapi";
import { getDaemon } from "../../../../features/daemon-connection/application/queries/getDaemon";
import type { DaemonPresencePort } from "../../../../features/daemon-connection/domain/DaemonConnectionPort";
import type {
  DaemonQueryPort,
  DaemonTelemetryPort,
} from "../../../../features/daemon-connection/domain/DaemonConfigurationPort";
import {
  DaemonDetailsSchema,
  DaemonParamsSchema,
} from "../../../../features/daemon-connection/adapters/inbound/dto/daemonDto";
import {
  PROBLEM_MEDIA_TYPE,
  ProblemDetailSchema,
  buildProblemDetail,
} from "../../../../infrastructure/http/problemDetails";

const getDaemonRoute = createRoute({
  method: "get",
  path: "/v1/daemons/{daemonId}",
  request: { params: DaemonParamsSchema },
  responses: {
    200: {
      content: { "application/json": { schema: DaemonDetailsSchema } },
      description: "Daemon configuration, runtime facts, and live telemetry.",
    },
    404: {
      content: {
        "application/problem+json": { schema: ProblemDetailSchema },
      },
      description: "Unknown daemon id.",
    },
  },
});

export function registerGetDaemonRoute(
  app: OpenAPIHono,
  dependencies: {
    registry: DaemonQueryPort;
    presence: DaemonPresencePort;
    telemetry: DaemonTelemetryPort;
  },
): void {
  app.openapi(getDaemonRoute, (async (context) => {
    const result = await getDaemon(
      dependencies.registry,
      dependencies.presence,
      dependencies.telemetry,
      context.req.valid("param").daemonId,
    );
    if (result.ok) return context.json(result.value, 200);
    return context.json(
      buildProblemDetail({
        status: 404,
        code: result.error.code,
        detail: result.error.message,
        instance: context.req.path,
      }),
      404,
      { "content-type": PROBLEM_MEDIA_TYPE },
    );
  }) as RouteHandler<typeof getDaemonRoute>);
}
