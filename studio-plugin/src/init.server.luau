--!strict
-- shipcheck — Studio plugin entry point. This is the ONLY file that references the
-- `plugin` global; everything else receives it through Bootstrap.
local Bootstrap = require(script.Bootstrap)

Bootstrap.start(plugin)
