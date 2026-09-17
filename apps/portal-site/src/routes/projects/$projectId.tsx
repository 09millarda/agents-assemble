import { Outlet } from "@tanstack/react-router";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/projects/$projectId")({
  component: () => <Outlet />,
});
