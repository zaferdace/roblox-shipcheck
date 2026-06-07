--!nonstrict
-- Minimal headless test framework (describe / it / expect) for Lune.
-- Pure Luau; no Roblox or Lune APIs so it stays trivially portable.

local TestKit = {}
TestKit.__index = TestKit

function TestKit.new()
	return setmetatable({
		_suites = {},
		_current = nil,
		passed = 0,
		failed = 0,
		failures = {},
	}, TestKit)
end

function TestKit:describe(name: string, body: () -> ())
	local previous = self._current
	self._current = name
	local ok, err = pcall(body)
	if not ok then
		self.failed += 1
		table.insert(self.failures, ("[%s] suite body errored: %s"):format(name, tostring(err)))
	end
	self._current = previous
end

function TestKit:it(name: string, body: () -> ())
	local label = (self._current and (self._current .. " › ") or "") .. name
	local ok, err = pcall(body)
	if ok then
		self.passed += 1
	else
		self.failed += 1
		table.insert(self.failures, ("%s\n      %s"):format(label, tostring(err)))
	end
end

local function fail(message: string)
	error(message, 3)
end

-- counts entries in an array or map
local function count(t: any): number
	if type(t) ~= "table" then
		return 0
	end
	local n = 0
	for _ in t do
		n += 1
	end
	return n
end

-- Closure-based matchers so both dot (`expect(x).toBe(y)`) and the value capture work
-- without `self` threading. Each matcher returns the expectation for chaining.
function TestKit.expect(value: any)
	local exp = {}

	function exp.toBe(expected: any)
		if value ~= expected then
			fail(("expected %s to equal %s"):format(tostring(value), tostring(expected)))
		end
		return exp
	end

	function exp.toNotBe(expected: any)
		if value == expected then
			fail(("expected %s to NOT equal %s"):format(tostring(value), tostring(expected)))
		end
		return exp
	end

	function exp.toBeTruthy()
		if not value then
			fail(("expected %s to be truthy"):format(tostring(value)))
		end
		return exp
	end

	function exp.toBeFalsy()
		if value then
			fail(("expected %s to be falsy"):format(tostring(value)))
		end
		return exp
	end

	function exp.toBeNil()
		if value ~= nil then
			fail(("expected %s to be nil"):format(tostring(value)))
		end
		return exp
	end

	function exp.toEqual(expected: number, tolerance: number?)
		local tol = tolerance or 1e-9
		if type(value) ~= "number" or math.abs(value - expected) > tol then
			fail(("expected %s to approx-equal %s"):format(tostring(value), tostring(expected)))
		end
		return exp
	end

	function exp.toBeGreaterThan(expected: number)
		if type(value) ~= "number" or value <= expected then
			fail(("expected %s to be > %s"):format(tostring(value), tostring(expected)))
		end
		return exp
	end

	function exp.toBeGreaterThanOrEqual(expected: number)
		if type(value) ~= "number" or value < expected then
			fail(("expected %s to be >= %s"):format(tostring(value), tostring(expected)))
		end
		return exp
	end

	function exp.toHaveLength(expected: number)
		local n = count(value)
		if n ~= expected then
			fail(("expected length %d, got %d"):format(expected, n))
		end
		return exp
	end

	function exp.toContainKey(key: any)
		if type(value) ~= "table" or value[key] == nil then
			fail(("expected table to contain key %s"):format(tostring(key)))
		end
		return exp
	end

	-- array contains a value
	function exp.toContainValue(needle: any)
		if type(value) == "table" then
			for _, v in value do
				if v == needle then
					return exp
				end
			end
		end
		fail(("expected table to contain value %s"):format(tostring(needle)))
		return exp
	end

	return exp
end

return TestKit
