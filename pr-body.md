Rebrands the project **Veyra → Innvil** and adds a product-first README, bumping to **v0.2.0**.

### Included
- Rename across app, config, docs, and migration headers (`InnvilApp`, `*.innvil.app`, page titles / OpenGraph).
- New `README.md` framing Innvil as infrastructure for launching and scaling digital businesses (SMM = first vertical).
- `package.json` `0.1.0 → 0.2.0`.
- `vercel.json` intentionally empty — order-status cron moved to Supabase.

If `origin/main` is behind local `main`, this branch also carries this session's earlier work:
- Multi-gateway payments (Cryptomus / Razorpay / Stripe) on a pluggable adapter architecture + full catalog UI.
- §4 order-status sync engine (auto-progress + proportional auto-refund).
- Terms & Privacy pages; owner balance management (manual credit/debit).

**Note:** payment integrations are untested end-to-end — they need live gateway accounts and a public webhook URL to verify.
