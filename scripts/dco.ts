import { execFileSync } from "node:child_process";

const base = process.env.DCO_BASE ?? "HEAD^";
const commits = execFileSync("git", ["rev-list", `${base}..HEAD`], { encoding: "utf8" })
  .trim()
  .split("\n")
  .filter(Boolean);
const failures: string[] = [];
for (const commit of commits) {
  const body = execFileSync("git", ["show", "-s", "--format=%B", commit], { encoding: "utf8" });
  const author = execFileSync("git", ["show", "-s", "--format=%an <%ae>", commit], {
    encoding: "utf8",
  }).trim();
  if (
    !body
      .split("\n")
      .some((line) => line.toLowerCase() === `Signed-off-by: ${author}`.toLowerCase())
  )
    failures.push(commit);
}
if (failures.length) throw new Error(`Missing author DCO sign-off: ${failures.join(", ")}`);
process.stdout.write(`DCO sign-off present for ${commits.length} commits\n`);
