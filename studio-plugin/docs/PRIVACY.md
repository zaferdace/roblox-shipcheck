# Privacy

shipcheck runs **entirely on your machine, inside Roblox Studio**.

- The audit reads the currently-open place's DataModel (instances, properties, and
  script source) locally to generate its report.
- **No project data, script source, or scan result ever leaves Studio.** The plugin
  makes no network requests and contacts no external server.
- The only data persisted is your plugin settings (rule toggles, thresholds,
  suppressions), stored locally via Studio's standard `plugin:SetSetting` mechanism.
- The plugin never modifies your place. "Jump to instance" only selects and focuses
  an object; it does not edit it.

Because everything is local, the audit works offline and requires no permissions
beyond running as a Studio plugin.
