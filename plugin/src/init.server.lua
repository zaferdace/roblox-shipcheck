local BRIDGE_HOST = "http://127.0.0.1"
local BRIDGE_PORT = 33796
local POLL_INTERVAL = 0.5
local PLUGIN_VERSION = "0.1.0"

local HttpService = game:GetService("HttpService")
local ScriptEditorService = game:GetService("ScriptEditorService")
local ChangeHistoryService = game:GetService("ChangeHistoryService")
local TestService = game:GetService("TestService")
local CollectionService = game:GetService("CollectionService")

local sessionToken = nil
local connected = false
local running = true

local testResults = {}

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
		for key, nestedValue in pairs(value) do
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
				if op.properties then
					for key, value in pairs(op.properties) do
						pcall(function()
							instance[key] = toPropertyValue(value)
						end)
					end
				end
				instance.Parent = parent
				table.insert(changes, { type = "create", path = op.target_path .. "." .. instance.Name })
			elseif op.type == "update" then
				local target = resolveInstancePath(op.target_path)
				if not target then
					error("Target not found: " .. op.target_path)
				end
				if op.properties then
					for key, value in pairs(op.properties) do
						pcall(function()
							target[key] = toPropertyValue(value)
						end)
					end
				end
				table.insert(changes, { type = "update", path = op.target_path })
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
	return { undone = true }
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
	}

	task.spawn(function()
		local ok, err = pcall(function()
			local tests = {}
			for _, child in ipairs(TestService:GetChildren()) do
				if child:IsA("LuaSourceContainer") then
					table.insert(tests, child)
				end
			end

			for _, testScript in ipairs(tests) do
				local startTime = os.clock()
				local testOk, testErr = pcall(function()
					if testScript:IsA("Script") then
						testScript.Disabled = false
					end
				end)
				local duration = (os.clock() - startTime) * 1000

				table.insert(testResults[runId].results, {
					name = testScript.Name,
					status = testOk and "pass" or "fail",
					durationMs = duration,
					errorMessage = testOk and nil or tostring(testErr),
				})
			end
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
	local ok, err = pcall(function()
		ScriptEditorService:UpdateSourceAsync(instance, function()
			return params.source
		end)
	end)
	if not ok then
		pcall(function()
			instance.Source = params.source
		end)
	end
	ChangeHistoryService:FinishRecording(
		recordingId,
		ok and Enum.FinishRecordingOperation.Commit or Enum.FinishRecordingOperation.Cancel
	)
	if not ok then
		error(err)
	end
	return { path = params.path, updated = true }
end

local function executeCode(params)
	local code = params.code
	local fn, compileErr = loadstring(code)
	if not fn then
		error("Compile error: " .. tostring(compileErr))
	end
	local results = { fn() }
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
	target:Destroy()
	ChangeHistoryService:FinishRecording(recordingId, Enum.FinishRecordingOperation.Commit)
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
	local clone = target:Clone()
	if params.new_parent_path then
		local newParent = resolveInstancePath(params.new_parent_path)
		if newParent then
			clone.Parent = newParent
		end
	else
		clone.Parent = target.Parent
	end
	ChangeHistoryService:FinishRecording(recordingId, Enum.FinishRecordingOperation.Commit)
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
			return { key = params.key, value = target:GetAttribute(params.key) }
		end
		return { attributes = target:GetAttributes() }
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
					table.insert(edges, { from_script = path, to_place_id = placeId })
				end
				for placeId in string.gmatch(source, "TeleportService%s*:%s*TeleportToPrivateServer%s*%((%d+)") do
					table.insert(edges, { from_script = path, to_place_id = placeId, private = true })
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
