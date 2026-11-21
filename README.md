# Visual Asset CDN

Static visual asset CDN for logos and icons served by **Cloudflare Pages** (Direct Upload) and deployed via **GitHub Actions**. No frameworks, no bundlers: purely static assets.

## Directory Structure

```
public/                     # Public root (the only directory deployed to Cloudflare)
  _headers                  # CORS + Cache-Control rules for Cloudflare Pages
  logos/
    borrageiros/            # Brand assets (e.g. light / dark variants)
scripts/
  validate-assets.mjs       # Name, extension, and file size validator (runs in CI)
.github/workflows/
  deploy.yml                # CI/CD: validate -> deploy to Cloudflare Pages
wrangler.toml               # Project name and output directory configuration
update.bat                  # Local helper script to stage, commit, and push updates
```

## Deployment Flow

1. Push to `main` (affecting `public/**`, `scripts/**`, `wrangler.toml`, or the workflow).
2. **Validate assets** job: Validates file names (kebab-case), extensions, file size limits, and the presence of `_headers`.
3. **Deploy to Cloudflare Pages** job: Runs `cloudflare/wrangler-action` executing `wrangler pages deploy public --branch=main`.
4. Pull Requests trigger only the validation step without deploying.

## Adding New Assets

- **Allowed formats**: `.svg`, `.png`, `.webp`, `.avif`, `.jpg`, `.jpeg`, `.ico`.
- **Naming convention**: **lowercase kebab-case** (e.g., `brand-logo.svg`, `icon-512.png`). No uppercase letters, spaces, or underscores (Cloudflare Pages URLs are case-sensitive).
- **Raster variants**: Use size suffixes (`logo-256.png`, `logo-512.webp`) or density suffixes (`logo-2x.png`).
- **Recommended sizes**: SVG < 50 KB, raster images < 500 KB. The validator warns at 1 MB and rejects files exceeding 5 MB.
- **Self-contained SVGs**: SVGs must not reference external fonts or remote images.
- **Resulting URL format**: `https://<project-name>.pages.dev/logos/borrageiros/dark/logo.svg`.

### Caching and Invalidation

`/logos/*` is served with `Cache-Control: public, max-age=31536000, immutable`.
This means **the content at a given URL should never be overwritten in-place**. If you update an asset, deploy it with a versioned filename (e.g., `logo-v2.svg`) and update your consumer applications accordingly. This ensures immediate cache coherence and avoids stale assets.

## Required Setup

### 1) Cloudflare Dashboard

| Action | Location | Details |
|---|---|---|
| **Account ID** | Dashboard → Workers & Pages (right sidebar) or dashboard URL | 32-character hexadecimal string |
| **API Token** | My Profile → API Tokens → Create Token → Custom token | Permissions: `Account` → `Cloudflare Pages` → `Edit`; Account Resources: Include your account |
| **Pages Project** | Workers & Pages → Create → Pages → **Upload assets** | Project name should match `CLOUDFLARE_PAGES_PROJECT` (default: `cdn`) |
| **Custom Domain** (optional) | Pages Project → Custom domains | e.g., `cdn.yourdomain.com` (requires Cloudflare DNS zone) |

> [!NOTE]
> Do **not** connect the GitHub repository directly inside the Cloudflare Pages UI. Deployment is handled via GitHub Actions (Direct Upload). Connecting the repository directly to Pages would trigger redundant builds.

### 2) GitHub Repository (Settings → Secrets and variables → Actions)

| Name | Type | Required | Description |
|---|---|---|---|
| `CLOUDFLARE_API_TOKEN` | **Secret** | Yes | API Token with `Cloudflare Pages: Edit` permissions |
| `CLOUDFLARE_ACCOUNT_ID` | **Secret** (or Variable) | Yes | Cloudflare Account ID |
| `CLOUDFLARE_PAGES_PROJECT` | **Variable** | Recommended | Exact Cloudflare Pages project name (defaults to `cdn` if unset) |

Using the GitHub CLI:

```bash
gh secret set CLOUDFLARE_API_TOKEN
gh secret set CLOUDFLARE_ACCOUNT_ID
gh variable set CLOUDFLARE_PAGES_PROJECT --body "cdn"
```

### 3) Local Testing (Optional)

```bash
npx wrangler@4 login
npx wrangler@4 pages deploy public --project-name=cdn --branch=main
```

## Verification

After deployment, check your asset headers using `curl`:

```bash
curl -I https://<project-name>.pages.dev/logos/borrageiros/dark/logo.svg
```

Expected response headers:
- `HTTP/2 200`
- `access-control-allow-origin: *`
- `cache-control: public, max-age=31536000, immutable`
- `content-type: image/svg+xml` (or `image/png`)

## Troubleshooting

| Issue | Likely Cause |
|---|---|
| `Project not found` in Actions | The Pages project does not exist yet in Cloudflare or `CLOUDFLARE_PAGES_PROJECT` does not match. |
| `Authentication error` | The API Token lacks `Cloudflare Pages: Edit` permission or the Account ID is incorrect. |
| Changes not reflecting immediately | Assets are cached as `immutable`; deploy under a new filename to bypass cache. |
| Missing CORS headers | `public/_headers` is missing from the deploy root or was rejected. |
| 404 at root `/` | Expected behavior: this CDN serves static assets under subpaths; there is no root index file. |
