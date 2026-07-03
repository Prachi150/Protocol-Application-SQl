# Make an installed LSG protocol app subpath-aware — LLM fix prompt

> **For app teams**: drop this file at the root of your protocol-app repo and tell your LLM assistant
> "*Apply the fix described in this file to this codebase.*"
>
> The LLM has everything it needs in here: the problem statement, exact diagnosis steps,
> file-by-file fixes with full code, and verification commands.

---

## Role and goal

You are a React/Vite expert helping fix an "LSG protocol app" so that the same compiled bundle
works under THREE different URL contexts:

| Context | URL the user sees |
|---|---|
| Local dev | `http://localhost:8080/` (or wherever your dev server runs, at root) |
| Device-local | `http://<device-ip>:81/apps/<your-app>/` |
| Through the bastion proxy | `https://<bastion>/<16-hex-linkId>/apps/<your-app>/` |

The same compiled `dist/` must work in ALL of them. You **cannot** hardcode the URL prefix at
build time. The fix is three small rules.

This prompt's job: make you, the LLM, apply those three rules to the user's codebase with no
hand-holding from the user. After you finish, the user runs `npm run build` and the app works
under every context above.

---

## Context — why this matters

LSG devices run their own nginx that serves the React build. Admins can also reach the same device
through an SSL bastion at a URL like `https://<bastion>/<linkId>/...`. Each device gets a stable
random 16-hex `linkId` for this. So a request that hits the device at `http://device:81/apps/foo/bar`
is the same request that, through the bastion, looks like `https://bastion/abcdef0123456789/apps/foo/bar`.

If the app's `index.html` ships with `<script src="/apps/foo/assets/index.js">`, the browser resolves
that absolute path against the page's host. Through the bastion that resolves to
`https://bastion/apps/foo/assets/index.js` — **without** the `/abcdef0123456789/` prefix. The bastion
only proxies `/abcdef0123456789/*` to the device, so the request 404s before it ever reaches the
device. Page renders blank. **Same fate for every `fetch('/api/foo')`, every `<Link to="...">`,
every WebSocket URL.**

The bastion has a Referer-based 307 fallback that recovers stray HTTP requests, but it cannot save
WebSockets, and it adds latency to every request. The contract below is the durable fix.

---

## Step 1 — Diagnose

Run these commands at the **root of the protocol app repo**. Capture the output for your own analysis;
do not show it to the user unless they ask.

```bash
# Find the bundler config
ls vite.config.* webpack.config.* rspack.config.* 2>/dev/null

# Look for the build's `base` setting (the thing baking the prefix in)
grep -En 'base\s*:' vite.config.* 2>/dev/null
grep -En 'publicPath\s*:' webpack.config.* rspack.config.* 2>/dev/null

# Check the React Router setup
grep -rEn 'BrowserRouter|HashRouter|MemoryRouter|basename' src/ 2>/dev/null | head -20

# Find every fetch/axios/EventSource/WebSocket call that starts with '/'
grep -rEn '(fetch|axios\.[a-z]+|new EventSource|new WebSocket)\s*\(\s*[`"' "'" ']/' src/ 2>/dev/null | head -40

# Find every hardcoded /api/ or /apps/<anything>/ reference
grep -rEn '[`"' "'" ']/(api|apps/)' src/ 2>/dev/null | head -40
```

You are looking for these red flags:

| Red flag | Where it shows up |
|---|---|
| `base: '/apps/<your-app>/'` (anything not `'./'`) | `vite.config.ts` |
| `<BrowserRouter basename={import.meta.env.BASE_URL}>` | usually `src/App.tsx` or `src/main.tsx` |
| `<BrowserRouter>` with NO `basename` | same place |
| `fetch('/api/...')` / `axios.get('/api/...')` | scattered in components or `src/lib/api.ts` |
| `new WebSocket('wss://host/...')` | live-data hooks |

If you find ANY of these, the app is broken under the bastion and needs the fix below.

---

## Step 2 — Apply the three rules

### Rule 1 — Vite/bundler emits RELATIVE asset paths

Edit `vite.config.ts` (or `vite.config.js`). Find the `defineConfig({...})` call and set:

```ts
export default defineConfig({
  base: './',     // ← emit "./assets/...", NOT "/assets/..." or "/apps/foo/assets/..."
  // ...everything else stays
});
```

For webpack/rspack the equivalent is `output.publicPath: 'auto'`.

**Why**: with `base: './'`, the built `index.html` references look like
`<script src="./assets/index-Xyz.js">`. The browser resolves `./assets/index-Xyz.js`
against the **current page URL**, so it works at any depth automatically — no
prefix-baking, no leakage.

**DO NOT** set `base: '/apps/<your-app>/'` or use `process.env.VITE_BASE_PATH`. That bakes a
specific mount path into the build, which is exactly the bug we're fixing.

### Rule 2 — Compute the Router basename at RUNTIME

Create a new file `src/lib/path.ts` (or `src/lib/path.js` if the project is JS). It should export
a single constant:

```ts
// The app's mount point, derived from the actual URL the page loaded at.
// Works in all four contexts:
//   Local dev (no /apps/<x>/)        → ""
//   Device-local (/apps/<x>/)        → "/apps/<x>"
//   Bastion (/<linkId>/apps/<x>/)    → "/<linkId>/apps/<x>"
//   Future nested proxy              → matches whatever /apps/<x>/ prefix exists
export const APP_BASE: string = (() => {
  if (typeof window === 'undefined') return '';        // SSR safety
  const m = window.location.pathname.match(/^.*\/apps\/[^/]+\//);
  if (m) return m[0].replace(/\/$/, '');               // strip trailing slash
  return '';                                           // dev-mode at root
})();
```

Wire it into the Router. Find where `<BrowserRouter>` is instantiated (usually `src/App.tsx`)
and change:

```tsx
import { BrowserRouter } from 'react-router-dom';
import { APP_BASE } from './lib/path';

<BrowserRouter basename={APP_BASE}>
  {/* routes */}
</BrowserRouter>
```

**DO NOT** use `import.meta.env.BASE_URL` for the basename. That's the **compile-time** Vite
base (which we set to `./` per Rule 1 — meaningless as a Router basename). The basename MUST
come from `window.location.pathname` at runtime.

Now `<Route path="/settings">` matches whether the URL is `/settings`, `/apps/foo/settings`, OR
`/<linkId>/apps/foo/settings`. Same for `<Link to="/settings">` — it'll navigate to the right
URL in each context.

### Rule 3 — Prefix every API call with `APP_BASE`

Find the central API client. Common patterns:

- `src/lib/api.ts` or `src/services/api.ts` — exports a wrapped `fetch` or an axios instance
- Or `fetch()` calls scattered across components (anti-pattern; consolidate)

Update the central client to prepend `APP_BASE` to every request:

```ts
// src/lib/api.ts
import { APP_BASE } from './path';

const API_PREFIX = APP_BASE + '/api';   // device nginx routes /apps/<x>/api/ to the app's backend

export const api = (path: string, opts?: RequestInit) =>
  fetch(API_PREFIX + path, opts);
//  api('/topics')  →  fetches  /<full-prefix>/apps/<x>/api/topics
```

For axios:

```ts
import axios from 'axios';
import { APP_BASE } from './path';

export const apiClient = axios.create({
  baseURL: APP_BASE + '/api',
});
```

**Then grep the codebase** for any remaining direct `fetch('/api/...')` / `axios.get('/api/...')`
calls and convert them to go through the central client. Leading-slash absolute paths bypass
`APP_BASE` and break under the bastion.

### Rule 4 (when applicable) — WebSockets and EventSource

`WebSocket` does NOT follow HTTP redirects, so the bastion's Referer-rescue catch-all CANNOT save
it. Build WS URLs from `APP_BASE` directly:

```ts
import { APP_BASE } from '../lib/path';

const ws = new WebSocket(
  (location.protocol === 'https:' ? 'wss://' : 'ws://') +
  location.host +
  APP_BASE + '/api/stream'
);

// EventSource works the same; it DOES follow redirects but it's free to do this right anyway.
const es = new EventSource(APP_BASE + '/api/logs/stream');
```

If the app has no WebSocket / EventSource usage, skip this rule.

---

## Things you (the LLM) must NOT do

| Anti-pattern | Why it's wrong |
|---|---|
| `base: '/apps/<your-app>/'` in vite.config | Bakes ONE specific mount path; breaks through any other proxy. |
| `<BrowserRouter basename={import.meta.env.BASE_URL}>` | Uses the compile-time base; same problem. |
| `fetch('/api/foo')` | Absolute path; ignores the runtime prefix. |
| `<a href="/foo">` for internal app links | Use `<Link to="/foo">` so the Router's basename applies. |
| Hardcoded `/apps/<your-app>/` strings anywhere in source | Hard to rename, hard to relocate. Use `APP_BASE` instead. |
| Adding `<base href="/...">` to `index.html` | Doesn't fix absolute paths and complicates Router behavior. |
| Modifying `package.json` build scripts to pass `--base=...` | Defeats the whole point of runtime detection. |

If you catch yourself writing any of the above, stop and revert.

---

## Verification

After you finish editing, ask the user to run:

```bash
# 1. Build cleanly
npm run build   # or yarn build / pnpm build

# 2. Sanity-check the built HTML — every asset reference must be relative
grep -E 'src="/|href="/' dist/index.html
# Expected output: NONE (or only fonts.googleapis.com / external CDNs).
# If you see `src="/apps/..."` or `src="/assets/..."`, Rule 1 didn't take effect.

# 3. Local dev still works at root
npm run dev
# Open http://localhost:<port>/ — app should render normally.
```

Then, on the device, after the user installs the rebuilt zip:

```bash
# 4. Direct device access
curl -i http://<device>:81/apps/<your-app>/      # serves index.html

# 5. Through the bastion
# Open the Open-LSG-App URL from the admin UI:
#   https://<bastion>/<linkId>/apps/<your-app>/
# The page must render. No broken images, no 404 in DevTools → Network.
# Navigate around — every API call in DevTools should start with /<linkId>/apps/<your-app>/api/...
```

If step 5 renders blank or refresh breaks, one of the rules was missed.
The single most common miss is Rule 3 — some `fetch('/api/...')` hidden in a corner.
Grep again with: `grep -rEn '[\x27\"]/api' src/`

---

## Quick checklist for your final commit message

- [ ] `vite.config.ts` (or equivalent): `base: './'`
- [ ] New file: `src/lib/path.ts` exporting `APP_BASE`
- [ ] `<BrowserRouter basename={APP_BASE}>` (NOT `import.meta.env.BASE_URL`)
- [ ] Central API client uses `APP_BASE + '/api'` as baseURL/prefix
- [ ] All direct `fetch('/api/...')` calls migrated to the central client
- [ ] All `new WebSocket(...)` / `new EventSource(...)` build URLs from `APP_BASE`
- [ ] `grep -E 'src="/|href="/' dist/index.html` returns no `/apps/`-prefixed or `/assets/`-prefixed hits
- [ ] App renders identically at: local dev, on-device direct URL, bastion proxy URL

About **15 lines of net changes** across 2–3 files. Anything significantly larger means you
over-engineered something — go back and prefer the surgical change.