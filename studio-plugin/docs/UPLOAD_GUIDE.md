# Publishing shipcheck to the Creator Store

These are the manual, account-bound steps to take the built `.rbxm` to a live, paid
Creator Store listing. They require **your** logged-in Roblox account and cannot be
automated.

## 0. One-time seller setup (required to charge money)

1. **Government-ID verify** your Roblox account (Account → Settings → Verification;
   uses Persona — ID scan + selfie). Phone verification is **not** enough to sell.
2. **Set up a seller account + Stripe onboarding** (tax forms W-8/W-9). Must be in a
   Stripe-supported country (Brazil/China/India/Russia are not yet supported).
3. A **verified** account may distribute up to 10 plugins per 30 days. Seller-account
   review can take up to ~7 days — do this early.

> Free distribution does NOT require Stripe — you can publish the Free edition first to
> validate demand, then complete Stripe before flipping the paid tier on.

## 1. Build the artifacts

```bash
cd studio-plugin
./scripts/build.sh          # -> build/shipcheck.rbxm (Pro) and build/shipcheck-free.rbxm (Free)
```

## 2. Set the toolbar icon (optional but recommended)

The plugin currently uses a placeholder toolbar icon (`rbxassetid://0`).

1. In Studio, upload `assets/shipcheck_toolbar_32.png` (Asset Manager → Images, or the
   Creator Dashboard) and copy its asset id.
2. In `src/Bootstrap.luau`, replace `"rbxassetid://0"` in `toolbar:CreateButton(...)`
   with `"rbxassetid://<your id>"`, then re-run `./scripts/build.sh`.

(The 16×16 variant `assets/shipcheck_toolbar_16.png` is for the quick-access bar.)

## 3. Import and publish from Studio

Roblox publishes plugins **from Studio**, not by uploading a file on the website.

1. Open a Studio place. Drag `build/shipcheck.rbxm` into Studio (or Insert → from file)
   so the `shipcheck` model/script appears in Explorer.
2. (To sanity-check first, right-click it → **Save as Local Plugin**, then run an audit
   on a test place — see "Smoke test" below.)
3. Right-click the `shipcheck` root in Explorer → **Save to Roblox**.
4. Set **Name** = `shipcheck — Ship-Readiness Audit & Pre-Launch Checker`,
   paste the **Description** (see `STORE_LISTING.md`), Content Type = **Development
   Item**, and Save.

## 4. Configure the Creator Store listing

On the Creator Dashboard (create.roblox.com → your Development Item → **Configure**):

1. **Distribution** → toggle **Distribute on Creator Store**.
2. **USD Pricing** → enter the price (recommended **$24.99**, see `STORE_LISTING.md`).
3. Upload the **icon** (`assets/shipcheck_store_icon_512.png`, 512×512 PNG) and **5
   thumbnails** (1920×1080 16:9 PNG — see the media plan).
4. Add the **tags**: audit, optimization, checklist, qa, release.
5. Save Changes. The listing goes public on save — verify everything first.

## 5. Free edition

Repeat steps 3–4 with `build/shipcheck-free.rbxm`, name it
`shipcheck (Free)`, and set the price to **$0** / leave it free. It needs no Stripe.

## 6. Launch

1. Post a **DevForum → Community Resources** showcase thread (GIF first, then the report
   screenshots, feature bullets, free-vs-paid breakdown, buy link).
2. Submit the official **Featured Plugins** nomination survey, leading with the
   "productivity / time saved / automated QA" angle.
3. Amplify on X with #RobloxDev and in active Roblox dev Discords.
4. Run the 20% launch-week discount to seed reviews.

## Smoke test before publishing

Because the rules engine is unit-tested but the Studio integration (scanner + UI) is
not runnable headless, do ONE manual pass before listing:

1. Save `shipcheck.rbxm` as a local plugin (Plugins folder).
2. Open a real place, click the **Audit** toolbar button, then **Run audit**.
3. Confirm: the dock widget shows a verdict + score, findings render with severity
   colors, "Select instance" focuses the right object, and there are no errors in the
   Output window. Fix any issue, rebuild, then publish.
