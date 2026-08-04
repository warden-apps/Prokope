# ΠΡΟΚΟΠΗ · Prokopē

*The Stoic word for the progress a person is making toward becoming good. Not arrival. Progress.*

A nightly ledger: Anki's numbers and Seneca's three questions, kept in one place. One HTML file, no build step, no dependencies, no network, no account. Everything you write stays in your browser.

---

## Put it online

```
your-repo/
├── index.html          the whole app
├── manifest.json       makes it installable
├── sw.js               opens with no signal
├── apple-touch-icon.png
├── icon-512.png
└── README.md
```

Push all of it, then **Settings → Pages → Deploy from a branch → `main` / `root`**.

It will be served at `https://<user>.github.io/<repo>/`. Open that on your phone in Safari, then **Share → Add to Home Screen**. It launches full screen with no browser chrome.

> Changed the icon? Delete the Home Screen shortcut and add it again — iOS caches icons hard.

You may see `.nojekyll` recommended for GitHub Pages. This repo does not need it: there are no Liquid tags (`{{` or `{%`), no files beginning with an underscore, and no YAML front matter, so Jekyll copies every file through untouched. iOS Files will not let you create a name beginning with a dot anyway — if you ever do want it, make it on github.com with **Add file → Create new file** and type `.nojekyll` as the name.

## Or no server at all

`index.html` works from the Files app or any folder — the icon is embedded in the file as base64, so a lone copy still has one. The service worker simply does nothing on `file://`.

## The nightly loop

1. **Set for today** — one thing that must be done before you sleep.
2. **The count** — open Anki → deck → *Stats*, copy the **Today** block, paste it in. The fields fill themselves.
3. **The examination** — the three questions Sextius asked himself every night, and Seneca after him.
4. **The four virtues** — wisdom, justice, courage, temperance. Untouched is a fair answer.
5. **The journal** — whatever the day left in you.

Three marks under the date — *Counted · Examined · Written* — light as you go, so you can see what is left without scrolling.

## Reading the Anki paste

Anki wraps every number in invisible Unicode bidi marks (U+2068/U+2069); those are stripped before parsing. The breakdown line is read carefully:

```
Studied 66 cards in 12.65 minutes today
Again count: 11 (16.67%)
Learn: 3, Review: 55, Relearn: 8, Filtered: 0
Correct answers on mature cards: 23/26 (88.46%)
```

- **Reviewed → 55**, from the *Review* line. The 66 total counts learning and relearning steps too.
- **New → 3**, from *Learn*.
- **Correct → 83.33%**, derived as 100 − the again rate. Derived values carry a dashed border; tap one to see the reasoning.
- **Mature → 88.46%** — the number that says a word is actually yours.

*Studied* and *Relearn* appear as dim chips: context, not queue progress.

## Your data

It lives in `localStorage` under `keikoroku.v1` and is never sent anywhere.

Browsers do clear storage — an installed Home Screen app is far safer than a plain tab. **Download backup** on the Record page writes a real `.json`; **Restore from file** reads it back. The app counts the days since your last backup and says something if it has been a while. Every destructive action has one level of undo.

## How it is built

No frameworks, no dependencies, ES5 throughout for old Safari.

**The background** is a cloner grid running a scale wave. Every clone is a scale — high shoulders, a belly drawn to a soft point, a spine down the middle. Rows lap and offset by half a cell, so it reads as a hide rather than a grid. A travelling sine sets each clone's size, crossed with a slower one so the ripple never repeats, and the effector's heading turns slowly. Six tones run from deep gold at the head of the field to steel at its foot, with a seam that drifts sideways — two poles, never a spectrum. The ramp is deliberately dark: nothing in it exceeds 148 in luminance, and no step is desaturated, because a pale or neutral tone at the top of the field lands directly behind the masthead and washes the type. Only the crest lights: alpha is cubed, so most of the hide stays dark and a band catches as the wave passes. Seal a night and a ring of light runs out through the scales.

It is cheap on purpose: about 325 `drawImage` calls a frame from six pre-rendered sprites, no path building in the loop. Earlier attempts stuttered because they stroked thousands of paths per frame, or spread the work over twenty composited DOM layers.

**The calendar** is a dark tray, and the month begins unlit. Each day takes the light it earns — six steps from near-black to burning gold — so a good month glows and a thin one doesn't. Every step is contrast-checked against its own day number; the lowest passes at 4.7:1.

**Everything else that moves** is CSS on the compositor: every keyframe animates `transform` and `opacity` alone, so nothing touches layout. `prefers-reduced-motion` stops all of it.

### Three traps worth knowing

`globalCompositeOperation = "lighter"` on a *transparent* canvas accumulates alpha as well as colour. Sixteen overlapping shapes saturate to an opaque `rgb(255,255,190)` wash that replaces the page. Fill an opaque ground first.

CSS blocks are load-bearing. Deleting a rule while its element stays in the markup silently turns a `position:fixed` layer into a giant block in the document flow. Check for orphaned classes after any refactor.

Measure the whole stack, not the layer you just changed. The background washed out for several rounds because three soft radial `.aura` divs sat behind the wave — where all three overlapped they lifted the page ground to luminance 70, so the scales appeared *darker* than what was behind them. Every measurement missed it because every measurement modelled the wave alone. They are gone. So is the 300px `.lampglow` oval behind the title (+49 levels) and the silhouette at the right edge (+24). The background is now the wave, a vignette and a little grain, and nothing else — audit the *whole* set of full-page layers before trusting any number.

---

ζῆν κατὰ φύσιν
