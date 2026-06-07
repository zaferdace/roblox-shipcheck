--!strict
-- The rules engine: runs every enabled rule under per-rule pcall isolation so one
-- bad rule (or one malformed finding) never aborts a scan, and normalizes output.
local Severity = require(script.Parent.Severity)
local Categories = require(script.Parent.Categories)

local Engine = {}
Engine.__index = Engine

local VALID_CONFIDENCE = { exact = true, heuristic = true }

function Engine.new(rules)
	return setmetatable({ rules = rules }, Engine)
end

local function isEnabled(rule, config): boolean
	local override = config[rule.id .. ".enabled"]
	if override ~= nil then
		return override == true
	end
	return rule.defaultEnabled ~= false
end

-- Builds a normalized Finding from a rule + its raw emission. Throws on a finding
-- that is structurally invalid; the caller pcalls this so a bad finding is dropped,
-- not fatal.
local function normalizeFinding(rule, raw)
	assert(type(raw) == "table", "finding must be a table")
	assert(type(raw.title) == "string", "finding.title must be a string")

	local severity = raw.severity or rule.severity
	if not Severity.isValid(severity) then
		severity = "medium"
	end

	local confidence = raw.confidence
	if confidence == nil then
		confidence = if rule.kind == "source" then "heuristic" else "exact"
	elseif not VALID_CONFIDENCE[confidence] then
		confidence = "heuristic"
	end

	local subjects = raw.subjects
	if subjects == nil and raw.path ~= nil then
		subjects = { { path = raw.path } }
	end
	subjects = subjects or {}

	local primaryPath: string? = nil
	if subjects[1] ~= nil then
		primaryPath = subjects[1].path
	end

	return {
		ruleId = rule.id,
		category = rule.category,
		severity = severity,
		confidence = confidence,
		title = raw.title,
		detail = raw.detail or "",
		fix = raw.fix or "",
		subjects = subjects,
		primaryPath = primaryPath,
		evidence = raw.evidence,
		docs = raw.docs or rule.docs,
	}
end

-- Returns (findings, rulesRun, rulesErrored).
function Engine:run(ctx)
	local findings = {}
	local rulesRun = 0
	local rulesErrored = 0
	local config = ctx.config or {}

	for _, rule in self.rules do
		if not isEnabled(rule, config) then
			continue
		end
		rulesRun += 1

		local ok, result = pcall(rule.run, ctx)
		if not ok or type(result) ~= "table" then
			rulesErrored += 1
			continue
		end

		for _, raw in result do
			local okNorm, finding = pcall(normalizeFinding, rule, raw)
			if okNorm then
				table.insert(findings, finding)
			else
				rulesErrored += 1
			end
		end
	end

	return findings, rulesRun, rulesErrored
end

-- Dev/test-time registry validation. Returns an array of human-readable problems;
-- an empty array means the registry is well-formed. Gated by a unit test.
function Engine.validate(rules): { string }
	local problems = {}
	local seen = {}

	for index, rule in rules do
		if type(rule) ~= "table" then
			table.insert(problems, ("rule #%d is not a table"):format(index))
			continue
		end
		if type(rule.id) ~= "string" then
			table.insert(problems, ("rule #%d is missing a string id"):format(index))
			continue
		end
		if seen[rule.id] then
			table.insert(problems, "duplicate rule id: " .. rule.id)
		end
		seen[rule.id] = true

		if not Categories.exists(rule.category) then
			table.insert(
				problems,
				("rule '%s' has unknown category '%s'"):format(rule.id, tostring(rule.category))
			)
		end
		if type(rule.run) ~= "function" then
			table.insert(problems, ("rule '%s' is missing run()"):format(rule.id))
		end
		if not Severity.isValid(rule.severity) then
			table.insert(problems, ("rule '%s' has an invalid default severity"):format(rule.id))
		end
		if rule.kind ~= "property" and rule.kind ~= "source" then
			table.insert(problems, ("rule '%s' has an invalid kind"):format(rule.id))
		end
	end

	return problems
end

return Engine
