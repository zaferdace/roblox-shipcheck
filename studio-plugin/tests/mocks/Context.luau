--!nonstrict
-- Builders for fake ScanContexts / records so rules can be tested with no Roblox runtime.
local Context = {}

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
		services = {
			workspace = { streamingEnabled = true },
			lighting = { technology = "ShadowMap" },
			players = { maxPlayers = 30, respawnTime = 5, characterAutoLoads = true },
			httpService = { httpEnabled = false },
			soundService = {},
		},
	}
end

-- overrides: a map of inventory field -> value (e.g. { parts = {...} })
function Context.new(overrides)
	local inventory = emptyInventory()
	if overrides then
		for key, value in overrides do
			inventory[key] = value
		end
	end
	return { inventory = inventory, config = {} }
end

local function leafName(path)
	return path:match("[^%.]+$") or path
end

function Context.part(path, props)
	return {
		path = path,
		name = leafName(path),
		className = "Part",
		container = "Workspace",
		props = props or {},
	}
end

function Context.script(path, source, opts)
	opts = opts or {}
	return {
		path = path,
		name = leafName(path),
		className = opts.className or "Script",
		container = opts.container or "ServerScriptService",
		props = {},
		source = source,
		runContext = opts.runContext or "Legacy",
		isServer = opts.isServer ~= false,
		isClient = opts.isClient == true,
	}
end

return Context
