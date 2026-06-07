--!strict
-- Flags scripts that connect to PromptProductPurchaseFinished or
-- PromptPurchaseFinished to grant items. These signals fire client-side and
-- can be spoofed; item grants must go through ProcessReceipt on the server.
local Source = require(script.Parent.Parent.Parent.util.Source)

local Rule = {
	id = "grant-on-prompt-finished",
	title = "Item grant hooked to PromptPurchaseFinished instead of ProcessReceipt",
	category = "monetization",
	kind = "source",
	severity = "high",
	description = "Granting items via PromptProductPurchaseFinished is exploitable; use ProcessReceipt.",
	docs = "https://create.roblox.com/docs/reference/engine/classes/MarketplaceService#ProcessReceipt",
	defaultEnabled = true,
	tags = { "monetization", "security", "developer-products" },
}

local SIGNALS = {
	"PromptProductPurchaseFinished",
	"PromptPurchaseFinished",
}

-- Grant-like tokens: a .Value write, += / -= mutation, :FireServer call,
-- or a function/keyword that implies giving something to the player.
-- We match the keyword as a prefix (allowing compound names like grantItem, giveReward).
local GRANT_PATTERNS = {
	"%.Value%s*[%+%-]?=",
	":FireServer%s*%(",
	"[Gg]ive%u?[%w]*%s*%(",
	"[Gg]rant%u?[%w]*%s*%(",
	"[Rr]eward%u?[%w]*%s*%(",
	"[Uu]nlock%u?[%w]*%s*%(",
}

local function hasGrantContext(stripped: string): boolean
	for _, pat in GRANT_PATTERNS do
		if Source.has(stripped, pat) then
			return true
		end
	end
	return false
end

function Rule.run(ctx)
	local findings = {}

	for _, scriptRec in ctx.inventory.scripts do
		local stripped = Source.strip(scriptRec.source)

		-- Only flag when the handler also contains grant-like mutation.
		if not hasGrantContext(stripped) then
			continue
		end

		for _, signal in SIGNALS do
			-- Look for :Connect( or :connect( after the signal name
			if
				stripped:find("%." .. signal .. "%s*[:%.]%s*[Cc]onnect%s*%(") ~= nil
				or stripped:find("%." .. signal .. "%s*=%s*function") ~= nil
			then
				local pos = stripped:find("%." .. signal)
				local line = if pos then Source.lineOf(scriptRec.source, pos) else nil
				table.insert(findings, {
					title = ("'%s' connects to %s"):format(scriptRec.name, signal),
					detail = ("'%s' hooks %s to grant items or respond to purchases. This signal fires on the client and can be faked by exploiters; item grants must only happen inside MarketplaceService.ProcessReceipt on the server."):format(
						scriptRec.name,
						signal
					),
					fix = "Remove the "
						.. signal
						.. " handler and move all grant logic into MarketplaceService.ProcessReceipt on a server Script.",
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
