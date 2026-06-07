--!strict
-- Jump-to-instance: selects the offending instance for a finding and focuses it,
-- turning the audit report into a fix workflow.
local SelectionService = game:GetService("Selection")

local Selection = {}

-- refs: the path -> Instance map from DataModelScanner. Returns true if found.
function Selection.jumpTo(refs: { [string]: Instance }, path: string?): boolean
	if path == nil then
		return false
	end
	local instance = refs[path]
	if instance == nil then
		return false
	end

	SelectionService:Set({ instance })
	pcall(function()
		local camera = workspace.CurrentCamera
		if camera and instance:IsA("BasePart") then
			local target = instance.Position
			camera.CFrame = CFrame.lookAt(target + Vector3.new(0, 6, 14), target)
		end
	end)
	return true
end

return Selection
