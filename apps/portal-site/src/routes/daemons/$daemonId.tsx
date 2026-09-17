import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import type { DaemonDetails } from "@factory/shared-domain";
import { HttpDaemonRegistryAdapter } from "../../features/daemon-connection/adapters/HttpDaemonRegistryAdapter";
import { DaemonDetail } from "../../features/daemon-connection/components/DaemonDetail";

function DaemonDetailPage() {
  const { daemonId } = Route.useParams();
  const registry = useMemo(() => new HttpDaemonRegistryAdapter(), []);
  const [details, setDetails] = useState<DaemonDetails | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void registry.getDaemon(daemonId).then(
      (loaded) => { if (!cancelled) setDetails(loaded); },
      (failure: unknown) => { if (!cancelled) setError(failure instanceof Error ? failure.message : "Failed to load daemon details."); },
    );
    return () => { cancelled = true; };
  }, [daemonId, registry]);

  if (error) return <p role="alert">{error}</p>;
  if (!details) return <p>Loading daemon…</p>;
  return <DaemonDetail initialDetails={details} registry={registry} />;
}

export const Route = createFileRoute("/daemons/$daemonId")({ component: DaemonDetailPage });
