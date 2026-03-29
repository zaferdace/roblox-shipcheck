# Example: Shooter Audit Report

Sample output from running shooter-specific checks on a Roblox FPS project.

## Shipcheck Report — MyShooterGame

**Date:** 2026-03-29T20:00:00Z
**Verdict:** REVIEW — Score: 72/100

### Summary
- Blockers: 0
- Warnings: 3
- Info: 1
- Manual review needed: 2

### Shooter-Specific Findings

#### [shooter-weapon-001] Unvalidated weapon remote
**Confidence:** medium | **Category:** security | **Remediation:** assisted
Handler for "FireWeapon" in ServerScriptService.WeaponHandler may lack argument type checks.
**Evidence:** ServerScriptService.WeaponHandler — no typeof/tonumber patterns found
**Recommendation:** Validate argument types (typeof, tonumber, etc.) in OnServerEvent handlers.

#### [shooter-weapon-002] No rate limiting on damage remote
**Confidence:** heuristic | **Category:** security | **Remediation:** assisted
No rate limiting patterns detected for "ApplyDamage" handler.
**Evidence:** ServerScriptService.DamageHandler — no tick()/cooldown/debounce patterns
**Recommendation:** Add server-side rate limiting to prevent fire-rate exploitation.

#### [shooter-spawn-001] Spawn point clustering detected
**Confidence:** heuristic | **Category:** gameplay | **Remediation:** manual
Average spawn spread is 18.4 studs, below the 30-stud minimum.
**Evidence:** 8 SpawnLocations in Workspace.Spawns, avg distance: 18.4 studs
**Recommendation:** Spread spawn points to reduce spawn-kill risk.

#### [shooter-spawn-002] Team spawn imbalance
**Confidence:** medium | **Category:** gameplay | **Remediation:** manual
Team "Red" has 5 spawns, team "Blue" has 2 spawns.
**Evidence:** SpawnLocation TeamColor distribution
**Recommendation:** Balance spawn counts across teams.

### Playtester Results

#### shooter_weapon_equip — PASS
- StarterPack: 3 Tools found (Rifle, Pistol, Knife)
- All weapons have Handle parts
- Config values: Rifle (Damage=25, Ammo=30), Pistol (Damage=15, Ammo=12)

#### shooter_respawn_cycle — PASS
- CharacterAutoLoads: true
- RespawnTime: 5 seconds
- SpawnLocations: 8 (Red: 5, Blue: 2, Neutral: 1)
- CharacterAdded handlers: 3 found

---

*This is a sample report. Actual output depends on your project's structure and configuration.*
*All findings are heuristic — they flag review candidates, not definitive issues.*
