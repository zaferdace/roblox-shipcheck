--!strict
-- Shared type contract for the pure rules engine. Type-only module: returns an
-- empty table but exports the types every other core module references.
local Types = {}

export type Severity = "blocker" | "high" | "medium" | "low"
export type Confidence = "exact" | "heuristic"
export type RuleKind = "property" | "source"
export type Verdict = "SHIP" | "REVIEW" | "HOLD"

-- A normalized snapshot of one DataModel instance. The service layer extracts the
-- handful of properties each rule needs into `props` (plain strings/numbers/bools)
-- so rules never touch live Instances or Roblox enums and stay headless-testable.
export type InstanceRecord = {
	path: string,
	name: string,
	className: string,
	container: string,
	props: { [string]: any },
}

export type ScriptRecord = {
	path: string,
	name: string,
	className: string,
	container: string,
	props: { [string]: any },
	source: string,
	runContext: string,
	isServer: boolean,
	isClient: boolean,
}

export type ServiceSnapshot = {
	workspace: { [string]: any },
	lighting: { [string]: any },
	players: { [string]: any },
	httpService: { [string]: any },
	soundService: { [string]: any },
}

export type Inventory = {
	-- `parts` contains EVERY BasePart (Part, MeshPart, UnionOperation, etc.);
	-- meshParts/unions are subsets for shape-specific rules.
	parts: { InstanceRecord },
	meshParts: { InstanceRecord },
	unions: { InstanceRecord },
	decals: { InstanceRecord },
	textures: { InstanceRecord },
	images: { InstanceRecord },
	sounds: { InstanceRecord },
	lights: { InstanceRecord },
	guiObjects: { InstanceRecord },
	textObjects: { InstanceRecord },
	remotes: { InstanceRecord },
	spawns: { InstanceRecord },
	scripts: { ScriptRecord },
	instancesByClass: { [string]: number },
	totalInstances: number,
	services: ServiceSnapshot,
}

export type ScanContext = {
	inventory: Inventory,
	-- Open config map. Convention: per-rule overrides are keyed `<ruleId>.enabled`
	-- (boolean) and `<ruleId>.<thresholdName>` (number/string).
	config: { [string]: any },
}

-- One instance a finding points at (for jump-to-instance and bulk remediation).
export type Subject = {
	path: string,
	className: string?,
	role: string?,
}

-- Optional structured evidence backing a finding.
export type Evidence = {
	line: number?,
	snippet: string?,
	value: any?,
	threshold: any?,
	count: number?,
}

-- What a rule emits. The engine fills ruleId / category / confidence / primaryPath.
-- A rule may pass a single `path` as shorthand for `subjects = { { path = path } }`.
export type RawFinding = {
	severity: Severity?,
	title: string,
	detail: string,
	fix: string,
	path: string?,
	subjects: { Subject }?,
	evidence: Evidence?,
	confidence: Confidence?,
	docs: string?,
}

export type Finding = {
	ruleId: string,
	category: string,
	severity: Severity,
	confidence: Confidence,
	title: string,
	detail: string,
	fix: string,
	subjects: { Subject },
	primaryPath: string?,
	evidence: Evidence?,
	docs: string?,
}

export type Rule = {
	id: string,
	title: string,
	category: string,
	kind: RuleKind,
	severity: Severity,
	description: string,
	docs: string?,
	defaultEnabled: boolean,
	tags: { string }?,
	autoFixable: boolean?,
	run: (ctx: ScanContext) -> { RawFinding },
}

export type Summary = {
	blocker: number,
	high: number,
	medium: number,
	low: number,
	total: number,
}

export type Report = {
	verdict: Verdict,
	score: number,
	summary: Summary,
	findings: { Finding },
	rulesRun: number,
	rulesErrored: number,
}

return Types
