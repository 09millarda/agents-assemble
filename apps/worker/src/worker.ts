import { PUBLIC_ORGANIZATION } from "@aa/community/service";
import { DomainError } from "@aa/platform/contracts";
import { newId } from "@aa/platform/crypto";
import { z } from "zod";
import type { Application } from "../../api/src/app.ts";
import { scopeConsumerSchema } from "../../api/src/project-consumer.ts";

export class Worker {
  private incarnation = newId();
  private enrolled = new Set<string>();
  constructor(private app: Application) {}
  async once() {
    let delivered = 0;
    const organizations = await this.app.access.organizations();
    for (const org of organizations) {
      for (const consumer of scopeConsumerSchema.options) {
        const identity = `${org.id}:${consumer}`;
        if (!this.enrolled.has(identity)) {
          await this.app.projects.enrollConsumer(org.id, consumer, this.incarnation);
          this.enrolled.add(identity);
        }
        for (const checkpoint of await this.app.projects.consumerCheckpoints(
          org.id,
          consumer,
          this.incarnation,
        )) {
          const receipt = await this.app[consumer].installProjectCheckpoint(org.id, checkpoint);
          await this.app.projects.acknowledgeCheckpoint(org.id, receipt);
        }
      }
      let after = await this.app.catalog.communityCheckpoint(org.id);
      for (;;) {
        const page = await this.app.stores.community.messages(PUBLIC_ORGANIZATION, {
          after,
          limit: 200,
        });
        if (!page.length) break;
        for (const entry of page)
          await this.app.catalog.acceptCommunityPolicy(org.id, entry.message);
        after = page.at(-1)?.message.id;
        if (after) await this.app.catalog.advanceCommunityCheckpoint(org.id, after);
        if (page.length < 200) break;
      }
    }
    for (const source of Object.values(this.app.stores))
      for (const message of await source.pending()) {
        try {
          // Each consumer owns its own transaction and inbox. A killed relay safely
          // repeats the same source identity, including after partial fan-out.
          if (message.source === "community")
            for (const org of organizations)
              await this.app.catalog.acceptCommunityPolicy(org.id, message);
          if (message.source === "execution") await this.app.catalog.acceptExecutionPolicy(message);
          const local =
            message.source === "access" && message.type === "access.revoked"
              ? {
                  ...message,
                  organizationId: z.object({ organizationId: z.uuid() }).parse(message.payload)
                    .organizationId,
                }
              : message;
          await this.app.projects.accept(local);
          await this.app.execution.accept(local);
          await this.app.human.accept(local);
          await this.app.integrations.accept(local);
          await source.markDelivered(message.id);
          delivered++;
        } catch (error) {
          await source.markFailed(
            message.id,
            error instanceof DomainError
              ? error.code
              : error instanceof Error
                ? error.message.slice(0, 160)
                : "delivery_failed",
          );
        }
      }
    for (const org of organizations) {
      try {
        await this.app.human.tick(org.id);
        await this.app.execution.tick(org.id);
        await this.app.integrations.tick(org.id);
      } catch (error) {
        process.stderr.write(
          `${JSON.stringify({ event: "scheduler_wait", organizationId: org.id, code: error instanceof DomainError ? error.code : error instanceof Error ? error.message.slice(0, 160) : "scheduler_unavailable" })}\n`,
        );
      }
    }
    await Promise.all(
      Object.values(this.app.stores).map((store) => store.observeWorker(this.incarnation)),
    );
    return { delivered };
  }
}
