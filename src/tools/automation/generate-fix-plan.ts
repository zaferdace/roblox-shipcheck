import { z } from "zod";
import { createResponseEnvelope, sourceInfo } from "../../shared.js";
import { registerTool } from "../registry.js";

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
      addStep(
        "rbx_accessibility_audit",
        "Audit accessibility issues across contrast, touch targets, and text scaling.",
        { studio_port: input.studio_port },
        "Mobile and UI work often overlaps with accessibility risks.",
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
      addStep(
        "rbx_shipcheck_report",
        "Generate a unified shipcheck report with a verdict, issue list, and markdown summary.",
        {
          studio_port: input.studio_port,
          output_format: "both" as const,
          ...(input.api_key ? { api_key: input.api_key } : {}),
          ...(input.universe_id ? { universe_id: input.universe_id } : {}),
        },
        "Ship and release goals benefit from a single report that consolidates audit signals.",
      );
      addStep(
        "rbx_content_maturity_check",
        "Run a content maturity review for violence, language, social links, and gambling risk indicators.",
        {
          studio_port: input.studio_port,
          ...(input.api_key ? { api_key: input.api_key } : {}),
          ...(input.universe_id ? { universe_id: input.universe_id } : {}),
        },
        "Shipping goals should include an explicit content maturity review.",
      );
    }
    if (/diff|changed|baseline|compare|release/u.test(goal)) {
      addStep(
        "rbx_release_diff",
        "Compare the current place against a saved baseline to summarize release risk and changed areas.",
        {
          studio_port: input.studio_port,
          run_targeted_audits: true,
          ...(input.api_key ? { api_key: input.api_key } : {}),
          ...(input.universe_id ? { universe_id: input.universe_id } : {}),
        },
        "The goal mentions release comparison, change detection, or baseline-driven review.",
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
    if (/script|source|lua|code/u.test(goal)) {
      addStep(
        "rbx_get_script_source",
        "Read the relevant script source before changing behavior.",
        {
          studio_port: input.studio_port,
          path: "game.ServerScriptService.ExampleScript",
        },
        "Script-related goals usually start with source inspection.",
      );
    }
    if (/property|attribute|tag/u.test(goal)) {
      addStep(
        "rbx_get_instance_properties",
        "Inspect instance state, properties, tags, and attributes for the target path.",
        {
          studio_port: input.studio_port,
          path: "game.Workspace.Target",
        },
        "Property and metadata changes should start with current state.",
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
    if (/create|spawn|add instance|new part|insert/u.test(goal)) {
      addStep(
        "rbx_create_instance",
        "Create the required Roblox instance under the intended parent path.",
        {
          studio_port: input.studio_port,
          parent_path: "game.Workspace",
          class_name: "Part",
        },
        "Creation requests map directly to the instance creation tool.",
      );
    }
    if (/delete|remove|destroy/u.test(goal)) {
      addStep(
        "rbx_delete_instance",
        "Delete the targeted Roblox instance by path.",
        {
          studio_port: input.studio_port,
          path: "game.Workspace.Target",
        },
        "Removal requests map directly to deletion.",
      );
    }
    if (/move|reparent|parent/u.test(goal)) {
      addStep(
        "rbx_move_instance",
        "Reparent the target instance to the desired location.",
        {
          studio_port: input.studio_port,
          path: "game.Workspace.Target",
          new_parent_path: "game.ReplicatedStorage",
        },
        "Parenting changes are best handled with the move tool.",
      );
    }
    if (/clone|duplicate|copy/u.test(goal)) {
      addStep(
        "rbx_clone_instance",
        "Clone the target instance for safe iteration or duplication.",
        {
          studio_port: input.studio_port,
          path: "game.Workspace.Template",
        },
        "Duplication requests map directly to cloning.",
      );
    }
    if (/select|selection/u.test(goal)) {
      addStep(
        "rbx_get_selection",
        "Read the current Studio selection to target edits precisely.",
        { studio_port: input.studio_port },
        "Selection-aware workflows should confirm Studio context first.",
      );
    }
    if (/playtest|play test|run game|stop test/u.test(goal)) {
      addStep(
        "rbx_start_playtest",
        "Start a Studio playtest in the requested mode.",
        { studio_port: input.studio_port, mode: "play" as const },
        "Playtest workflows should explicitly start or stop simulation.",
      );
      addStep(
        "rbx_get_output",
        "Inspect recent Studio output for runtime errors during the playtest.",
        { studio_port: input.studio_port, limit: 100 },
        "Playtest debugging depends on runtime output.",
      );
      addStep(
        "rbx_playtester",
        "Run a guided playtest scenario and collect structured evidence.",
        {
          studio_port: input.studio_port,
          action: "run_scenario" as const,
          scenario_preset: "spawn_flow" as const,
        },
        "Scenario-based playtests provide reusable verification and evidence capture.",
      );
    }
    if (/maturity|age rating|violence|profanity|social link|gambling/u.test(goal)) {
      addStep(
        "rbx_content_maturity_check",
        "Scan the experience for heuristic content maturity and policy review risks.",
        {
          studio_port: input.studio_port,
          ...(input.api_key ? { api_key: input.api_key } : {}),
          ...(input.universe_id ? { universe_id: input.universe_id } : {}),
        },
        "The goal mentions age-rating or content-policy risk areas.",
      );
    }
    if (/teleport|place transition|portal/u.test(goal)) {
      addStep(
        "rbx_teleport_graph_audit",
        "Audit teleport targets, loops, and broken PlaceId references.",
        {
          studio_port: input.studio_port,
          ...(input.api_key ? { api_key: input.api_key } : {}),
          ...(input.universe_id ? { universe_id: input.universe_id } : {}),
        },
        "Teleport-related goals benefit from graph validation.",
      );
    }
    if (/package|drift|fork|version mismatch/u.test(goal)) {
      addStep(
        "rbx_package_drift_audit",
        "Inspect PackageLink instances for drift and stale versions.",
        { studio_port: input.studio_port },
        "Package maintenance goals require version drift inspection.",
      );
    }
    if (
      /publish place|publish build|ship place/u.test(goal) &&
      input.api_key &&
      input.universe_id
    ) {
      addStep(
        "rbx_publish_place",
        "Publish the target place version through Open Cloud.",
        {
          api_key: input.api_key,
          universe_id: input.universe_id,
          place_id: "PLACE_ID",
          version_type: "Published" as const,
        },
        "Explicit place publishing requests map to the publish tool.",
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
