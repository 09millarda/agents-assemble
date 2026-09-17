import { MoreVertical } from "lucide-react";
import type { DaemonSummary } from "@factory/shared-domain";
import { Button } from "../../../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";

export type DaemonRowOptionId = "deregister";

export interface DaemonRowOption {
  id: DaemonRowOptionId;
  label: string;
  disabled: boolean;
}

export function buildDaemonRowOptions(
  daemon: DaemonSummary,
  actions: { canDeregister: boolean }
): DaemonRowOption[] {
  const options: DaemonRowOption[] = [];
  if (actions.canDeregister) options.push({ id: "deregister", label: "Remove", disabled: false });
  return options;
}

export function DaemonRowActions({
  daemon,
  canDeregister,
  onDeregister,
}: {
  daemon: DaemonSummary;
  canDeregister: boolean;
  onDeregister: (daemon: DaemonSummary) => void;
}) {
  function chooseOption(option: DaemonRowOption): void {
    if (option.disabled) return;
    if (option.id === "deregister") onDeregister(daemon);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" size="icon" variant="ghost" aria-label={`Actions for ${daemon.machineName}`}>
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        {buildDaemonRowOptions(daemon, { canDeregister }).map((option) => (
          <DropdownMenuItem
            key={option.id}
            disabled={option.disabled}
            onSelect={() => chooseOption(option)}
            className={option.id === "deregister" ? "text-[#a32929] focus:text-[#a32929]" : undefined}
          >
            {option.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
