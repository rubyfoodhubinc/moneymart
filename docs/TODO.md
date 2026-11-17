# MoneyMart — open TODOs

## Infrastructure
- [ ] **Move moneymart.app to Cloudflare** (owner decision, 2026-11-17).
  Add the `moneymart.app` zone to the Cloudflare account (aa68bdd0…), switch the
  nameservers at IONOS, recreate the DNS records that point `moneymart.app` and
  `www.moneymart.app` at Railway (moneymart-production.up.railway.app), and keep
  Railway's custom-domain certificates valid through the switch. Not required for
  live video: Cloudflare Stream uses its own WHIP/WHEP hostnames.

- [ ] **Migrate Railway config before 2026-12-01.** `railway.toml` (Config as Code)
  stops working on that date; run `railway config migrate` to move to
  `.railway/railway.ts` and redeploy.

## Live commerce (see docs/live-commerce-spec.md)
- [ ] iOS: go-live host screen and live viewer for Amazon IVS (kit 1.48.1 in
  /Volumes/MAC5/Development/Vendor) and Cloudflare (WebView WHIP/WHEP).
- [ ] Translate new category names and seller/show screens into the app's 7 other languages.
