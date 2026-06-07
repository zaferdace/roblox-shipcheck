--!strict
-- WCAG 2.1 contrast-ratio helper. Pure function, no Roblox runtime needed.
local Contrast = {}

-- Parses "#rrggbb" -> r, g, b in [0, 1].
local function parseHex(hex: string): (number, number, number)
	local r = tonumber(hex:sub(2, 3), 16) or 0
	local g = tonumber(hex:sub(4, 5), 16) or 0
	local b = tonumber(hex:sub(6, 7), 16) or 0
	return r / 255, g / 255, b / 255
end

-- Linearizes an sRGB component per WCAG 2.1 formula.
local function linearize(c: number): number
	if c <= 0.04045 then
		return c / 12.92
	end
	return ((c + 0.055) / 1.055) ^ 2.4
end

-- Relative luminance of a linearized sRGB triple.
local function luminance(r: number, g: number, b: number): number
	return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b)
end

-- WCAG contrast ratio between two "#rrggbb" colours. Returns a value in [1, 21].
function Contrast.contrastRatio(hexA: string, hexB: string): number
	local lA = luminance(parseHex(hexA))
	local lB = luminance(parseHex(hexB))
	local lighter = if lA > lB then lA else lB
	local darker = if lA > lB then lB else lA
	return (lighter + 0.05) / (darker + 0.05)
end

return Contrast
