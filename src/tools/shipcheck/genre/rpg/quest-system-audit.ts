import { z } from "zod";
import { StudioBridgeClient } from "../../../../roblox/studio-bridge-client.js";
import { createResponseEnvelope, sourceInfo } from "../../../../shared.js";
import type { AuditIssue } from "../../../../shared.js";
import type { StudioSearchMatch } from "../../../../types/roblox.js";
import type { ResponseEnvelope } from "../../../../types/tools.js";
import { registerTool } from "../../../registry.js";

const schema = z.object({
  studio_port: z.number().int().positive().default(33796),
});

interface QuestSystemResult {
  quests_found: number;
  chain_issues: string[];
  reward_issues: string[];
  persistence_check: boolean;
  issues: AuditIssue[];
}

export async function runQuestSystemAudit(
  input: z.infer<typeof schema>,
): Promise<ResponseEnvelope<QuestSystemResult>> {
  const client = new StudioBridgeClient({ port: input.studio_port });
  await client.ping();

  const issues: AuditIssue[] = [];
  const chainIssues: string[] = [];
  const rewardIssues: string[] = [];

  const questMatches = await client.searchInstances({
    query: "Quest",
    search_type: "name",
    case_sensitive: false,
    max_results: 200,
  });
  const questArray: StudioSearchMatch[] = Array.isArray(questMatches) ? questMatches : [];

  const questScriptMatches = await client.searchInstances({
    query: "Quest",
    search_type: "script_content",
    case_sensitive: false,
    max_results: 100,
  });
  const questScriptArray: StudioSearchMatch[] = Array.isArray(questScriptMatches) ? questScriptMatches : [];

  const questsFound = questArray.length + questScriptArray.length;

  const rewardMatches = await client.searchInstances({
    query: "Reward",
    search_type: "name",
    case_sensitive: false,
    max_results: 100,
  });
  const rewardArray: StudioSearchMatch[] = Array.isArray(rewardMatches) ? rewardMatches : [];

  const rewardScriptMatches = await client.searchInstances({
    query: "GiveReward",
    search_type: "script_content",
    case_sensitive: false,
    max_results: 30,
  });
  const rewardScriptArray: StudioSearchMatch[] = Array.isArray(rewardScriptMatches) ? rewardScriptMatches : [];

  const totalRewards = rewardArray.length + rewardScriptArray.length;

  if (questsFound > 0 && totalRewards === 0) {
    rewardIssues.push("No reward definitions or GiveReward calls found");
    issues.push({
      severity: "high",
      element_path: "ServerScriptService",
      rule: "no_quest_rewards",
      message: "Quest system found but no reward logic detected.",
      suggestion: "Implement GiveReward or equivalent for each quest completion.",
    });
  }

  if (questsFound > 5 && totalRewards < questsFound / 2) {
    rewardIssues.push(`Only ${totalRewards} reward references for ${questsFound} quests`);
    issues.push({
      severity: "medium",
      element_path: "ServerScriptService",
      rule: "incomplete_quest_rewards",
      message: `${questsFound} quests found but only ${totalRewards} reward references — some quests may have no reward.`,
      suggestion: "Ensure every quest has a corresponding reward defined.",
    });
  }

  const nextQuestMatches = await client.searchInstances({
    query: "NextQuest",
    search_type: "script_content",
    case_sensitive: false,
    max_results: 30,
  });
  const nextQuestArray: StudioSearchMatch[] = Array.isArray(nextQuestMatches) ? nextQuestMatches : [];

  const chainCompleteMatches = await client.searchInstances({
    query: "QuestComplete",
    search_type: "script_content",
    case_sensitive: false,
    max_results: 30,
  });
  const chainCompleteArray: StudioSearchMatch[] = Array.isArray(chainCompleteMatches) ? chainCompleteMatches : [];

  if (questsFound > 3 && nextQuestArray.length === 0 && chainCompleteArray.length === 0) {
    chainIssues.push("No quest chaining logic detected (NextQuest or QuestComplete)");
    issues.push({
      severity: "medium",
      element_path: "ServerScriptService",
      rule: "no_quest_chaining",
      message: "Multiple quests found but no chain progression logic detected.",
      suggestion: "Implement NextQuest references or QuestComplete callbacks to chain quests together.",
    });
  }

  const dsMatches = await client.searchInstances({
    query: "DataStore",
    search_type: "script_content",
    case_sensitive: false,
    max_results: 30,
  });
  const dsArray: StudioSearchMatch[] = Array.isArray(dsMatches) ? dsMatches : [];
  const persistenceCheck = dsArray.length > 0;

  if (!persistenceCheck && questsFound > 0) {
    issues.push({
      severity: "high",
      element_path: "ServerScriptService",
      rule: "no_quest_persistence",
      message: "No DataStore detected — quest progress will not persist between sessions.",
      suggestion: "Save quest progress to DataStore on completion and load it on player join.",
    });
  }

  if (questsFound === 0) {
    issues.push({
      severity: "medium",
      element_path: "ServerScriptService",
      rule: "no_quest_system",
      message: "No quest-related instances or scripts detected.",
      suggestion: "Add a quest system with defined objectives, chains, and rewards.",
    });
  }

  return createResponseEnvelope(
    {
      quests_found: questsFound,
      chain_issues: chainIssues,
      reward_issues: rewardIssues,
      persistence_check: persistenceCheck,
      issues,
    },
    { source: sourceInfo({ studio_port: input.studio_port }) },
  );
}

registerTool({
  name: "rbx_rpg_quest_system_audit",
  description:
    "Audit quest definitions, progression chains, dead-end quests, and reward consistency",
  schema,
  handler: runQuestSystemAudit,
});
