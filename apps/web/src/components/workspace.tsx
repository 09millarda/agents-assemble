import { AlertCircle, ArrowRight, LoaderCircle, Plus } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, type Credentials, type RecordData, resource, text, useCommand } from "@/lib/api";

export function ErrorNotice({ error }: { error?: Error }) {
  if (!error) return null;
  return (
    <Alert variant="destructive" role="alert">
      <AlertCircle />
      <AlertTitle>
        {error instanceof ApiError
          ? error.detail.code.replaceAll("_", " ")
          : "Unable to complete request"}
      </AlertTitle>
      <AlertDescription>
        <p>{error.message}</p>
        {error instanceof ApiError && error.detail.correlationId && (
          <small>Reference: {error.detail.correlationId}</small>
        )}
      </AlertDescription>
    </Alert>
  );
}
export function Status({ value }: { value: unknown }) {
  const label = text(value) || "pending";
  const good = [
    "accepted",
    "active",
    "ready",
    "healthy",
    "succeeded",
    "delivered",
    "published",
    "admitted",
  ].includes(label);
  const bad = [
    "failed",
    "rejected",
    "revoked",
    "quarantined",
    "conflict",
    "outcome_unknown",
    "blocked",
    "suspended",
    "reauthentication_required",
  ].includes(label);
  return (
    <Badge
      variant="outline"
      className={
        good
          ? "border-teal-200 bg-teal-50 text-teal-800"
          : bad
            ? "border-amber-200 bg-amber-50 text-amber-900"
            : "text-slate-600"
      }
    >
      <span
        className={`size-1.5 rounded-full ${good ? "bg-teal-600" : bad ? "bg-amber-600" : "bg-slate-400"}`}
      />
      {label.replaceAll("_", " ")}
    </Badge>
  );
}
export function PageHeading({
  eyebrow = "Workspace",
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-5">
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-teal-700">
          {eyebrow}
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-950">{title}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">{description}</p>
      </div>
      {action}
    </div>
  );
}
export function Loading() {
  return (
    <div role="status" className="flex items-center gap-2 py-10 text-sm text-slate-500">
      <LoaderCircle className="size-4 animate-spin" />
      Loading workspace…
    </div>
  );
}
export function Empty({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed bg-white px-6 py-14 text-center">
      <div className="mx-auto mb-4 grid size-11 place-items-center rounded-xl bg-slate-100 text-slate-500">
        <Plus className="size-5" />
      </div>
      <h2 className="font-medium">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">{children}</p>
    </div>
  );
}
export function Details({ value, title = "Recorded details" }: { value: unknown; title?: string }) {
  return (
    <details className="rounded-lg border bg-slate-50/60 p-4">
      <summary className="cursor-pointer text-sm font-medium text-slate-600">{title}</summary>
      <pre className="mt-4 max-h-96 overflow-auto whitespace-pre-wrap break-all text-xs leading-6 text-slate-600">
        {JSON.stringify(value, null, 2)}
      </pre>
    </details>
  );
}
export function ResourceCard({
  resource,
  href,
  children,
}: {
  resource: RecordData;
  href?: string;
  children?: ReactNode;
}) {
  const title = text(resource.name) || text(resource.title) || text(resource.id);
  return (
    <Card className="gap-4 shadow-none">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="text-base">
            {href ? (
              <a className="hover:text-teal-700 focus-visible:underline" href={href}>
                {title}
              </a>
            ) : (
              title
            )}
          </CardTitle>
          {resource.status !== undefined && <Status value={resource.status} />}
        </div>
        {resource.description !== undefined && (
          <CardDescription>{text(resource.description)}</CardDescription>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {children ?? <Details value={resource} />}
        {href && (
          <a
            className="inline-flex items-center gap-2 text-sm font-medium text-teal-700"
            href={href}
          >
            Open workspace
            <ArrowRight className="size-3.5" />
          </a>
        )}
      </CardContent>
    </Card>
  );
}
export type Field = {
  name: string;
  label: string;
  type?: "text" | "password" | "email" | "number" | "textarea" | "json" | "select";
  required?: boolean;
  value?: string;
  placeholder?: string;
  hint?: string;
  options?: { value: string; label: string }[];
};
export function CommandForm({
  title,
  description,
  fields,
  path,
  credentials,
  defaults = {},
  method,
  onDone,
  label,
  inline = false,
  keepOpen = false,
  transform,
}: {
  title: string;
  description: string;
  fields: Field[];
  path: string;
  credentials?: Credentials;
  defaults?: RecordData;
  method?: string;
  onDone?: (result: RecordData) => void;
  label?: string;
  inline?: boolean;
  keepOpen?: boolean;
  transform?: (values: RecordData) => RecordData;
}) {
  const [open, setOpen] = useState(false);
  const [localError, setLocalError] = useState<Error>();
  const id = useId();
  const command = useCommand(credentials);
  const form = (
    <form
      className="space-y-5"
      onSubmit={async (event) => {
        event.preventDefault();
        setLocalError(undefined);
        const formData = new FormData(event.currentTarget);
        try {
          const values: RecordData = { ...defaults };
          for (const field of fields) {
            const value = String(formData.get(field.name) ?? "");
            if (!value && !field.required) continue;
            values[field.name] =
              field.type === "json"
                ? JSON.parse(value)
                : field.type === "number"
                  ? Number(value)
                  : value;
          }
          const result = await command.run(path, transform ? transform(values) : values, method);
          onDone?.(result);
          if (
            !keepOpen &&
            !result.token &&
            !result.enrollmentToken &&
            !result.command &&
            !["outcome_unknown", "blocked", "pending", "rejected", "conflict"].includes(
              text(result.outcome ?? result.status),
            )
          )
            setOpen(false);
        } catch (error) {
          if (!(error instanceof ApiError))
            setLocalError(error instanceof Error ? error : new Error("Please check the form."));
        }
      }}
    >
      {fields.map((field) => (
        <div key={field.name} className="space-y-2">
          <Label htmlFor={`${id}-${field.name}`}>
            {field.label}
            {field.required && <span className="text-slate-400"> *</span>}
          </Label>
          {field.type === "textarea" || field.type === "json" ? (
            <Textarea
              id={`${id}-${field.name}`}
              name={field.name}
              required={field.required}
              defaultValue={field.value}
              placeholder={field.placeholder}
              className={field.type === "json" ? "min-h-32 font-mono text-xs" : "min-h-24"}
            />
          ) : field.type === "select" ? (
            <select
              id={`${id}-${field.name}`}
              name={field.name}
              required={field.required}
              defaultValue={field.value ?? ""}
              className="h-9 w-full rounded-md border bg-white px-3 text-sm"
            >
              <option value="">Select {field.label.toLowerCase()}</option>
              {field.options?.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          ) : (
            <Input
              id={`${id}-${field.name}`}
              name={field.name}
              type={field.type ?? "text"}
              required={field.required}
              defaultValue={field.value}
              placeholder={field.placeholder}
              autoComplete={
                field.type === "password"
                  ? "current-password"
                  : field.type === "email"
                    ? "username"
                    : undefined
              }
            />
          )}
          {field.hint && <p className="text-xs leading-5 text-slate-500">{field.hint}</p>}
        </div>
      ))}
      <ErrorNotice error={localError ?? command.error} />
      {command.result && (
        <div role="status" className="space-y-2">
          <Status value={command.result.outcome ?? command.result.status ?? "recorded"} />
          <Details value={command.result} title="Operation receipt" />
        </div>
      )}
      <Button disabled={command.pending} type="submit" className="min-h-9">
        {command.pending && <LoaderCircle className="size-4 animate-spin" />}
        {label ?? title}
      </Button>
    </form>
  );
  if (inline) return form;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="min-h-9">
          {title}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {form}
      </DialogContent>
    </Dialog>
  );
}
export function itemList(data: RecordData | undefined, key = "items"): RecordData[] {
  if (!data || !Array.isArray(data[key])) return [];
  return data[key].map(resource);
}
