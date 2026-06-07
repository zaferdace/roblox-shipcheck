--!nonstrict
-- Headless Roblox module-require emulator for Lune.
--
-- The shipped plugin uses Roblox-native instance requires (`require(script.Parent.X)`)
-- so it is 100% Studio-safe. To unit-test the pure core under Lune we mirror the Rojo
-- source tree in memory and execute each module with a synthetic `script` node and a
-- `require` that resolves instance arguments against that tree. Specs never ship.
--
-- Rojo semantics implemented:
--   * a folder becomes a Folder node
--   * a `.luau` file becomes a ModuleScript node (name = filename without extension,
--     and without a `.server`/`.client` sub-extension)
--   * a folder containing `init.luau` / `init.server.luau` BECOMES that module, with the
--     folder's other entries as its children

local fs = require("@lune/fs")
local luau = require("@lune/luau")

local Roblox = {}

local SENTINEL = setmetatable({}, {
	__tostring = function()
		return "RobloxRequireSentinel"
	end,
})

-- Globals exposed to every emulated module. The pure core only needs the standard
-- library; Roblox-coupled layers (services/ui) are not loaded under Lune.
local function baseGlobals()
	return {
		table = table,
		string = string,
		math = math,
		os = os,
		coroutine = coroutine,
		utf8 = utf8,
		buffer = buffer,
		pairs = pairs,
		ipairs = ipairs,
		next = next,
		select = select,
		type = type,
		typeof = typeof,
		tostring = tostring,
		tonumber = tonumber,
		pcall = pcall,
		xpcall = xpcall,
		error = error,
		assert = assert,
		setmetatable = setmetatable,
		getmetatable = getmetatable,
		rawget = rawget,
		rawset = rawset,
		rawequal = rawequal,
		rawlen = rawlen,
		print = print,
		warn = warn,
		unpack = table.unpack,
		_VERSION = _VERSION,
	}
end

local nodeMethods = {}

local function makeNode(name: string, kind: string)
	local node = {
		Name = name,
		ClassName = (kind == "module") and "ModuleScript" or "Folder",
		Parent = nil,
		_kind = kind,
		_children = {},
		_source = nil,
		_path = nil,
		_loaded = SENTINEL,
	}
	return setmetatable(node, {
		__index = function(self, key)
			local child = rawget(self, "_children")[key]
			if child ~= nil then
				return child
			end
			return nodeMethods[key]
		end,
		__tostring = function(self)
			return rawget(self, "Name")
		end,
	})
end

function nodeMethods.FindFirstChild(self, name: string)
	return rawget(self, "_children")[name]
end

function nodeMethods.GetChildren(self)
	local out = {}
	for _, child in rawget(self, "_children") do
		table.insert(out, child)
	end
	return out
end

function nodeMethods.IsA(self, className: string)
	return rawget(self, "ClassName") == className
end

local function addChild(parent, child)
	local children = rawget(parent, "_children")
	if children[child.Name] ~= nil then
		error(("duplicate child name '%s' under '%s'"):format(child.Name, tostring(parent)), 2)
	end
	child.Parent = parent
	children[child.Name] = child
end

-- strips `.luau`, then an optional `.server` / `.client` sub-extension
local function moduleNameFromFile(fileName: string): string
	local base = fileName:gsub("%.luau$", "")
	base = base:gsub("%.server$", ""):gsub("%.client$", "")
	return base
end

local buildDir

local function buildFolder(node, dirPath: string)
	local entries = fs.readDir(dirPath)
	-- Detect an init file first so the folder can become a module.
	local initCount = 0
	for _, entry in entries do
		if entry == "init.luau" or entry == "init.server.luau" or entry == "init.client.luau" then
			initCount += 1
			node._kind = "module"
			node.ClassName = "ModuleScript"
			node._source = fs.readFile(dirPath .. "/" .. entry)
			node._path = dirPath .. "/" .. entry
		end
	end
	if initCount > 1 then
		error(("folder '%s' has multiple init files"):format(dirPath), 2)
	end

	for _, entry in entries do
		local full = dirPath .. "/" .. entry
		local meta = fs.metadata(full)
		if meta.kind == "dir" then
			local child = makeNode(entry, "folder")
			addChild(node, child)
			buildDir(child, full)
		elseif entry:match("%.luau$") then
			local isInit = entry == "init.luau"
				or entry == "init.server.luau"
				or entry == "init.client.luau"
			if not isInit then
				local child = makeNode(moduleNameFromFile(entry), "module")
				child._source = fs.readFile(full)
				child._path = full
				addChild(node, child)
			end
		end
	end
end

buildDir = buildFolder

-- Builds the in-memory tree for a Rojo `$path` directory and returns its root node.
function Roblox.buildTree(srcDir: string, rootName: string)
	local root = makeNode(rootName, "folder")
	root._path = srcDir
	buildFolder(root, srcDir)
	return root
end

-- Resolves and runs a module node, caching the result (singleton, like Roblox).
function Roblox.requireNode(node)
	if rawget(node, "_kind") ~= "module" then
		error(("attempt to require a non-ModuleScript node '%s'"):format(tostring(node)), 2)
	end
	if rawget(node, "_loaded") ~= SENTINEL then
		return rawget(node, "_loaded")
	end

	local env = baseGlobals()
	env.script = node
	env.require = function(arg)
		if type(arg) == "table" then
			return Roblox.requireNode(arg)
		end
		error("emulated require only accepts instance nodes, got " .. typeof(arg), 2)
	end
	-- self-reference so deeply nested code that reads _G stays sane
	env._G = env

	local ok, chunkOrErr = pcall(luau.load, rawget(node, "_source"), {
		environment = env,
		debugName = "@" .. tostring(rawget(node, "_path")),
	})
	if not ok then
		error(("failed to load module '%s': %s"):format(tostring(node), tostring(chunkOrErr)), 2)
	end
	local result = chunkOrErr()
	rawset(node, "_loaded", result)
	return result
end

-- Navigates a slash path ("core/Engine") from a root node and requires the leaf.
function Roblox.requirePath(root, path: string)
	local node = root
	for segment in string.gmatch(path, "[^/]+") do
		local child = rawget(node, "_children")[segment]
		if child == nil then
			error(("no module at path segment '%s' (in '%s')"):format(segment, path), 2)
		end
		node = child
	end
	return Roblox.requireNode(node)
end

return Roblox
