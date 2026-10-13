# Riwaq Admin foundation (unreleased)

رِواق أدمن تطبيق ويندوز منفصل عن تطبيق المشاهد. يتيح حفظ مسودة إشعار ومعاينتها ونشرها يدويًا، واختيار مصدر رِواق وبناء تعديلاتك وفحصها وتشغيلها ببيانات مستقلة. هذا أساس أولي، ولا يتضمن محرر كود كاملًا أو تحديثًا تلقائيًا لتطبيق الأدمن نفسه.

## Start and develop

From a trusted Riwaq checkout on Windows x64, with Node.js 24 and `npm ci` already run:

```powershell
npm run admin
```

- Choose the checkout through **اختيار المصدر**. The version, branch, commit and local-change status are shown. Git must be installed; this step reads status only.
- Edit in your usual editor using **فتح مجلد التطوير**. **بناء التعديلات** runs the checkout's Vite build; **فحص المصدر** runs its Node tests. Tasks run fixed argument lists without a shell and do not inherit tokens, signing keys or Node options from the admin process. This explicitly trusts code in the selected checkout.
- **تشغيل النسخة التجريبية** starts that checkout's own Electron runtime and `electron/main.mjs`, using `%APPDATA%/Riwaq Admin/sandboxes/<checkout-hash>` for its data. Build first. Download MPV with `node scripts/fetch-mpv.mjs` in the checkout before testing video. Close the test app's own window to end it normally, allowing MPV and torrent shutdown. Closing Admin leaves an already running preview open.
- Builds modify `dist/` in the selected checkout; sandboxing separates app data, not the source tree or build output. Use a separate checkout when you also run source builds for daily viewing.
- **التحديثات قيد المراجعة** opens GitHub PRs. The releases panel reads published versions and opens their pages. Selecting a branch, fetching changes, resolving conflicts, downloading installers and installing releases remain explicit developer actions; Admin does not overwrite a checkout or install unreviewed code.

Build a separate portable administrator app:

```powershell
npm run package:admin
```

Output: `release-admin/Riwaq-Admin-0.43.1-win-x64.exe`. It has its own app ID, name and data directory. The normal viewer package does not include `admin/`; the admin package includes no MPV or viewer credentials. A portable admin app can compose/publish notices without Node, but development tasks require Node 24, Git and an installed source checkout. It does not use the viewer's updater or release-signing key. A manual **Build Riwaq Admin** Actions workflow builds the executable as an artifact, without publishing a viewer release.

## Connect and publish

1. Merge this foundation so `announcements/feed.json` exists on `main`. It starts empty: no announcement is broadcast by this PR or its tests.
2. In GitHub, create a fine-grained token owned by **ABADIOSA**, selecting only **ABADIOSA/riwaq** and repository **Contents: read and write**. Use an expiry. GitHub's [Contents API documentation](https://docs.github.com/en/rest/repos/contents#create-or-update-file-contents) describes the permission and conditional blob SHA needed for the write.
3. Enter the token in Admin and connect. Main verifies the owner's identity, push access, and that this repository remains public with `main` as the default branch. The token is removed from the input immediately and is held only in main-process memory until disconnect or app exit. It is never persisted, returned in state, sent to the viewer, or included in a draft. Renderer reload keeps the current main-process connection.
4. Write Arabic title/body, optionally complete English title/body, audience (everyone/desktop/web), expiry (1–90 days), optional inclusive version range, and an optional link within this repository on `https://github.com/ABADIOSA/riwaq/`.
5. **حفظ المسودة** writes only the text fields to Admin's local `draft.json`. **معاينة قبل النشر** validates the notice and reads the current feed. Editing invalidates the preview. A preview expires after ten minutes.
6. **نشر الإشعار** shows a native confirmation naming the notice and its delivery scope. Confirming commits exactly the previewed feed to `announcements/feed.json` on `main`, using the reviewed SHA. A concurrent change returns a conflict; refresh the preview instead of overwriting it. Branch protection may require an allowed publishing credential/policy; the app does not bypass it. Publication uses GitHub history as the audit trail.

Each publication uses a new opaque ID. Keep private information out of notices: they are public. Existing active notices are retained within 80 total and 64 KiB; expired notices and then the oldest excess notices are removed on the next publication. To withdraw an incorrect notice in this first foundation, remove its ID from the feed through GitHub and commit; connected clients remove it on their next successful refresh, while offline caches retain it until expiry. Dedicated withdrawal/revision controls can build on this feed contract.

## Viewer notifications

The bell in both Riwaq layouts opens an inbox on desktop and web. Notices render as plain text; titles, bodies and links are bounded. Only official repository links can be opened, resolved by notice ID in the bridge. Notices cannot execute JavaScript, install an update, add an addon, or open arbitrary login/download URLs.

- Reads the fixed public raw-GitHub feed on startup and every 15 minutes, with a manual refresh button and a one-minute request throttle. GitHub caching may delay delivery. Requests use no authentication, viewer IDs, libraries or account data.
- Filters scheduled/expired notices, platform and semantic version range. English uses the author's English message if present, otherwise the Arabic message.
- Unread IDs, cached messages and opt-out live on the device, outside profiles, account sync and portable backups. A network/schema error keeps the last valid cache and shows an error. Expired notices are filtered whenever the inbox state is read.
- **قراءة الكل**, per-message read and **استقبال أخبار رِواق** work without a Riwaq account. Disabling reception stops requests and invalidates pending replies; existing cached messages remain readable.
- Delivery requires a version with this inbox and an open app/site. No OS background push, delivery receipts, device registry or analytics are implemented. No notices pop up over MPV or interrupt playback. Discord/Telegram notifications configured by a viewer remain their separate outgoing feature.

## Contract and checks

`core/announcements.mjs` validates schema 1 (`schema`, `items`), a 64 KiB feed, up to 80 unique IDs, 160-character titles, 3,000-character bodies, time bounds, audience and repository-only HTTPS links. Fetches refuse redirects, omit credentials and abort at 12 seconds. Admin's privileged GitHub module stays outside the viewer package; Admin renderer has no Node or network access and only explicit main-frame IPC actions.

```powershell
node --test tests/announcements.test.mjs
npm run build
npm run build:web
# Windows, Playwright available through RIWAQ_PLAYWRIGHT:
node scripts/test-admin.mjs
```

The native smoke uses real Electron and IPC, only mocking GitHub and the native chooser. It checks drafts, owner connection, edited previews, manual confirmation, a simulated write with a SHA lease, session state, real Node/Vite builds, and the viewer inbox in Arabic/English at 980×680. It never publishes a real announcement or uses a real token. See `VERIFICATION.md` for measured results and remaining limits.
