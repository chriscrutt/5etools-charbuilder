# 5etools — Local Hosting & Performance Notes

A personal, offline, fast-hosted copy of 5etools. All content and formatting are the
stock 5etools data — only the **serving and caching layer** is tuned here. Nothing in
`data/` is modified.

## TL;DR — start the site

```powershell
# from c:\Users\Chris\Code\5etools-src
npm run serve:dev            # stock dev server, http://localhost:5050/index.html
```

For the tuned "fast" server (compression + long cache headers), see
[Fast serving](#fast-serving) below.

## Why the live site felt slow (and why local is faster)

5etools is a 100% client-side static app: every page downloads JSON in the browser and
renders it. Heavy pages fan out into **hundreds of requests** (the Bestiary pulls a
separate JSON per source — ~237 requests / ~14 MB). On the live site that's network
latency + rate-limiting. Served from your SSD, the network cost disappears.

What remains, even locally, are three fixable costs:

1. **Request fan-out** — hundreds of small fetches per heavy page.
2. **No compression** — the stock dev server ships raw JSON (wire bytes ≈ raw bytes).
3. **No caching** — `serve:dev` runs with `-c-1`, so every visit re-fetches everything.

The optimizations below target all three, in increasing order of impact for *repeat*
use.

## Images (offline art / maps / tokens)

Images live in a separate repo and were cloned into `img/`:

```powershell
git clone --depth 1 --single-branch --branch main `
  https://github.com/5etools-mirror-3/5etools-img.git img
```

`img/` maps 1:1 onto the paths the site requests (`img/book/PHB/1.webp`, etc.), so once
present they load straight from disk. You can delete `img/.git` afterward to reclaim
several GB of git metadata you don't need:

```powershell
Remove-Item -Recurse -Force img\.git
```

## Fast serving (recommended)

```powershell
npm run serve:fast      # http-server on :5050 with 1-year cache headers (+ compression if present)
```

The only meaningful difference from `serve:dev` is **cache headers**: `serve:dev` runs
`-c-1` (re-download everything every visit), whereas `serve:fast` lets the browser cache
files, so repeat visits transfer **0 bytes**. See [measured results](#measured-results).

> If you edit data files, the 1-year cache can serve stale copies — hard-refresh with
> **Ctrl+Shift+R** to bypass it.

### Optional: compression (only if serving to other devices)

```powershell
npm run local:precompress          # writes .br/.gz next to text files (~21MB brotli)
npm run local:precompress:clean    # remove them
```

`serve:fast`'s `-b`/`-g` flags serve a sibling `.br`/`.gz` when the browser supports it,
shrinking JSON ~85%. **This does nothing for speed on localhost** (the bytes never cross
a network) — it only helps if you serve this copy to your phone/tablet/other PCs over
Wi-Fi. Skip it for single-machine use.

## Offline cache (service worker)

The service worker makes repeat visits cache-first (instant) and enables true offline
use. It is **not** committed; build it locally:

```powershell
npm run build:sw:prod
```

On the first visit afterward it precaches the core site (JS/CSS/most data/search) into
the browser's Cache Storage; later visits serve from cache. Adventures and images are
cached on first access. To update content later, rebuild and hard-refresh
(Ctrl+Shift+R). To remove it: Settings → Preload Data → "Reset Preloaded Data".

> Note: do NOT use Settings → "Preload All (5GB+)". That bulk-caches everything
> (including all images) into the browser and is the thing that stalls. You don't need
> it — the disk is already your cache.

## Benchmark harness

`../5etools-bench/bench.mjs` drives headless Edge over CDP and reports real page-load
timings (DOMContentLoaded, content-rendered, network-idle, request count, wire vs raw
bytes). Run:

```powershell
node ../5etools-bench/bench.mjs http://localhost:5050 cold 3 "label"   # first-visit
node ../5etools-bench/bench.mjs http://localhost:5050 warm 3 "label"   # repeat-visit
```

## Measured results

Headless MS Edge, median of 3 runs, this machine. The metric is **time until the list
of entries is rendered** — what you actually wait for. Every config renders the *full*
data set (bestiary 2268 rows, items 1822, spells 550); nothing is trimmed.

**First visit (cold cache) — 4 pages, time to rendered:**

| Config                         | index | spells | items | bestiary | total    | wire    |
| ------------------------------ | ----- | ------ | ----- | -------- | -------- | ------- |
| `serve:dev` (`-c-1`, baseline) | 603   | 1075   | 2588  | 2513     | 6779 ms  | 29.2 MB |
| `serve:fast` (cache headers)   | 577   | 1068   | 2343  | 2491     | 6479 ms  | 29.2 MB |
| `serve:fast` + brotli          | 644   | 1202   | 2435  | 2564     | 6845 ms  | 4.9 MB  |

**Repeat visit (warm cache) — 4 pages:**

| Config                         | total    | wire    |
| ------------------------------ | -------- | ------- |
| `serve:dev` (`-c-1`)           | 5215 ms  | 29.2 MB |
| `serve:fast` (cache headers)   | 4998 ms  | 0 MB    |
| service worker (cache-first)   | ~5000 ms | 0 MB    |

**Where the time actually goes (CPU profile, bestiary):** 66,972 DOM nodes built,
`TaskDuration ≈ 2000 ms`. Cross-referencing cold vs warm, network/disk is only ~15% of a
cold heavy page and ~0% on a repeat visit.

### Conclusions

1. **Hosting locally was the win.** It removed the live site's real bottlenecks: network
   latency, rate-limiting, and third-party ad/analytics/consent scripts (the
   `<!--5ETOOLS_ANALYTICS-->`/`ADCODE` slots are empty locally).
2. **The remaining ~2s on heavy pages is in-browser DOM construction** (tens of thousands
   of nodes), inherent to 5etools rendering the full list. *No* serving-layer change moves
   it — proven identical across caching, compression, and the service worker.
3. **Cache headers (`serve:fast`) are the one free win** — repeat visits transfer 0 bytes.
   Recommended default.
4. **Compression**: 83% smaller transfer, **0 local speed gain** (loopback). LAN-serving only.
5. **Service worker**: same speed as cache headers; only adds offline use *without* the
   server running. Opt-in (`npm run build:sw:prod`); it caches in the browser, the opposite
   of a disk-served setup.
