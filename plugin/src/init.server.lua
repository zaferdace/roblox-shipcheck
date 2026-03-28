local BRIDGE_HOST = "http://127.0.0.1"
local BRIDGE_PORT = 33796
local POLL_INTERVAL = 0.5
local PLUGIN_VERSION = "0.1.0"
local MAX_JSON_BREADTH = 100
local MAX_TEST_RESULTS = 50

local HttpService = game:GetService("HttpService")
local ScriptEditorService = game:GetService("ScriptEditorService")
local ChangeHistoryService = game:GetService("ChangeHistoryService")
local TestService = game:GetService("TestService")
local CollectionService = game:GetService("CollectionService")
local Lighting = game:GetService("Lighting")

local sessionToken = nil
local connected = false
local running = true

local testResults = {}
local testResultOrder = {}

local LIGHTING_PRESETS = {
	realistic_day = {
		lighting = {
			Brightness = 2,
			ClockTime = 14,
			GeographicLatitude = 35,
			EnvironmentDiffuseScale = 1,
			EnvironmentSpecularScale = 1,
			GlobalShadows = true,
			Technology = Enum.Technology.Future,
		},
		atmosphere = {
			Density = 0.3,
			Offset = 0.25,
			Color = Color3.fromRGB(199, 207, 217),
			Decay = Color3.fromRGB(92, 120, 155),
			Glare = 0,
			Haze = 1,
		},
		sky = {
			CelestialBodiesShown = true,
			StarCount = 3000,
		},
	},
	realistic_night = {
		lighting = {
			Brightness = 0,
			ClockTime = 0,
			GlobalShadows = true,
			Technology = Enum.Technology.Future,
			OutdoorAmbient = Color3.fromRGB(20, 20, 40),
		},
		atmosphere = {
			Density = 0.5,
			Offset = 0,
			Color = Color3.fromRGB(20, 24, 45),
			Decay = Color3.fromRGB(15, 15, 30),
			Glare = 0,
			Haze = 2,
		},
		sky = {
			StarCount = 5000,
			CelestialBodiesShown = true,
		},
	},
	sunset = {
		lighting = {
			Brightness = 1,
			ClockTime = 18,
			GlobalShadows = true,
			Technology = Enum.Technology.Future,
		},
		atmosphere = {
			Density = 0.4,
			Offset = 0.5,
			Color = Color3.fromRGB(255, 180, 120),
			Decay = Color3.fromRGB(200, 100, 50),
			Glare = 0.5,
			Haze = 2,
		},
	},
	foggy = {
		lighting = {
			Brightness = 1,
			ClockTime = 10,
			GlobalShadows = true,
			FogColor = Color3.fromRGB(200, 200, 210),
			FogStart = 0,
			FogEnd = 500,
		},
		atmosphere = {
			Density = 0.8,
			Offset = 0,
			Color = Color3.fromRGB(200, 200, 210),
			Decay = Color3.fromRGB(180, 180, 195),
			Glare = 0,
			Haze = 10,
		},
	},
	neon_night = {
		lighting = {
			Brightness = 0.5,
			ClockTime = 22,
			GlobalShadows = true,
			Technology = Enum.Technology.Future,
			OutdoorAmbient = Color3.fromRGB(30, 10, 50),
		},
		atmosphere = {
			Density = 0.4,
			Offset = 0,
			Color = Color3.fromRGB(40, 20, 60),
			Decay = Color3.fromRGB(30, 10, 45),
			Glare = 0.2,
			Haze = 3,
		},
		bloom = {
			Intensity = 1.5,
			Size = 30,
			Threshold = 0.8,
		},
		color_correction = {
			Saturation = 0.3,
			Contrast = 0.2,
		},
	},
	studio_flat = {
		lighting = {
			Brightness = 2,
			ClockTime = 12,
			GlobalShadows = false,
			Technology = Enum.Technology.Compatibility,
			Ambient = Color3.fromRGB(180, 180, 180),
			OutdoorAmbient = Color3.fromRGB(180, 180, 180),
		},
	},
}

local toolbar = plugin:CreateToolbar("Roblox Workflow MCP")
local toggleButton = toolbar:CreateButton(
	"Toggle Connection",
	"Connect/disconnect from MCP bridge",
	"rbxassetid://0"
)

local function buildUrl(path)
	return string.format("%s:%d%s", BRIDGE_HOST, BRIDGE_PORT, path)
end

local function normalizePathSegments(pathStr)
	local segments = {}
	for _, segment in ipairs(string.split(pathStr, ".")) do
		if segment ~= "" then
			table.insert(segments, segment)
		end
	end
	if #segments > 0 and (segments[1] == "game" or segments[1] == game.Name or segments[1] == "DataModel") then
		table.remove(segments, 1)
	end
	return segments
end

local function resolveInstancePath(pathStr)
	local current = game
	for _, segment in ipairs(normalizePathSegments(pathStr)) do
		current = current:FindFirstChild(segment)
		if not current then
			return nil
		end
	end
	return current
end

local function findInstanceByDebugId(debugId)
	if game:GetDebugId() == debugId then
		return game
	end
	local stack = { game }
	while #stack > 0 do
		local current = table.remove(stack)
		if current:GetDebugId() == debugId then
			return current
		end
		for _, child in ipairs(current:GetChildren()) do
			table.insert(stack, child)
		end
	end
	return nil
end

local function vector3ToTable(value)
	return { x = value.X, y = value.Y, z = value.Z }
end

local function color3ToTable(value)
	return { r = value.R, g = value.G, b = value.B }
end

local function udim2ToTable(value)
	return {
		xScale = value.X.Scale,
		xOffset = value.X.Offset,
		yScale = value.Y.Scale,
		yOffset = value.Y.Offset,
	}
end

local function getPropertiesForInstance(instance)
	local props = {
		Name = instance.Name,
		ClassName = instance.ClassName,
		Archivable = instance.Archivable,
	}

	if instance:IsA("BasePart") then
		local part = instance
		props.Position = vector3ToTable(part.Position)
		props.Size = vector3ToTable(part.Size)
		props.Anchored = part.Anchored
		props.CanCollide = part.CanCollide
		props.Transparency = part.Transparency
		props.Material = part.Material.Name
		props.BrickColor = part.BrickColor.Name
		props.Color = color3ToTable(part.Color)
	end

	if instance:IsA("GuiObject") then
		local gui = instance
		props.Position = udim2ToTable(gui.Position)
		props.Size = udim2ToTable(gui.Size)
		props.Visible = gui.Visible
		props.ZIndex = gui.ZIndex
		props.BackgroundTransparency = gui.BackgroundTransparency
		props.BackgroundColor3 = color3ToTable(gui.BackgroundColor3)
		props.AbsolutePosition = { x = gui.AbsolutePosition.X, y = gui.AbsolutePosition.Y }
		props.AbsoluteSize = { x = gui.AbsoluteSize.X, y = gui.AbsoluteSize.Y }
		props.AutoLocalize = gui.AutoLocalize
		if gui:IsA("TextLabel") or gui:IsA("TextButton") or gui:IsA("TextBox") then
			props.Text = gui.Text
			props.TextSize = gui.TextSize
			props.TextColor3 = color3ToTable(gui.TextColor3)
			props.Font = gui.Font.Name
			props.TextWrapped = gui.TextWrapped
			props.TextScaled = gui.TextScaled
			props.RichText = gui.RichText
		end
		if gui:IsA("ImageLabel") or gui:IsA("ImageButton") then
			props.Image = gui.Image
			props.ImageTransparency = gui.ImageTransparency
		end
	end

	if instance:IsA("LuaSourceContainer") then
		local ok, source = pcall(function()
			return ScriptEditorService:GetEditorSource(instance)
		end)
		if ok then
			props.Source = source
		else
			local fallbackOk, fallbackSource = pcall(function()
				return instance.Source
			end)
			if fallbackOk then
				props.Source = fallbackSource
			end
		end
		if instance:IsA("Script") then
			props.Disabled = instance.Disabled
		end
	end

	if instance:IsA("Model") and instance.PrimaryPart then
		props.PrimaryPart = instance.PrimaryPart.Name
	end

	local attributes = instance:GetAttributes()
	if next(attributes) then
		props._attributes = attributes
	end

	local tags = CollectionService:GetTags(instance)
	if #tags > 0 then
		props._tags = tags
	end

	return props
end

local function serializeInstance(instance, depth, maxDepth, includeProperties)
	local node = {
		id = instance:GetDebugId(),
		name = instance.Name,
		className = instance.ClassName,
		children = {},
	}

	if includeProperties then
		node.properties = getPropertiesForInstance(instance)
	end

	if depth < maxDepth then
		for _, child in ipairs(instance:GetChildren()) do
			table.insert(node.children, serializeInstance(child, depth + 1, maxDepth, includeProperties))
		end
	end

	return node
end

local function serializeDataModel(params)
	local maxDepth = params.max_depth or 10
	local rootPath = params.root_path
	local includeProperties = params.include_properties or false

	local root = game
	if rootPath then
		root = resolveInstancePath(rootPath)
		if not root then
			error("Path not found: " .. rootPath)
		end
	end

	return serializeInstance(root, 0, maxDepth, includeProperties)
end

local function getInstanceProperties(params)
	local instance = nil
	if params.id then
		instance = findInstanceByDebugId(params.id)
	end
	if not instance and params.path then
		instance = resolveInstancePath(params.path)
	end
	if not instance then
		error("Instance not found")
	end
	return getPropertiesForInstance(instance)
end

local function searchInstances(params)
	local query = params.query
	local searchType = params.search_type or "name"
	local caseSensitive = params.case_sensitive or false
	local maxResults = params.max_results or 50
	local rootPath = params.root_path

	local root = game
	if rootPath then
		root = resolveInstancePath(rootPath)
		if not root then
			return { matches = {} }
		end
	end

	local matches = {}
	local queryValue = caseSensitive and query or string.lower(query)

	local function search(instance, path)
		if #matches >= maxResults then
			return
		end

		local currentPath = path == "" and instance.Name or (path .. "." .. instance.Name)
		local matched = false
		local snippet = ""

		if searchType == "name" then
			local name = caseSensitive and instance.Name or string.lower(instance.Name)
			if string.find(name, queryValue, 1, true) then
				matched = true
				snippet = instance.Name
			end
		elseif searchType == "class" then
			local className = caseSensitive and instance.ClassName or string.lower(instance.ClassName)
			if string.find(className, queryValue, 1, true) then
				matched = true
				snippet = instance.ClassName
			end
		elseif searchType == "property" then
			local props = getPropertiesForInstance(instance)
			for key, value in pairs(props) do
				local rendered = HttpService:JSONEncode(value)
				local compare = caseSensitive and (key .. ":" .. rendered) or string.lower(key .. ":" .. rendered)
				if string.find(compare, queryValue, 1, true) then
					matched = true
					snippet = key .. " = " .. rendered
					break
				end
			end
		elseif searchType == "script_content" and instance:IsA("LuaSourceContainer") then
			local ok, source = pcall(function()
				return ScriptEditorService:GetEditorSource(instance)
			end)
			if not ok then
				ok, source = pcall(function()
					return instance.Source
				end)
			end
			if ok and source then
				local compare = caseSensitive and source or string.lower(source)
				local pos = string.find(compare, queryValue, 1, true)
				if pos then
					matched = true
					local startPos = math.max(1, pos - 40)
					local endPos = math.min(#source, pos + #query + 40)
					snippet = string.sub(source, startPos, endPos)
				end
			end
		end

		if matched then
			table.insert(matches, {
				path = currentPath,
				className = instance.ClassName,
				snippet = snippet,
				matchType = searchType,
			})
		end

		for _, child in ipairs(instance:GetChildren()) do
			if #matches >= maxResults then
				return
			end
			search(child, currentPath)
		end
	end

	search(root, "")
	return { matches = matches }
end

local function toPropertyValue(value)
	local valueType = typeof(value)
	if valueType == "Vector3" then
		return vector3ToTable(value)
	end
	if valueType == "Color3" then
		return color3ToTable(value)
	end
	if valueType == "UDim2" then
		return udim2ToTable(value)
	end
	return value
end

local PROPERTY_ENUMS = {
	Technology = Enum.Technology,
	SortOrder = Enum.SortOrder,
	FillDirection = Enum.FillDirection,
	HorizontalAlignment = Enum.HorizontalAlignment,
	VerticalAlignment = Enum.VerticalAlignment,
	TextXAlignment = Enum.TextXAlignment,
	TextYAlignment = Enum.TextYAlignment,
	ScaleType = Enum.ScaleType,
	AutomaticSize = Enum.AutomaticSize,
	SizeConstraint = Enum.SizeConstraint,
	ApplyStrokeMode = Enum.ApplyStrokeMode,
	ResamplerMode = Enum.ResamplerMode,
}

local function tableToVector3(value)
	return Vector3.new(value.x or 0, value.y or 0, value.z or 0)
end

local function tableToVector2(value)
	return Vector2.new(value.x or 0, value.y or 0)
end

local function tableToColor3(value)
	return Color3.new(value.r or 0, value.g or 0, value.b or 0)
end

local function tableToUDim2(value)
	return UDim2.new(value.xScale or 0, value.xOffset or 0, value.yScale or 0, value.yOffset or 0)
end

local function coerceEnumValue(propertyName, value)
	if type(value) ~= "string" then
		return nil
	end
	local enumType = PROPERTY_ENUMS[propertyName]
	if enumType and enumType[value] then
		return enumType[value]
	end
	return nil
end

local function coercePropertyValue(propertyName, value)
	if type(value) ~= "table" then
		local enumValue = coerceEnumValue(propertyName, value)
		if enumValue ~= nil then
			return enumValue
		end
		if (propertyName == "Padding" or propertyName == "CornerRadius") and type(value) == "number" then
			return UDim.new(0, value)
		end
		return value
	end

	if value.xScale ~= nil or value.xOffset ~= nil or value.yScale ~= nil or value.yOffset ~= nil then
		return tableToUDim2(value)
	end
	if value.r ~= nil or value.g ~= nil or value.b ~= nil then
		return tableToColor3(value)
	end
	if value.x ~= nil and value.y ~= nil then
		if value.z ~= nil then
			return tableToVector3(value)
		end
		return tableToVector2(value)
	end
	if value.z ~= nil then
		return tableToVector3(value)
	end
	return value
end

local function setProperties(target, properties)
	local count = 0
	if not properties then
		return count
	end
	for key, value in pairs(properties) do
		target[key] = coercePropertyValue(key, value)
		count += 1
	end
	return count
end

local function rememberTestResult(runId)
	table.insert(testResultOrder, runId)
	while #testResultOrder > MAX_TEST_RESULTS do
		local oldestRunId = table.remove(testResultOrder, 1)
		if oldestRunId ~= nil then
			testResults[oldestRunId] = nil
		end
	end
end

local function appendChildPath(parentPath, childName)
	if parentPath == "" then
		return childName
	end
	return parentPath .. "." .. childName
end

local function findOrCreateChildOfClass(parent, className)
	for _, child in ipairs(parent:GetChildren()) do
		if child.ClassName == className then
			return child
		end
	end
	local instance = Instance.new(className)
	instance.Parent = parent
	return instance
end

local function toJsonSafeValue(value, depth)
	local currentDepth = depth or 0
	if currentDepth > 4 then
		return tostring(value)
	end

	local valueType = typeof(value)
	if value == nil or valueType == "string" or valueType == "number" or valueType == "boolean" then
		return value
	end
	if valueType == "Vector3" then
		return vector3ToTable(value)
	end
	if valueType == "Color3" then
		return color3ToTable(value)
	end
	if valueType == "UDim2" then
		return udim2ToTable(value)
	end
	if valueType == "Instance" then
		return value:GetFullName()
	end
	if valueType == "table" then
		local result = {}
		local count = 0
		for key, nestedValue in pairs(value) do
			count += 1
			if count > MAX_JSON_BREADTH then
				result["_truncated"] = true
				break
			end
			result[tostring(key)] = toJsonSafeValue(nestedValue, currentDepth + 1)
		end
		return result
	end
	return tostring(value)
end

local function applyPatch(params)
	local patch = params.patch
	local dryRun = params.dryRun
	if dryRun == nil then
		dryRun = true
	end

	if dryRun then
		local preview = {}
		for _, op in ipairs(patch.operations) do
			local entry = { operation = op.type, target = op.target_path }
			if op.type ~= "create" then
				local target = resolveInstancePath(op.target_path)
				entry.exists = target ~= nil
			end
			table.insert(preview, entry)
		end
		return { applied = false, preview = preview }
	end

	local recordingId = ChangeHistoryService:TryBeginRecording("MCP Patch: " .. (patch.description or "unnamed"))
	if not recordingId then
		error("Failed to begin ChangeHistoryService recording")
	end

	local changes = {}
	local ok, err = pcall(function()
		for _, op in ipairs(patch.operations) do
			if op.type == "create" then
				local parent = resolveInstancePath(op.target_path)
				if not parent then
					error("Parent not found: " .. op.target_path)
				end
				local instance = Instance.new(op.class_name)
				local failedProps = {}
				if op.properties then
					for key, value in pairs(op.properties) do
						local propOk, propErr = pcall(function()
							instance[key] = toPropertyValue(value)
						end)
						if not propOk then
							table.insert(failedProps, { key = key, error = tostring(propErr) })
						end
					end
				end
				instance.Parent = parent
				local change = { type = "create", path = op.target_path .. "." .. instance.Name }
				if #failedProps > 0 then
					change.failed_properties = failedProps
				end
				table.insert(changes, change)
			elseif op.type == "update" then
				local target = resolveInstancePath(op.target_path)
				if not target then
					error("Target not found: " .. op.target_path)
				end
				local failedProps = {}
				if op.properties then
					for key, value in pairs(op.properties) do
						local propOk, propErr = pcall(function()
							target[key] = toPropertyValue(value)
						end)
						if not propOk then
							table.insert(failedProps, { key = key, error = tostring(propErr) })
						end
					end
				end
				local change = { type = "update", path = op.target_path }
				if #failedProps > 0 then
					change.failed_properties = failedProps
				end
				table.insert(changes, change)
			elseif op.type == "delete" then
				local target = resolveInstancePath(op.target_path)
				if not target then
					error("Target not found: " .. op.target_path)
				end
				target:Destroy()
				table.insert(changes, { type = "delete", path = op.target_path })
			elseif op.type == "reparent" then
				local target = resolveInstancePath(op.target_path)
				local newParent = resolveInstancePath(op.new_parent_path)
				if not target then
					error("Target not found: " .. op.target_path)
				end
				if not newParent then
					error("New parent not found: " .. op.new_parent_path)
				end
				target.Parent = newParent
				table.insert(changes, {
					type = "reparent",
					path = op.target_path,
					new_parent = op.new_parent_path,
				})
			end
		end
	end)

	if ok then
		ChangeHistoryService:FinishRecording(recordingId, Enum.FinishRecordingOperation.Commit)
	else
		ChangeHistoryService:FinishRecording(recordingId, Enum.FinishRecordingOperation.Cancel)
		error(err)
	end

	return { applied = true, patch_id = recordingId, changes = changes }
end

local function undoPatch(_params)
	ChangeHistoryService:Undo()
	return {
		undone = true,
		warning = "Undo targets the most recent operation, not a specific patch",
	}
end

local function runTests(params)
	local runId = HttpService:GenerateGUID(false)
	local config = params.configuration or "server"

	testResults[runId] = {
		runId = runId,
		status = "running",
		configuration = config,
		startedAt = os.date("!%Y-%m-%dT%H:%M:%SZ"),
		results = {},
		warning = "Test execution is limited and relies on Roblox TestService behavior",
	}
	rememberTestResult(runId)

	task.spawn(function()
		local ok, err = pcall(function()
			local timeout = params.timeout_seconds or params.timeoutSeconds or 60
			local startTime = os.clock()
			TestService:Run()
			local elapsed = 0
			while elapsed < timeout do
				if TestService.IsRunning == false then
					break
				end
				task.wait(0.5)
				elapsed += 0.5
			end
			local duration = math.floor((os.clock() - startTime) * 1000)
			table.insert(testResults[runId].results, {
				name = "TestService",
				status = TestService.ErrorCount > 0 and "fail" or "pass",
				durationMs = duration,
				errorMessage = TestService.ErrorCount > 0
						and (tostring(TestService.ErrorCount) .. " errors detected")
					or nil,
			})
		end)

		testResults[runId].status = ok and "completed" or "failed"
		testResults[runId].finishedAt = os.date("!%Y-%m-%dT%H:%M:%SZ")
		if not ok then
			testResults[runId].error = tostring(err)
		end
	end)

	return { runId = runId }
end

local function getTestResults(params)
	local runId = params.runId
	return testResults[runId] or { runId = runId, status = "not_found", results = {} }
end

local function getScriptSource(params)
	local instancePath = params.path
	local instance = resolveInstancePath(instancePath)
	if not instance then
		error("Instance not found: " .. instancePath)
	end
	if not instance:IsA("LuaSourceContainer") then
		error("Not a script: " .. instancePath)
	end

	local ok, source = pcall(function()
		return ScriptEditorService:GetEditorSource(instance)
	end)
	if not ok then
		ok, source = pcall(function()
			return instance.Source
		end)
	end
	if not ok then
		error("Cannot read source: " .. tostring(source))
	end

	return { path = instancePath, source = source }
end

local function setScriptSource(params)
	local instance = resolveInstancePath(params.path)
	if not instance then
		error("Not found: " .. params.path)
	end
	if not instance:IsA("LuaSourceContainer") then
		error("Not a script")
	end
	local recordingId = ChangeHistoryService:TryBeginRecording("MCP: Set script source")
	if not recordingId then
		error("Failed to begin recording")
	end
	local editorOk, editorErr = pcall(function()
		ScriptEditorService:UpdateSourceAsync(instance, function()
			return params.source
		end)
	end)
	if editorOk then
		ChangeHistoryService:FinishRecording(recordingId, Enum.FinishRecordingOperation.Commit)
		return { path = params.path, updated = true }
	end
	local fallbackOk, fallbackErr = pcall(function()
		instance.Source = params.source
	end)
	if fallbackOk then
		ChangeHistoryService:FinishRecording(recordingId, Enum.FinishRecordingOperation.Commit)
		return { path = params.path, updated = true, fallback = true }
	end
	ChangeHistoryService:FinishRecording(recordingId, Enum.FinishRecordingOperation.Cancel)
	error("Failed to set source: " .. tostring(editorErr) .. " / " .. tostring(fallbackErr))
end

local function executeCode(params)
	if params.acknowledge_risk ~= true then
		error("execute_code requires acknowledge_risk=true")
	end
	local code = params.code
	local fn, compileErr = loadstring(code)
	if not fn then
		error("Compile error: " .. tostring(compileErr))
	end
	local ok, resultsOrError = pcall(function()
		return { fn() }
	end)
	if not ok then
		error("Runtime error: " .. tostring(resultsOrError))
	end
	local results = resultsOrError
	local jsonSafeResults = {}
	for index, value in ipairs(results) do
		jsonSafeResults[index] = toJsonSafeValue(value)
	end
	return { success = true, results = jsonSafeResults }
end

local function createInstance(params)
	local parent = resolveInstancePath(params.parent_path)
	if not parent then
		error("Parent not found: " .. params.parent_path)
	end
	local recordingId = ChangeHistoryService:TryBeginRecording("MCP: Create instance")
	if not recordingId then
		error("Failed to begin recording")
	end
	local instance = Instance.new(params.class_name)
	if params.name then
		instance.Name = params.name
	end
	if params.properties then
		for key, value in pairs(params.properties) do
			pcall(function()
				instance[key] = toPropertyValue(value)
			end)
		end
	end
	instance.Parent = parent
	ChangeHistoryService:FinishRecording(recordingId, Enum.FinishRecordingOperation.Commit)
	return {
		path = params.parent_path .. "." .. instance.Name,
		id = instance:GetDebugId(),
		className = params.class_name,
	}
end

local function deleteInstance(params)
	local target = resolveInstancePath(params.path)
	if not target then
		error("Not found: " .. params.path)
	end
	local recordingId = ChangeHistoryService:TryBeginRecording("MCP: Delete instance")
	if not recordingId then
		error("Failed to begin recording")
	end
	local ok, err = pcall(function()
		target:Destroy()
	end)
	ChangeHistoryService:FinishRecording(
		recordingId,
		ok and Enum.FinishRecordingOperation.Commit or Enum.FinishRecordingOperation.Cancel
	)
	if not ok then
		error(err)
	end
	return { path = params.path, deleted = true }
end

local function cloneInstance(params)
	local target = resolveInstancePath(params.path)
	if not target then
		error("Not found: " .. params.path)
	end
	local recordingId = ChangeHistoryService:TryBeginRecording("MCP: Clone instance")
	if not recordingId then
		error("Failed to begin recording")
	end
	local clone = nil
	local ok, err = pcall(function()
		clone = target:Clone()
		if params.new_parent_path then
			local newParent = resolveInstancePath(params.new_parent_path)
			if not newParent then
				clone:Destroy()
				error("New parent not found: " .. params.new_parent_path)
			end
			clone.Parent = newParent
		else
			clone.Parent = target.Parent
		end
	end)
	ChangeHistoryService:FinishRecording(
		recordingId,
		ok and Enum.FinishRecordingOperation.Commit or Enum.FinishRecordingOperation.Cancel
	)
	if not ok then
		error(err)
	end
	return {
		path = (params.new_parent_path or params.path:match("(.+)%..+$") or "game") .. "." .. clone.Name,
		id = clone:GetDebugId(),
	}
end

local function moveInstance(params)
	local target = resolveInstancePath(params.path)
	if not target then
		error("Not found: " .. params.path)
	end
	local newParent = resolveInstancePath(params.new_parent_path)
	if not newParent then
		error("Parent not found: " .. params.new_parent_path)
	end
	local recordingId = ChangeHistoryService:TryBeginRecording("MCP: Move instance")
	if not recordingId then
		error("Failed to begin recording")
	end
	target.Parent = newParent
	ChangeHistoryService:FinishRecording(recordingId, Enum.FinishRecordingOperation.Commit)
	return { path = params.new_parent_path .. "." .. target.Name, moved = true }
end

local function setInstanceProperty(params)
	local target = resolveInstancePath(params.path)
	if not target then
		error("Not found: " .. params.path)
	end
	local recordingId = ChangeHistoryService:TryBeginRecording("MCP: Set property")
	if not recordingId then
		error("Failed to begin recording")
	end
	local ok, err = pcall(function()
		target[params.property] = toPropertyValue(params.value)
	end)
	ChangeHistoryService:FinishRecording(
		recordingId,
		ok and Enum.FinishRecordingOperation.Commit or Enum.FinishRecordingOperation.Cancel
	)
	if not ok then
		error(err)
	end
	return { path = params.path, property = params.property, updated = true }
end

local function getChildren(params)
	local target = resolveInstancePath(params.path or "game")
	if not target then
		error("Not found")
	end
	local depth = params.depth or 1
	return serializeInstance(target, 0, depth, false)
end

local function getSelection(_params)
	local selected = game:GetService("Selection"):Get()
	local result = {}
	for _, instance in ipairs(selected) do
		table.insert(result, {
			name = instance.Name,
			className = instance.ClassName,
			id = instance:GetDebugId(),
			path = instance:GetFullName(),
		})
	end
	return { selection = result }
end

local function manageTags(params)
	local target = resolveInstancePath(params.path)
	if not target then
		error("Not found: " .. params.path)
	end
	if params.action == "list" then
		return { tags = CollectionService:GetTags(target) }
	elseif params.action == "add" then
		if not params.tag then
			error("Missing tag")
		end
		local recordingId = ChangeHistoryService:TryBeginRecording("MCP: Add tag")
		if not recordingId then
			error("Failed to begin recording")
		end
		CollectionService:AddTag(target, params.tag)
		ChangeHistoryService:FinishRecording(recordingId, Enum.FinishRecordingOperation.Commit)
		return { path = params.path, tag = params.tag, added = true }
	elseif params.action == "remove" then
		if not params.tag then
			error("Missing tag")
		end
		local recordingId = ChangeHistoryService:TryBeginRecording("MCP: Remove tag")
		if not recordingId then
			error("Failed to begin recording")
		end
		CollectionService:RemoveTag(target, params.tag)
		ChangeHistoryService:FinishRecording(recordingId, Enum.FinishRecordingOperation.Commit)
		return { path = params.path, tag = params.tag, removed = true }
	end
	error("Unsupported tag action: " .. tostring(params.action))
end

local function manageAttributes(params)
	local target = resolveInstancePath(params.path)
	if not target then
		error("Not found: " .. params.path)
	end
	if params.action == "get" then
		if params.key then
			return { key = params.key, value = toJsonSafeValue(target:GetAttribute(params.key), 0) }
		end
		local safeAttributes = {}
		for key, value in pairs(target:GetAttributes()) do
			safeAttributes[key] = toJsonSafeValue(value, 0)
		end
		return { attributes = safeAttributes }
	elseif params.action == "set" then
		if not params.key then
			error("Missing key")
		end
		local recordingId = ChangeHistoryService:TryBeginRecording("MCP: Set attribute")
		if not recordingId then
			error("Failed to begin recording")
		end
		target:SetAttribute(params.key, params.value)
		ChangeHistoryService:FinishRecording(recordingId, Enum.FinishRecordingOperation.Commit)
		return { path = params.path, key = params.key, set = true }
	elseif params.action == "delete" then
		if not params.key then
			error("Missing key")
		end
		local recordingId = ChangeHistoryService:TryBeginRecording("MCP: Delete attribute")
		if not recordingId then
			error("Failed to begin recording")
		end
		target:SetAttribute(params.key, nil)
		ChangeHistoryService:FinishRecording(recordingId, Enum.FinishRecordingOperation.Commit)
		return { path = params.path, key = params.key, deleted = true }
	end
	error("Unsupported attribute action: " .. tostring(params.action))
end

local function createUIElement(spec, parent, parentPath, createdPaths)
	local instance = Instance.new(spec.class)
	if spec.name then
		instance.Name = spec.name
	end
	setProperties(instance, spec.properties)
	instance.Parent = parent

	local instancePath = appendChildPath(parentPath, instance.Name)
	table.insert(createdPaths, instancePath)

	if spec.children then
		for _, childSpec in ipairs(spec.children) do
			createUIElement(childSpec, instance, instancePath, createdPaths)
		end
	end

	return instancePath
end

local function buildUI(params)
	local parent = resolveInstancePath(params.parent_path)
	if not parent then
		error("Parent not found: " .. params.parent_path)
	end
	if type(params.spec) ~= "table" then
		error("Missing UI spec")
	end

	local recordingId = ChangeHistoryService:TryBeginRecording("MCP: Build UI")
	if not recordingId then
		error("Failed to begin recording")
	end

	local createdPaths = {}
	local ok, result = pcall(function()
		return createUIElement(params.spec, parent, params.parent_path, createdPaths)
	end)

	ChangeHistoryService:FinishRecording(
		recordingId,
		ok and Enum.FinishRecordingOperation.Commit or Enum.FinishRecordingOperation.Cancel
	)

	if not ok then
		error(result)
	end

	return {
		created_count = #createdPaths,
		root_path = result,
		tree = createdPaths,
	}
end

local function applyLightingConfig(target, properties)
	return setProperties(target, properties)
end

local function applyLighting(params)
	local presetName = params.preset
	local config = nil

	if presetName and presetName ~= "custom" then
		config = LIGHTING_PRESETS[presetName]
		if not config then
			error("Unknown lighting preset: " .. tostring(presetName))
		end
	else
		config = params.custom_config
	end

	if type(config) ~= "table" then
		error("Missing lighting configuration")
	end

	local recordingId = ChangeHistoryService:TryBeginRecording("MCP: Apply lighting")
	if not recordingId then
		error("Failed to begin recording")
	end

	local ok, result = pcall(function()
		local propertiesSet = 0

		if config.lighting then
			propertiesSet += applyLightingConfig(Lighting, config.lighting)
		end
		if config.atmosphere then
			propertiesSet += applyLightingConfig(findOrCreateChildOfClass(Lighting, "Atmosphere"), config.atmosphere)
		end
		if config.sky then
			propertiesSet += applyLightingConfig(findOrCreateChildOfClass(Lighting, "Sky"), config.sky)
		end
		if config.bloom then
			propertiesSet += applyLightingConfig(findOrCreateChildOfClass(Lighting, "BloomEffect"), config.bloom)
		end
		if config.color_correction then
			propertiesSet += applyLightingConfig(
				findOrCreateChildOfClass(Lighting, "ColorCorrectionEffect"),
				config.color_correction
			)
		end
		if config.sun_rays then
			propertiesSet += applyLightingConfig(findOrCreateChildOfClass(Lighting, "SunRaysEffect"), config.sun_rays)
		end

		return {
			preset_applied = presetName or "custom",
			properties_set = propertiesSet,
		}
	end)

	ChangeHistoryService:FinishRecording(
		recordingId,
		ok and Enum.FinishRecordingOperation.Commit or Enum.FinishRecordingOperation.Cancel
	)

	if not ok then
		error(result)
	end

	return result
end

local function terrainMaterial(materialName)
	if type(materialName) == "string" and Enum.Material[materialName] then
		return Enum.Material[materialName]
	end
	return Enum.Material.Grass
end

local function terrainVector3(value)
	return Vector3.new(value.x or 0, value.y or 0, value.z or 0)
end

local function terrainGenerate(params)
	local operation = params.operation
	local terrainParams = params.params or {}
	local terrain = workspace.Terrain

	local recordingId = ChangeHistoryService:TryBeginRecording("MCP: Terrain generate")
	if not recordingId then
		error("Failed to begin recording")
	end

	local ok, result = pcall(function()
		if operation == "fill_block" then
			local cframe = CFrame.new(terrainVector3(terrainParams.position or {}))
			local size = terrainVector3(terrainParams.size or {})
			terrain:FillBlock(cframe, size, terrainMaterial(terrainParams.material))
		elseif operation == "fill_ball" then
			local center = terrainVector3(terrainParams.position or {})
			terrain:FillBall(center, terrainParams.radius or 4, terrainMaterial(terrainParams.material))
		elseif operation == "fill_cylinder" then
			local cframe = CFrame.new(terrainVector3(terrainParams.position or {}))
			terrain:FillCylinder(
				cframe,
				terrainParams.height or 4,
				terrainParams.radius or 4,
				terrainMaterial(terrainParams.material)
			)
		elseif operation == "fill_wedge" then
			local cframe = CFrame.new(terrainVector3(terrainParams.position or {}))
			local size = terrainVector3(terrainParams.size or {})
			terrain:FillWedge(cframe, size, terrainMaterial(terrainParams.material))
		elseif operation == "clear_region" then
			local region = Region3.new(
				terrainVector3(terrainParams.region_start or {}),
				terrainVector3(terrainParams.region_end or {})
			):ExpandToGrid(4)
			terrain:FillRegion(region, 4, Enum.Material.Air)
		elseif operation == "set_material_region" then
			local region = Region3.new(
				terrainVector3(terrainParams.region_start or {}),
				terrainVector3(terrainParams.region_end or {})
			):ExpandToGrid(4)
			terrain:FillRegion(region, 4, terrainMaterial(terrainParams.material))
		elseif operation == "generate_flat" then
			local startPos = terrainParams.region_start or { x = -256, y = 0, z = -256 }
			local endPos = terrainParams.region_end or { x = 256, y = 0, z = 256 }
			local minX = math.min(startPos.x or 0, endPos.x or 0)
			local maxX = math.max(startPos.x or 0, endPos.x or 0)
			local minZ = math.min(startPos.z or 0, endPos.z or 0)
			local maxZ = math.max(startPos.z or 0, endPos.z or 0)
			local baseHeight = terrainParams.base_height or 0
			local cframe = CFrame.new((minX + maxX) / 2, baseHeight, (minZ + maxZ) / 2)
			local size = Vector3.new(math.max(4, maxX - minX), 4, math.max(4, maxZ - minZ))
			terrain:FillBlock(cframe, size, terrainMaterial(terrainParams.material))
		elseif operation == "generate_hills" then
			local startPos = terrainParams.region_start or { x = -128, y = 0, z = -128 }
			local endPos = terrainParams.region_end or { x = 128, y = 0, z = 128 }
			local minX = math.min(startPos.x or 0, endPos.x or 0)
			local maxX = math.max(startPos.x or 0, endPos.x or 0)
			local minZ = math.min(startPos.z or 0, endPos.z or 0)
			local maxZ = math.max(startPos.z or 0, endPos.z or 0)
			local baseHeight = terrainParams.base_height or 10
			local amplitude = terrainParams.amplitude or 20
			local frequency = terrainParams.frequency or 0.02
			local seed = terrainParams.seed or math.random(1, 10000)
			local material = terrainMaterial(terrainParams.material)
			local resolution = 4

			local iterations = 0
			for x = minX, maxX, resolution do
				for z = minZ, maxZ, resolution do
					local noise = math.noise(x * frequency + seed, z * frequency + seed)
					local height = baseHeight + noise * amplitude
					local cframe = CFrame.new(x, height / 2, z)
					local size = Vector3.new(resolution, math.max(resolution, height), resolution)
					terrain:FillBlock(cframe, size, material)
					iterations += 1
					if iterations % 100 == 0 then
						task.wait()
					end
				end
			end
		else
			error("Unsupported terrain operation: " .. tostring(operation))
		end

		return {
			operation = operation,
			material = terrainParams.material,
			success = true,
		}
	end)

	ChangeHistoryService:FinishRecording(
		recordingId,
		ok and Enum.FinishRecordingOperation.Commit or Enum.FinishRecordingOperation.Cancel
	)

	if not ok then
		error(result)
	end

	return result
end

local function startPlaytest(params)
	local mode = params.mode or "play"
	local ok, err = pcall(function()
		if mode == "run" then
			game:GetService("RunService"):Run()
		else
			plugin:StartDecal()
		end
	end)
	return {
		started = ok,
		mode = mode,
		note = "Playtest control may require manual interaction",
		error = ok and nil or tostring(err),
	}
end

local function stopPlaytest(_params)
	local ok, err = pcall(function()
		game:GetService("RunService"):Stop()
	end)
	return { stopped = ok, error = ok and nil or tostring(err) }
end

local function getOutput(params)
	local history = game:GetService("LogService"):GetLogHistory()
	local limit = params.limit or 100
	local entries = {}
	local startIndex = math.max(1, #history - limit + 1)
	for index = startIndex, #history do
		local entry = history[index]
		table.insert(entries, {
			message = entry.message,
			messageType = tostring(entry.messageType),
			timestamp = entry.timestamp,
		})
	end
	return { entries = entries, total = #history }
end

local function getTeleportGraph(_params)
	local nodes = {}
	local edges = {}

	local function scanForTeleports(instance, path)
		if instance:IsA("LuaSourceContainer") then
			local ok, source = pcall(function()
				return ScriptEditorService:GetEditorSource(instance)
			end)
			if not ok then
				ok, source = pcall(function()
					return instance.Source
				end)
			end
			if ok and source then
				for placeId in string.gmatch(source, "TeleportService%s*:%s*Teleport[Async]*%s*%((%d+)") do
					table.insert(edges, { from_script = path, to_place_id = placeId, source = source })
				end
				for placeId in string.gmatch(source, "TeleportService%s*:%s*TeleportToPrivateServer%s*%((%d+)") do
					table.insert(edges, {
						from_script = path,
						to_place_id = placeId,
						private = true,
						source = source,
					})
				end
				if string.find(source, "TeleportService", 1, true) then
					table.insert(nodes, { path = path, className = instance.ClassName })
				end
			end
		end
		for _, child in ipairs(instance:GetChildren()) do
			scanForTeleports(child, path .. "." .. child.Name)
		end
	end

	scanForTeleports(game, "game")
	return { nodes = nodes, edges = edges }
end

local function getPackageInfo(_params)
	local packages = {}

	local function scanForPackages(instance, path)
		if instance.ClassName == "PackageLink" then
			local parent = instance.Parent
			table.insert(packages, {
				path = path,
				parent_name = parent and parent.Name or "unknown",
				parent_class = parent and parent.ClassName or "unknown",
				package_id = instance.PackageId,
				version_number = instance.VersionNumber,
				auto_update = instance.AutoUpdate,
			})
		end
		for _, child in ipairs(instance:GetChildren()) do
			scanForPackages(child, path .. "." .. child.Name)
		end
	end

	scanForPackages(game, "game")
	return { packages = packages }
end

local function getScreenshot(params)
	local viewport = params.viewport or "game"
	return { pngBase64 = "", viewport = viewport }
end

local function sendResponse(commandId, success, result)
	pcall(function()
		HttpService:RequestAsync({
			Url = buildUrl("/studio/response"),
			Method = "POST",
			Headers = { ["Content-Type"] = "application/json" },
			Body = HttpService:JSONEncode({
				token = sessionToken,
				commandId = commandId,
				result = success and result or nil,
				error = (not success) and tostring(result) or nil,
			}),
		})
	end)
end

local function processCommand(cmd)
	local commandId = cmd.id
	local command = cmd.command
	local params = cmd.params or {}

	local success, result = pcall(function()
		if command == "get_datamodel" then
			return serializeDataModel(params)
		elseif command == "search" then
			return searchInstances(params)
		elseif command == "get_properties" then
			return getInstanceProperties(params)
		elseif command == "apply_patch" then
			return applyPatch(params)
		elseif command == "undo_patch" then
			return undoPatch(params)
		elseif command == "run_tests" then
			return runTests(params)
		elseif command == "get_test_results" then
			return getTestResults(params)
		elseif command == "execute_code" then
			return executeCode(params)
		elseif command == "set_script_source" then
			return setScriptSource(params)
		elseif command == "get_script_source" then
			return getScriptSource(params)
		elseif command == "create_instance" then
			return createInstance(params)
		elseif command == "delete_instance" then
			return deleteInstance(params)
		elseif command == "clone_instance" then
			return cloneInstance(params)
		elseif command == "move_instance" then
			return moveInstance(params)
		elseif command == "set_instance_property" then
			return setInstanceProperty(params)
		elseif command == "get_children" then
			return getChildren(params)
		elseif command == "get_selection" then
			return getSelection(params)
		elseif command == "manage_tags" then
			return manageTags(params)
		elseif command == "manage_attributes" then
			return manageAttributes(params)
		elseif command == "start_playtest" then
			return startPlaytest(params)
		elseif command == "stop_playtest" then
			return stopPlaytest(params)
		elseif command == "get_output" then
			return getOutput(params)
		elseif command == "teleport_graph" then
			return getTeleportGraph(params)
		elseif command == "package_info" then
			return getPackageInfo(params)
		elseif command == "get_screenshot" then
			return getScreenshot(params)
		elseif command == "build_ui" then
			return buildUI(params)
		elseif command == "apply_lighting" then
			return applyLighting(params)
		elseif command == "terrain_generate" then
			return terrainGenerate(params)
		else
			error("Unknown command: " .. tostring(command))
		end
	end)

	sendResponse(commandId, success, result)
end

local function disconnect()
	connected = false
	sessionToken = nil
	toggleButton:SetActive(false)
	print("[RBX-MCP] Disconnected from bridge")
end

local function startPolling()
	task.spawn(function()
		while connected and running do
			local ok, response = pcall(function()
				return HttpService:RequestAsync({
					Url = buildUrl("/studio/poll?token=" .. sessionToken),
					Method = "GET",
					Headers = {},
				})
			end)

			if ok and response.Success then
				local data = HttpService:JSONDecode(response.Body)
				if data.command then
					processCommand(data)
				end
			elseif ok and response.StatusCode == 401 then
				disconnect()
			else
				task.wait(2)
			end

			task.wait(POLL_INTERVAL)
		end
	end)
end

local function connect()
	if connected then
		disconnect()
		task.wait(0.1)
	end
	local ok, response = pcall(function()
		return HttpService:RequestAsync({
			Url = buildUrl("/studio/connect"),
			Method = "POST",
			Headers = { ["Content-Type"] = "application/json" },
			Body = HttpService:JSONEncode({ version = PLUGIN_VERSION }),
		})
	end)

	if ok and response.Success then
		local data = HttpService:JSONDecode(response.Body)
		sessionToken = data.token
		connected = true
		toggleButton:SetActive(true)
		print("[RBX-MCP] Connected to bridge, session:", data.sessionId)
		startPolling()
	else
		warn("[RBX-MCP] Failed to connect to bridge")
	end
end

toggleButton.Click:Connect(function()
	if connected then
		disconnect()
	else
		connect()
	end
end)

plugin.Unloading:Connect(function()
	running = false
	disconnect()
end)
