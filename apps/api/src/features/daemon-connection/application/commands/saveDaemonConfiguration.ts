import type {
  DaemonConfiguration,
  DaemonDetails,
  DaemonId,
  DomainError,
  Result,
} from "@factory/shared-domain";
import { isDaemonHarnessCapacityValid } from "@factory/shared-domain";
import type {
  DaemonConfigurationDeliveryPort,
  DaemonConfigurationPort,
} from "../../domain/DaemonConfigurationPort";

export async function saveDaemonConfiguration(
  registry: DaemonConfigurationPort,
  delivery: DaemonConfigurationDeliveryPort,
  daemonId: DaemonId,
  configuration: DaemonConfiguration,
): Promise<Result<DaemonDetails, DomainError>> {
  if (!isDaemonHarnessCapacityValid(configuration.maxParallelHarnesses)) {
    return {
      ok: false,
      error: {
        code: "INVALID_DAEMON_CONFIGURATION",
        message:
          "Parallel harness capacity must be a whole number from 1 to 10.",
      },
    };
  }
  const daemon = await registry.saveDesiredConfiguration(
    daemonId,
    configuration,
  );
  if (!daemon) {
    return {
      ok: false,
      error: {
        code: "DAEMON_NOT_FOUND",
        message: "Daemon not found.",
      },
    };
  }
  delivery.sendConfiguration(
    daemonId,
    daemon.configuration.revision,
    daemon.configuration.desired,
  );
  return { ok: true, value: daemon };
}
