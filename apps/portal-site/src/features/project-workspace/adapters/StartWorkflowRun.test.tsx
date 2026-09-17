import { expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import type { ProjectInfo } from "@factory/shared-domain";
import type { WorkflowDefinition } from "@factory/workflow";
import { StartWorkflowRunForm } from "./StartWorkflowRun";

const project: ProjectInfo = {
  projectId: "project-1",
  name: "Portal",
  absolutePath: "/home/example/portal",
  daemonId: "daemon-1",
  gitStatus: "valid",
  blockedReason: null,
  enabledWorkflowIds: ["workflow-1", "workflow-3"],
};

const definitions: WorkflowDefinition[] = [
  { workflowId: "workflow-1", name: "Build a feature", description: "", status: "published", tags: [], activities: [], positions: {} },
  { workflowId: "workflow-2", name: "Disabled workflow", description: "", status: "published", tags: [], activities: [], positions: {} },
  { workflowId: "workflow-3", name: "Draft workflow", description: "", status: "draft", tags: [], activities: [], positions: {} },
];

function renderForm(overrides: Partial<Parameters<typeof StartWorkflowRunForm>[0]> = {}): string {
  return renderToString(
    <StartWorkflowRunForm
      project={project}
      definitions={definitions}
      selectedWorkflowId="workflow-1"
      kickoffPrompt=""
      branch=""
      notifyBrowser={true}
      busy={false}
      onWorkflowChange={() => {}}
      onKickoffPromptChange={() => {}}
      onBranchChange={() => {}}
      onNotifyBrowserChange={() => {}}
      onStart={() => {}}
      {...overrides}
    />,
  );
}

test("start form renders only workflows enabled for the project", () => {
  const html = renderForm();

  expect(html).toContain("Build a feature");
  expect(html).not.toContain("Disabled workflow");
  expect(html).not.toContain("Draft workflow");
  expect(html).toContain("Optional kickoff prompt");
  expect(html).toContain("Local starting branch (optional)");
  expect(html).toContain("Notify this browser when enrolled");
});

test("start form disables submission without a workflow or daemon", () => {
  const html = renderForm({
    project: { ...project, daemonId: null },
    selectedWorkflowId: "",
  });

  expect(html).toContain('disabled=""');
});
