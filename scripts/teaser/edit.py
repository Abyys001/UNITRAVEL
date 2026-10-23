#!/usr/bin/env python3
"""Edits the teaser from the recorded clips (record.mjs), the voiceover (media/teaser/vo) and the Canva cards.

Each scene becomes a 1920x1080/30 fps segment whose length follows its narration line: the screen recording is
sped up (at most 1.6x) or held on its last frame to fit, a lower-third label is burned in, and the line sits
between short pauses. Segments are joined with crossfades over a quiet synthesised pad, then loudness-normalised.
Usage: scripts/teaser/edit.py [--reuse]  ->  media/teaser/uni-travel-teaser.mp4
"""
import json
import sys
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
T = ROOT / "media/teaser"
CLIPS, VO, SEG = T / "clips", T / "vo", T / "segments"
BRAND = ROOT / "assets/brand"
FONTS = Path.home() / "Projects/01_engineering-kit/fonts"
SERIF = FONTS / "fraunces/Fraunces72pt-SemiBold.ttf"
SANS = FONTS / "inter/Inter-Medium.ttf"
SEG.mkdir(parents=True, exist_ok=True)

W, H, FPS = 1920, 1080, 30
LEAD, TAIL, XF = 0.45, 0.55, 0.5
MAX_SPEED = 1.6

LABELS = {
    "02-home": "Customer website", "03-search": "Live search", "04-itinerary": "Itinerary detail",
    "05-request": "Request — no booking, no payment", "06-persian": "فارسی — right to left", "07-mobile": "Mobile app",
    "08-queue": "Staff console · Admin Panel", "09-quote": "Quote builder", "10-accept": "Customer accepts the quote",
    "11-compliance": "Compliance & sanctions screening", "12-dev": "Developer Panel", "13-cargo": "Cargo",
}
STILLS = {"01-title": BRAND / "title-card.png", "14-end": BRAND / "end-card.png"}


def run(args):
    subprocess.run(args, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)


def probe(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)], check=True, capture_output=True, text=True)
    return float(out.stdout.strip())


def esc(text):
    return text.replace("\\", "\\\\").replace(":", "\\:").replace("'", "’").replace("%", "\\%")


def label_filter(text):
    # A quiet lower-third: copper rule + label on a translucent navy plate, faded in and out.
    fnt = SANS if not any("؀" <= c <= "ۿ" for c in text) else FONTS / "vazirmatn" / "Vazirmatn-Medium.ttf"
    if not Path(fnt).exists():
        fnt = SANS
    a = "if(lt(t,0.6),0,if(lt(t,1.1),(t-0.6)/0.5,1))"
    return (
        f"drawbox=x=64:y=ih-148:w=12:h=56:color=0xC98D5B@1:t=fill:enable='gte(t,0.6)',"
        f"drawtext=fontfile='{fnt}':text='{esc(text)}':x=96:y=h-136:fontsize=34:fontcolor=0xF5F1EA:alpha='{a}'"
        f":box=1:boxcolor=0x0F2238@0.82:boxborderw=18"
    )


def audio_for(sid, dur):
    vo = VO / f"{sid}.wav"
    return ["-i", str(vo)], f"[1:a]aresample=48000,adelay={int(LEAD * 1000)}|{int(LEAD * 1000)},apad,atrim=0:{dur:.3f},aformat=channel_layouts=stereo[a]"


def still_segment(sid, out):
    dur = LEAD + probe(VO / f"{sid}.wav") + TAIL + 0.6
    frames = int(dur * FPS)
    ain, af = audio_for(sid, dur)
    vf = (f"[0:v]scale=3840:-1,zoompan=z='1+0.06*on/{frames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d={frames}:s={W}x{H}:fps={FPS},"
          f"fade=t=in:st=0:d=0.6,format=yuv420p[v]")
    run(["ffmpeg", "-y", "-loop", "1", "-i", str(STILLS[sid]), *ain, "-filter_complex", f"{vf};{af}", "-map", "[v]", "-map", "[a]",
         "-t", f"{dur:.3f}", "-r", str(FPS), "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-c:a", "pcm_s16le", str(out)])
    return dur


def clip_segment(sid, out, offsets):
    dur = LEAD + probe(VO / f"{sid}.wav") + TAIL
    src = CLIPS / f"{sid}.webm"
    start = offsets.get(sid, 0)
    avail = probe(src) - start
    speed = min(max(avail / dur, 1.0), MAX_SPEED)
    ain, af = audio_for(sid, dur)
    fit = f"trim=start={start:.3f},setpts=(PTS-STARTPTS)/{speed:.4f},fps={FPS},tpad=stop_mode=clone:stop_duration={dur:.3f},trim=0:{dur:.3f}"
    if sid == "07-mobile":
        # The phone recording sits in a device frame on the brand background, with a short caption beside it.
        bg = str(BRAND / "title-card.png")
        vf = (f"[0:v]{fit},scale=-2:960:flags=lanczos,format=rgba,"
              f"geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(gt(abs(X-W/2),W/2-36)*gt(abs(Y-H/2),H/2-36),if(lte(hypot(abs(X-W/2)-(W/2-36),abs(Y-H/2)-(H/2-36)),36),255,0),255)'[ph];"
              f"[2:v]scale={W}:{H},boxblur=60:4,eq=brightness=-0.12:saturation=0.8[bgv];"
              f"[bgv]drawbox=x=1140-14:y=60-14:w=444+28:h=960+28:color=0x0A1626@0.9:t=fill[bgb];"
              f"[bgb][ph]overlay=x=1140:y=60:shortest=1,"
              f"drawtext=fontfile='{SERIF}':text='The same journey,':x=180:y=380:fontsize=72:fontcolor=0xF5F1EA,"
              f"drawtext=fontfile='{SERIF}':text='in your pocket.':x=180:y=470:fontsize=72:fontcolor=0xC98D5B,"
              f"drawtext=fontfile='{SANS}':text='Flutter · iOS · Android · web · offline-ready':x=184:y=590:fontsize=32:fontcolor=0xD6C6B4,"
              f"fade=t=in:st=0:d=0.4,format=yuv420p[v]")
        inputs = ["-i", str(src), *ain, "-loop", "1", "-i", bg]
    else:
        vf = f"[0:v]{fit},scale={W}:{H}:flags=lanczos,{label_filter(LABELS[sid])},format=yuv420p[v]"
        inputs = ["-i", str(src), *ain]
    run(["ffmpeg", "-y", *inputs, "-filter_complex", f"{vf};{af}", "-map", "[v]", "-map", "[a]", "-t", f"{dur:.3f}",
         "-r", str(FPS), "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-c:a", "pcm_s16le", str(out)])
    return dur


def main():
    scenes = [s["id"] for s in json.loads((T / "narration.json").read_text())]
    offsets = json.loads((CLIPS / "offsets.json").read_text())
    reuse = "--reuse" in sys.argv
    segs = []
    for sid in scenes:
        out = SEG / f"{sid}.mkv"
        if reuse and out.exists():
            dur = probe(out)
        else:
            dur = still_segment(sid, out) if sid in STILLS else clip_segment(sid, out, offsets)
        segs.append((out, dur))
        print(f"{sid}: {dur:.2f} s")

    # Crossfades are applied pairwise into a lossless working file: one 14-input graph decodes every segment at
    # once and runs out of memory on a 16 GB machine.
    acc, acc_dur = segs[0]
    for i, (seg, dur) in enumerate(segs[1:], 1):
        out = SEG / f".join-{i % 2}.mkv"
        fc = (f"[0:v][1:v]xfade=transition=fade:duration={XF}:offset={acc_dur - XF:.3f}[v];"
              f"[0:a][1:a]acrossfade=d={XF}:c1=tri:c2=tri[a]")
        run(["ffmpeg", "-y", "-i", str(acc), "-i", str(seg), "-filter_complex", fc, "-map", "[v]", "-map", "[a]",
             "-c:v", "libx264", "-preset", "ultrafast", "-qp", "0", "-c:a", "pcm_s16le", str(out)])
        acc, acc_dur = out, acc_dur + dur - XF
    total = acc_dur
    last_v, last_a = "[0:v]", "[0:a]"

    # A quiet A-major pad that breathes slowly; it sits ~24 dB under the voice and fades at both ends.
    pad = (f"aevalsrc='0.18*sin(2*PI*110*t)*(0.6+0.4*sin(2*PI*0.07*t))+0.12*sin(2*PI*164.81*t)*(0.6+0.4*sin(2*PI*0.05*t+1))"
           f"+0.10*sin(2*PI*220*t)*(0.6+0.4*sin(2*PI*0.09*t+2))+0.07*sin(2*PI*277.18*t)*(0.6+0.4*sin(2*PI*0.06*t+3))':s=48000:d={total:.3f},"
           f"lowpass=f=900,aecho=0.8:0.7:120|260:0.35|0.25,volume=0.09,afade=t=in:d=2.5,afade=t=out:st={total - 3:.3f}:d=3,aformat=channel_layouts=stereo[pad]")
    mix = f"{last_a}[pad]amix=inputs=2:duration=first:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11[aout]"
    fc = ";".join([pad, mix])
    final = T / "uni-travel-teaser.mp4"
    run(["ffmpeg", "-y", "-i", str(acc), "-filter_complex", fc, "-map", "0:v", "-map", "[aout]", "-c:v", "libx264", "-preset", "slow", "-crf", "19",
         "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", str(final)])
    print(f"wrote {final} ({total:.1f} s)")


if __name__ == "__main__":
    main()
