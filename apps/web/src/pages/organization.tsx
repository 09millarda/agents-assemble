import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  CommandForm,
  Empty,
  ErrorNotice,
  itemList,
  Loading,
  PageHeading,
  Status,
} from "@/components/workspace";
import { type Credentials, text, useResource } from "@/lib/api";

export function Organization({
  credentials,
  organizationName,
}: {
  credentials: Credentials;
  organizationName: string;
}) {
  const state = useResource("/members", credentials);
  return (
    <>
      <PageHeading
        eyebrow={organizationName}
        title="Organization"
        description="Manage invited collaborators and the authority they have across your workspace."
        action={
          <CommandForm
            title="Invite member"
            description="Create a private invitation. Share the resulting token with the intended recipient through your own trusted channel."
            path="/invitations"
            credentials={credentials}
            fields={[
              { name: "email", label: "Email", type: "email", required: true },
              {
                name: "role",
                label: "Role",
                type: "select",
                required: true,
                value: "member",
                options: ["member", "admin", "publisher", "moderator"].map((role) => ({
                  value: role,
                  label: role,
                })),
              },
            ]}
            onDone={state.refresh}
          />
        }
      />
      <ErrorNotice error={state.error} />
      {state.loading && <Loading />}
      <div className="space-y-3">
        {itemList(state.data).map((member) => (
          <Card key={text(member.id)} className="gap-4 shadow-none">
            <CardHeader className="flex-row items-center justify-between gap-4">
              <div>
                <CardTitle className="text-base">
                  {text(member.name) || text(member.email)}
                </CardTitle>
                <p className="mt-1 text-xs text-slate-500">
                  {text(member.email)} · {text(member.role)}
                </p>
              </div>
              <Status value={member.active ? "active" : "revoked"} />
            </CardHeader>
            <CardContent className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-slate-500">
                Authority generation {text(member.authorityGeneration)}
              </p>
              {Boolean(member.active) && (
                <CommandForm
                  title="Revoke access"
                  description={`Revoke ${text(member.email)} from this organization. Current policy will prevent future sensitive operations.`}
                  path={`/members/${text(member.id)}/revoke`}
                  credentials={credentials}
                  defaults={{ expectedVersion: member.version }}
                  fields={[{ name: "reason", label: "Reason", type: "textarea", required: true }]}
                  onDone={state.refresh}
                />
              )}
            </CardContent>
          </Card>
        ))}
      </div>
      {!state.loading && !state.error && !itemList(state.data).length && (
        <Empty title="No members to display">
          Organization membership is managed by administrators.
        </Empty>
      )}
    </>
  );
}
