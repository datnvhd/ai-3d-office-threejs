"""mathvid: the toolbox the office's math video agent uses to make short vertical explainer videos (MP4).

  mathvid build script.json scene.py --out ten-video.mp4 [--draft] [--music nhac.mp3] [--no-subs] [--scene Video]
                                                  everything below in one go: narration, render, mux, frames
  mathvid check                                   what is installed (Manim, ffmpeg, voices, LaTeX)
  mathvid music --mood romantic --seconds 30 --out nhac.wav   original backing track (romantic, dreamy, happy, upbeat)
  mathvid tts script.json                         narration: .mathvid/voice.wav, timings.json, subs.ass (cached per segment)
  mathvid render scene.py Video [--draft]         render the Manim scene (1080x1920, 60 fps; --draft 540x960, 15 fps)
  mathvid mux --out final.mp4 [--draft] [--music m.mp3] [--no-subs]   picture + voice + music + burned-in captions
  mathvid frames final.mp4 [--n 8]                contact sheet of N frames (one PNG) to look at the result
  mathvid probe file.mp4                          duration, size, fps, audio

Work files go to .mathvid/ next to the script; only the MP4, the frames PNG, script.json and scene.py are results.

script.json: {"voice": "nu" | "nam" | "none", "rate": "+20%", "speed": 1.0, "music": "romantic" | "nhac.mp3" (optional),
              "segments": [{"id": "hook", "text": "...", "pause": 0.25, "duration": 3 (voice none only)}, ...]}
"""
import argparse, asyncio, json, os, re, shutil, subprocess, sys, wave
from pathlib import Path

HERE = Path(__file__).resolve().parent
W, H, FPS = 1080, 1920, 60   # 60 fps: smooth motion on phones (TikTok, Shorts and Reels all take it)
VOICES = {"nu": "vi-VN-HoaiMyNeural", "nam": "vi-VN-NamMinhNeural"}


def work(folder):
    w = Path(folder).resolve() / ".mathvid"
    w.mkdir(parents=True, exist_ok=True)
    return w


def ffmpeg():
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


def run(cmd, cwd=None, quiet=True):
    r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if r.returncode != 0:
        sys.stderr.write((r.stderr or r.stdout)[-3000:] + "\n")
        sys.exit(f"Lỗi khi chạy: {Path(cmd[0]).name} (mã {r.returncode})")
    return r


def media_info(path):
    r = subprocess.run([ffmpeg(), "-hide_banner", "-i", str(path)], capture_output=True, text=True, encoding="utf-8", errors="replace")
    t = r.stderr
    d = re.search(r"Duration: (\d+):(\d+):([\d.]+)", t)
    v = re.search(r"Video: .*?, (\d{2,5})x(\d{2,5})[ ,].*?([\d.]+) fps", t)
    return {
        "duration": round(int(d[1]) * 3600 + int(d[2]) * 60 + float(d[3]), 3) if d else None,
        "width": int(v[1]) if v else None, "height": int(v[2]) if v else None, "fps": float(v[3]) if v else None,
        "audio": "Audio:" in t,
    }


def wav_seconds(path):
    with wave.open(str(path)) as w:
        return w.getnframes() / w.getframerate()


# ---------------- tts ----------------
async def _stream(text, voice, rate, boundary):
    import edge_tts
    words, audio = [], bytearray()
    async for ch in edge_tts.Communicate(text, voice, rate=rate, boundary=boundary).stream():
        if ch["type"] == "audio":
            audio += ch["data"]
        elif ch["type"] in ("WordBoundary", "SentenceBoundary"):
            s = ch["offset"] / 1e7
            words.append({"w": ch["text"], "start": round(s, 3), "end": round(s + ch["duration"] / 1e7, 3)})
    return bytes(audio), words


def _spread(sentences):
    """Word times from sentence times, in proportion to each word's length (when only sentences are known)."""
    out = []
    for s in sentences:
        ws = s["w"].split()
        total = sum(len(w) + 1 for w in ws) or 1
        t, span = s["start"], s["end"] - s["start"]
        for w in ws:
            d = span * (len(w) + 1) / total
            out.append({"w": w, "start": round(t, 3), "end": round(t + d, 3)}); t += d
    return out


async def _speak(text, voice, rate, out_mp3):
    """Narration for one segment, with the time of every word. The online voice service now and then sends nothing:
    retry with growing pauses, and after a few failures ask for sentence timings and spread them over the words."""
    cache = Path(out_mp3).with_suffix(".json")
    key = {"text": text, "voice": voice, "rate": rate}
    try:
        c = json.loads(cache.read_text(encoding="utf-8"))
        if c.get("key") == key and Path(out_mp3).exists():
            return c["words"]
    except Exception:
        pass
    err = None
    for attempt in range(7):
        boundary = "WordBoundary" if attempt < 4 else "SentenceBoundary"
        try:
            audio, marks = await _stream(text, voice, rate, boundary)
            if audio:
                words = marks if boundary == "WordBoundary" else _spread(marks)
                Path(out_mp3).write_bytes(audio)
                cache.write_text(json.dumps({"key": key, "words": words}, ensure_ascii=False), encoding="utf-8")
                return words
        except Exception as e:
            err = e
        await asyncio.sleep(2 * (attempt + 1))
    sys.exit(f"Không tạo được giọng đọc (cần Internet, dịch vụ giọng đọc Microsoft): {err}")


def ass_time(t):
    t = max(0.0, t)
    return f"{int(t // 3600)}:{int(t % 3600 // 60):02d}:{t % 60:05.2f}"


def write_ass(segments, path, font):
    """Trend-style captions: 2-4 words at a time, big bold white with a thick outline, the spoken word in yellow."""
    head = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {W}
PlayResY: {H}
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,{font},78,&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,7,3,2,70,70,430,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    lines = []
    for seg in segments:
        ws = seg["words"]
        if not ws:
            continue
        chunks, cur = [], []
        for w in ws:
            cur.append(w)
            if len(cur) >= 4 or re.search(r"[,.!?;:…]$", w["w"]):
                chunks.append(cur); cur = []
        if cur:
            chunks.append(cur)
        for ci, ch in enumerate(chunks):
            end_chunk = chunks[ci + 1][0]["start"] if ci + 1 < len(chunks) else ch[-1]["end"] + 0.25
            for i, w in enumerate(ch):
                st = w["start"]
                en = ch[i + 1]["start"] if i + 1 < len(ch) else end_chunk
                txt = " ".join(
                    ("{\\c&H3BD4FF&\\fscx112\\fscy112}" + x["w"].upper() + "{\\r}") if j == i else x["w"].upper()
                    for j, x in enumerate(ch))
                lines.append(f"Dialogue: 0,{ass_time(st)},{ass_time(en)},Cap,,0,0,0,,{txt}")
    Path(path).write_text(head + "\n".join(lines) + "\n", encoding="utf-8")


def get_speed(spec, override=None):
    v = override or (spec.get("speed") if isinstance(spec, dict) else None) or 1.0
    return max(0.5, min(2.0, float(v)))


def cmd_tts(a):
    spec = json.loads(Path(a.script).read_text(encoding="utf-8"))
    speed = get_speed(spec, getattr(a, "speed", None))
    segs = spec["segments"] if isinstance(spec, dict) else spec
    voice = VOICES.get(spec.get("voice", "nu"), spec.get("voice")) if isinstance(spec, dict) else VOICES["nu"]
    # short-video pace: a brisk voice, almost no silence between sentences or at the start
    rate = spec.get("rate", "+20%") if isinstance(spec, dict) else "+20%"
    gap = float(spec.get("gap", 0.1)) if isinstance(spec, dict) else 0.1
    lead = float(spec.get("lead", 0.12)) if isinstance(spec, dict) else 0.12
    out = work(Path(a.script).parent); (out / "voice").mkdir(parents=True, exist_ok=True)
    ff = ffmpeg(); parts = []; t = 0.0; timeline = []
    silence = out / "voice" / "_lead.wav"
    lead /= speed
    run([ff, "-y", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono", "-t", f"{lead:.3f}", str(silence)])
    parts.append(silence); t = lead
    silent = str(voice).lower() in ("none", "khong", "không", "")
    for i, s in enumerate(segs):
        sid = str(s.get("id") or f"s{i + 1}"); text = str(s.get("text", "")).strip()
        mp3 = out / "voice" / f"{i + 1:02d}_{sid}.mp3"; wav = mp3.with_suffix(".wav")
        pause = float(s.get("pause", gap))
        if silent:
            # music-only video: the segment is the time its picture/text stays on screen
            dur = float(s.get("duration") or max(2.0, 0.08 * len(text) + 1.2))
            pause /= speed
            run([ff, "-y", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono", "-t", f"{dur / speed + pause:.3f}", str(wav)])
            words = []
        else:
            words = asyncio.run(_speak(text, s.get("voice") and VOICES.get(s["voice"], s["voice"]) or voice, s.get("rate", rate), mp3))
            pause /= speed
            tempo = f"atempo={speed:.4f}," if speed != 1.0 else ""
            run([ff, "-y", "-i", str(mp3), "-af", f"{tempo}apad=pad_dur={pause:.3f}", "-ar", "48000", "-ac", "1", str(wav)])
            words = [{**w, "start": round(w["start"] / speed, 3), "end": round(w["end"] / speed, 3)} for w in words]
        d = wav_seconds(wav)
        timeline.append({"id": sid, "text": text, "start": round(t, 3), "end": round(t + d - pause, 3), "slot_end": round(t + d, 3),
                         "words": [{**w, "start": round(w["start"] + t, 3), "end": round(w["end"] + t, 3)} for w in words]})
        parts.append(wav); t += d
        print(f"  {sid:>12}: {timeline[-1]['start']:6.2f}s → {timeline[-1]['end']:6.2f}s  {text[:60]}")
    lst = out / "voice" / "_list.txt"
    lst.write_text("".join(f"file '{p.name}'\n" for p in parts), encoding="utf-8")
    run([ff, "-y", "-f", "concat", "-safe", "0", "-i", lst.name, "-c", "copy", str((out / "voice.wav").resolve())], cwd=out / "voice")
    total = round(t, 3)
    (out / "timings.json").write_text(json.dumps({"total": total, "voice": voice, "speed": speed, "segments": timeline}, ensure_ascii=False, indent=1), encoding="utf-8")
    write_ass(timeline, out / "subs.ass", font_name())
    print(f"{'Khung thời gian (không lời)' if silent else 'Giọng đọc'} {total:.2f}s{f' (tốc độ ×{speed:g})' if speed != 1.0 else ''} · mốc thời gian từng đoạn: .mathvid/timings.json"
          + ("" if silent else " · phụ đề: .mathvid/subs.ass"))


def font_name():
    return {"win32": "Arial", "darwin": "Helvetica Neue"}.get(sys.platform, "DejaVu Sans")


# ---------------- music ----------------
MOODS = {  # chords as MIDI notes; bpm; brightness of the plucked arpeggio
    "romantic": dict(bpm=72, prog=[[60, 64, 67], [55, 59, 62], [57, 60, 64], [53, 57, 60]], bright=0.35),
    "dreamy": dict(bpm=62, prog=[[57, 60, 64], [53, 57, 60], [60, 64, 67], [55, 59, 62]], bright=0.2),
    "happy": dict(bpm=112, prog=[[55, 59, 62], [60, 64, 67], [62, 66, 69], [55, 59, 62]], bright=0.6),
    "upbeat": dict(bpm=100, prog=[[57, 60, 64], [53, 57, 60], [60, 64, 67], [55, 59, 62]], bright=0.5),
}
MOOD_ALIAS = {"lang-man": "romantic", "lãng mạn": "romantic", "to-tinh": "romantic", "mo-mang": "dreamy", "galaxy": "dreamy",
              "vui": "happy", "sinh-nhat": "happy", "birthday": "happy", "soi-dong": "upbeat", "hoc": "upbeat"}


def synth_music(mood, seconds, out):
    """A short original backing track (no copyright): soft pad, bass, and a plucked arpeggio with a little echo."""
    import numpy as np
    m = MOODS.get(MOOD_ALIAS.get(mood, mood), MOODS["romantic"])
    sr = 44100; total = int((seconds + 0.5) * sr)
    L = np.zeros(total); R = np.zeros(total)
    beat = 60 / m["bpm"]; bar = 4 * beat

    def tone(midi, dur, amp, decay, bright, attack=0.006):
        n = int(dur * sr); t = np.arange(n) / sr; f = 440 * 2 ** ((midi - 69) / 12)
        w = np.sin(2 * np.pi * f * t) + bright * 0.5 * np.sin(4 * np.pi * f * t) + bright * 0.2 * np.sin(6 * np.pi * f * t)
        env = np.exp(-t * decay) * np.minimum(1, t / attack) * np.minimum(1, (n - np.arange(n)) / (0.05 * sr))
        return amp * w * env

    def put(start, sig, pan=0.0):
        s = int(start * sr); e = min(total, s + len(sig))
        if s < total:
            L[s:e] += sig[:e - s] * (1 - pan) ; R[s:e] += sig[:e - s] * (1 + pan)

    t, i = 0.0, 0
    while t < seconds:
        ch = m["prog"][i % len(m["prog"])]
        for n in ch:  # pad: the chord held through the bar, slow swell
            put(t, tone(n - 12, bar + 0.4, 0.05, 0.25, 0.1, attack=0.5), pan=0.15 * (n % 3 - 1))
        put(t, tone(ch[0] - 24, bar, 0.16, 0.9, 0.3))            # bass
        put(t + 2 * beat, tone(ch[0] - 24, bar / 2, 0.1, 1.2, 0.3))
        pattern = [0, 1, 2, 1, 0, 2, 1, 2]
        for k in range(8):  # arpeggio in eighths, alternating sides
            note = ch[pattern[k]] + 12 + (12 if k == 6 else 0)
            put(t + k * beat / 2, tone(note, beat * 1.6, 0.11, 3.2, m["bright"]), pan=0.35 if k % 2 else -0.35)
        t += bar; i += 1
    for buf in (L, R):  # two soft echoes
        for d, g in ((0.27, 0.28), (0.41, 0.16)):
            k = int(d * sr); buf[k:] += buf[:-k] * g
    st = np.stack([L, R], axis=1)[: int(seconds * sr)]
    st /= max(1e-9, np.abs(st).max()) / 0.7
    n = len(st); fade_in, fade_out = int(0.6 * sr), int(min(3.0, seconds / 4) * sr)
    st[:fade_in] *= np.linspace(0, 1, fade_in)[:, None]; st[n - fade_out:] *= np.linspace(1, 0, fade_out)[:, None]
    with wave.open(str(out), "wb") as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(sr); w.writeframes((st * 32767).astype("<i2").tobytes())


def cmd_music(a):
    out = Path(a.out).resolve(); synth_music(a.mood, a.seconds, out)
    print(f"Nhạc nền ({a.mood}, {a.seconds:.1f}s, tự sáng tác, không bản quyền): {out}")


# ---------------- render ----------------
def cmd_render(a):
    scene = Path(a.scene).resolve(); out = work(scene.parent)
    w, h, fps = (540, 960, 15) if a.draft else (W, H, FPS)
    try:
        speed = float(json.loads((out / "timings.json").read_text(encoding="utf-8")).get("speed") or 1.0)
    except Exception:
        speed = 1.0
    media = out / "media"
    env = {**os.environ, "PYTHONPATH": str(HERE) + os.pathsep + os.environ.get("PYTHONPATH", ""), "PYTHONIOENCODING": "utf-8", "PYTHONDONTWRITEBYTECODE": "1",
           "MATHVID_TIMINGS": str(out / "timings.json"), "MATHVID_SPEED": str(speed)}
    cmd = [sys.executable, "-m", "manim", "render", str(scene), a.name, "-r", f"{w},{h}", "--fps", str(fps),
           "--media_dir", str(media), "--disable_caching", "--progress_bar", "none", "-o", a.name]
    r = subprocess.run(cmd, cwd=scene.parent, env=env, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if r.returncode != 0:
        sys.stderr.write((r.stderr or r.stdout)[-4000:] + "\n"); sys.exit("Manim báo lỗi khi dựng cảnh (xem lỗi Python ở trên).")
    found = sorted(media.glob(f"videos/**/{a.name}.mp4"), key=lambda p: p.stat().st_mtime)
    if not found:
        sys.exit("Không thấy file video Manim vừa dựng.")
    dest = out / ("draft_noaudio.mp4" if a.draft else "video_noaudio.mp4")
    shutil.copyfile(found[-1], dest)
    print(f"Đã dựng hình: .mathvid/{dest.name} · {json.dumps(media_info(dest))}")


# ---------------- mux ----------------
def cmd_mux(a):
    out = Path(a.out).resolve(); wd = work(out.parent)
    ff = ffmpeg()
    v = Path(a.video).resolve() if a.video else wd / ("draft_noaudio.mp4" if a.draft else "video_noaudio.mp4")
    voice = Path(a.voice).resolve() if a.voice else wd / "voice.wav"
    subs = None if a.no_subs else (Path(a.subs).resolve() if a.subs else wd / "subs.ass")
    for f in (v, voice):
        if not f.exists():
            sys.exit(f"Thiếu {f.name}: chạy mathvid tts / mathvid render trước.")
    vd, ad = media_info(v)["duration"] or 0, media_info(voice)["duration"] or 0
    total = max(vd, ad + 0.3)
    fps = round(media_info(v)["fps"] or FPS)
    fps = FPS if fps < 24 else fps   # a 15 fps draft is shown at full rate (frames repeated)
    inputs = ["-i", str(v), "-i", str(voice)]
    spoken = "Dialogue:" in (subs.read_text(encoding="utf-8") if subs and subs.exists() else "")
    if a.music and not spoken:
        inputs += ["-stream_loop", "-1", "-i", str(Path(a.music).resolve())]
        afilter = "[2:a]aformat=channel_layouts=stereo,loudnorm=I=-14:TP=-1.5:LRA=11[a]"
    elif a.music:
        inputs += ["-stream_loop", "-1", "-i", str(Path(a.music).resolve())]
        afilter = ("[2:a]volume=0.22,aformat=channel_layouts=stereo[m];[1:a]aformat=channel_layouts=stereo,asplit=2[v1][v2];"
                   "[m][v1]sidechaincompress=threshold=0.02:ratio=10:attack=15:release=350[md];"
                   "[v2][md]amix=inputs=2:duration=longest:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11[a]")
    else:
        afilter = "[1:a]aformat=channel_layouts=stereo,loudnorm=I=-14:TP=-1.5:LRA=11[a]"
    vf = f"[0:v]tpad=stop_mode=clone:stop_duration={max(0.0, total - vd) + 0.1:.2f},fps={fps},scale={W}:{H}:flags=lanczos,format=yuv420p"
    cwd = None
    if subs and subs.exists() and "Dialogue:" in subs.read_text(encoding="utf-8"):
        cwd = subs.parent
        vf += f",ass={subs.name}"   # run from the subtitle's folder: no path escaping on Windows
    vf += "[v]"
    cmd = [ff, "-y", *inputs, "-filter_complex", vf + ";" + afilter, "-map", "[v]", "-map", "[a]", "-t", f"{total:.2f}",
           "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-profile:v", "high", "-pix_fmt", "yuv420p",
           "-r", str(fps), "-fps_mode", "cfr", "-g", str(fps), "-keyint_min", str(fps), "-sc_threshold", "0",
           "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", str(out)]
    run(cmd, cwd=cwd)
    print(f"Video hoàn chỉnh: {out.name} · {json.dumps(media_info(out))}")


# ---------------- frames / probe / check ----------------
def cmd_frames(a):
    v = Path(a.video).resolve(); d = media_info(v)["duration"] or 1; n = max(1, a.n)
    out = Path(a.out).resolve() if a.out else v.with_name(v.stem + "_frames.png")
    cols = 4 if n > 4 else n; rows = -(-n // cols)
    run([ffmpeg(), "-y", "-i", str(v), "-vf", f"fps={n / d:.5f},scale=270:-2,tile={cols}x{rows}:padding=6:color=white", "-frames:v", "1", str(out)])
    print(f"Ảnh {n} khung hình (mỗi {d / n:.1f}s, xem bằng công cụ đọc ảnh để tự kiểm tra): {out}")


def cmd_probe(a):
    print(json.dumps(media_info(a.file), ensure_ascii=False))


def cmd_check(a):
    info = {"python": sys.version.split()[0], "ffmpeg": None, "manim": None, "edge_tts": None, "latex": bool(shutil.which("latex"))}
    try: info["ffmpeg"] = ffmpeg()
    except Exception as e: info["ffmpeg_error"] = str(e)
    try:
        import manim; info["manim"] = manim.__version__
    except Exception as e: info["manim_error"] = str(e)
    try:
        import edge_tts; info["edge_tts"] = edge_tts.__version__
    except Exception as e: info["edge_tts_error"] = str(e)
    print(json.dumps(info, ensure_ascii=False))


def cmd_build(a):
    """Narration (cached), render, mux and a contact sheet, stopping at the first failing step."""
    folder = Path(a.script).resolve().parent
    print("1/4 Giọng đọc + phụ đề…"); cmd_tts(argparse.Namespace(script=a.script, speed=a.speed))
    print("2/4 Dựng hình Manim…"); cmd_render(argparse.Namespace(scene=a.scene_file, name=a.scene, draft=a.draft))
    out = Path(a.out) if Path(a.out).is_absolute() else folder / a.out
    spec = json.loads(Path(a.script).read_text(encoding="utf-8"))
    music = a.music or spec.get("music")
    if music and not Path(music).exists() and not (folder / music).exists():
        total = json.loads((work(folder) / "timings.json").read_text(encoding="utf-8"))["total"] + 0.4
        gen = work(folder) / "music.wav"; synth_music(str(music), total, gen)
        print(f"   nhạc nền tự sáng tác: {music}"); music = str(gen)
    elif music and not Path(music).exists():
        music = str(folder / music)
    print("3/4 Ghép tiếng, nhạc, phụ đề…")
    cmd_mux(argparse.Namespace(out=str(out), video=None, voice=None, subs=None, no_subs=a.no_subs, music=music, draft=a.draft))
    print("4/4 Ảnh khung hình…"); cmd_frames(argparse.Namespace(video=str(out), n=a.n, out=None))


def main():
    sys.stdout.reconfigure(encoding="utf-8"); sys.stderr.reconfigure(encoding="utf-8")
    p = argparse.ArgumentParser(prog="mathvid", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sp = p.add_subparsers(dest="cmd", required=True)
    s = sp.add_parser("check"); s.set_defaults(f=cmd_check)
    s = sp.add_parser("build"); s.add_argument("script"); s.add_argument("scene_file"); s.add_argument("--scene", default="Video")
    s.add_argument("--out", required=True); s.add_argument("--draft", action="store_true"); s.add_argument("--music"); s.add_argument("--no-subs", action="store_true")
    s.add_argument("--n", type=int, default=12); s.add_argument("--speed", type=float, help="tốc độ cả video, ví dụ 1.25 (ghi đè \"speed\" trong script.json; giọng không méo, hình không mất khung)"); s.set_defaults(f=cmd_build)
    s = sp.add_parser("tts"); s.add_argument("script"); s.add_argument("--speed", type=float); s.set_defaults(f=cmd_tts)
    s = sp.add_parser("music"); s.add_argument("--mood", default="romantic"); s.add_argument("--seconds", type=float, default=30); s.add_argument("--out", required=True); s.set_defaults(f=cmd_music)
    s = sp.add_parser("render"); s.add_argument("scene"); s.add_argument("name"); s.add_argument("--draft", action="store_true"); s.set_defaults(f=cmd_render)
    s = sp.add_parser("mux"); s.add_argument("--out", required=True); s.add_argument("--video"); s.add_argument("--voice"); s.add_argument("--subs")
    s.add_argument("--no-subs", action="store_true"); s.add_argument("--draft", action="store_true"); s.add_argument("--music"); s.set_defaults(f=cmd_mux)
    s = sp.add_parser("frames"); s.add_argument("video"); s.add_argument("--n", type=int, default=8); s.add_argument("--out"); s.set_defaults(f=cmd_frames)
    s = sp.add_parser("probe"); s.add_argument("file"); s.set_defaults(f=cmd_probe)
    a = p.parse_args(); a.f(a)


if __name__ == "__main__":
    main()
