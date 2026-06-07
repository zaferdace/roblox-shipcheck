--!strict
-- Severity ordering and scoring weights. Pure data + helpers.
local Severity = {}

Severity.order = { "blocker", "high", "medium", "low" }

Severity.rank = { blocker = 4, high = 3, medium = 2, low = 1 }

-- Points deducted from the 0-100 ship-readiness score per finding of each severity.
Severity.weight = { blocker = 25, high = 12, medium = 5, low = 2 }

function Severity.isValid(value: string): boolean
	return Severity.rank[value] ~= nil
end

-- true when `a` is strictly more severe than `b`
function Severity.isMoreSevere(a: string, b: string): boolean
	return (Severity.rank[a] or 0) > (Severity.rank[b] or 0)
end

return Severity
