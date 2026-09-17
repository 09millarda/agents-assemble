import { useMemo, useState } from "react";
import { Check, KeyRound, ShieldCheck, X } from "lucide-react";
import { isUserCodeValid, normalizeUserCode } from "@factory/shared-domain";
import { approveDeviceAuthorization } from "../application/approveDeviceAuthorization";
import { denyDeviceAuthorization } from "../application/denyDeviceAuthorization";
import { HttpDeviceAuthorizationAdapter } from "../adapters/HttpDeviceAuthorizationAdapter";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Input } from "../../../components/ui/input";

type Decision = { kind: "approved"; daemonId: string } | { kind: "denied" } | null;

export function formatUserCodeForDisplay(userCode: string): string | null {
  const normalized = normalizeUserCode(userCode);
  if (!isUserCodeValid(userCode)) return null;
  return normalized.slice(0, 4) + "-" + normalized.slice(4);
}

export function readInitialUserCodeFromHash(hash: string): string {
  const queryIndex = hash.indexOf("?");
  if (queryIndex === -1) return "";
  const params = new URLSearchParams(hash.slice(queryIndex + 1));
  const rawCode = params.get("code") ?? "";
  if (rawCode === "") return "";
  const formatted = formatUserCodeForDisplay(rawCode);
  return formatted ?? "";
}

export function readInitialUserCodeFromSearch(search: string): string {
  if (!search) return "";
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const rawCode = params.get("code") ?? "";
  if (rawCode === "") return "";
  return formatUserCodeForDisplay(rawCode) ?? "";
}

function readInitialUserCodeFromLocation(): string {
  if (typeof window === "undefined") return "";
  if (typeof window.location?.search === "string" && window.location.search.includes("code=")) {
    return readInitialUserCodeFromSearch(window.location.search);
  }
  if (typeof window.location?.hash === "string") return readInitialUserCodeFromHash(window.location.hash);
  return "";
}

export function AuthorizedDeviceCard({ daemonId }: { daemonId: string }) {
  return (
    <Card className="overflow-hidden border-white/10 bg-white shadow-[0_24px_80px_rgba(0,0,0,0.22)]">
      <CardHeader className="border-b border-border/70 bg-[#fbfcfd] p-6">
        <span className="mb-3 grid h-11 w-11 place-items-center rounded-2xl bg-[#e3f7eb] text-[#226342]"><Check className="h-5 w-5" /></span>
        <CardTitle className="text-xl">Machine authorized</CardTitle>
        <CardDescription className="mt-1">This machine is authorized and ready to connect through the Factory CLI.</CardDescription>
      </CardHeader>
      <CardContent className="p-6">
        <p role="status" className="rounded-xl border border-[#cce7d7] bg-[#f1fbf5] p-3 text-sm text-[#226342]">
          Authorized daemon <strong className="font-mono">{daemonId}</strong> can now connect.
        </p>
        <p className="mt-4 text-sm text-muted-foreground">You can now close this tab or window.</p>
      </CardContent>
    </Card>
  );
}

export function DeviceApprovalPage({ initialUserCode }: { initialUserCode?: string }) {
  const authorizations = useMemo(() => new HttpDeviceAuthorizationAdapter(), []);
  const [userCode, setUserCode] = useState(() => initialUserCode ?? readInitialUserCodeFromLocation());
  const [isWorking, setIsWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [decision, setDecision] = useState<Decision>(null);

  const confirmationCode = formatUserCodeForDisplay(userCode);

  async function decide(kind: "approve" | "deny"): Promise<void> {
    setIsWorking(true);
    setError(null);
    try {
      if (kind === "approve") {
        const result = await approveDeviceAuthorization(authorizations, userCode);
        setDecision({ kind: "approved", daemonId: result.daemonId });
      } else {
        await denyDeviceAuthorization(authorizations, userCode);
        setDecision({ kind: "denied" });
      }
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : "Device approval failed.");
    } finally {
      setIsWorking(false);
    }
  }

  if (decision?.kind === "approved") {
    return (
      <div className="mx-auto w-full max-w-md">
        <AuthorizedDeviceCard daemonId={decision.daemonId} />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-md">
      <Card className="overflow-hidden border-white/10 bg-white shadow-[0_24px_80px_rgba(0,0,0,0.22)]">
        <CardHeader className="border-b border-border/70 bg-[#fbfcfd] p-6">
          <span className="mb-3 grid h-11 w-11 place-items-center rounded-2xl bg-[#fff3d9] text-[#aa6816]"><ShieldCheck className="h-5 w-5" /></span>
          <CardTitle className="text-xl">Approve this machine</CardTitle>
          <CardDescription className="mt-1">
            Enter the code shown by <code className="rounded bg-slate-100 px-1 font-mono">cli auth login</code>, then approve or deny it.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 p-6">
          <label className="grid gap-1 text-sm font-medium">
            User code
            <Input
              value={userCode}
              onChange={(event) => setUserCode(event.target.value)}
              placeholder="ABCD-2345"
              autoComplete="off"
              className="h-12 border-[#c5cfdd] bg-white text-center text-lg font-bold uppercase tracking-[0.16em]"
            />
          </label>
          {confirmationCode ? (
            <p className="rounded-xl border border-[#d9e2ed] bg-[#f5f8fb] p-3 text-sm leading-6 text-muted-foreground">
              <KeyRound className="mr-1.5 inline h-4 w-4 align-[-0.15em] text-[#5575a7]" />
              Are you sure you want to approve this machine? Check the code here matches the code in your terminal before approving:{" "}
              <strong className="font-mono">{confirmationCode}</strong>
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </p>
          ) : null}
          {decision?.kind === "denied" ? (
            <p role="status" className="flex items-center gap-2 rounded-xl border border-border bg-[#f5f8fb] p-3 text-sm text-muted-foreground">
              <Badge variant="secondary"><X className="mr-1 h-3 w-3" /> Denied</Badge> The waiting CLI will stop polling with access denied.
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button type="button" onClick={() => void decide("approve")} disabled={isWorking} className="flex-1">
              {isWorking ? "Working…" : "Approve"}
            </Button>
            <Button type="button" variant="outline" onClick={() => void decide("deny")} disabled={isWorking} className="flex-1">
              Deny
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
