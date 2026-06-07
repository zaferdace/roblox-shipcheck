--!strict
-- Brand palette + severity/verdict color mapping (deep-space navy + signal teal +
-- confidence green; green reserved for the pass/SHIP state).
local Palette = {}

Palette.navy = Color3.fromHex("0E1A2B")
Palette.navy700 = Color3.fromHex("16263B")
Palette.teal = Color3.fromHex("1FB6C9")
Palette.green = Color3.fromHex("2BD37A")
Palette.amber = Color3.fromHex("FFB020")
Palette.red = Color3.fromHex("FF5A5F")
Palette.white = Color3.fromHex("F4F8FB")
Palette.slate = Color3.fromHex("7C8DA6")

function Palette.severityColor(severity: string): Color3
	if severity == "blocker" then
		return Palette.red
	elseif severity == "high" then
		return Palette.amber
	elseif severity == "medium" then
		return Palette.teal
	end
	return Palette.slate
end

function Palette.verdictColor(verdict: string): Color3
	if verdict == "SHIP" then
		return Palette.green
	elseif verdict == "HOLD" then
		return Palette.red
	end
	return Palette.amber
end

return Palette
