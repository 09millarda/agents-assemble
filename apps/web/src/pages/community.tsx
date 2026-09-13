import { BookMarked, Globe2, Search, Star } from "lucide-react";
import { useState } from "react";
import { PackageExport, PackageImport } from "@/components/package-transfer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  CommandForm,
  Details,
  Empty,
  ErrorNotice,
  itemList,
  Loading,
  PageHeading,
  Status,
} from "@/components/workspace";
import {
  asRecord,
  type Credentials,
  type RecordData,
  resource,
  text,
  useResource,
} from "@/lib/api";

export function Community({ id, credentials }: { id?: string; credentials: Credentials }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("recent");
  const [author, setAuthor] = useState("");
  const [tag, setTag] = useState("");
  const params = new URLSearchParams({
    q: query,
    sort,
    ...(author ? { author } : {}),
    ...(tag ? { tag } : {}),
  });
  const state = useResource(id ? `/community/releases/${id}` : `/community/releases?${params}`);
  const authenticated = Boolean(credentials.token && credentials.organizationId);
  if (id)
    return (
      <Release
        id={id}
        release={state.data}
        error={state.error}
        credentials={credentials}
        refresh={state.refresh}
      />
    );
  return (
    <>
      <PageHeading
        eyebrow="Open community"
        title="Built to be shared"
        description="Discover inspectable, portable playbooks. Import an immutable version, then bind it to your own runners and policy."
        action={
          authenticated ? (
            <Publication credentials={credentials} onDone={state.refresh} />
          ) : (
            <a href="#/projects" className="text-sm font-medium text-teal-700">
              Sign in to collaborate →
            </a>
          )
        }
      />
      <Tabs defaultValue="discover">
        <TabsList>
          <TabsTrigger value="discover">Discover</TabsTrigger>
          {authenticated && (
            <>
              <TabsTrigger value="bookmarks">Private bookmarks</TabsTrigger>
              <TabsTrigger value="moderation">Moderation</TabsTrigger>
            </>
          )}
        </TabsList>
        <TabsContent value="discover" className="mt-6">
          <form
            className="mb-6 flex flex-wrap gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              setQuery(String(data.get("q")));
              setAuthor(String(data.get("author")));
              setTag(String(data.get("tag")));
            }}
          >
            <div className="relative min-w-52 flex-1">
              <Search className="absolute left-3 top-2.5 size-4 text-slate-400" />
              <label htmlFor="community-search" className="sr-only">
                Search playbooks
              </label>
              <Input
                id="community-search"
                name="q"
                placeholder="Search playbooks…"
                className="h-9 bg-white pl-9"
              />
            </div>
            <label htmlFor="community-author" className="sr-only">
              Filter author
            </label>
            <Input
              id="community-author"
              name="author"
              placeholder="Author"
              className="h-9 w-36 bg-white"
            />
            <label htmlFor="community-tag" className="sr-only">
              Filter tag
            </label>
            <Input id="community-tag" name="tag" placeholder="Tag" className="h-9 w-28 bg-white" />
            <label htmlFor="community-sort" className="sr-only">
              Sort playbooks
            </label>
            <select
              id="community-sort"
              value={sort}
              onChange={(event) => setSort(event.target.value)}
              className="h-9 rounded-md border bg-white px-3 text-sm"
            >
              <option value="recent">Recently published</option>
              <option value="rating">Highest rated</option>
              <option value="relevance">Relevance</option>
            </select>
            <Button type="submit" className="h-9">
              Search
            </Button>
          </form>
          <ErrorNotice error={state.error} />
          {state.loading && <Loading />}
          <div className="grid gap-5 lg:grid-cols-2 xl:grid-cols-3">
            {itemList(state.data).map((release) => (
              <ReleaseCard key={text(release.id)} release={release} />
            ))}
          </div>
          {!state.loading && !state.error && !itemList(state.data).length && (
            <Empty title="No matching public playbooks">
              Try a broader search or publish a reviewed package from your organization catalog.
            </Empty>
          )}
          {authenticated && (
            <div className="mt-8">
              <PackageImport credentials={credentials} onDone={state.refresh} />
            </div>
          )}
        </TabsContent>
        {authenticated && (
          <>
            <TabsContent value="bookmarks" className="mt-6">
              <Bookmarks credentials={credentials} />
            </TabsContent>
            <TabsContent value="moderation" className="mt-6">
              <Moderation credentials={credentials} />
            </TabsContent>
          </>
        )}
      </Tabs>
    </>
  );
}
function ReleaseCard({ release }: { release: RecordData }) {
  const rating = release.rating ? asRecord(release.rating) : undefined;
  return (
    <Card className="gap-4 shadow-none transition-shadow hover:shadow-sm">
      <CardHeader>
        <div className="mb-2 flex items-center justify-between">
          <span className="grid size-10 place-items-center rounded-xl border border-teal-100 bg-teal-50 text-teal-700">
            <Globe2 className="size-5" />
          </span>
          <span className="text-xs text-slate-400">v{text(release.version)}</span>
        </div>
        <CardTitle className="text-base">
          <a className="hover:text-teal-700" href={`#/community/${text(release.id)}`}>
            {text(release.name)}
          </a>
        </CardTitle>
        <CardDescription className="line-clamp-3 leading-6">
          {text(release.summary)}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-1.5">
          {Array.isArray(release.tags) &&
            release.tags.map((tag) => (
              <Badge key={text(tag)} variant="secondary" className="font-normal text-slate-500">
                {text(tag)}
              </Badge>
            ))}
        </div>
        <div className="flex items-center justify-between border-t pt-4 text-xs text-slate-500">
          <span>{text(release.authorName)}</span>
          <span className="flex items-center gap-1">
            <Star className="size-3.5 text-amber-500" />
            {rating?.average === null ? "Unrated" : Number(rating?.average ?? 0).toFixed(1)}
            {rating && <span className="text-slate-400">({text(rating.count)})</span>}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
function Release({
  id,
  release,
  error,
  credentials,
  refresh,
}: {
  id: string;
  release?: RecordData;
  error?: Error;
  credentials: Credentials;
  refresh: () => void;
}) {
  const authenticated = Boolean(credentials.token && credentials.organizationId);
  const available = release?.status === "active";
  if (!release)
    return (
      <>
        <ErrorNotice error={error} />
        {!error && <Loading />}
      </>
    );
  const comments = Array.isArray(release.comments) ? release.comments.map(resource) : [];
  return (
    <>
      <a href="#/community" className="mb-5 inline-block text-xs text-slate-500">
        ← Explore community
      </a>
      <PageHeading
        eyebrow={text(release.namespace)}
        title={text(release.name)}
        description={text(release.summary)}
      />
      <div className="mb-6 flex flex-wrap gap-3">
        <Status value={release.status} />
        <Badge variant="outline">Version {text(release.version)}</Badge>
        <span className="text-sm text-slate-500">
          {text(release.authorName)} · {text(release.organizationName)}
        </span>
      </div>
      <ErrorNotice error={error} />
      {!available && (
        <Card className="mb-6 border-amber-200 bg-amber-50/50 shadow-none">
          <CardHeader>
            <CardTitle className="text-base">This version is unavailable</CardTitle>
            <CardDescription>
              The release is {text(release.status)}. Recorded reason:{" "}
              {text(release.reasonCategory) || "Awaiting review"}.
            </CardDescription>
          </CardHeader>
        </Card>
      )}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-5">
          <Card className="shadow-none">
            <CardHeader>
              <CardTitle>Version & changelog</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="whitespace-pre-wrap text-sm leading-7 text-slate-600">
                {text(release.changelog) || text(release.reasonCategory)}
              </p>
              <Details
                value={release}
                title="Immutable package, permissions, author & organization"
              />
            </CardContent>
          </Card>
          <Card className="shadow-none">
            <CardHeader>
              <CardTitle>Discussion</CardTitle>
              <CardDescription>
                Attributed comments are public. Bookmarks and reports stay private.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {comments.map((comment) => (
                <div
                  key={text(comment.id)}
                  className={`${comment.parentId ? "ml-5 border-l pl-4" : "border-b pb-4"} space-y-2`}
                >
                  <p className="text-xs font-medium text-slate-500">
                    {text(comment.actorId)}
                    {comment.edited ? " · edited" : ""}
                  </p>
                  <p className="whitespace-pre-wrap text-sm leading-6">
                    {comment.status === "deleted"
                      ? "Comment removed"
                      : comment.status === "hidden"
                        ? "Comment hidden by moderation"
                        : text(comment.body)}
                  </p>
                  {authenticated && comment.status !== "deleted" && comment.status !== "hidden" && (
                    <CommandForm
                      title="Reply"
                      description="Add a public reply to this exact comment."
                      path={`/community/releases/${id}/comments`}
                      credentials={credentials}
                      defaults={{ parentId: comment.id }}
                      fields={[{ name: "body", label: "Reply", type: "textarea", required: true }]}
                      onDone={refresh}
                    />
                  )}
                </div>
              ))}
              {!comments.length && <p className="text-sm text-slate-500">No comments yet.</p>}
              {authenticated && available && (
                <CommandForm
                  inline
                  title="Post comment"
                  description="Your comment will be public."
                  path={`/community/releases/${id}/comments`}
                  credentials={credentials}
                  fields={[
                    { name: "body", label: "Public comment", type: "textarea", required: true },
                  ]}
                  onDone={refresh}
                />
              )}
            </CardContent>
          </Card>
        </div>
        <div className="space-y-5">
          {available && (
            <Card className="shadow-none">
              <CardHeader>
                <CardTitle className="text-base">Make this version yours</CardTitle>
                <CardDescription>
                  Imports pin an immutable closure and grant no execution authority.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {authenticated && (
                  <>
                    <CommandForm
                      title="Import into organization"
                      description="Copy this exact immutable package closure into your local catalog. Local runtime/environment bindings and grants remain required."
                      path={`/community/releases/${id}/import`}
                      credentials={credentials}
                      fields={[]}
                      onDone={refresh}
                    />
                    <CommandForm
                      title="Fork into editable draft"
                      description="Create an independent local package identity and preserve this release's origin and notices."
                      path={`/community/releases/${id}/fork`}
                      credentials={credentials}
                      fields={[
                        {
                          name: "title",
                          label: "Draft title",
                          required: true,
                          value: `${text(release.name)} fork`,
                        },
                      ]}
                      onDone={(value) => {
                        if (value.id) location.hash = `/catalog/${text(value.id)}`;
                      }}
                    />
                    <CommandForm
                      title="Save private bookmark"
                      description="Only you can see this bookmark."
                      path={`/community/releases/${id}/bookmark`}
                      credentials={credentials}
                      defaults={{ saved: true }}
                      fields={[]}
                    />
                    <CommandForm
                      title="Rate reviewed version"
                      description="Record one rating for the version you reviewed. Your rating is public."
                      path={`/community/releases/${id}/rating`}
                      credentials={credentials}
                      defaults={{ reviewedVersion: release.version }}
                      fields={[
                        {
                          name: "score",
                          label: "Rating",
                          type: "select",
                          required: true,
                          options: [1, 2, 3, 4, 5].map((value) => ({
                            value: String(value),
                            label: `${value} star${value === 1 ? "" : "s"}`,
                          })),
                        },
                      ]}
                      transform={(values) => ({ ...values, score: Number(values.score) })}
                      onDone={refresh}
                    />
                  </>
                )}
                <PackageExport id={id} publicRelease />
              </CardContent>
            </Card>
          )}
          {authenticated && (
            <>
              <CommandForm
                title="Report privately"
                description="Send a private report and evidence to authorized moderators."
                path="/community/reports"
                credentials={credentials}
                defaults={{ targetType: "release", targetId: id, evidence: [] }}
                fields={[
                  { name: "category", label: "Category", required: true },
                  { name: "explanation", label: "Explanation", type: "textarea", required: true },
                ]}
              />
              <CommandForm
                title="Moderate release"
                description="Record a reasoned, attributed decision bound to the current public release version. Authorization is checked by the service."
                path="/community/moderation"
                credentials={credentials}
                defaults={{ targetId: id, expectedVersion: release.aggregateVersion }}
                fields={[
                  {
                    name: "action",
                    label: "Decision",
                    type: "select",
                    required: true,
                    options: ["quarantine", "restore", "withdraw"].map((value) => ({
                      value,
                      label: value,
                    })),
                  },
                  { name: "category", label: "Category", required: true },
                  { name: "reason", label: "Reason", type: "textarea", required: true },
                ]}
                onDone={refresh}
              />
            </>
          )}
        </div>
      </div>
    </>
  );
}
function Publication({ credentials, onDone }: { credentials: Credentials; onDone: () => void }) {
  const versions = useResource("/catalog/versions", credentials);
  const [candidate, setCandidate] = useState<RecordData>();
  return (
    <div className="space-y-3">
      <CommandForm
        title="Prepare public release"
        description="Create an exact redacted package candidate for review. Only invited publishers can publish during the pilot."
        path="/community/candidates"
        credentials={credentials}
        fields={[
          {
            name: "versionId",
            label: "Organization version",
            type: "select",
            required: true,
            options: itemList(versions.data).map((version) => ({
              value: text(version.id),
              label: text(version.id),
            })),
          },
          { name: "namespace", label: "Public namespace", required: true },
          { name: "name", label: "Package name", required: true },
          { name: "summary", label: "Summary", type: "textarea", required: true },
          { name: "tags", label: "Tags", type: "json", required: true, value: "[]" },
          { name: "authorName", label: "Public author name", required: true },
          { name: "organizationName", label: "Public organization name", required: true },
          {
            name: "rights",
            label: "Redistribution rights inventory",
            type: "json",
            hint: 'Custom packages require an entry for every root and action component: [{"componentId":"…","license":"Apache-2.0","redistribution":"permitted","noticeText":"…"}]. Unmodified bundled starters already carry their rights.',
          },
        ]}
        onDone={(value) => setCandidate(resource(value))}
      />
      {candidate && (
        <Card className="max-w-xl">
          <CardHeader>
            <CardTitle className="text-base">Review the exact public candidate</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Details value={candidate} title="Complete redacted publication inventory" />
            <CommandForm
              title="Publish reviewed candidate"
              description={`Publish only candidate ${text(candidate.id)} with digest ${text(candidate.digest)}.`}
              path="/community/releases"
              credentials={credentials}
              defaults={{
                candidateId: candidate.id,
                digest: candidate.digest,
                expectedPolicyVersion: 0,
              }}
              fields={[]}
              onDone={onDone}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
function Bookmarks({ credentials }: { credentials: Credentials }) {
  const state = useResource("/community/bookmarks", credentials);
  return (
    <div className="space-y-4">
      <ErrorNotice error={state.error} />
      {itemList(state.data).map((bookmark) => (
        <Card key={text(bookmark.id)}>
          <CardContent className="flex items-center justify-between gap-4">
            <a
              className="flex items-center gap-2 text-sm text-teal-700"
              href={`#/community/${text(bookmark.releaseId)}`}
            >
              <BookMarked className="size-4" />
              {text(bookmark.releaseId)}
            </a>
            <CommandForm
              title="Remove bookmark"
              description="Remove this bookmark from your private list."
              path={`/community/releases/${text(bookmark.releaseId)}/bookmark`}
              credentials={credentials}
              defaults={{ saved: false }}
              fields={[]}
              onDone={state.refresh}
            />
          </CardContent>
        </Card>
      ))}
      {!state.error && !state.loading && !itemList(state.data).length && (
        <Empty title="Your private reading list">
          Save public packages to revisit them later. Other people cannot see your bookmarks.
        </Empty>
      )}
    </div>
  );
}
function Moderation({ credentials }: { credentials: Credentials }) {
  const state = useResource("/community/moderation", credentials);
  return (
    <div className="space-y-4">
      <ErrorNotice error={state.error} />
      {["reports", "appeals", "decisions"].map((group) => (
        <Card key={group} className="shadow-none">
          <CardHeader>
            <CardTitle className="text-base capitalize">{group}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {itemList(state.data, group).map((item) => (
              <Details
                key={text(item.id)}
                value={item}
                title={`${group.slice(0, -1)} ${text(item.id).slice(0, 8)}`}
              />
            ))}
            {!itemList(state.data, group).length && (
              <p className="text-xs text-slate-500">No records available.</p>
            )}
          </CardContent>
        </Card>
      ))}
      <CommandForm
        title="Appeal a decision"
        description="Submit a private appeal tied to an exact moderation decision. Only an affected publisher or commenter may appeal."
        path="/community/appeals"
        credentials={credentials}
        fields={[
          { name: "decisionId", label: "Decision ID", required: true },
          { name: "explanation", label: "Explanation", type: "textarea", required: true },
        ]}
        onDone={state.refresh}
      />
    </div>
  );
}
