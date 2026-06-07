--!strict
-- Flags server scripts that register OnServerEvent or OnServerInvoke handlers
-- but contain no input-validation tokens (typeof(, type(, assert() anywhere in
-- the file — a strong signal that untrusted client data goes unchecked.
local Source = require(script.Parent.Parent.Parent.util.Source)

local Rule = {
	id = "remote-no-server-validation",
	title = "RemoteEvent/Function handler with no input validation",
	category = "security",
	kind = "source",
	severity = "blocker",
	description = "Server remote handlers that skip typeof/type/assert let clients send arbitrary data, enabling exploits.",
	docs = "https://create.roblox.com/docs/scripting/security/security-tactics#validate-client-input",
	defaultEnabled = true,
	tags = { "remotes", "exploits", "trust-boundary" },
}

-- Tokens whose presence anywhere in the file suggests the author performs validation.
local VALIDATION_TOKENS = {
	"typeof%s*%(",
	"type%s*%(",
	"[^%w_]assert%s*%(",
}

-- Handler patterns in stripped source.
-- OnServerEvent is a property (accessed with `.`), not a method; the Connect
-- call uses `:Connect(` on that property: `remote.OnServerEvent:Connect(fn)`.
-- OnServerInvoke is assigned as a callback: `remote.OnServerInvoke = function`.
local HANDLER_PATTERNS = {
	"OnServerEvent:Connect%s*%(",
	"OnServerInvoke%s*=",
}

function Rule.run(ctx)
	local findings = {}

	for _, scriptRec in ctx.inventory.scripts do
		if not scriptRec.isServer then
			continue
		end

		local stripped = Source.strip(scriptRec.source)

		-- Check whether this script has any remote handler.
		local hasHandler = false
		for _, pattern in HANDLER_PATTERNS do
			if Source.has(stripped, pattern) then
				hasHandler = true
				break
			end
		end

		if not hasHandler then
			continue
		end

		-- Check for any validation token anywhere in the script.
		local hasValidation = false
		for _, token in VALIDATION_TOKENS do
			if Source.has(stripped, token) then
				hasValidation = true
				break
			end
		end

		if not hasValidation then
			-- Record the line of the first handler for navigation.
			local pos: number? = nil
			for _, pattern in HANDLER_PATTERNS do
				local p = stripped:find(pattern)
				if p and (pos == nil or p < (pos :: number)) then
					pos = p
				end
			end
			local line = if pos then Source.lineOf(scriptRec.source, pos) else nil

			table.insert(findings, {
				severity = "blocker",
				title = ("'%s' handles remote calls without input validation"):format(
					scriptRec.name
				),
				detail = "The script connects an OnServerEvent or OnServerInvoke handler but contains no typeof(), type(), or assert() calls. Clients can send arbitrary values — wrong types or out-of-range numbers — and the server will process them unchecked.",
				fix = "Validate every argument from the client: use typeof() to guard types and assert() or guard clauses to enforce ranges and constraints before acting on the data.",
				path = scriptRec.path,
				evidence = { line = line },
			})
		end
	end

	return findings
end

return Rule
