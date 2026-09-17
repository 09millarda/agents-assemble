import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import type { DaemonCapabilityPort } from "../../../../features/workflow-delivery/domain/DaemonCapabilityPort";
import { HarnessCapabilitySchema } from "../../../../features/workflow-delivery/adapters/inbound/dto/harnessCapabilityDto";

const daemonCapabilitiesResponseSchema = z.object({
  data: z.array(HarnessCapabilitySchema),
  pagination: z.object({ nextCursor: z.null(), limit: z.number() }),
});

const getDaemonCapabilitiesRoute = createRoute({
  method: "get",
  path: "/v1/daemons/{daemonId}/capabilities",
  request: { params: z.object({ daemonId: z.string().min(1) }) },
  responses: {
    200: {
      description: "Currently available harness capabilities.",
      content: { "application/json": { schema: daemonCapabilitiesResponseSchema } },
    },
  },
});

export function registerGetDaemonCapabilitiesRoute(
  app: OpenAPIHono,
  dependencies: { capabilities: DaemonCapabilityPort },
): void {
  app.openapi(getDaemonCapabilitiesRoute, (context) =>
    context.json(
      {
        data: dependencies.capabilities.getCapabilities(context.req.valid("param").daemonId),
        pagination: { nextCursor: null, limit: 100 },
      },
      200,
    ),
  );
}
