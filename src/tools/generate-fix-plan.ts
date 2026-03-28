import { z } from "zod";
import { createResponseEnvelope, sourceInfo } from "../shared.js";
import { registerTool } from "./registry.js";

const schema = z.object({
  goal: z.string().min(1),
  studio_port: z.number().int().positive().default(33796),
  api_key: z.string().min(1).optional(),
  universe_id: z.string().min(1).optional(),
});

registerTool({
  name: "rbx_generate_fix_plan",
  description: "Generate a Roblox remediation plan by mapping a goal to the available tools.",
  schema,
  handler: async (input) => {
    const goal = input.goal.toLowerCase();
    const steps: Array<{
      order: number;
      tool_name: string;
      description: string;
      suggested_args: Record<string, unknown>;
      rationale: string;
    }> = [];

    const addStep = (
      toolName: string,
      description: string,
      suggestedArgs: Record<string, unknown>,
      rationale: string,
    ): void => {
      if (steps.some((step) => step.tool_name === toolName)) {
        return;
      }
      steps.push({
        order: steps.length + 1,
        tool_name: toolName,
        description,
        suggested_args: suggestedArgs,
        rationale,
      });
    };

    if (/mobile|ui|touch|notch|screen/u.test(goal)) {
      addStep(
        "rbx_validate_mobile_ui",
        "Validate mobile layout, touch target sizes, and safe-area issues.",
        { studio_port: input.studio_port },
        "The goal mentions mobile or UI concerns.",
      );
    }
    if (/publish|release|ship|launch/u.test(goal)) {
      addStep(
        "rbx_prepublish_audit",
        "Run a full pre-publish audit to surface blockers before release.",
        {
          studio_port: input.studio_port,
          ...(input.api_key ? { api_key: input.api_key } : {}),
          ...(input.universe_id ? { universe_id: input.universe_id } : {}),
        },
        "Publishing goals benefit from a full audit.",
      );
    }
    if (/test|broken|failing|regression/u.test(goal)) {
      addStep(
        "rbx_run_test_matrix",
        "Run tests across the relevant server and client modes.",
        {
          studio_port: input.studio_port,
          configurations: ["server", "client"],
        },
        "The goal mentions failures or testing.",
      );
    }
    if (/find|search|where|locate/u.test(goal)) {
      addStep(
        "rbx_search_project",
        "Search the project for the relevant instances or script content.",
        {
          studio_port: input.studio_port,
          query: input.goal,
          search_type: "script_content",
        },
        "The goal implies discovery before action.",
      );
    }
    if (/fix|change|update|patch|rename/u.test(goal)) {
      addStep(
        "rbx_apply_patch_safe",
        "Preview structural or property changes as a dry run before applying them.",
        {
          studio_port: input.studio_port,
          dry_run: true,
          operations: [],
        },
        "The goal requires project mutations; the safe patch tool provides preview and rollback.",
      );
    }
    if (/performance|lag|slow|fps/u.test(goal)) {
      addStep(
        "rbx_prepublish_audit",
        "Run a performance-focused audit for counts, heavy scripts, and UI depth.",
        {
          studio_port: input.studio_port,
          categories: ["performance"],
        },
        "The goal mentions performance symptoms.",
      );
    }

    if (steps.length === 0) {
      addStep(
        "rbx_project_snapshot",
        "Capture the current project tree before deciding on follow-up actions.",
        { studio_port: input.studio_port, max_depth: 6 },
        "A project snapshot is the safest first step when the goal is broad.",
      );
    }

    return createResponseEnvelope(
      {
        steps,
        estimated_tools: steps.length,
      },
      {
        source: sourceInfo({
          studio_port: input.studio_port,
          ...(input.universe_id ? { universe_id: input.universe_id } : {}),
        }),
      },
    );
  },
});
