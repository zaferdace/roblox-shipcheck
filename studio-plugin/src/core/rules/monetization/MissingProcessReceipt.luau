--!strict
-- Flags games that prompt developer product purchases but never assign
-- MarketplaceService.ProcessReceipt, which means all purchases are silently
-- lost (the server never grants the item or acknowledges the transaction).
local Source = require(script.Parent.Parent.Parent.util.Source)

local Rule = {
	id = "missing-processreceipt",
	title = "PromptProductPurchase used but ProcessReceipt never assigned",
	category = "monetization",
	kind = "source",
	severity = "blocker",
	description = "Developer products are prompted but ProcessReceipt is never assigned, so purchases are never fulfilled.",
	docs = "https://create.roblox.com/docs/reference/engine/classes/MarketplaceService#ProcessReceipt",
	defaultEnabled = true,
	tags = { "monetization", "developer-products" },
}

function Rule.run(ctx)
	local usesProducts = false
	local hasProcessReceipt = false

	for _, scriptRec in ctx.inventory.scripts do
		local stripped = Source.strip(scriptRec.source)

		if not usesProducts and Source.hasMethodCall(stripped, "PromptProductPurchase") then
			usesProducts = true
		end

		-- Assignment: MarketplaceService.ProcessReceipt = ...
		-- Match ".ProcessReceipt" followed eventually by "=" (not ==)
		if not hasProcessReceipt and stripped:find("%.%s*ProcessReceipt%s*=[^=]") ~= nil then
			hasProcessReceipt = true
		end
	end

	if usesProducts and not hasProcessReceipt then
		return {
			{
				severity = "blocker",
				title = "ProcessReceipt is never assigned",
				detail = "PromptProductPurchase is called, indicating developer products are in use, but no server script assigns MarketplaceService.ProcessReceipt. Without it Roblox will retry the receipt indefinitely and the item is never granted.",
				fix = "Add a server Script that assigns MarketplaceService.ProcessReceipt to a handler function that grants the product and returns Enum.ProductPurchaseDecision.PurchaseGranted.",
				evidence = {},
			},
		}
	end

	return {}
end

return Rule
