import { createFileRoute } from "@tanstack/react-router";
import { MonitorCog } from "lucide-react";
import { DaemonList } from "../../features/daemon-connection/components/DaemonList";
import { useDaemonRegistry } from "../../features/daemon-connection/adapters/DaemonRegistryProvider";

function DaemonsPage() {
  const { daemons, isLoading, error, refreshDaemons, deregisterDaemon } = useDaemonRegistry();

  return (
    <div className="grid gap-6">
      <div>
        <p className="portal-eyebrow">Workspace / connections</p>
        <h1 className="portal-display mt-2 flex items-center gap-3 text-3xl font-bold tracking-tight text-[#18243a] md:text-4xl">
          <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[#e6eefb] text-[#3b5f9e]"><MonitorCog className="h-5 w-5" /></span>
          Daemons
        </h1>
        <p className="mt-2 text-base leading-7 text-muted-foreground">Search, filter, and manage the machine-run daemons connected to your Factory API.</p>
      </div>
      <DaemonList
        daemons={daemons}
        onRefresh={() => void refreshDaemons()}
        isLoading={isLoading}
        loadError={error}
        onDeregisterDaemon={async (daemonId) => {
          await deregisterDaemon(daemonId);
        }}
      />
    </div>
  );
}

export const Route = createFileRoute("/daemons/")({ component: DaemonsPage });
