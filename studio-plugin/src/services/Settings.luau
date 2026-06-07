--!strict
-- Namespaced wrapper over plugin:GetSetting/SetSetting. Values are shared across all
-- of a user's plugins in one settings.json, so every key is prefixed and callers must
-- store only small, JSON-serializable data (no Instances/functions/cycles).
local Settings = {}
Settings.__index = Settings

local PREFIX = "shipcheck."

function Settings.new(plugin: Plugin)
	return setmetatable({ plugin = plugin }, Settings)
end

function Settings:get(key: string, default: any): any
	local ok, value = pcall(function()
		return self.plugin:GetSetting(PREFIX .. key)
	end)
	if ok and value ~= nil then
		return value
	end
	return default
end

function Settings:set(key: string, value: any)
	pcall(function()
		self.plugin:SetSetting(PREFIX .. key, value)
	end)
end

return Settings
