# Visual Asset CDN

Static visual asset CDN for logos and icons served by **Cloudflare Pages** (Direct Upload) and deployed via **GitHub Actions**. No frameworks, no bundlers: purely static assets.

## Directory Structure

```
public/                     # Public root (the only directory deployed to Cloudflare)
  _headers                  # CORS + Cache-Control rules for Cloudflare Pages
  logos/
    borrageiros/            # Brand assets (e.g. light / dark variants)
  index.html                # Generated at deploy time (not committed)
scripts/
  validate-assets.mjs       # Name, extension, and file size validator (runs in CI)
  generate-browse.mjs       # Generates the directory listing pages (runs in CI)
.github/workflows/
  deploy.yml                # CI/CD: validate -> generate listings -> deploy
wrangler.toml               # Project name and output directory configuration
update.bat                  # Local helper script to stage, commit, and push updates
```

## Deployment Flow

1. Push to `main` (affecting `public/**`, `scripts/**`, `wrangler.toml`, or the workflow).
2. **Validate assets** job: Validates file names (kebab-case), extensions, file size limits, and the presence of `_headers`.
3. **Generate directory listings**: `node scripts/generate-browse.mjs` downloads the PrettyIndex bundle, walks `public/`, and writes an `index.html` per directory plus a `404.html` (none of these generated files are committed).
4. **Deploy to Cloudflare Pages** job: Runs `cloudflare/wrangler-action` executing `wrangler pages deploy --project-name=<project> --branch=main`. The folder comes from `pages_build_output_dir` in `wrangler.toml`.
5. Pull Requests trigger validation and listing generation without deploying.

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

## Directory Browser

`https://cdn.borrageiros.com/` and every folder URL with a trailing slash render a browsable index powered by [PrettyIndex](https://github.com/borrageiros/PrettyIndex) (MIT).

- The HTML is generated at deploy time by `scripts/generate-browse.mjs` from the current `public/` tree. Generated `index.html` files and `404.html` are gitignored.
- Each page is a minimal Nginx-style autoindex; `prettyindex.js` parses it and replaces it with the full UI (search, sorting, grid/list views, preview modal).
- Folder links always use a trailing slash (`/logos/borrageiros/dark/`).
- File sizes come from the filesystem; dates come from `git log` (the deploy job checks out with `fetch-depth: 0`). Without history, the file mtime is used.
- Search and sorting apply to the current folder only.
- The UI bundle is **not stored in this repository**. At generation time it is downloaded into `public/_ui/` (gitignored) and uploaded with the deployment; the URL is content-hashed (`prettyindex.<hash>.js|css`) for safe immutable caching.
- The source defaults to `https://cdn.jsdelivr.net/gh/borrageiros/PrettyIndex@latest/dist` and can be overridden with the `PRETTYINDEX_BASE_URL` environment variable. Pin a commit or tag there for reproducible builds; `@latest` follows the newest PrettyIndex commit (subject to jsDelivr caching).

Caching rules:

| Path | Cache-Control |
|---|---|
| `/logos/*` | `public, max-age=31536000, immutable` |
| `/logos/*/` (folder URLs) | `public, max-age=0, must-revalidate` + `X-Robots-Tag: noindex` |
| `/` and `/index.html` | `public, max-age=0, must-revalidate` + `X-Robots-Tag: noindex` |
| `/_ui/*` | `public, max-age=31536000, immutable` |

Listing pages detach the inherited `Cache-Control` in `_headers`; otherwise `/logos/*` would cache them as immutable for a year.

Local preview:

```bash
node scripts/generate-browse.mjs
npx wrangler@4 pages dev public
```

Local generation also downloads the UI into the gitignored `public/_ui/` (internet required). Re-run the generator after adding, renaming, or removing assets so the listings stay in sync.

## Required Setup

### 1) Cloudflare Dashboard

| Action | Location | Details |
|---|---|---|
| **Account ID** | Dashboard → Workers & Pages (right sidebar) or dashboard URL | 32-character hexadecimal string |
| **API Token** | My Profile → API Tokens → Create Token → Custom token | Permissions: `Account` → `Cloudflare Pages` → `Edit`; Account Resources: Include your account |
| **Pages Project** | Workers & Pages → Create → Pages → **Upload assets** | Project name should match `CLOUDFLARE_PAGES_PROJECT` (default: `cdn-borrageiros-com`) |
| **Custom Domain** (optional) | Pages Project → Custom domains | e.g., `cdn.yourdomain.com` (requires Cloudflare DNS zone) |

> [!NOTE]
> Do **not** connect the GitHub repository directly inside the Cloudflare Pages UI. Deployment is handled via GitHub Actions (Direct Upload). Connecting the repository directly to Pages would trigger redundant builds.

### 2) GitHub Repository (Settings → Secrets and variables → Actions)

| Name | Type | Required | Description |
|---|---|---|---|
| `CLOUDFLARE_API_TOKEN` | **Secret** | Yes | API Token with `Cloudflare Pages: Edit` permissions |
| `CLOUDFLARE_ACCOUNT_ID` | **Secret** (or Variable) | Yes | Cloudflare Account ID |
| `CLOUDFLARE_PAGES_PROJECT` | **Variable** | Recommended | Exact Cloudflare Pages project name (defaults to `cdn-borrageiros-com` if unset) |

Using the GitHub CLI:

```bash
gh secret set CLOUDFLARE_API_TOKEN
gh secret set CLOUDFLARE_ACCOUNT_ID
gh variable set CLOUDFLARE_PAGES_PROJECT --body "cdn-borrageiros-com"
```

### 3) Local Testing (Optional)

```bash
npx wrangler@4 login
npx wrangler@4 pages deploy --project-name=cdn-borrageiros-com --branch=main
```

Do not also pass `public` as a positional argument: Wrangler rejects a directory argument combined with `pages_build_output_dir` in `wrangler.toml`.

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
| Exit code 1 right after `Running Wrangler Commands` | Usually a directory argument passed alongside `pages_build_output_dir`, or a missing project. Check the full Wrangler stderr in the job log. |
| `Authentication error` | The API Token lacks `Cloudflare Pages: Edit` permission or the Account ID is incorrect. |
| Changes not reflecting immediately | Assets are cached as `immutable`; deploy under a new filename to bypass cache. |
| Missing CORS headers | `public/_headers` is missing from the deploy root or was rejected. |
| 404 when opening a folder | The generated listing is missing (generator not run) or the URL lacks the trailing slash. |
| `Could not download .../prettyindex.js` during generation | jsDelivr is unreachable or `PRETTYINDEX_BASE_URL` points to an invalid version/tag. |
| Listing pages cached for a year | The `! Cache-Control` detach rules were removed or placed before `/logos/*` in `_headers`. |
