# Shipcheck Report — Penguin Obby
**Date:** 2026-03-29T18:00:00Z
**Verdict:** REVIEW — Score: 68/100

## Summary
- 🔴 Blockers: 0
- 🟡 Warnings: 4
- ℹ️ Info: 1
- 👁 Manual review needed: 2

## Issues

### 🟡 Warnings

#### [remote-001] Unvalidated RemoteEvent handler
**Confidence:** high | **Category:** security | **Remediation:** assisted
Server handler for "PurchaseRequest" does not validate argument types. Client can send unexpected data.
**Evidence:** ServerScriptService.ShopHandler:14
**Recommendation:** Add type checks and sanity validation for all RemoteEvent arguments before processing.

#### [mobile-001] Touch target below minimum size
**Confidence:** high | **Category:** mobile | **Remediation:** auto
TextButton "BuyBtn" absolute size is 32x28px, below the 44px minimum recommended for reliable touch input on mobile devices.
**Evidence:** StarterGui.ShopUI.MainFrame.BuyBtn
**Recommendation:** Increase button size to at least 44x44 pixels.

#### [datastore-001] DataStore operations without pcall
**Confidence:** high | **Category:** datastore | **Remediation:** assisted
DataStore GetAsync and SetAsync calls detected without pcall/xpcall protection. Transient failures will crash the script.
**Evidence:** ServerScriptService.DataHandler:22
**Recommendation:** Wrap DataStore requests in pcall or xpcall and handle transient failures with retry logic.

#### [maturity-001] Social link reference detected
**Confidence:** manual_review | **Category:** social | **Remediation:** manual
Script contains "discord.gg" reference. External social links may require content maturity questionnaire review.
**Evidence:** ServerScriptService.WelcomeHandler:8
**Recommendation:** Verify all external references for Roblox community guidelines and content policy compliance.

### ℹ️ Info

#### [package-001] Auto-update disabled on package
**Confidence:** high | **Category:** packages | **Remediation:** manual
PackageLink "UIComponents" has AutoUpdate disabled. Package may be out of date.
**Evidence:** ReplicatedStorage.UIComponents.PackageLink
**Recommendation:** Consider enabling auto-update or manually checking for package updates.

## Checks Run
- remote_contract_audit
- datastore_schema_guard
- marketplace_compliance_audit
- validate_mobile_ui
- localization_coverage_audit
- content_maturity_check
- teleport_graph_audit
- package_drift_audit
- accessibility_audit
- runtime_profiler
