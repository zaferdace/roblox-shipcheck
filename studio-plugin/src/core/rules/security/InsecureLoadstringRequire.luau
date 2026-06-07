--!strict
-- Flags source files that contain loadstring( (remote-code execution) or
-- require() with a bare numeric asset ID (require(123456)) — both are common
-- back-door and remote-code vectors that bypass normal module boundaries.
local Source = require(script.Parent.Parent.Parent.util.Source)

local Rule = {
	id = "insecure-loadstring-require",
	title = "loadstring or numeric require detected",
	category = "security",
	kind = "source",
	severity = "high",
	description = "loadstring() or require(number) can execute arbitrary or remote code and are common backdoor vectors.",
	docs = "https://create.roblox.com/docs/scripting/security/security-tactics",
	defaultEnabled = true,
	tags = { "backdoor", "rce", "remotes" },
}

function Rule.run(ctx)
	local findings = {}

	for _, scriptRec in ctx.inventory.scripts do
		local stripped = Source.strip(scriptRec.source)

		-- loadstring(  — always suspicious regardless of context.
		local loadPos = stripped:find("[^%w_]loadstring%s*%(")
		if not loadPos then
			-- also match at start-of-file
			loadPos = stripped:find("^loadstring%s*%(")
		end

		if loadPos then
			local line = Source.lineOf(scriptRec.source, loadPos)
			table.insert(findings, {
				severity = "high",
				title = ("'%s' uses loadstring()"):format(scriptRec.name),
				detail = "loadstring() compiles and runs an arbitrary string as Lua code at runtime. If the string originates from the network, a DataStore, or a RemoteEvent, an attacker can execute any code on the server or client.",
				fix = "Remove loadstring(). If dynamic behaviour is needed, express it as data-driven configuration rather than executable strings.",
				path = scriptRec.path,
				evidence = { line = line },
			})
			-- Don't double-report the same script; move on.
			continue
		end

		-- require(  followed by a bare integer (no quote, no variable).
		local reqPos = stripped:find("[^%w_]require%s*%(%s*%d+%s*%)")
		if not reqPos then
			reqPos = stripped:find("^require%s*%(%s*%d+%s*%)")
		end

		if reqPos then
			local line = Source.lineOf(scriptRec.source, reqPos)
			table.insert(findings, {
				severity = "high",
				title = ("'%s' uses require() with a numeric asset ID"):format(scriptRec.name),
				detail = "require(number) loads a module by its Roblox asset ID rather than a local instance reference. The asset could be updated or replaced by its owner without any change to your place, silently altering game logic.",
				fix = "Replace require(assetId) with require(path.To.Module) using a proper instance reference so the dependency is locked to your project.",
				path = scriptRec.path,
				evidence = { line = line },
			})
		end
	end

	return findings
end

return Rule
