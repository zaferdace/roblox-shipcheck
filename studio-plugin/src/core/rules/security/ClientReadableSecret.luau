--!strict
-- Flags client-accessible scripts (isClient flag or placed in a client-facing
-- container) that embed secret literals such as Discord webhook URLs, Slack
-- incoming hooks, HTTP Authorization headers, or API keys.  These are visible
-- to any player who decompiles the game client.
local Source = require(script.Parent.Parent.Parent.util.Source)

local Rule = {
	id = "client-readable-secret",
	title = "Secret or webhook URL embedded in a client-readable script",
	category = "security",
	kind = "source",
	severity = "high",
	description = "Webhook URLs and API keys in client-reachable scripts are readable by any player via memory scanning or decompilation.",
	docs = "https://create.roblox.com/docs/scripting/security/security-tactics#protect-private-information",
	defaultEnabled = true,
	tags = { "secrets", "webhooks", "data-exposure" },
}

-- Containers whose contents are replicated to / readable by every client.
local CLIENT_CONTAINERS = {
	ReplicatedStorage = true,
	ReplicatedFirst = true,
	StarterGui = true,
	StarterPlayer = true,
}

-- Patterns for webhook URLs — always secret-shaped when present.
local WEBHOOK_PATTERNS = {
	"discord%.com/api/webhooks",
	"hooks%.slack%.com",
}

-- For header/key names, we require the key to be assigned to a quoted string literal
-- (i.e. an actual embedded secret value, not just a bare variable name).
-- Pattern: <key>%s*=%s*["'] — the value must begin with a quote char.
local KEY_ASSIGNMENT_PATTERNS = {
	Authorization = "Authorization%s*=%s*[\"']",
	Bearer = "Bearer%s+[%w%-_/.%%+]+",
	api_key = "api_key%s*=%s*[\"']",
	apikey = "apikey%s*=%s*[\"']",
}

local function isClientReachable(scriptRec): boolean
	if scriptRec.isClient then
		return true
	end
	-- Check top-level container name (path segment before first dot).
	local topLevel = scriptRec.container or scriptRec.path:match("^([^%.]+)") or ""
	return CLIENT_CONTAINERS[topLevel] == true
end

function Rule.run(ctx)
	local findings = {}

	for _, scriptRec in ctx.inventory.scripts do
		if not isClientReachable(scriptRec) then
			continue
		end

		-- Keep strings so we can match URL/token literals.
		local withStrings = Source.stripComments(scriptRec.source)

		local matched: string? = nil
		local matchPos: number? = nil

		-- Check webhook URLs first (always secret-shaped).
		for _, pattern in WEBHOOK_PATTERNS do
			local pos = withStrings:find(pattern)
			if pos then
				matched = pattern
				matchPos = pos
				break
			end
		end

		-- Check key assignment patterns (only flag when an actual secret value is present).
		if matched == nil then
			for label, pattern in KEY_ASSIGNMENT_PATTERNS do
				local pos = withStrings:find(pattern)
				if pos then
					matched = label
					matchPos = pos
					break
				end
			end
		end

		if matched ~= nil then
			local line = if matchPos then Source.lineOf(scriptRec.source, matchPos) else nil
			table.insert(findings, {
				title = ("'%s' contains a secret literal (%s)"):format(scriptRec.name, matched),
				detail = "This script is replicated to or executable by the client. Any player can extract its source and steal the embedded credential.",
				fix = "Move secrets server-side only. Use a secure proxy Script in ServerScriptService rather than embedding URLs or keys in replicated modules.",
				path = scriptRec.path,
				evidence = { line = line },
			})
		end
	end

	return findings
end

return Rule
