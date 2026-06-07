--!strict
-- Flags projects where server scripts grant in-game currency (write leaderstats
-- values, reference Cash/Coins, or implement ProcessReceipt) but no script
-- anywhere calls LogEconomyEvent. Cross-script check: one finding at project level.
local Source = require(script.Parent.Parent.Parent.util.Source)

local Rule = {
	id = "missing-economy-events",
	title = "Currency granted without LogEconomyEvent",
	category = "analytics",
	kind = "source",
	severity = "medium",
	description = "Server scripts grant currency but no LogEconomyEvent call exists, so economy flows are invisible in the analytics dashboard.",
	docs = "https://create.roblox.com/docs/production/analytics/economy-events",
	defaultEnabled = true,
	tags = { "analytics", "economy" },
}

-- A grant is detected when a server script writes to a named currency Value object
-- that is a child of leaderstats, OR implements ProcessReceipt, AND contains a
-- grant operator (+=, or the value is increased/set in context of a grant).
-- Generic words like "gold" without a leaderstats/Value write context are NOT flagged.
--
-- Accepted patterns (all must be in a server script):
--   1. ProcessReceipt assignment (canonical grant path)
--   2. leaderstats child Value write: leaderstats.Cash.Value += / =
--   3. Named currency Value write where the variable is explicitly Cash/Coins/Gems/Robux/Tokens
--      AND there is a += or explicit assignment that isn't a read comparison.

-- Named currency Value objects that are economy-specific (not generic words)
local NAMED_CURRENCY_PATTERNS = {
	'[Ff]ind[Ff]irst[Cc]hild%s*%(%s*"Cash"',
	'[Ff]ind[Ff]irst[Cc]hild%s*%(%s*"Coins"',
	'[Ff]ind[Ff]irst[Cc]hild%s*%(%s*"Gems"',
	'[Ff]ind[Ff]irst[Cc]hild%s*%(%s*"Robux"',
	'[Ff]ind[Ff]irst[Cc]hild%s*%(%s*"Tokens"',
	-- direct property access on well-known names
	"[^%w_][Cc]ash%.Value",
	"[^%w_][Cc]oins%.Value",
	"[^%w_][Gg]ems%.Value",
	"[^%w_][Tt]okens%.Value",
}

-- The write must be an increment/decrement or a plain assignment (not ==).
local WRITE_INDICATORS = {
	"%.Value%s*%+=",
	"%.Value%s*%-=",
	-- plain assignment but not ==: Value%s*=[^=]
	"%.Value%s*=[^=]",
	"ProcessReceipt%s*=",
}

local function scriptGrantsCurrency(stripped: string): boolean
	-- Check ProcessReceipt (always a grant context when assigned)
	if Source.has(stripped, "ProcessReceipt%s*=") then
		return true
	end

	-- Check leaderstats + value write
	if Source.has(stripped, "leaderstats") then
		for _, indicator in WRITE_INDICATORS do
			if Source.has(stripped, indicator) then
				return true
			end
		end
	end

	-- Check named currency + value write
	local hasCurrencyRef = false
	for _, pattern in NAMED_CURRENCY_PATTERNS do
		if Source.has(stripped, pattern) then
			hasCurrencyRef = true
			break
		end
	end
	if hasCurrencyRef then
		for _, indicator in WRITE_INDICATORS do
			if Source.has(stripped, indicator) then
				return true
			end
		end
	end

	return false
end

function Rule.run(ctx)
	local grantsCurrency = false
	local hasEconomyEvent = false

	for _, scriptRec in ctx.inventory.scripts do
		local stripped = Source.strip(scriptRec.source)

		if scriptRec.isServer and scriptGrantsCurrency(stripped) then
			grantsCurrency = true
		end

		if Source.hasMethodCall(stripped, "LogEconomyEvent") then
			hasEconomyEvent = true
		end
	end

	if not grantsCurrency or hasEconomyEvent then
		return {}
	end

	return {
		{
			title = "Currency is granted but LogEconomyEvent is never called",
			detail = "Server scripts write currency values (leaderstats, Cash, Coins, ProcessReceipt, or similar) but no script calls AnalyticsService:LogEconomyEvent. Economy flows will not appear in the Roblox analytics economy dashboard.",
			fix = "Call AnalyticsService:LogEconomyEvent on the server whenever currency is granted or spent, passing the flow type (SourceSink), currency name, amount, and balance.",
		},
	}
end

return Rule
