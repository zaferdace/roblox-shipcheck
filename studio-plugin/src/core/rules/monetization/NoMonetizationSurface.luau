--!strict
-- Advisory: no script anywhere references any MarketplaceService prompt,
-- UserOwnsGamePassAsync, GamePassId, or DeveloperProduct. Emits a single
-- low-severity finding so the audit report acknowledges the absence of
-- monetization rather than silently ignoring it.
local Source = require(script.Parent.Parent.Parent.util.Source)

local Rule = {
	id = "no-monetization-surface",
	title = "No monetization surface detected",
	category = "monetization",
	kind = "source",
	severity = "low",
	description = "No MarketplaceService prompts, game passes, or developer products were found in any script.",
	docs = "https://create.roblox.com/docs/production/monetization",
	defaultEnabled = true,
	tags = { "monetization", "advisory" },
}

local INDICATORS = {
	"PromptPurchase",
	"PromptProductPurchase",
	"PromptGamePassPurchase",
	"UserOwnsGamePassAsync",
	"GamePassId",
	"DeveloperProduct",
}

function Rule.run(ctx)
	for _, scriptRec in ctx.inventory.scripts do
		local stripped = Source.strip(scriptRec.source)
		for _, indicator in INDICATORS do
			if Source.has(stripped, indicator) then
				return {}
			end
		end
	end

	return {
		{
			severity = "low",
			title = "No monetization surface detected",
			detail = "No script references MarketplaceService prompts, UserOwnsGamePassAsync, GamePassId, or DeveloperProduct. This may be intentional, but if the game is meant to be monetized, review whether the integration is missing.",
			fix = "If monetization is planned, add game pass or developer product prompts via MarketplaceService and implement ProcessReceipt for developer products.",
		},
	}
end

return Rule
