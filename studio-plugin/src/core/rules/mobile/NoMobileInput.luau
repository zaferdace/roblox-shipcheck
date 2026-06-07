--!strict
-- Flags scripts that bind keyboard input via UserInputService/InputBegan + Enum.KeyCode
-- but have NO touch/mobile path. A keyboard-only input handler will silently do nothing
-- on phones and tablets. Conservative: requires all three keyboard signals to be present
-- before flagging, and clears when any touch signal exists.
local Source = require(script.Parent.Parent.Parent.util.Source)

local Rule = {
	id = "no-mobile-input",
	title = "Keyboard input handler with no touch fallback",
	category = "mobile",
	kind = "source",
	severity = "medium",
	description = "Scripts that bind keyboard input with no touch/ContextAction path will silently do nothing on phones.",
	docs = "https://create.roblox.com/docs/input/mobile",
	defaultEnabled = true,
	tags = { "mobile", "input" },
}

-- Patterns that indicate keyboard-only input binding.
local KEYBOARD_SIGNALS = {
	"UserInputService",
	"InputBegan",
	"Enum%.KeyCode",
}

-- Any of these patterns indicates a touch/mobile path is already present.
local TOUCH_SIGNALS = {
	"TouchEnabled",
	"ContextActionService",
	"Touch",
}

function Rule.run(ctx)
	local findings = {}

	for _, scriptRec in ctx.inventory.scripts do
		local stripped = Source.strip(scriptRec.source)
		local withStrings = Source.stripComments(scriptRec.source)

		-- All three keyboard signals must be present.
		local hasKeyboard = true
		for _, sig in KEYBOARD_SIGNALS do
			if not Source.has(stripped, sig) and not Source.has(withStrings, sig) then
				hasKeyboard = false
				break
			end
		end
		if not hasKeyboard then
			continue
		end

		-- If any touch signal exists, it is fine — skip conservatively.
		local hasTouch = false
		for _, sig in TOUCH_SIGNALS do
			if Source.has(stripped, sig) or Source.has(withStrings, sig) then
				hasTouch = true
				break
			end
		end
		if hasTouch then
			continue
		end

		-- Find a representative line for the first keyboard signal occurrence.
		local pos = Source.findMethodCall(stripped, "InputBegan")
		local line = if pos then Source.lineOf(scriptRec.source, pos) else nil

		table.insert(findings, {
			title = ("'%s' binds keyboard input with no touch fallback"):format(scriptRec.name),
			detail = "This script uses UserInputService.InputBegan with Enum.KeyCode but has no touch, ContextActionService, or TouchEnabled path. On phones and tablets keyboard input events never fire, so the handler is effectively dead.",
			fix = "Add a ContextActionService binding (works for keyboard, gamepad, and touch simultaneously) or check UserInputService.TouchEnabled and provide an on-screen button alternative.",
			path = scriptRec.path,
			evidence = { line = line },
		})
	end

	return findings
end

return Rule
