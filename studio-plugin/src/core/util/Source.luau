--!strict
-- Pure heuristic helpers for static Luau source scanning. `strip()` is a small
-- state machine (not a full parser) that blanks comments and string literals while
-- preserving byte offsets and newlines, so pattern scans don't match quoted/commented
-- code and reported line numbers stay accurate. Source rules are always advisory.
local Source = {}

-- Replaces a run of characters with spaces but keeps newlines, preserving offsets.
local function blank(segment: string): string
	return (segment:gsub("[^\n]", " "))
end

function Source.strip(src: string): string
	if type(src) ~= "string" then
		return ""
	end

	local out = {}
	local index = 1
	local length = #src

	while index <= length do
		local two = src:sub(index, index + 1)
		local char = src:sub(index, index)

		if two == "--" then
			-- Comment. Check for a long-bracket form first.
			local eqs = src:match("^%[(=*)%[", index + 2)
			if eqs then
				local close = "]" .. eqs .. "]"
				local endPos = src:find(close, index + 2 + #eqs + 1, true)
				local stop = endPos and (endPos + #close - 1) or length
				table.insert(out, blank(src:sub(index, stop)))
				index = stop + 1
			else
				local newline = src:find("\n", index, true)
				local stop = newline and (newline - 1) or length
				table.insert(out, blank(src:sub(index, stop)))
				index = stop + 1
			end
		elseif char == '"' or char == "'" then
			-- Short string with escape handling.
			local quote = char
			table.insert(out, " ")
			index += 1
			while index <= length do
				local ch = src:sub(index, index)
				if ch == "\\" then
					table.insert(out, "  ")
					index += 2
				elseif ch == quote then
					table.insert(out, " ")
					index += 1
					break
				elseif ch == "\n" then
					table.insert(out, "\n")
					index += 1
					break
				else
					table.insert(out, " ")
					index += 1
				end
			end
		elseif char == "[" then
			-- Long string [[ ]] / [==[ ]==].
			local eqs = src:match("^%[(=*)%[", index)
			if eqs then
				local close = "]" .. eqs .. "]"
				local endPos = src:find(close, index + 2 + #eqs, true)
				local stop = endPos and (endPos + #close - 1) or length
				table.insert(out, blank(src:sub(index, stop)))
				index = stop + 1
			else
				table.insert(out, char)
				index += 1
			end
		else
			table.insert(out, char)
			index += 1
		end
	end

	return table.concat(out)
end

-- matches a method call `:name(`
function Source.hasMethodCall(src: string, name: string): boolean
	return src:find(":%s*" .. name .. "%s*%(") ~= nil
end

-- byte offset of the first `:name(` occurrence, or nil
function Source.findMethodCall(src: string, name: string): number?
	return (src:find(":%s*" .. name .. "%s*%("))
end

-- matches a free call `name(` with a non-identifier (or start) boundary before it
function Source.hasCall(src: string, name: string): boolean
	if src:find("^%s*" .. name .. "%s*%(") ~= nil then
		return true
	end
	return src:find("[^%w_]" .. name .. "%s*%(") ~= nil
end

function Source.has(src: string, pattern: string): boolean
	return src:find(pattern) ~= nil
end

function Source.count(src: string, pattern: string): number
	local n = 0
	for _ in src:gmatch(pattern) do
		n += 1
	end
	return n
end

-- 1-based line number containing a byte offset.
function Source.lineOf(src: string, index: number): number
	local _, newlines = src:sub(1, index):gsub("\n", "")
	return newlines + 1
end

-- true if the source references a given service via GetService or as a bare name
function Source.usesService(src: string, serviceName: string): boolean
	if src:find("GetService%s*%(%s*[\"']" .. serviceName .. "[\"']%s*%)") ~= nil then
		return true
	end
	return src:find("[^%w_]" .. serviceName .. "[^%w_]") ~= nil
end

return Source
