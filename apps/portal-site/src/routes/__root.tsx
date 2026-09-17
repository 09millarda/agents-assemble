import { Link, Outlet, createRootRoute, useLocation } from "@tanstack/react-router";
import {
  Activity,
  ArrowUpRight,
  Boxes,
  ChevronDown,
  Factory,
  LayoutDashboard,
  MonitorCog,
  Radio,
  RefreshCw,
  Sparkles,
  Workflow,
} from "lucide-react";
import { Avatar, AvatarFallback } from "../components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import { Separator } from "../components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../components/ui/tooltip";
import { ToastProvider } from "../components/ui/toast";
import { isDaemonReachable } from "@factory/shared-domain";
import { Button } from "../components/ui/button";
import {
  DaemonRegistryProvider,
  useDaemonRegistry,
} from "../features/daemon-connection/adapters/DaemonRegistryProvider";
import { cn } from "../lib/utils";

const NAV = [
  { to: "/", label: "Overview", icon: LayoutDashboard },
  { to: "/daemons", label: "Daemons", icon: MonitorCog },
  { to: "/projects", label: "Projects", icon: Boxes },
  { to: "/workflows", label: "Workflows", icon: Workflow },
  { to: "/activity", label: "Activity", icon: Activity },
] as const;

function isNavItemActive(pathname: string, path: string): boolean {
  return path === "/" ? pathname === "/" : pathname.startsWith(path);
}

function BrandMark({ compact = false, onDark = true }: { compact?: boolean; onDark?: boolean }) {
  return (
    <div className={cn("flex items-center gap-3", compact && "gap-2")}>
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#f6b756] text-[#18243a] shadow-[0_6px_16px_rgba(246,183,86,0.2)]">
        <Factory className="h-4 w-4" strokeWidth={2.4} />
      </span>
      <span className="min-w-0">
        <span className={cn("block truncate text-sm font-bold tracking-[-0.02em]", onDark ? "text-white" : "text-[#18243a]")}>Factory Console</span>
        {!compact ? <span className={cn("block truncate text-xs", onDark ? "text-[#94a6c1]" : "text-muted-foreground")}>Agent Software Factory</span> : null}
      </span>
    </div>
  );
}

function SidebarNav({ pathname }: { pathname: string }) {
  return (
    <nav className="grid gap-1.5" aria-label="Console">
      <p className="mb-2 px-3 text-[11px] font-bold uppercase tracking-[0.14em] text-[#71839f]">Workspace</p>
      {NAV.map((item) => {
        const Icon = item.icon;
        const isActive = isNavItemActive(pathname, item.to);
        return (
          <Link
            key={item.to}
            to={item.to}
            className={cn(
              "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors",
              isActive
                ? "bg-[#f6b756] text-[#18243a] shadow-[0_6px_20px_rgba(246,183,86,0.13)]"
                : "text-[#aebbd0] hover:bg-white/[0.07] hover:text-white",
            )}
          >
            <Icon className={cn("h-[18px] w-[18px]", isActive ? "text-[#18243a]" : "text-[#8294b0] group-hover:text-[#f6b756]")} />
            {item.label}
            {isActive ? <ArrowUpRight className="ml-auto h-4 w-4" /> : null}
          </Link>
        );
      })}
    </nav>
  );
}

function MobileNav({ pathname }: { pathname: string }) {
  return (
    <nav className="grid grid-cols-5 gap-1 px-3 pb-3 md:hidden" aria-label="Console">
      {NAV.map((item) => {
        const Icon = item.icon;
        const isActive = isNavItemActive(pathname, item.to);
        return (
          <Link
            key={item.to}
            to={item.to}
            className={cn(
              "flex min-w-0 flex-col items-center gap-1 rounded-xl px-1 py-2 text-xs font-semibold transition-colors",
              isActive ? "bg-[#f6b756] text-[#18243a]" : "text-[#aebbd0] hover:bg-white/[0.07] hover:text-white",
            )}
          >
            <Icon className="h-4 w-4" />
            <span className="truncate">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function ConnectionHealth() {
  const { daemons, isLoading, refreshDaemons } = useDaemonRegistry();
  const totalCount = daemons.length;
  const onlineCount = daemons.filter((daemon) => isDaemonReachable(daemon.status)).length;

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3.5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-[#c0cce0]">
          <Radio className="h-4 w-4 text-[#f6b756]" />
          Connection health
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-lg text-[#8294b0] hover:bg-white/[0.08] hover:text-white"
              onClick={() => void refreshDaemons()}
              disabled={isLoading}
              aria-label="Refresh daemon connection health"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", isLoading && "animate-spin")} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Refresh daemon connection health</TooltipContent>
        </Tooltip>
      </div>
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-2xl font-bold tracking-[-0.04em] text-white">{onlineCount}</p>
          <p className="text-xs text-[#8294b0]">of {totalCount} daemons online</p>
        </div>
        <span className="mb-1 inline-flex items-center gap-1.5 text-xs font-semibold text-[#8ed4ad]">
          <span className="h-1.5 w-1.5 rounded-full bg-[#65c88d] shadow-[0_0_0_4px_rgba(101,200,141,0.12)]" />
          Live
        </span>
      </div>
    </div>
  );
}

function ConsoleShell() {
  const location = useLocation();
  const isFloatingDeviceRoute = location.pathname.startsWith("/device");
  const currentSection = NAV.find((item) => isNavItemActive(location.pathname, item.to))?.label ?? "Console";

  if (isFloatingDeviceRoute) {
    return (
      <TooltipProvider>
        <ToastProvider>
          <div className="portal-grid flex min-h-screen flex-col bg-[#101a2e] text-white">
            <header className="border-b border-white/10 px-5 py-4 md:px-8">
              <div className="mx-auto max-w-5xl">
                <BrandMark />
              </div>
            </header>
            <main className="mx-auto grid w-full max-w-5xl flex-1 place-items-center p-5 md:p-10">
              <Outlet />
            </main>
          </div>
        </ToastProvider>
      </TooltipProvider>
    );
  }

  return (
    <DaemonRegistryProvider>
      <TooltipProvider>
        <ToastProvider>
          <div className="flex min-h-screen bg-transparent text-foreground">
            <aside className="sticky top-0 hidden h-screen w-[264px] shrink-0 flex-col overflow-y-auto bg-[#101a2e] px-4 py-5 md:flex">
              <div className="px-2 pb-8">
                <BrandMark />
              </div>
              <SidebarNav pathname={location.pathname} />
              <div className="mt-auto">
                <Separator className="mb-5 bg-white/10" />
                <ConnectionHealth />
                <p className="mt-4 px-2 text-xs leading-5 text-[#687b98]">Machines stay on your network. The portal is your control surface.</p>
              </div>
            </aside>

            <div className="flex min-w-0 flex-1 flex-col">
              <header className="sticky top-0 z-20 border-b border-border/70 bg-[#f7f9fc]/90 backdrop-blur-xl">
                <div className="flex min-h-[72px] items-center justify-between gap-4 px-5 md:px-8">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="md:hidden">
                      <BrandMark compact onDark={false} />
                    </div>
                    <div className="hidden min-w-0 md:block">
                      <p className="portal-eyebrow">Workspace / live</p>
                      <h1 className="truncate text-lg font-bold tracking-[-0.03em]">{currentSection}</h1>
                    </div>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button type="button" className="flex items-center gap-2 rounded-full p-1.5 pr-2 transition-colors hover:bg-[#edf2f7]" aria-label="Open workspace menu">
                          <Avatar className="h-8 w-8">
                            <AvatarFallback className="bg-[#172842] text-xs font-bold text-[#f6b756]">AF</AvatarFallback>
                          </Avatar>
                          <span className="hidden text-left sm:block">
                            <span className="block text-xs font-bold leading-4">Local workspace</span>
                            <span className="block text-[11px] leading-4 text-muted-foreground">Connected</span>
                          </span>
                          <ChevronDown className="hidden h-4 w-4 text-muted-foreground sm:block" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-56">
                        <DropdownMenuLabel className="font-semibold">Workspace actions</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem asChild>
                          <Link to="/device" search={{ code: undefined }}><Sparkles className="h-4 w-4" /> Connect a machine</Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem asChild>
                          <Link to="/activity"><Activity className="h-4 w-4" /> Open activity</Link>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
                <MobileNav pathname={location.pathname} />
              </header>
              <main className="portal-grid mx-auto w-full max-w-[1480px] flex-1 p-5 md:p-8">
                <Outlet />
              </main>
            </div>
          </div>
        </ToastProvider>
      </TooltipProvider>
    </DaemonRegistryProvider>
  );
}

export const Route = createRootRoute({ component: ConsoleShell });
