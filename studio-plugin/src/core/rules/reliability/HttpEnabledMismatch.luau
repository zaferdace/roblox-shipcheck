--!strict
-- Flags scripts that call HttpService while HTTP requests are disabled (runtime errors).
local Source = require(script.Parent.Parent.Parent.util.Source)

local Rule = {
	id = "httpenabled-mismatch",
	title = "HttpService used but HttpEnabled is off",
	category = "reliability",
	kind = "source",
	severity = "medium",
	description = "Scripts call HttpService but Game Settings has HTTP disabled, so the calls error at runtime.",
	docs = "https://create.roblox.com/docs/reference/engine/classes/HttpService",
	defaultEnabled = true,
	tags = { "http" },
}

local HTTP_CALLS = { "RequestAsync", "PostAsync", "GetAsync" }

function Rule.run(ctx)
	if ctx.inventory.services.httpService.httpEnabled ~= false then
		return {}
	end

	for _, scriptRec in ctx.inventory.scripts do
		local source = Source.strip(scriptRec.source)
		local withStrings = Source.stripComments(scriptRec.source)
		if Source.usesService(withStrings, "HttpService") then
			for _, call in HTTP_CALLS do
				if Source.hasMethodCall(source, call) then
					return {
						{
							title = "Scripts use HttpService but HttpEnabled is off",
							detail = ("'%s' calls HttpService:%s but HTTP requests are disabled in Game Settings, so the calls will error at runtime."):format(
								scriptRec.name,
								call
							),
							fix = "Enable HTTP requests in Game Settings > Security, or remove the HttpService calls.",
							path = scriptRec.path,
						},
					}
				end
			end
		end
	end

	return {}
end

return Rule
