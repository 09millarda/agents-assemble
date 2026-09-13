import { expect, it } from "vitest";
import { normalizeDefinition, toTypeScript } from "./definition.ts";
import { starterPlaybook } from "./starters.ts";

it.each(["new-feature", "bug-fix"] as const)(
  "publishes the complete bounded %s delivery contract",
  (kind) => {
    const definition = starterPlaybook(kind);
    expect(normalizeDefinition(JSON.parse(JSON.stringify(definition)))).toEqual(definition);
    expect(toTypeScript(definition)).toContain("productionApproval");
    expect(Object.keys(definition.dependencies)).toEqual(
      expect.arrayContaining([
        "approveSpec",
        "check",
        "review",
        "approvePublish",
        "publishPR",
        "waitMerge",
        "staging",
        "approveProduction",
        "production",
        "verifyHealth",
        "recoverProduction",
      ]),
    );
    expect(
      Object.values(definition.dependencies).every((action) => action.retry.maxAttempts === 1),
    ).toBe(true);
    if (kind === "bug-fix")
      expect(definition.dependencies.unreproduced.outputs.properties).toHaveProperty("decision");
  },
);
