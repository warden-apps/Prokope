# ΠΡΟΚΟΠΗ — Prokopē

*The Stoic word for the progress a person is making toward becoming good. Not arrival. Progress.*

A nightly ledger: Anki's numbers and Seneca's three questions, kept in one place. One HTML file, no build step, no network, no account. Everything you write stays in your browser.

---

## The files

| File | What it is |
|---|---|
| `prokope.html` | The whole app. Open it and it works. |
| `apple-touch-icon.png` | 180×180 — the icon iOS uses on the Home Screen |
| `icon-512.png` | 512×512 — favicon and Android |
| `manifest.json` | Makes it installable as a standalone app |
| `sw.js` | Service worker — lets the hosted version open with no signal |

The icon is also embedded inside `prokope.html` as base64, so a lone saved copy still has one.

## Putting it online

Drop all five files in a GitHub repo, then **Settings → Pages → Deploy from branch → main / root**. It will be served at `https://<user>.github.io/<repo>/prokope.html`.

Open that on your phone in Safari → **Share → Add to Home Screen**. It launches full-screen with no browser chrome.

> If you change the icon later, delete the Home Screen shortcut and add it again — iOS caches icons hard.

## Using it without a server

`prokope.html` works from the Files app or any folder. Keep the two PNGs beside it for the icon; the service worker simply does nothing on `file://`.

## It starts blank

A fresh install carries nothing. No name, no deadline, no data. Set what you are counting toward under **The horizon** on the Record page and every screen counts down to it; leave it empty and the corner stays quiet.

## The nightly loop

1. **Set for today** — one thing that must be done before you sleep.
2. **The count** — open Anki → deck → *Stats*, copy the **Today** block, paste it in. The fields fill themselves.
3. **The examination** — the three questions Sextius asked himself every night and Seneca kept after him.
4. **The four virtues** — wisdom, justice, courage, temperance. Untouched is a fair answer.
5. **The journal** — whatever the day left in you.

## On the Anki paste

Anki wraps every number in invisible Unicode bidi marks (U+2068/U+2069); those are stripped before parsing. The breakdown line is read carefully:

```
Studied 66 cards in 12.65 minutes today
Again count: 11 (16.67%)
Learn: 3, Review: 55, Relearn: 8, Filtered: 0
Correct answers on mature cards: 23/26 (88.46%)
```

- **Reviewed → 55**, from the *Review* line. The 66 total counts learning and relearning steps too.
- **New → 3**, from *Learn*.
- **Correct → 83.33%**, derived as 100 − the again rate. Derived values are marked with a dashed border; tap one to see the reasoning.
- **Mature → 88.46%** — the number that says a word is actually yours.

Studied and Relearn show as dim chips: context, not queue progress.

## Your data

It lives in `localStorage` under `keikoroku.v1` and is never sent anywhere.

Browsers do clear storage. **Download backup** on the Record page writes a real `.json` file; **Restore from file** reads it back. The app counts the days since your last backup and says something if it has been a while. There is one level of undo on every destructive action.

## Notes on how it is built

No frameworks, no dependencies, ES5 throughout for old Safari.

The background is a cloner grid running a scale wave — the MoGraph idea, in a canvas. Every clone is a scale: high shoulders, a belly drawn to a soft point, a spine down the middle. Rows lap and offset by half a cell, so it reads as a hide rather than a grid. A travelling sine sets each clone's size, crossed with a slower one so the ripple never repeats, and the effector's heading turns slowly. Six tones run from pale gold at the head of the field to steel and deep blue at its foot, with a seam that drifts sideways — two poles, never a spectrum.

Only the crest of the swell lights: alpha is cubed, so most of the hide stays dark and a band of scales catches as the wave passes. A scrim over the top of the page keeps type clean — the header band sits around 7–16 in luminance against gold text at 137. When a night is sealed, a ring of light runs out through the scales from the centre.

It is cheap on purpose: about 325 `drawImage` calls a frame from six pre-rendered sprites, no path building in the loop.

The calendar is a dark tray and the month begins unlit. Each day takes the light it earns — six steps from near-black to burning gold — so a good month glows and a thin one doesn't. Every step was contrast-checked against its own day number; the lowest passes at 4.7:1.

Every keyframe animates transform and opacity alone, so nothing touches layout. `prefers-reduced-motion` leaves the lattice standing and stops the wave.

---

ζῆν κατὰ φύσιν
