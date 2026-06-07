--!strict
-- Flags client scripts that attempt to write authoritative game state:
-- assigning to leaderstats values, setting Humanoid.Health, or writing to
-- economy Value objects (Cash/Coins/Gold/Money).  These writes are silently
-- ignored on other clients (FilteringEnabled) or replicate only locally,
-- making the client think the operation succeeded while the server doesn't.
-- More critically, if the same pattern runs on an exploited client it can
-- feed false data upstream via RemoteEvents, so the check doubles as a hint
-- that trust is misplaced.
local Source = require(script.Parent.Parent.Parent.util.Source)

local Rule = {
	id = "client-authority-leak",
	title = "Client script writes authoritative game state",
	category = "security",
	kind = "source",
	severity = "high",
	description = "Client scripts that mutate leaderstats, Humanoid.Health, or economy values indicate misplaced trust — the server must own those writes.",
	docs = "https://create.roblox.com/docs/scripting/security/security-tactics#never-trust-the-client",
	defaultEnabled = true,
	tags = { "trust-boundary", "exploits", "economy" },
}

-- Patterns that identify a suspect expression (leaderstats/currency/Humanoid path).
-- These are matched against stripComments source (strings kept for "leaderstats" literals).
-- We only flag when the matched expression is also WRITTEN — see WRITE_SUFFIXES below.
local SUSPECT_PATTERNS = {
	-- leaderstats navigation
	'[Ff]ind[Ff]irst[Cc]hild%s*%(%s*"leaderstats"',
	"leaderstats%.",
	-- direct health assignment — already encodes the write, so no suffix needed
	"Humanoid%.Health%s*[%+%-]?=",
	-- currency value writes by name
	'[Ff]ind[Ff]irst[Cc]hild%s*%(%s*"Cash"',
	'[Ff]ind[Ff]irst[Cc]hild%s*%(%s*"Coins"',
	'[Ff]ind[Ff]irst[Cc]hild%s*%(%s*"Gold"',
	'[Ff]ind[Ff]irst[Cc]hild%s*%(%s*"Money"',
	-- direct .Value writes to common economy names
	"Cash%.Value%s*[%+%-]?=",
	"Coins%.Value%s*[%+%-]?=",
	"Gold%.Value%s*[%+%-]?=",
	"Money%.Value%s*[%+%-]?=",
}

-- For the patterns that identify an expression rather than already encoding a write,
-- we need to verify that a write operator appears on the same expression.
-- Strategy: after locating the pattern, scan the following ~120 characters for a write.
local ALREADY_WRITE_PATTERNS = {
	-- Humanoid.Health write and .Value writes encode `=` in the pattern itself
	["Humanoid%.Health%s*[%+%-]?="] = true,
	["Cash%.Value%s*[%+%-]?="] = true,
	["Coins%.Value%s*[%+%-]?="] = true,
	["Gold%.Value%s*[%+%-]?="] = true,
	["Money%.Value%s*[%+%-]?="] = true,
}

-- Returns true if the text starting at `pos` contains a write operator soon after,
-- meaning `.Value` followed by `=`, `+=`, or `-=` (but not `==`).
local function hasNearbyWrite(src: string, pos: number): boolean
	-- Scan the 200 chars after the match for a .Value write or += / -= write
	local window = src:sub(pos, pos + 200)
	-- .Value = or .Value += or .Value -=
	if window:find("%.Value%s*[%+%-]?=") and not window:find("%.Value%s*==") then
		-- Make sure the `=` isn't `==`
		local eqPos = window:find("%.Value%s*=")
		if eqPos then
			local afterEq = window:sub(eqPos):match("%.Value%s*(=+)")
			if afterEq and #afterEq == 1 then
				return true
			end
			-- handle += and -=
			if window:find("%.Value%s*[%+%-]=") then
				return true
			end
		end
	end
	-- Also catch += and -= directly on any expression in the window
	if window:find("[%+%-]=[^=]") then
		return true
	end
	return false
end

function Rule.run(ctx)
	local findings = {}

	for _, scriptRec in ctx.inventory.scripts do
		if not scriptRec.isClient then
			continue
		end

		-- Use stripComments (keeps strings) so quoted names like "leaderstats" remain matchable.
		local stripped = Source.stripComments(scriptRec.source)

		for _, pattern in SUSPECT_PATTERNS do
			local pos = stripped:find(pattern)
			if pos then
				-- If the pattern already encodes a write token, accept it directly.
				-- Otherwise require evidence of a write near the match position.
				local isWrite = ALREADY_WRITE_PATTERNS[pattern] == true
					or hasNearbyWrite(stripped, pos)
				if not isWrite then
					continue
				end

				local line = Source.lineOf(scriptRec.source, pos)
				table.insert(findings, {
					title = ("'%s' writes authoritative state from the client"):format(
						scriptRec.name
					),
					detail = "Client scripts cannot reliably mutate leaderstats, player economy values, or Humanoid.Health — those changes are local only and exploiters can manipulate them. Move writes to a server Script invoked via a validated RemoteEvent.",
					fix = "Use a RemoteEvent to request the change, then validate and apply it in a server Script. Never trust client-provided values for game-critical state.",
					path = scriptRec.path,
					evidence = { line = line },
				})
				break
			end
		end
	end

	return findings
end

return Rule
