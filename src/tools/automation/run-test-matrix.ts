import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import { StudioBridgeClient } from "../../roblox/studio-bridge-client.js";
import { createResponseEnvelope } from "../../shared.js";
import type { TestCaseResult, TestConfig } from "../../types/roblox.js";
import { registerTool } from "../registry.js";

const schema = z.object({
  studio_port: z.number().int().positive().default(33796),
  test_filter: z.string().optional(),
  configurations: z
    .array(z.enum(["server", "client", "multi_client"]))
    .min(1)
    .default(["server"]),
  multi_client_count: z.number().int().min(2).max(8).default(2),
  timeout_seconds: z.number().int().min(5).max(600).default(60),
});

registerTool({
  name: "rbx_run_test_matrix",
  description: "Run Roblox TestService suites across server and client configurations.",
  schema,
  handler: async (input) => {
    const client = new StudioBridgeClient({ port: input.studio_port, timeout: 15_000 });
    await client.ping();
    const startedAt = Date.now();
    const results: Array<{
      type: TestConfig["configuration"];
      run_id: string;
      status: string;
      results: TestCaseResult[];
      summary: ReturnType<typeof summarizeTests>;
    }> = [];
    const flakyCounter = new Map<string, Set<string>>();

    for (const configuration of input.configurations) {
      const runConfig: TestConfig = {
        configuration,
        timeoutSeconds: input.timeout_seconds,
        ...(input.test_filter ? { testFilter: input.test_filter } : {}),
        ...(configuration === "multi_client" ? { multiClientCount: input.multi_client_count } : {}),
      };
      const run = await client.runTests(runConfig);
      const deadline = Date.now() + input.timeout_seconds * 1000;
      let finalResult = await client.getTestResults(run.runId);
      while (finalResult.status === "queued" || finalResult.status === "running") {
        if (Date.now() > deadline) {
          throw new Error(`Timed out waiting for test run ${run.runId} (${configuration})`);
        }
        await sleep(1000);
        finalResult = await client.getTestResults(run.runId);
      }
      for (const test of finalResult.results) {
        const statuses = flakyCounter.get(test.name) ?? new Set<string>();
        statuses.add(test.status);
        flakyCounter.set(test.name, statuses);
      }
      const summary = summarizeTests(finalResult.results);
      results.push({
        type: configuration,
        run_id: run.runId,
        status: finalResult.status,
        results: finalResult.results,
        summary,
      });
    }

    const allTests = results.flatMap((entry) => entry.results);
    const passCount = allTests.filter((test) => test.status === "pass").length;
    const flaky = [...flakyCounter.entries()]
      .filter(([, statuses]) => statuses.size > 1)
      .map(([name]) => name);

    return createResponseEnvelope(
      {
        configurations: results,
        overall: {
          pass_rate:
            allTests.length === 0 ? 0 : Number(((passCount / allTests.length) * 100).toFixed(2)),
          total_duration_ms: Date.now() - startedAt,
          slowest_tests: [...allTests]
            .sort((a, b) => b.durationMs - a.durationMs)
            .slice(0, 5)
            .map((test) => ({
              name: test.name,
              duration_ms: test.durationMs,
              status: test.status,
            })),
          flaky_tests: flaky,
        },
      },
      {
        source: { studio_port: input.studio_port },
      },
    );
  },
});

function summarizeTests(results: TestCaseResult[]): {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  errored: number;
} {
  return results.reduce(
    (summary, result) => {
      summary.total += 1;
      if (result.status === "pass") {
        summary.passed += 1;
      } else if (result.status === "fail") {
        summary.failed += 1;
      } else if (result.status === "skip") {
        summary.skipped += 1;
      } else {
        summary.errored += 1;
      }
      return summary;
    },
    { total: 0, passed: 0, failed: 0, skipped: 0, errored: 0 },
  );
}
