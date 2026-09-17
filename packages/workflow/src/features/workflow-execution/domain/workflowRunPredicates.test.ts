import { describe, expect, test } from "bun:test";
import {
  isWorkflowRunActive,
  isWorkflowRunAwaitingAttention,
  isWorkflowRunTerminal,
} from "./workflowRunPredicates";

describe("workflow run lifecycle predicates", () => {
  test("identifies queued and running runs as active", () => {
    expect(isWorkflowRunActive("queued")).toBe(true);
    expect(isWorkflowRunActive("running")).toBe(true);
    expect(isWorkflowRunActive("awaiting-human")).toBe(true);
    expect(isWorkflowRunActive("recovery-required")).toBe(true);
  });

  test("identifies human waits and recovery decisions as needing attention", () => {
    expect(isWorkflowRunAwaitingAttention("awaiting-human")).toBe(true);
    expect(isWorkflowRunAwaitingAttention("recovery-required")).toBe(true);
    expect(isWorkflowRunAwaitingAttention("running")).toBe(false);
  });

  test("identifies stopped runs as terminal", () => {
    expect(isWorkflowRunTerminal("completed")).toBe(true);
    expect(isWorkflowRunTerminal("cancelled")).toBe(true);
    expect(isWorkflowRunTerminal("failed")).toBe(true);
    expect(isWorkflowRunTerminal("queued")).toBe(false);
  });
});
