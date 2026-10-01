# /// script
# requires-python = ">=3.10"
# dependencies = ["piper-tts==1.8.0", "lameenc", "numpy"]
# ///
"""Synthesize public/audio/<key>.mp3 for every phrase in .speech/phrases.json (incremental). See docs/audio.md."""
import json, os, shutil, sys, time
from multiprocessing import Pool
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
VOICES, AUDIO, PUB_VOICES = ROOT / ".voices", ROOT / "public/audio", ROOT / "public/voices"
voices = json.loads((ROOT / "scripts/speech/voices.json").read_text())
phrases = json.loads((ROOT / ".speech/phrases.json").read_text())
_loaded = {}


def voice(lang):
    if lang not in _loaded:
        import onnxruntime
        from piper import PiperVoice
        orig = onnxruntime.SessionOptions

        def one_thread():  # one process per core; ORT's default pool per process oversubscribes badly
            o = orig()
            o.intra_op_num_threads = o.inter_op_num_threads = 1
            return o

        onnxruntime.SessionOptions = one_thread
        _loaded[lang] = PiperVoice.load(VOICES / f"{voices[lang]}.onnx")
    return _loaded[lang]


def trim(pcm, rate):
    import numpy as np
    a = np.frombuffer(pcm, dtype=np.int16)
    loud = np.nonzero(np.abs(a) > 300)[0]
    if not len(loud):
        return pcm
    pad = int(rate * 0.08)
    return a[max(0, loud[0] - pad): loud[-1] + pad].tobytes()


def work(item):
    import lameenc
    v = voice(item["lang"])
    rate = v.config.sample_rate
    pcm = trim(b"".join(c.audio_int16_bytes for c in v.synthesize(item["text"])), rate)
    enc = lameenc.Encoder()
    enc.set_bit_rate(32)
    enc.set_in_sample_rate(rate)
    enc.set_channels(1)
    enc.set_quality(2)
    tmp = AUDIO / f"{item['key']}.mp3.tmp"
    tmp.write_bytes(bytes(enc.encode(pcm) + enc.flush()))
    tmp.replace(AUDIO / f"{item['key']}.mp3")
    return item["key"]


def main():
    t0 = time.time()
    VOICES.mkdir(exist_ok=True)
    AUDIO.mkdir(parents=True, exist_ok=True)
    PUB_VOICES.mkdir(parents=True, exist_ok=True)
    langs = {p["lang"] for p in phrases}
    for lang in langs:
        vid = voices[lang]
        if not (VOICES / f"{vid}.onnx").exists() or not (VOICES / f"{vid}.onnx.json").exists():
            from piper.download_voices import download_voice
            download_voice(vid, VOICES)
        for ext in (".onnx", ".onnx.json"):
            dst = PUB_VOICES / f"{vid}{ext}"
            if not dst.exists():
                try:
                    os.link(VOICES / f"{vid}{ext}", dst)
                except OSError:
                    shutil.copy2(VOICES / f"{vid}{ext}", dst)

    stamp = AUDIO / ".voices.json"
    old = json.loads(stamp.read_text()) if stamp.exists() else {}
    changed = {l for l in langs if old.get(l) != voices[l]}
    for p in phrases:
        if p["lang"] in changed:
            (AUDIO / f"{p['key']}.mp3").unlink(missing_ok=True)

    keys = {p["key"] for p in phrases}
    for f in AUDIO.glob("*.mp3"):
        if f.stem not in keys:
            f.unlink()
    todo = [p for p in phrases if not (AUDIO / f"{p['key']}.mp3").exists()]
    if todo:
        n = os.cpu_count() or 1
        print(f"speech: synthesizing {len(todo)} clips on {n} cores", flush=True)
        with Pool(n) as pool:
            for i, _ in enumerate(pool.imap_unordered(work, todo, chunksize=4), 1):
                if i % 100 == 0 or i == len(todo):
                    print(f"  {i}/{len(todo)}", flush=True)
    stamp.write_text(json.dumps({l: voices[l] for l in langs}))
    (AUDIO / "manifest.json").write_text(json.dumps(sorted(keys)))
    size = sum(f.stat().st_size for f in AUDIO.glob("*.mp3"))
    print(f"speech: {len(keys)} clips, {size / 1e6:.1f} MB, {time.time() - t0:.1f}s")


if __name__ == "__main__":
    main()
