--!strict
-- Turns a flat list of findings into a ship-readiness score and verdict. Pure.
local Severity = require(script.Parent.Severity)

local Scoring = {}

-- Score floor below which, even with no high/blocker findings, we still REVIEW.
local SHIP_SCORE_FLOOR = 80

-- Max points a SINGLE rule may deduct, so an instance-heavy rule (e.g. 400 small
-- unanchored parts) can't single-handedly drive the score to zero.
local PER_RULE_PENALTY_CAP = 40

function Scoring.summarize(findings: { { severity: string } })
	local summary = { blocker = 0, high = 0, medium = 0, low = 0, total = 0 }
	for _, finding in findings do
		if summary[finding.severity] ~= nil then
			summary[finding.severity] += 1
		end
		summary.total += 1
	end
	return summary
end

function Scoring.score(findings: { { severity: string, ruleId: string? } }): number
	local perRule: { [string]: number } = {}
	for _, finding in findings do
		local weight = Severity.weight[finding.severity] or 0
		local key = finding.ruleId or "_anonymous"
		perRule[key] = (perRule[key] or 0) + weight
	end

	local penalty = 0
	for _, rulePenalty in perRule do
		penalty += math.min(rulePenalty, PER_RULE_PENALTY_CAP)
	end

	return math.clamp(100 - penalty, 0, 100)
end

function Scoring.verdict(summary, score: number): string
	if summary.blocker > 0 then
		return "HOLD"
	end
	if summary.high > 0 then
		return "REVIEW"
	end
	if score >= SHIP_SCORE_FLOOR then
		return "SHIP"
	end
	return "REVIEW"
end

function Scoring.build(findings: { { severity: string, ruleId: string? } })
	local summary = Scoring.summarize(findings)
	local score = Scoring.score(findings)
	return {
		summary = summary,
		score = score,
		verdict = Scoring.verdict(summary, score),
	}
end

return Scoring
