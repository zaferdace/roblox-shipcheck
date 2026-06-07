--!nonstrict
-- Headless test entry point. Run with: lune run tests/runner
--
-- Discovers every `*.spec.luau` under tests/, executes it with an injected
-- (describe, it, expect, requireSrc) surface, and reports a pass/fail summary.
-- Exits non-zero on any failure so CI gates on it.

local fs = require("@lune/fs")
local process = require("@lune/process")
local luau = require("@lune/luau")
local Roblox = require("./lib/Roblox")
local TestKit = require("./lib/TestKit")

local ROOT = process.args[1] or "."
local SRC_DIR = ROOT .. "/src"
local TESTS_DIR = ROOT .. "/tests"

local function discoverSpecs(dir: string, acc: { string })
	for _, entry in fs.readDir(dir) do
		local full = dir .. "/" .. entry
		local meta = fs.metadata(full)
		if meta.kind == "dir" then
			discoverSpecs(full, acc)
		elseif entry:match("%.spec%.luau$") then
			table.insert(acc, full)
		end
	end
	return acc
end

local function specEnv(srcRoot, testsRoot, kit)
	local env = {
		table = table,
		string = string,
		math = math,
		os = os,
		pairs = pairs,
		ipairs = ipairs,
		next = next,
		select = select,
		type = type,
		typeof = typeof,
		tostring = tostring,
		tonumber = tonumber,
		pcall = pcall,
		error = error,
		assert = assert,
		setmetatable = setmetatable,
		getmetatable = getmetatable,
		print = print,
		warn = warn,
		unpack = table.unpack,
		describe = function(name, body)
			kit:describe(name, body)
		end,
		it = function(name, body)
			kit:it(name, body)
		end,
		expect = TestKit.expect,
		requireSrc = function(path)
			return Roblox.requirePath(srcRoot, path)
		end,
		requireTest = function(path)
			return Roblox.requirePath(testsRoot, path)
		end,
	}
	env._G = env
	return env
end

local function main()
	local srcRoot = Roblox.buildTree(SRC_DIR, "shipcheck")
	local testsRoot = Roblox.buildTree(TESTS_DIR, "tests")
	local kit = TestKit.new()

	local specs = discoverSpecs(TESTS_DIR, {})
	table.sort(specs)

	-- optional substring filter (args[2]) so a focused run only executes matching specs
	local filter = process.args[2]
	if filter then
		local filtered = {}
		for _, specPath in specs do
			if specPath:find(filter, 1, true) then
				table.insert(filtered, specPath)
			end
		end
		specs = filtered
	end

	for _, specPath in specs do
		local source = fs.readFile(specPath)
		local env = specEnv(srcRoot, testsRoot, kit)
		local loaded, chunk =
			pcall(luau.load, source, { environment = env, debugName = "@" .. specPath })
		if not loaded then
			kit.failed += 1
			table.insert(kit.failures, ("could not load %s: %s"):format(specPath, tostring(chunk)))
		else
			local ok, runErr = pcall(chunk)
			if not ok then
				kit.failed += 1
				table.insert(kit.failures, ("%s errored: %s"):format(specPath, tostring(runErr)))
			end
		end
	end

	print(
		("\nshipcheck tests: %d passed, %d failed (%d spec files)\n"):format(
			kit.passed,
			kit.failed,
			#specs
		)
	)

	if kit.failed > 0 then
		print("Failures:")
		for _, f in kit.failures do
			print("  ✗ " .. f)
		end
		process.exit(1)
	end
end

main()
