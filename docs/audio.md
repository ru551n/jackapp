# Audio

Speech is a hybrid, tried in this order at runtime:

1. **Bundled clip** `audio/<key>.mp3` (built with Piper) when the key is in `audio/manifest.json`.
2. **In-app Piper** for new text, loading `voices/<id>.onnx` from the build output.
3. **Device voice** (`speechSynthesis`) as the last fallback.

## How clips are built

`scripts/speech/collect.mjs` walks the content and writes `.speech/phrases.json` (`{key, lang, text}`, keys from `speechKey()` in `src/lib/spoken.ts`). `scripts/speech/synth.py` (run by `uv`, deps inline) synthesizes only missing clips with Piper into `public/audio/<key>.mp3` (mono, 32 kbps, edge silence trimmed), deletes stale clips, writes `manifest.json`, and hardlinks the voice models into `public/voices/`. Voices are listed in `scripts/speech/voices.json` and downloaded into `.voices/` when missing. All generated output is git-ignored.

```
npm run speech            # collect + synth (incremental)
JACKAPP_SKIP_SPEECH=1 npm run build   # build without speech (e.g. no uv/Python)
```

`npm run build` runs `speech` first. Unit tests and `npm run check` need no Python.

## Changing a voice

Edit the id in `scripts/speech/voices.json` and run `npm run speech`. The chosen id per language is recorded in `public/audio/.voices.json`; a change regenerates that language's clips.

## Size and timing

About 2,640 clips (sv 2,326, en 309), roughly 40 MB of MP3. Full run on 32 cores: about 90 seconds; incremental with nothing changed: about 3 seconds (mostly `uv` and collect). Voice models add about 170 MB to `dist/voices`.

## Credits and licences

The app credits these on the adult "Om appen" page; the full list ships as `THIRD_PARTY_NOTICES.txt` (from `public/`) with licence texts in `licenses/`, and `synth.py` writes `voices/NOTICE` next to the models.

- **Alma** (`sv_SE-alma-medium`): "Alma" by Daniel Nylander, CC BY 4.0, trained on the NST Swedish speech corpus distributed by Språkbanken at the National Library of Norway. Model card: https://huggingface.co/yeagersthlm/piper-voice-sv-alma
- **Cori** (`en_GB-cori-high`): public domain (LibriVox recordings read by Bryce Beattie).
- **espeak-ng** (GPL-3.0-or-later) **ships to browsers**: it is compiled into `assets/piper_phonemize-*.wasm` and its `.data` file (from `@diffusionstudio/piper-wasm`), which in-app Piper uses as its phonemizer. Source: https://github.com/rhasspy/espeak-ng at commit `0f65aa301e0d6bae5e172cc74197d32a6182200f` (pinned by piper-phonemize), built per the piper-wasm README.
- **piper-phonemize**, **@diffusionstudio/piper-wasm**, **onnxruntime-web**: MIT, ship to browsers.
- **Atkinson Hyperlegible** font: SIL OFL 1.1, ships to browsers.
- **Piper** engine (piper1-gpl): GPL-3.0, used only as a build tool for the clips; clips are its output, not Piper code.

### GPL and redistribution

Serving the web app copies the espeak-ng wasm to every browser that loads it, which counts as conveying it under GPL-3.0. Whoever serves or redistributes a build must therefore keep `THIRD_PARTY_NOTICES.txt` and `licenses/GPL-3.0.txt` in the served output and keep the corresponding espeak-ng source available (the links above; mirror them if you distribute builds widely). JackApp's own MIT licence is GPL-compatible, so the combination may be conveyed under GPL-3.0 terms. If you modify or rebuild the phonemizer wasm, publish your changed source and update the notices. If that is unacceptable, drop in-app Piper (bundled clips and the device voice still work).
