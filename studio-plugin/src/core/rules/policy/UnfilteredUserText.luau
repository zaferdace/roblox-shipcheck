--!strict
-- Flags scripts that read TextBox.Text and assign it to a shared label without
-- going through Roblox's text-filtering APIs (FilterStringAsync / GetNonChatStringForBroadcastAsync).
-- Heuristic, conservative: only flags when BOTH the read AND an assignment to a label are present
-- AND neither filtering call appears anywhere in the same script.
local Source = require(script.Parent.Parent.Parent.util.Source)

local Rule = {
	id = "unfiltered-user-text",
	title = "TextBox value assigned to label without text filtering",
	category = "policy",
	kind = "source",
	severity = "medium",
	description = "Reading TextBox.Text and displaying it to other players without FilterStringAsync can expose chat-policy violations.",
	docs = "https://create.roblox.com/docs/chat/filtering-text",
	defaultEnabled = true,
	tags = { "safety", "text-filtering", "moderation" },
}

-- Returns true when the script has strong evidence of sharing TextBox input beyond
-- the local UI:
--   • fires it to the server via :FireServer (remote replication)
--   • places it in a SurfaceGui (world-visible to all players)
--   • writes it to a DIFFERENT identifier's .Text property: heuristic requires that
--     the number of distinct .Text-write identifiers is less than the total .Text
--     read count (i.e. there is a TextBox read and a separate destination write).
local function hasSharedWrite(stripped: string): boolean
	-- Strongest signals: server replication or world-visible surface.
	if Source.has(stripped, ":FireServer%s*%(") then
		return true
	end
	if Source.has(stripped, "SurfaceGui") then
		return true
	end
	-- Weaker signal: require at least 2 DIFFERENT identifiers before .Text
	-- (one for the TextBox source, one for the label destination).
	-- Collect all identifiers immediately preceding .Text[ =\n:(]
	-- Pattern: captures the word directly before .Text
	local idents = {}
	for ident in stripped:gmatch("([%w_]+)%.Text[^%w_]") do
		idents[ident] = (idents[ident] or 0) + 1
	end
	local distinctIdents = 0
	for _ in idents do
		distinctIdents += 1
	end
	-- Two or more distinct identifiers before .Text means a source (TextBox) and
	-- a destination (label) are both present.
	return distinctIdents >= 2
end

function Rule.run(ctx)
	local findings = {}

	for _, scriptRec in ctx.inventory.scripts do
		local stripped = Source.strip(scriptRec.source)

		-- Must reference TextBox (class name) and read .Text
		if not Source.has(stripped, "TextBox") then
			continue
		end
		if not Source.has(stripped, "%.Text[^%w_]") and not Source.has(stripped, "%.Text$") then
			continue
		end

		-- If the script already calls either filtering API, let it pass
		if
			Source.has(stripped, "FilterStringAsync")
			or Source.has(stripped, "GetNonChatStringForBroadcastAsync")
		then
			continue
		end

		-- Require evidence the text value is shared beyond the local box.
		if not hasSharedWrite(stripped) then
			continue
		end

		local pos = Source.findMethodCall(stripped, "Text") or stripped:find("%.Text[^%w_]")
		local line = if pos then Source.lineOf(scriptRec.source, pos) else nil

		table.insert(findings, {
			title = ("'%s' may display unfiltered TextBox input"):format(scriptRec.name),
			detail = "The script reads a TextBox value and assigns it to a label without calling FilterStringAsync or GetNonChatStringForBroadcastAsync. Showing unfiltered player text to other players violates Roblox policy.",
			fix = "Pass the TextBox string through TextService:FilterStringAsync before assigning it to any visible label.",
			path = scriptRec.path,
			evidence = { line = line },
		})
	end

	return findings
end

return Rule
