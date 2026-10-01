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

- **Alma** (`sv_SE-alma-medium`): CC BY 4.0, trained on NST (Språkbanken). Model card: https://huggingface.co/yeagersthlm/piper-voice-sv-alma (verify before release).
- **Cori** (`en_GB-cori-high`): public domain (LibriVox recordings).
- **Piper** engine (piper1-gpl): GPL-3.0, used only as a build tool; no Piper code ships in the app clips.
