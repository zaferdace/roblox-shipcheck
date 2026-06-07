--!strict
-- Walks the open place's DataModel ONCE and produces the normalized, plain-data
-- Inventory the pure rules engine consumes. This is the only place that touches live
-- Instances / Enums; rules never do. Keep the produced shape in lockstep with the
-- props vocabulary documented in src/core/Types.luau and the rule modules.
local ScriptReader = require(script.Parent.ScriptReader)

local DataModelScanner = {}

local SCAN_ROOTS = {
	"Workspace",
	"Lighting",
	"ReplicatedStorage",
	"ReplicatedFirst",
	"ServerScriptService",
	"ServerStorage",
	"StarterGui",
	"StarterPlayer",
	"StarterPack",
	"SoundService",
}

local CLIENT_CONTAINERS =
	{ StarterGui = true, StarterPlayer = true, StarterPack = true, ReplicatedFirst = true }
local SERVER_CONTAINERS = { ServerScriptService = true, ServerStorage = true }

-- Safety cap so a pathological place can't freeze Studio in a single pass.
local MAX_INSTANCES = 200000

local function safeGet(instance: Instance, prop: string, default: any): any
	local ok, value = pcall(function()
		return (instance :: any)[prop]
	end)
	if ok then
		return value
	end
	return default
end

-- "Enum.RenderFidelity.Precise" -> "Precise"
local function enumName(value: any): string
	return (tostring(value):match("[^.]+$")) or tostring(value)
end

local function hex(color: any): string
	if typeof(color) ~= "Color3" then
		return "#000000"
	end
	return string.format(
		"#%02X%02X%02X",
		math.floor(color.R * 255 + 0.5),
		math.floor(color.G * 255 + 0.5),
		math.floor(color.B * 255 + 0.5)
	)
end

local function isCharacterPart(part: Instance): boolean
	local model = part:FindFirstAncestorWhichIsA("Model")
	while model do
		if model:FindFirstChildWhichIsA("Humanoid") then
			return true
		end
		model = model:FindFirstAncestorWhichIsA("Model")
	end
	return false
end

local function classifyScript(instance: Instance, container: string): (boolean, boolean, string)
	if instance:IsA("LocalScript") then
		return false, true, "Legacy"
	end

	local runContext = enumName(safeGet(instance, "RunContext", "Legacy"))

	if instance:IsA("Script") then
		if runContext == "Client" then
			return false, true, runContext
		end
		-- Legacy / Server Scripts run server-side only (never as a client script).
		return true, false, runContext
	end

	-- ModuleScript: required by either side; classify by container.
	local isClient = CLIENT_CONTAINERS[container] == true or container == "ReplicatedStorage"
	local isServer = SERVER_CONTAINERS[container] == true
		or container == "ReplicatedStorage"
		or not isClient
	return isServer, isClient, runContext
end

local function emptyInventory()
	return {
		parts = {},
		meshParts = {},
		unions = {},
		decals = {},
		textures = {},
		images = {},
		sounds = {},
		lights = {},
		guiObjects = {},
		textObjects = {},
		remotes = {},
		spawns = {},
		scripts = {},
		instancesByClass = {},
		totalInstances = 0,
		truncated = false,
		services = {},
	}
end

function DataModelScanner.scan(config: { [string]: any }?)
	local inventory = emptyInventory()
	local count = 0
	-- path -> live Instance, kept OUT of the pure context so rules stay data-only;
	-- the UI uses it for jump-to-instance.
	local refs: { [string]: Instance } = {}

	for _, rootName in SCAN_ROOTS do
		local ok, service = pcall(game.GetService, game, rootName)
		if not ok or service == nil then
			continue
		end
		-- Seed a ref for the service itself so service-level findings (path = "Workspace",
		-- "Lighting", ...) resolve for jump-to-instance.
		refs[rootName] = service

		for _, instance in service:GetDescendants() do
			count += 1
			if count > MAX_INSTANCES then
				inventory.truncated = true
				break
			end

			local className = instance.ClassName
			inventory.instancesByClass[className] = (inventory.instancesByClass[className] or 0) + 1
			local path = instance:GetFullName()
			refs[path] = instance

			local function record(props)
				return {
					path = path,
					name = instance.Name,
					className = className,
					container = rootName,
					props = props,
				}
			end

			if instance:IsA("BasePart") then
				local part = record({
					anchored = safeGet(instance, "Anchored", false),
					canCollide = safeGet(instance, "CanCollide", true),
					sizeMagnitude = math.max(instance.Size.X, instance.Size.Y, instance.Size.Z),
					material = enumName(safeGet(instance, "Material", "Plastic")),
					isCharacterPart = isCharacterPart(instance),
					transparency = safeGet(instance, "Transparency", 0),
				})
				table.insert(inventory.parts, part)
				if instance:IsA("MeshPart") then
					part.props.meshId = safeGet(instance, "MeshId", "")
					part.props.textureId = safeGet(instance, "TextureID", "")
					part.props.renderFidelity =
						enumName(safeGet(instance, "RenderFidelity", "Automatic"))
					part.props.collisionFidelity =
						enumName(safeGet(instance, "CollisionFidelity", "Default"))
					table.insert(inventory.meshParts, part)
				elseif instance:IsA("UnionOperation") then
					part.props.renderFidelity =
						enumName(safeGet(instance, "RenderFidelity", "Automatic"))
					part.props.collisionFidelity =
						enumName(safeGet(instance, "CollisionFidelity", "Default"))
					table.insert(inventory.unions, part)
				end
			end

			if instance:IsA("SpawnLocation") then
				table.insert(
					inventory.spawns,
					record({ neutral = safeGet(instance, "Neutral", true) })
				)
			end

			if instance:IsA("Decal") then
				table.insert(
					inventory.decals,
					record({ textureId = safeGet(instance, "Texture", "") })
				)
			elseif instance:IsA("Texture") then
				table.insert(
					inventory.textures,
					record({ textureId = safeGet(instance, "Texture", "") })
				)
			end

			if instance:IsA("Sound") then
				table.insert(
					inventory.sounds,
					record({
						soundId = safeGet(instance, "SoundId", ""),
						looped = safeGet(instance, "Looped", false),
						volume = safeGet(instance, "Volume", 0),
					})
				)
			end

			if instance:IsA("Light") then
				table.insert(
					inventory.lights,
					record({
						shadows = safeGet(instance, "Shadows", false),
						brightness = safeGet(instance, "Brightness", 0),
						range = safeGet(instance, "Range", 0),
						lightType = className,
					})
				)
			end

			if instance:IsA("GuiObject") then
				local size = instance.Size
				local position = instance.Position
				table.insert(
					inventory.guiObjects,
					record({
						sizeXScale = size.X.Scale,
						sizeYScale = size.Y.Scale,
						sizeXOffset = size.X.Offset,
						sizeYOffset = size.Y.Offset,
						posXScale = position.X.Scale,
						posYScale = position.Y.Scale,
						isButton = instance:IsA("GuiButton"),
						hasAspectConstraint = instance:FindFirstChildWhichIsA(
							"UIAspectRatioConstraint"
						) ~= nil,
						visible = safeGet(instance, "Visible", true),
					})
				)
				if instance:IsA("ImageLabel") or instance:IsA("ImageButton") then
					table.insert(
						inventory.images,
						record({
							image = safeGet(instance, "Image", ""),
							isButton = instance:IsA("ImageButton"),
						})
					)
				end
				if
					instance:IsA("TextLabel")
					or instance:IsA("TextButton")
					or instance:IsA("TextBox")
				then
					table.insert(
						inventory.textObjects,
						record({
							text = safeGet(instance, "Text", ""),
							textSize = safeGet(instance, "TextSize", 0),
							textScaled = safeGet(instance, "TextScaled", false),
							textColorHex = hex(safeGet(instance, "TextColor3", nil)),
							bgColorHex = hex(safeGet(instance, "BackgroundColor3", nil)),
							bgTransparency = safeGet(instance, "BackgroundTransparency", 0),
							isTextBox = instance:IsA("TextBox"),
						})
					)
				end
			end

			if instance:IsA("RemoteEvent") or instance:IsA("RemoteFunction") then
				table.insert(
					inventory.remotes,
					record({ isFunction = instance:IsA("RemoteFunction") })
				)
			end

			if instance:IsA("LuaSourceContainer") then
				local disabled = safeGet(instance, "Disabled", false) == true
				-- Disabled Scripts/LocalScripts never run, so source rules must not analyze
				-- them. (ModuleScripts have no meaningful Disabled state.)
				if not (disabled and not instance:IsA("ModuleScript")) then
					local isServer, isClient, runContext = classifyScript(instance, rootName)
					table.insert(inventory.scripts, {
						path = path,
						name = instance.Name,
						className = className,
						container = rootName,
						props = { disabled = disabled },
						source = ScriptReader.read(instance),
						runContext = runContext,
						isServer = isServer,
						isClient = isClient,
					})
				end
			end
		end

		if inventory.truncated then
			break
		end
	end

	inventory.totalInstances = count

	local workspaceService = game:GetService("Workspace")
	local lighting = game:GetService("Lighting")
	local players = game:GetService("Players")
	local httpService = game:GetService("HttpService")
	inventory.services = {
		workspace = {
			streamingEnabled = safeGet(workspaceService, "StreamingEnabled", false),
			streamingTargetRadius = safeGet(workspaceService, "StreamingTargetRadius", 0),
		},
		lighting = {
			technology = enumName(safeGet(lighting, "Technology", "Voxel")),
			globalShadows = safeGet(lighting, "GlobalShadows", true),
		},
		players = {
			maxPlayers = safeGet(players, "MaxPlayers", 0),
			respawnTime = safeGet(players, "RespawnTime", 0),
			characterAutoLoads = safeGet(players, "CharacterAutoLoads", true),
		},
		httpService = {
			httpEnabled = safeGet(httpService, "HttpEnabled", false),
		},
		soundService = {},
	}

	return {
		context = { inventory = inventory, config = config or {} },
		refs = refs,
	}
end

return DataModelScanner
