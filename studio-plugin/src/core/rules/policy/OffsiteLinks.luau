--!strict
-- Flags off-platform links or solicitations found in script source or visible text objects.
-- Checks: discord.gg, discord.com/invite, http(s):// to non-roblox domains, "free robux".
local Source = require(script.Parent.Parent.Parent.util.Source)

local Rule = {
	id = "offsite-links",
	title = "Off-platform links or solicitations detected",
	category = "policy",
	kind = "source",
	severity = "high",
	description = "Discord links, external URLs, or 'free robux' solicitations violate Roblox Community Standards.",
	docs = "https://en.help.roblox.com/hc/en-us/articles/203313410",
	defaultEnabled = true,
	tags = { "safety", "community-standards", "links" },
}

-- Patterns checked against script source (comments stripped, strings kept)
local SCRIPT_PATTERNS = {
	{ pattern = "discord%.gg/", label = "discord.gg link" },
	{ pattern = "discord%.com/invite/", label = "discord.com/invite link" },
	{ pattern = "free%s+robux", label = '"free robux" solicitation' },
}

-- Matches http(s):// that are NOT roblox-owned domains
local function hasExternalUrl(src: string): boolean
	-- Find every http(s):// occurrence and reject if the domain is roblox
	for url in src:gmatch("https?://[%w%-%._/?=&#%%]+") do
		local domain = url:match("https?://([^/?#]+)") or ""
		-- Allow roblox.com and its subdomains
		if not domain:find("roblox%.com$") and not domain:find("%.roblox%.com$") then
			return true
		end
	end
	return false
end

function Rule.run(ctx)
	local findings = {}

	-- --- Script source scan ---
	-- Discord/free-robux patterns are always checked regardless of script side.
	-- External URLs (non-roblox https://) are only flagged for client-reachable scripts
	-- to avoid false positives on private backend URLs in server-only scripts.
	for _, scriptRec in ctx.inventory.scripts do
		-- Keep strings (URLs live in string literals); strip only comments
		local withStrings = Source.stripComments(scriptRec.source)
		local lower = withStrings:lower()

		local matched: string? = nil

		-- Discord and free-robux solicitations are policy violations regardless of context.
		for _, entry in SCRIPT_PATTERNS do
			if lower:find(entry.pattern) then
				matched = entry.label
				break
			end
		end

		-- External URLs are player-facing risk only when the script is client-reachable.
		if matched == nil and scriptRec.isClient and hasExternalUrl(withStrings) then
			matched = "external URL"
		end

		if matched ~= nil then
			table.insert(findings, {
				title = ("'%s' contains an off-platform link or solicitation"):format(
					scriptRec.name
				),
				detail = ("Detected %s in script source. Off-platform links and 'free robux' claims violate Roblox Community Standards and can trigger moderation."):format(
					matched
				),
				fix = "Remove all Discord links, external URLs, and 'free robux' references from script source.",
				path = scriptRec.path,
				evidence = { value = matched },
			})
		end
	end

	-- --- Text object scan ---
	for _, textRec in ctx.inventory.textObjects do
		local text = textRec.props and textRec.props.text or ""
		if type(text) ~= "string" or #text == 0 then
			continue
		end
		local lower = text:lower()

		local matched: string? = nil

		for _, entry in SCRIPT_PATTERNS do
			if lower:find(entry.pattern) then
				matched = entry.label
				break
			end
		end

		if matched == nil and hasExternalUrl(text) then
			matched = "external URL"
		end

		if matched ~= nil then
			table.insert(findings, {
				title = ("Text object '%s' contains an off-platform link or solicitation"):format(
					textRec.name
				),
				detail = ("Detected %s in the visible text of '%s'. Off-platform links and solicitations violate Roblox Community Standards."):format(
					matched,
					textRec.path
				),
				fix = "Remove all Discord links, external URLs, and 'free robux' references from visible text objects.",
				path = textRec.path,
				evidence = { value = matched },
			})
		end
	end

	return findings
end

return Rule
