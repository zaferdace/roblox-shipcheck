--!nonstrict
local Source = requireSrc("core/util/Source")

describe("Source.strip", function()
	it("blanks line comments but keeps surrounding code", function()
		local stripped = Source.strip("local x = 1 -- store:SetAsync()\nprint(x)")
		expect(Source.hasMethodCall(stripped, "SetAsync")).toBeFalsy()
		expect(Source.hasCall(stripped, "print")).toBeTruthy()
	end)

	it("does not let a string containing -- erase following code", function()
		local stripped = Source.strip('local a = "--" store:SetAsync(k)')
		expect(Source.hasMethodCall(stripped, "SetAsync")).toBeTruthy()
	end)

	it("blanks block comments while preserving line numbers", function()
		local src = "a\n--[[ b\nc ]] d:GetAsync()\n"
		local stripped = Source.strip(src)
		expect(Source.hasMethodCall(stripped, "GetAsync")).toBeTruthy()
		local pos = Source.findMethodCall(stripped, "GetAsync")
		expect(Source.lineOf(src, pos)).toBe(3)
	end)

	it("blanks long strings", function()
		local stripped = Source.strip("local html = [[ :SetAsync( ]] local y = 2")
		expect(Source.hasMethodCall(stripped, "SetAsync")).toBeFalsy()
	end)

	it("handles escaped quotes inside short strings", function()
		local stripped = Source.strip([[local a = "x\"y" b:GetAsync()]])
		expect(Source.hasMethodCall(stripped, "GetAsync")).toBeTruthy()
	end)
end)
