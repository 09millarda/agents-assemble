import {
  OpenAPIHono,
  createRoute,
  type RouteHandler,
} from "@hono/zod-openapi";
import { saveDaemonConfiguration } from "../../../../features/daemon-connection/application/commands/saveDaemonConfiguration";
import type {
  DaemonConfigurationDeliveryPort,
  DaemonConfigurationPort,
} from "../../../../features/daemon-connection/domain/DaemonConfigurationPort";
import {
  DaemonConfigurationSchema,
  DaemonDetailsSchema,
  DaemonParamsSchema,
} from "../../../../features/daemon-connection/adapters/inbound/dto/daemonDto";
import {
  PROBLEM_MEDIA_TYPE,
  ProblemDetailSchema,
  buildProblemDetail,
} from "../../../../infrastructure/http/problemDetails";

const saveDaemonConfigurationRoute = createRoute({
  method: "post",
  path: "/v1/daemons/{daemonId}/configuration",
  request: {
    params: DaemonParamsSchema,
    body: {
      content: {
        "application/json": { schema: DaemonConfigurationSchema },
      },
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: DaemonDetailsSchema } },
      description: "Desired daemon configuration saved.",
    },
    404: {
      content: {
        "application/problem+json": { schema: ProblemDetailSchema },
      },
      description: "Unknown daemon id.",
    },
    422: {
      content: {
        "application/problem+json": { schema: ProblemDetailSchema },
      },
      description: "Invalid daemon configuration.",
    },
  },
});

export function registerSaveDaemonConfigurationRoute(
  app: OpenAPIHono,
  dependencies: {
    registry: DaemonConfigurationPort;
    delivery: DaemonConfigurationDeliveryPort;
  },
): void {
  app.openapi(saveDaemonConfigurationRoute, (async (context) => {
    const result = await saveDaemonConfiguration(
      dependencies.registry,
      dependencies.delivery,
      context.req.valid("param").daemonId,
      context.req.valid("json"),
    );
    if (result.ok) return context.json(result.value, 200);
    const status = result.error.code === "DAEMON_NOT_FOUND" ? 404 : 422;
    return context.json(
      buildProblemDetail({
        status,
        code: result.error.code,
        detail: result.error.message,
        instance: context.req.path,
      }),
      status,
      { "content-type": PROBLEM_MEDIA_TYPE },
    );
  }) as RouteHandler<typeof saveDaemonConfigurationRoute>);
}
