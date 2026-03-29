# Shooter/Sniper Genre Checks

Genre-specific checks for Roblox shooter and sniper games. All checks are **opt-in** and **heuristic** — they use pattern matching and static analysis, not runtime simulation.

## Shipcheck Rules

### `rbx_shooter_weapon_remote_trust`

Audits weapon-related RemoteEvents and RemoteFunctions for server-side validation.

**What it checks:**
- Finds remotes with weapon-related names (fire, shoot, damage, hit, reload, equip, weapon, gun, bullet, projectile)
- Verifies each remote has a server-side handler in ServerScriptService
- Checks handlers for argument type validation (typeof, tonumber, assert, etc.)
- Checks handlers for rate limiting patterns (tick, cooldown, debounce, throttle)

**Issues raised:**

| Rule | Severity | Confidence | Description |
|------|----------|------------|-------------|
| `no_server_handler` | medium | medium | Weapon remote has no server-side handler |
| `missing_type_validation` | medium | heuristic | Handler lacks argument type checks |
| `no_rate_limiting` | low | heuristic | Handler lacks rate limiting patterns |

**Limitations:**
- Pattern-based name matching — non-standard naming may be missed
- Cannot verify validation is *correct*, only that patterns *exist*
- Obfuscated or minified scripts won't be analyzed effectively
- Only scans ServerScriptService for handlers

---

### `rbx_shooter_spawn_clustering`

Analyzes SpawnLocation distribution for fairness issues.

**What it checks:**
- Measures pairwise distances between all SpawnLocations
- Flags clustering when average spread is below threshold (default: 30 studs)
- Checks team balance — flags if team spawn counts differ by more than 2x
- Detects suspicious spawn heights (Y < -10 or Y > 1000)

**Issues raised:**

| Rule | Severity | Confidence | Description |
|------|----------|------------|-------------|
| `spawn_clustering` | warning | heuristic | Spawns are clustered below minimum spread |
| `team_spawn_imbalance` | warning | medium | Teams have unequal spawn point counts |
| `suspicious_spawn_height` | info | medium | Spawn at extreme Y position |

**Limitations:**
- Position-only heuristic — cannot assess line-of-sight or cover
- Intentionally clustered spawns (lobby areas) will be flagged
- FFA games without teams may trigger false positives on team balance

---

### `rbx_shooter_combat_content_maturity`

Scans scripts and UI text for combat-related content that may affect age rating.

**What it checks:**
- Reads all script source code and scans for keyword categories
- Scans TextLabel and TextButton text properties
- Categories: violence_explicit, violence_moderate, weapon_refs, social_risk

**Keyword categories:**

| Category | Examples | Severity |
|----------|----------|----------|
| violence_explicit | gore, dismember, decapitate, torture | warning |
| violence_moderate | blood, bleed, corpse, dead body | info |
| weapon_refs | AK-47, shotgun, sniper rifle, RPG | info |
| social_risk | discord.gg, youtube.com, twitter.com | warning |

**Limitations:**
- Keyword-based only — no semantic understanding
- Common game terms may be flagged (e.g., "headshot" is normal in shooters)
- All findings are `manual_review` confidence — flags for human review, not violations

## Playtester Presets

### `shooter_weapon_equip`

Verifies weapon Tools exist with proper configuration.

**Flow:**
1. Check StarterPack for Tool instances
2. Verify weapons have Handle parts
3. Check for config values (Damage, Ammo, FireRate)
4. Confirm at least one configured weapon exists

**Expected result:** PASS for shooter projects with value-instance weapon configs. PARTIAL or FAIL for non-shooter projects or script-based configs.

---

### `shooter_respawn_cycle`

Validates respawn infrastructure.

**Flow:**
1. Check Players.CharacterAutoLoads and RespawnTime
2. Count SpawnLocations and team assignments
3. Search for CharacterAdded handlers in scripts
4. Confirm spawn infrastructure exists

**Expected result:** PASS for most games with standard respawn setup. PARTIAL if CharacterAutoLoads is disabled (may be intentional for custom respawn).
