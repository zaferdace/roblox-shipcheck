--!strict
-- Flags scripts that contain debug/test artifacts: excessive print() calls or
-- unguarded admin/cheat command handlers (noclip, godmode, /kill, admin cmd).
-- Conservative: prefers misses over false positives.
local Source = require(script.Parent.Parent.Parent.util.Source)

local Rule = {
	id = "leftover-debug-artifacts",
	title = "Leftover debug or test artifacts in script",
	category = "discovery",
	kind = "source",
	severity = "medium",
	description = "Script contains excessive print() calls or an unguarded admin/cheat command handler.",
	docs = "https://create.roblox.com/docs/scripting/scripts",
	defaultEnabled = true,
	tags = { "debug", "cleanup" },
}

local PRINT_THRESHOLD = 5

local CHEAT_PATTERNS = {
	"noclip",
	"godmode",
	"/kill",
	"cmd%s*==%s*[\"']admin[\"']",
	"cmd%s*==%s*[\"']god[\"']",
}

-- A handler signal indicates the cheat keyword is wired to an actual command path,
-- not just stored in a string constant or documentation comment.
local HANDLER_SIGNALS = {
	"%.Chatted",
	"OnServerEvent",
	"message%s*==",
	"msg%s*==",
	"cmd%s*==",
}

local PERMISSION_PATTERNS = {
	"UserId%s*==",
	"userId%s*==",
	"AdminIds",
	"adminIds",
	"isAdmin",
	"IsAdmin",
	"HasPermission",
	"hasPermission",
}

local function hasPermissionCheck(stripped: string): boolean
	for _, pat in PERMISSION_PATTERNS do
		if Source.has(stripped, pat) then
			return true
		end
	end
	return false
end

-- Returns true when the source contains at least one handler signal that suggests
-- the cheat keyword is actively dispatched (not merely a string constant).
local function hasHandlerSignal(src: string): boolean
	for _, pat in HANDLER_SIGNALS do
		if Source.has(src, pat) then
			return true
		end
	end
	return false
end

function Rule.run(ctx)
	local findings = {}

	for _, scriptRec in ctx.inventory.scripts do
		-- strip blanks strings (for call-pattern matching like print)
		local stripped = Source.strip(scriptRec.source)
		-- stripComments keeps strings (needed to match string literals like "noclip")
		local noComments = Source.stripComments(scriptRec.source)

		-- Check 1: excessive print() calls
		local printCount = Source.count(stripped, "[^%w_]print%s*%(")
			+ (if stripped:match("^print%s*%(") then 1 else 0)
		if printCount > PRINT_THRESHOLD then
			local freePos = scriptRec.source:find("[^%w_]print%s*%(")
				or scriptRec.source:find("^print%s*%(")
			local line = if freePos then Source.lineOf(scriptRec.source, freePos) else nil
			table.insert(findings, {
				title = ("'%s' has %d print() calls (debug artifact)"):format(
					scriptRec.name,
					printCount
				),
				detail = ("Found %d print() calls; high counts indicate debug logging left in production code."):format(
					printCount
				),
				fix = "Remove or gate debug prints behind a IS_STUDIO / _G.DEBUG flag before shipping.",
				path = scriptRec.path,
				evidence = { line = line, count = printCount, threshold = PRINT_THRESHOLD },
			})
		end

		-- Check 2: unguarded cheat/admin handler.
		-- Only flag when the cheat keyword appears AND a handler signal is present
		-- (meaning the keyword is wired to a chat/remote dispatch, not just a constant).
		-- Permission check uses stripped (code paths only).
		for _, cheatPat in CHEAT_PATTERNS do
			if Source.has(noComments, cheatPat) then
				-- Require a handler signal to avoid flagging bare string constants.
				if hasHandlerSignal(stripped) and not hasPermissionCheck(stripped) then
					local cheatPos = noComments:find(cheatPat)
					local line = if cheatPos then Source.lineOf(scriptRec.source, cheatPos) else nil
					table.insert(findings, {
						title = ("'%s' has an unguarded admin/cheat handler"):format(
							scriptRec.name
						),
						detail = ("Script matches cheat pattern '%s' with no visible permission check (UserId ==, isAdmin, etc.). This may allow any player to trigger privileged commands."):format(
							cheatPat
						),
						fix = "Add a UserId allowlist or permission check before executing privileged commands, or remove the handler before shipping.",
						path = scriptRec.path,
						evidence = { line = line },
					})
				end
				break
			end
		end
	end

	return findings
end

return Rule
