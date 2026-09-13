import {
  Activity,
  Blocks,
  BookOpen,
  ChevronRight,
  CircleHelp,
  FolderGit2,
  Globe2,
  LogOut,
  Menu,
  Monitor,
  Play,
  Settings2,
  ShieldCheck,
  Workflow,
  X,
} from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CommandForm, ErrorNotice, Loading, PageHeading } from "@/components/workspace";
import { type Credentials, request, useCommand, useResource } from "@/lib/api";

const Projects = lazy(() =>
  import("@/pages/projects").then((module) => ({ default: module.Projects })),
);
const Runs = lazy(() => import("@/pages/runs").then((module) => ({ default: module.Runs })));
const Catalog = lazy(() =>
  import("@/pages/catalog").then((module) => ({ default: module.Catalog })),
);
const Documents = lazy(() =>
  import("@/pages/documents").then((module) => ({ default: module.Documents })),
);
const Runners = lazy(() =>
  import("@/pages/runners").then((module) => ({ default: module.Runners })),
);
const Environments = lazy(() =>
  import("@/pages/environments").then((module) => ({ default: module.Environments })),
);
const Community = lazy(() =>
  import("@/pages/community").then((module) => ({ default: module.Community })),
);
const Organization = lazy(() =>
  import("@/pages/organization").then((module) => ({ default: module.Organization })),
);
const Operations = lazy(() =>
  import("@/pages/operations").then((module) => ({ default: module.Operations })),
);

const sessionSchema = z.object({
  user: z.object({ id: z.string(), email: z.string(), name: z.string() }),
  organizations: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      role: z.string(),
      authorityGeneration: z.number(),
    }),
  ),
});
type Session = z.infer<typeof sessionSchema>;
const navigation = [
  { path: "projects", label: "Projects", icon: FolderGit2 },
  { path: "runs", label: "Runs", icon: Play },
  { path: "catalog", label: "Playbooks", icon: Workflow },
  { path: "documents", label: "Planning", icon: BookOpen },
  { path: "runners", label: "Runners", icon: Monitor },
  { path: "environments", label: "Environments", icon: Settings2 },
  { path: "community", label: "Community", icon: Globe2 },
  { path: "organization", label: "Organization", icon: ShieldCheck },
  { path: "operations", label: "Operations", icon: Activity },
];
export function App() {
  const [route, setRoute] = useState(location.hash.slice(2) || "projects");
  const [menu, setMenu] = useState(false);
  const [token, setToken] = useState(sessionStorage.getItem("aa-token") ?? "");
  const [organizationId, setOrganizationId] = useState(
    sessionStorage.getItem("aa-organization") ?? "",
  );
  const [session, setSession] = useState<Session>();
  const [error, setError] = useState<Error>();
  const [loading, setLoading] = useState(Boolean(token));
  const callbackStarted = useRef(false);
  const logout = useCommand({ token, organizationId: "" });
  useEffect(() => {
    const parameters = new URLSearchParams(location.search);
    const code = parameters.get("code");
    const state = parameters.get("state");
    if (!code || !state || callbackStarted.current) return;
    callbackStarted.current = true;
    const storedState = sessionStorage.getItem("aa-workos-state");
    const proof = sessionStorage.getItem("aa-workos-proof");
    if (state !== storedState || !proof) {
      setError(
        new Error("This sign-in callback does not match the browser that started authentication."),
      );
      return;
    }
    const key = sessionStorage.getItem("aa-workos-operation") ?? crypto.randomUUID();
    sessionStorage.setItem("aa-workos-operation", key);
    setLoading(true);
    request(
      "/auth/workos/complete",
      z.object({ token: z.string(), expiresAt: z.string() }),
      undefined,
      { method: "POST", body: { state, proof, code }, key },
    )
      .then((result) => {
        sessionStorage.setItem("aa-token", result.token);
        setToken(result.token);
        for (const key of ["aa-workos-state", "aa-workos-proof", "aa-workos-operation"])
          sessionStorage.removeItem(key);
        history.replaceState(null, "", `${location.pathname}${location.hash}`);
      })
      .catch((failure: Error) => {
        setError(failure);
        setLoading(false);
      });
  }, []);
  useEffect(() => {
    const change = () => {
      setRoute(location.hash.slice(2) || "projects");
      setMenu(false);
    };
    addEventListener("hashchange", change);
    return () => removeEventListener("hashchange", change);
  }, []);
  useEffect(() => {
    if (!token) {
      setSession(undefined);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(undefined);
    request(
      "/auth/session",
      sessionSchema,
      { token, organizationId: "" },
      { signal: controller.signal },
    )
      .then((next) => {
        setSession(next);
        setLoading(false);
        setOrganizationId((current) =>
          next.organizations.some((organization) => organization.id === current)
            ? current
            : (next.organizations[0]?.id ?? ""),
        );
      })
      .catch((failure: Error) => {
        if (!controller.signal.aborted) {
          setError(failure);
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [token]);
  useEffect(() => {
    sessionStorage.setItem("aa-organization", organizationId);
  }, [organizationId]);
  const credentials: Credentials = { token, organizationId };
  const section = route.split("/")[0];
  const organization = session?.organizations.find((item) => item.id === organizationId);
  return (
    <div className="min-h-svh bg-slate-50/70">
      {/* biome-ignore lint/a11y/useValidAnchor: Same-page skip navigation focuses its target without replacing the route fragment. */}
      <a
        href="#main-content"
        className="skip-link rounded bg-white p-3"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("main-content")?.focus();
        }}
      >
        Skip to content
      </a>
      <aside
        className={`workspace-sidebar ${menu ? "is-open" : ""}`}
        aria-label="Workspace navigation"
      >
        <a href="#/projects" className="flex items-center gap-3 px-5 py-7">
          <span className="grid size-9 place-items-center rounded-lg bg-teal-400 text-slate-950">
            <Blocks className="size-5" />
          </span>
          <span className="text-sm font-semibold tracking-tight text-white">
            agents assemble
            <span className="mt-0.5 block text-[10px] font-medium tracking-[0.2em] text-slate-400">
              DELIVERY WORKSPACE
            </span>
          </span>
        </a>
        <div className="mx-4 mb-7 rounded-lg border border-slate-700/70 bg-slate-800/70 p-3">
          <label
            htmlFor="organization-switcher"
            className="mb-2 block text-[10px] font-medium uppercase tracking-widest text-slate-400"
          >
            Organization
          </label>
          {session ? (
            <select
              id="organization-switcher"
              value={organizationId}
              onChange={(event) => setOrganizationId(event.target.value)}
              className="w-full min-w-0 bg-transparent text-sm text-slate-100"
            >
              {session.organizations.map((item) => (
                <option className="bg-slate-900" key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          ) : (
            <p className="text-sm text-slate-300">Your team, connected</p>
          )}
        </div>
        <p className="px-6 pb-2 text-[10px] font-medium uppercase tracking-[0.18em] text-slate-500">
          Build & deliver
        </p>
        <nav className="space-y-1 px-3">
          {navigation.map(({ path, label, icon: Icon }) => (
            <a
              key={path}
              href={`#/${path}`}
              aria-current={section === path ? "page" : undefined}
              className={`flex min-h-10 items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${section === path ? "bg-slate-800 font-medium text-teal-300" : "text-slate-400 hover:bg-slate-800/70 hover:text-white"}`}
            >
              <Icon className="size-4" />
              {label}
              {section === path && <span className="ml-auto size-1.5 rounded-full bg-teal-400" />}
            </a>
          ))}
        </nav>
        <div className="mt-auto space-y-4 p-5">
          <a
            className="flex items-center gap-2 text-xs text-slate-400 hover:text-white"
            href="#/help"
          >
            <CircleHelp className="size-4" />
            Installation & help
          </a>
          <div className="border-t border-slate-800 pt-4">
            <p className="text-xs leading-5 text-slate-500">
              Customer-controlled execution.
              <br />
              Shared, durable coordination.
            </p>
          </div>
        </div>
      </aside>
      {menu && (
        <button
          type="button"
          className="fixed inset-0 z-20 bg-slate-950/40 md:hidden"
          aria-label="Close navigation"
          onClick={() => setMenu(false)}
        />
      )}
      <div className="md:ml-60">
        <header className="sticky top-0 z-10 flex h-16 items-center justify-between gap-4 border-b bg-white/95 px-5 backdrop-blur sm:px-9">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              aria-label={menu ? "Close navigation" : "Open navigation"}
              onClick={() => setMenu(!menu)}
            >
              {menu ? <X /> : <Menu />}
            </Button>
            <span className="hidden text-xs text-slate-400 sm:inline">Workspace</span>
            <ChevronRight className="hidden size-3 text-slate-300 sm:block" />
            <span className="text-sm font-medium">
              {navigation.find((item) => item.path === section)?.label ?? "Help"}
            </span>
          </div>
          <div className="flex items-center gap-3">
            {session && (
              <>
                <span className="hidden text-xs text-slate-500 sm:block">
                  {session.user.name || session.user.email}
                </span>
                <span className="grid size-8 place-items-center rounded-full border border-teal-100 bg-teal-50 text-xs font-semibold text-teal-800">
                  {(session.user.name || session.user.email).slice(0, 2).toUpperCase()}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Sign out"
                  disabled={logout.pending}
                  onClick={async () => {
                    try {
                      await logout.run("/auth/logout", {});
                    } catch (failure) {
                      setError(
                        failure instanceof Error
                          ? failure
                          : new Error("Sign-out was not confirmed."),
                      );
                      return;
                    }
                    sessionStorage.removeItem("aa-token");
                    setToken("");
                    setSession(undefined);
                  }}
                >
                  <LogOut className="size-4" />
                </Button>
              </>
            )}
            {!session && (
              <span className="text-xs text-slate-500">Open source · Self-hostable</span>
            )}
          </div>
        </header>
        <main
          id="main-content"
          className="mx-auto max-w-[1500px] px-5 py-8 sm:px-9 sm:py-10"
          tabIndex={-1}
        >
          <ErrorNotice error={session ? error : undefined} />
          {loading ? (
            <Loading />
          ) : section === "help" ? (
            <Help />
          ) : !session && section !== "community" ? (
            <>
              <ErrorNotice error={error} />
              <SignIn
                onLogin={(value) => {
                  sessionStorage.setItem("aa-token", value);
                  setToken(value);
                }}
              />
            </>
          ) : (
            <Suspense fallback={<Loading />}>
              <Workspace
                route={route}
                credentials={credentials}
                organizationName={organization?.name ?? "Public community"}
              />
            </Suspense>
          )}
        </main>
      </div>
    </div>
  );
}
function SignIn({ onLogin }: { onLogin: (token: string) => void }) {
  const provider = useResource("/auth/providers");
  const [hostedError, setHostedError] = useState<Error>();
  const [starting, setStarting] = useState(false);
  const [invitation, setInvitation] = useState(false);
  return (
    <div className="mx-auto grid max-w-4xl gap-10 py-10 lg:grid-cols-2 lg:items-center">
      <div>
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-xs text-teal-800">
          <span className="size-1.5 rounded-full bg-teal-600" />
          From work item to verified delivery
        </div>
        <h1 className="text-4xl font-semibold leading-tight tracking-tight text-slate-950">
          Good work deserves
          <br />a clear path to production.
        </h1>
        <p className="mt-5 text-sm leading-7 text-slate-500">
          Bring playbooks, customer runners, and human decisions into one shared workspace. Every
          revision, approval, and outcome stays connected.
        </p>
        <a
          href="#/community"
          className="mt-7 inline-flex items-center gap-2 text-sm font-medium text-teal-700"
        >
          <Globe2 className="size-4" />
          Explore community playbooks
          <ChevronRight className="size-4" />
        </a>
      </div>
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-xl">Welcome to your workspace</CardTitle>
          <CardDescription>Sign in with your invited organization account.</CardDescription>
        </CardHeader>
        <CardContent>
          <ErrorNotice error={hostedError ?? provider.error} />
          {provider.data?.adapter === "workos" ? (
            <Button
              className="mt-4 w-full"
              disabled={starting}
              onClick={async () => {
                setStarting(true);
                setHostedError(undefined);
                try {
                  const result = await request(
                    "/auth/workos/start",
                    z.object({ authorizationUrl: z.url(), state: z.string(), proof: z.string() }),
                    undefined,
                    { method: "POST", body: {}, key: crypto.randomUUID() },
                  );
                  sessionStorage.setItem("aa-workos-state", result.state);
                  sessionStorage.setItem("aa-workos-proof", result.proof);
                  location.assign(result.authorizationUrl);
                } catch (failure) {
                  setHostedError(
                    failure instanceof Error
                      ? failure
                      : new Error("Hosted sign-in could not be started."),
                  );
                  setStarting(false);
                }
              }}
            >
              Continue with organization sign-in
            </Button>
          ) : invitation ? (
            <CommandForm
              inline
              title="Accept invitation"
              description="Use the exact invitation shared by your organization administrator."
              path="/auth/accept-invitation"
              fields={[
                { name: "token", label: "Invitation token", required: true },
                { name: "name", label: "Your name", required: true },
                {
                  name: "password",
                  label: "Password",
                  type: "password",
                  required: true,
                  hint: "Use at least 12 characters. Existing members should use their current password.",
                },
              ]}
              onDone={() => setInvitation(false)}
            />
          ) : (
            <CommandForm
              inline
              title="Sign in"
              description="Use your local account"
              path="/auth/login"
              fields={[
                { name: "email", label: "Email", type: "email", required: true },
                { name: "password", label: "Password", type: "password", required: true },
              ]}
              onDone={(result) => {
                const token = z.string().min(1).parse(result.token);
                onLogin(token);
              }}
            />
          )}
          {provider.data?.adapter !== "workos" && (
            <Button className="mt-4" variant="link" onClick={() => setInvitation(!invitation)}>
              {invitation ? "Return to sign in" : "Accept an invitation"}
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
function Help() {
  return (
    <>
      <PageHeading
        title="Installation & help"
        description="Run the same workspace on your own infrastructure, with native harness authentication kept on your runner."
      />
      <Card>
        <CardHeader>
          <BookOpen />
          <CardTitle>Start with a local installation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5 text-sm leading-7 text-slate-600">
          <p>
            Follow the repository installation guide to configure PostgreSQL, bootstrap your first
            organization account, start the API and worker, and enroll a Linux runner.
          </p>
          <p>
            Use the runner CLI to inspect Codex readiness and authentication before enrollment. The
            workspace never asks you to copy native model credentials.
          </p>
          <a
            href="https://github.com/09millarda/agents-assemble#readme"
            target="_blank"
            rel="noreferrer"
            className="font-medium text-teal-700"
          >
            Read the installation guide →
          </a>
        </CardContent>
      </Card>
    </>
  );
}
function Workspace({
  route,
  credentials,
  organizationName,
}: {
  route: string;
  credentials: Credentials;
  organizationName: string;
}) {
  const [section, id] = route.split("/");
  if (section === "documents")
    return (
      <Documents
        key={`${credentials.organizationId}:${id}`}
        id={id}
        credentials={credentials}
        organizationName={organizationName}
      />
    );
  if (section === "community")
    return (
      <Community key={`${credentials.organizationId}:${id}`} id={id} credentials={credentials} />
    );
  if (section === "runs")
    return (
      <Runs
        key={`${credentials.organizationId}:${id}`}
        id={id}
        credentials={credentials}
        organizationName={organizationName}
      />
    );
  if (section === "runners")
    return (
      <Runners
        key={credentials.organizationId}
        credentials={credentials}
        organizationName={organizationName}
      />
    );
  if (section === "catalog")
    return (
      <Catalog
        key={`${credentials.organizationId}:${id}`}
        id={id}
        credentials={credentials}
        organizationName={organizationName}
      />
    );
  if (section === "operations")
    return (
      <Operations
        key={credentials.organizationId}
        credentials={credentials}
        organizationName={organizationName}
      />
    );
  if (section === "environments")
    return (
      <Environments
        key={credentials.organizationId}
        credentials={credentials}
        organizationName={organizationName}
      />
    );
  if (section === "projects")
    return (
      <Projects
        key={`${credentials.organizationId}:${id}`}
        id={id}
        credentials={credentials}
        organizationName={organizationName}
      />
    );
  if (section === "organization")
    return (
      <Organization
        key={credentials.organizationId}
        credentials={credentials}
        organizationName={organizationName}
      />
    );
  return (
    <>
      <PageHeading
        eyebrow={organizationName}
        title={navigation.find((item) => item.path === route.split("/")[0])?.label ?? "Workspace"}
        description="Connected records, explicit decisions, and durable outcomes."
      />
      <p className="text-sm text-slate-500">Select a workspace resource to get started.</p>
    </>
  );
}
