--!strict
-- Reads a LuaSourceContainer's source, preferring the forward-compatible
-- ScriptEditorService path and falling back to the legacy .Source property.
local ScriptEditorService = game:GetService("ScriptEditorService")

local ScriptReader = {}

function ScriptReader.read(instance: LuaSourceContainer): string
	local ok, editorSource = pcall(function()
		return ScriptEditorService:GetEditorSource(instance)
	end)
	if ok and type(editorSource) == "string" then
		return editorSource
	end

	local okLegacy, legacy = pcall(function()
		return (instance :: any).Source
	end)
	if okLegacy and type(legacy) == "string" then
		return legacy
	end

	return ""
end

return ScriptReader
