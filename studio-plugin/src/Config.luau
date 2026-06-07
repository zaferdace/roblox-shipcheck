--!strict
-- Build-time edition + free-tier limits. The paid Creator Store listing ships with
-- edition = "pro"; the free listing build flips it to "free" (see scripts/build.sh).
-- This is product packaging, not DRM: Luau source is readable and Roblox forbids
-- obfuscation, so gating is intentional friction, not copy protection.
return {
	edition = "pro" :: "pro" | "free",
	free = {
		maxFindings = 10,
		minSeverity = "high",
		allowExport = false,
		allowSuppressions = false,
		allowBaseline = false,
	},
}
