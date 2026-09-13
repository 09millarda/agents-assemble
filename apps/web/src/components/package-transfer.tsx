import { Download, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { CommandForm, Details, ErrorNotice } from "@/components/workspace";
import { type Credentials, recordSchema, request, text, useCommand } from "@/lib/api";

export function saveArchive(encoded: string, name: string) {
  const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/zip" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}
export function PackageImport({
  credentials,
  onDone,
}: {
  credentials: Credentials;
  onDone: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<Error>();
  const command = useCommand(credentials);
  return (
    <div className="space-y-3">
      <input
        ref={input}
        type="file"
        accept=".zip,.aa-package,application/zip"
        className="sr-only"
        aria-label="Offline package file"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          setError(undefined);
          try {
            if (file.size > 4 * 1024 * 1024)
              throw new Error("The package exceeds the supported 4 MiB transport limit.");
            const bytes = new Uint8Array(await file.arrayBuffer());
            let binary = "";
            for (const byte of bytes) binary += String.fromCharCode(byte);
            await command.run("/catalog/packages/import", { archiveBase64: btoa(binary) });
            onDone();
          } catch (reason) {
            if (!(reason instanceof Error)) return;
            setError(reason);
          } finally {
            event.target.value = "";
          }
        }}
      />
      <Button variant="outline" disabled={command.pending} onClick={() => input.current?.click()}>
        <Upload />
        Import offline package
      </Button>
      <ErrorNotice error={error ?? command.error} />
      {command.result && (
        <Details
          value={command.result}
          title="Verified import receipt and local bindings required"
        />
      )}
    </div>
  );
}
export function PackageExport({
  id,
  credentials,
  publicRelease = false,
}: {
  id: string;
  credentials?: Credentials;
  publicRelease?: boolean;
}) {
  const [error, setError] = useState<Error>();
  const [busy, setBusy] = useState(false);
  const command = useCommand(credentials);
  return (
    <div className="space-y-2">
      <Button
        variant="outline"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(undefined);
          try {
            const result = publicRelease
              ? await request(`/community/releases/${id}/export`, recordSchema)
              : await command.run(`/catalog/versions/${id}/export`, {});
            saveArchive(text(result.archiveBase64), `agents-assemble-${id}.zip`);
          } catch (reason) {
            setError(reason instanceof Error ? reason : new Error("Package export failed."));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Download />
        Export package
      </Button>
      {!publicRelease && (
        <CommandForm
          title="Export with rights inventory"
          description="Declare the reviewed license and notices for every root and action component in this custom package."
          path={`/catalog/versions/${id}/export`}
          credentials={credentials}
          fields={[
            {
              name: "rights",
              label: "Redistribution rights inventory",
              type: "json",
              required: true,
              hint: '[{"componentId":"…","license":"Apache-2.0","redistribution":"permitted","noticeText":"…"}]',
            },
          ]}
          onDone={(result) => saveArchive(text(result.archiveBase64), `agents-assemble-${id}.zip`)}
        />
      )}
      <ErrorNotice error={error} />
    </div>
  );
}
