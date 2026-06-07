--!strict
-- Advisory rule: emits ONE finding listing maturity-signal keywords found in scripts
-- (including comments) or instance names. Prompts the developer to verify the Creator
-- Hub Maturity questionnaire. Conservative substring matching on lowercased text.
local Source = require(script.Parent.Parent.Parent.util.Source)

local Rule = {
	id = "maturity-content-signals",
	title = "Possible higher-maturity content signals detected",
	category = "policy",
	kind = "source",
	severity = "medium",
	description = "Keywords associated with higher-maturity content found; verify the Creator Hub Maturity questionnaire.",
	docs = "https://create.roblox.com/docs/production/publishing/experience-maturity",
	defaultEnabled = true,
	tags = { "maturity", "content-rating", "community-standards" },
}

-- Keywords to detect. Plain lowercased substrings — intentionally broad so devs are
-- prompted to fill in the questionnaire; not a policy violation finder.
local SIGNALS = {
	"blood",
	"gore",
	"gambling",
	"casino",
	"slots",
	"alcohol",
	"vape",
}

function Rule.run(ctx)
	-- Collect all matched keywords into a set so we emit exactly one advisory finding.
	local matched: { [string]: boolean } = {}

	-- --- Script source scan: use raw source so comments are included ---
	-- We DO strip strings to avoid flagging quoted API keys / URLs that happen to
	-- contain a keyword, but comments are intentional developer text so we keep them.
	for _, scriptRec in ctx.inventory.scripts do
		-- strip only strings (invert: keep comments, blank strings)
		-- Source.stripComments blanks comments and keeps strings — we want the opposite.
		-- Scan both: raw lower covers comments; strip() covers code identifiers.
		local rawLower = scriptRec.source:lower()
		local strippedLower = Source.strip(scriptRec.source):lower()
		for _, kw in SIGNALS do
			if rawLower:find(kw, 1, true) or strippedLower:find(kw, 1, true) then
				matched[kw] = true
			end
		end
	end

	-- --- Instance name scan across all inventory arrays ---
	local nameLists = {
		ctx.inventory.parts,
		ctx.inventory.meshParts,
		ctx.inventory.scripts,
		ctx.inventory.guiObjects,
		ctx.inventory.textObjects,
		ctx.inventory.sounds,
		ctx.inventory.lights,
		ctx.inventory.remotes,
		ctx.inventory.spawns,
	}
	for _, list in nameLists do
		for _, rec in list do
			if type(rec.name) ~= "string" then
				continue
			end
			local lower = rec.name:lower()
			for _, kw in SIGNALS do
				if lower:find(kw, 1, true) then
					matched[kw] = true
				end
			end
		end
	end

	if next(matched) == nil then
		return {}
	end

	-- Build a sorted list for deterministic output
	local keywords: { string } = {}
	for kw in matched do
		table.insert(keywords, kw)
	end
	table.sort(keywords)

	local signalList = table.concat(keywords, ", ")

	return {
		{
			title = "Maturity content signals found: " .. signalList,
			detail = ("Detected keyword(s) associated with higher-maturity content (%s). This does not necessarily mean your experience violates policy, but you must accurately complete the Creator Hub Maturity questionnaire to avoid moderation."):format(
				signalList
			),
			fix = "Review your experience's Maturity settings on Creator Hub (Audience tab). If these signals appear intentionally, ensure the questionnaire reflects that accurately.",
			evidence = { value = signalList },
		},
	}
end

return Rule
