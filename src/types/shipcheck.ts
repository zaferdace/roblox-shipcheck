export type IssueSeverity = "blocker" | "warning" | "info";
export type IssueConfidence = "high" | "medium" | "heuristic" | "manual_review";
export type RemediationType = "auto" | "assisted" | "manual";

export interface ShipcheckIssue {
  id: string;
  title: string;
  summary: string;
  severity: IssueSeverity;
  confidence: IssueConfidence;
  category: string;
  evidence: string[];
  recommendation: string;
  remediation: RemediationType;
  source_check: string;
}

export interface ShipcheckReport {
  project_name: string;
  timestamp: string;
  verdict: "SHIP" | "HOLD" | "REVIEW";
  overall_score: number;
  summary: {
    blockers: number;
    warnings: number;
    info: number;
    manual_review_needed: number;
  };
  issues: ShipcheckIssue[];
  checks_run: string[];
}

export type PlaytestActionType =
  | "execute_code"
  | "wait"
  | "verify_state"
  | "capture_evidence"
  | "note";

export interface PlaytestAction {
  type: PlaytestActionType;
  description: string;
  code?: string;
  wait_seconds?: number;
  expected?: string;
  note?: string;
}

export interface PlaytestScenario {
  name: string;
  description: string;
  steps: PlaytestAction[];
  timeout_seconds?: number;
}

export type StepStatus = "pass" | "fail" | "skip" | "timeout" | "manual_review";

export interface PlaytestStepResult {
  step_index: number;
  action: PlaytestAction;
  status: StepStatus;
  actual_result?: string;
  error?: string;
  duration_ms: number;
  evidence?: string[];
}

export interface PlaytestResult {
  id: string;
  scenario_name: string;
  started_at: string;
  finished_at: string;
  overall_status: "pass" | "fail" | "partial" | "timeout";
  steps: PlaytestStepResult[];
  summary: string;
  issues_found: ShipcheckIssue[];
}
