import { createFileRoute } from "@tanstack/react-router";
import { DeviceApprovalPage, formatUserCodeForDisplay } from "../../features/device-authorization/components/DeviceApprovalPage";

function DevicePage() {
  const search = Route.useSearch() as { code?: string };
  const initialUserCode = search.code ? formatUserCodeForDisplay(search.code) ?? undefined : undefined;
  return <DeviceApprovalPage initialUserCode={initialUserCode} />;
}

export const Route = createFileRoute("/device/")({
  component: DevicePage,
  validateSearch: (search: Record<string, unknown>) => ({
    code: typeof search.code === "string" ? search.code : undefined,
  }),
});
