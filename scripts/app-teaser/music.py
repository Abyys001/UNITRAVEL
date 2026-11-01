#!/usr/bin/env python3
"""Original background track for the app teaser. Everything is synthesised here, so there is nothing to license.

Usage: python3 music.py out.wav

96 BPM, so a bar is 2.5 s. Cues line up with scene.html: logo 2.5 s, phone lands 7.5 s, screen changes at 13.125,
16.25 and 19.375 s, Coming Soon at 22.5 s (bar 9), fade-out from 27.5 s.
"""
import sys
import wave

import numpy as np
from scipy.signal import butter, fftconvolve, lfilter, sosfilt

SR = 44100
DUR = 30.0
BEAT = 60 / 96
BAR = BEAT * 4
N = int(SR * DUR)
HIT = 22.5
rng = np.random.default_rng(1405)


def hz(midi):
    return 440.0 * 2 ** ((midi - 69) / 12)


def lowpass(x, cutoff):
    return sosfilt(butter(2, cutoff, fs=SR, output="sos"), x)


def highpass(x, cutoff):
    return sosfilt(butter(2, cutoff, btype="high", fs=SR, output="sos"), x)


def place(track, sig, start):
    i = int(start * SR)
    end = min(N, i + len(sig))
    if 0 <= i < N:
        track[i:end] += sig[: end - i]


def santur(midi, length=2.2, gain=1.0):
    """Struck-string tone (Karplus-Strong), two slightly detuned strings per note like a santur course."""
    out = np.zeros(int(length * SR))
    for detune in (-0.05, 0.05):
        delay = int(round(SR / hz(midi + detune)))
        burst = np.zeros(len(out))
        burst[:delay] = lowpass(rng.uniform(-1, 1, delay), 7000)
        a = np.zeros(delay + 2)
        a[0], a[delay], a[delay + 1] = 1, -0.4975, -0.4975
        out += lfilter([1], a, burst)
    return out * gain * 0.5


def pad(chord, length):
    t = np.arange(int(length * SR)) / SR
    x = np.zeros_like(t)
    for m in chord:
        for detune in (-0.08, 0.0, 0.08):
            f = hz(m + detune)
            phase = rng.uniform(0, 6.28)
            x += np.sin(2 * np.pi * f * t + phase) + 0.3 * np.sin(4 * np.pi * f * t + phase) + 0.12 * np.sin(6 * np.pi * f * t + phase)
    fade = np.minimum(1, np.minimum(t / 0.8, (length - t) / 1.0).clip(0))
    return x * fade / (len(chord) * 3)


def bass(midi, length):
    t = np.arange(int(length * SR)) / SR
    x = np.tanh(1.6 * np.sin(2 * np.pi * hz(midi) * t))
    return x * np.minimum(1, np.minimum(t / 0.02, (length - t) / 0.25).clip(0))


def dum():
    """Low frame-drum stroke."""
    t = np.arange(int(0.5 * SR)) / SR
    tone = np.sin(2 * np.pi * (62 * t + 7 * (1 - np.exp(-t * 28)))) * np.exp(-t * 9)
    skin = lowpass(rng.standard_normal(len(t)), 900) * np.exp(-t * 40) * 0.5
    return tone + skin


def tak():
    """Rim stroke."""
    t = np.arange(int(0.16 * SR)) / SR
    return highpass(rng.standard_normal(len(t)), 1800) * np.exp(-t * 48) * 0.55 + np.sin(2 * np.pi * 520 * t) * np.exp(-t * 60) * 0.5


def bell(midi, length=4.0):
    t = np.arange(int(length * SR)) / SR
    f = hz(midi)
    return np.sin(2 * np.pi * f * t + 2.2 * np.exp(-t * 2.5) * np.sin(2 * np.pi * f * 3.5 * t)) * np.exp(-t * 1.4)


def whoosh(length, peak=0.6, top=5000):
    """Filtered noise swell for a camera move; it rises to its peak position, then falls away."""
    n = int(length * SR)
    noise = rng.standard_normal(n)
    out = np.zeros(n)
    for k in range(0, n, 1024):
        p = k / n
        shape = p / peak if p < peak else (1 - p) / (1 - peak)
        out[k:k + 1024] = lowpass(noise[k:k + 1024], 250 + top * shape ** 2)
    pos = np.arange(n) / n
    return out * np.where(pos < peak, pos / peak, (1 - pos) / (1 - peak)) ** 2


def boom(length=3.0, depth=1.2):
    t = np.arange(int(length * SR)) / SR
    return np.sin(2 * np.pi * (36 * t + 6 * (1 - np.exp(-t * 16)))) * np.exp(-t * 2.2) * depth


pads, strings, low, drums, fx, bells = (np.zeros(N) for _ in range(6))

# A minor with a flat second in the melody for a Persian colour; the end opens out to C major.
CHORDS = [
    [57, 60, 64, 69], [57, 60, 64, 71], [53, 57, 60, 67], [55, 59, 62, 67],
    [57, 60, 64, 71], [53, 57, 60, 69], [50, 57, 60, 65], [52, 56, 59, 64],
    [53, 57, 60, 67], [57, 60, 64, 71], [53, 57, 60, 69], [48, 55, 60, 64],
]
for i, chord in enumerate(CHORDS):
    start = i * BAR
    place(pads, pad(chord, BAR * 1.2), start)
    if i >= 2:
        place(low, bass(chord[0] - 12, BAR * 0.96), start)

# The santur line, as (bar, beat, midi note, strength). The phrase repeats an octave up as the track grows.
PHRASE = [(0, 0, 69, 1), (0, 1, 70, .7), (0, 1.5, 69, .6), (0, 2, 67, .8), (0, 3, 65, .7), (1, 0, 64, 1), (1, 1, 65, .6), (1, 2, 67, .8), (1, 3.5, 64, .5)]
ANSWER = [(0, 0, 65, 1), (0, 1, 67, .7), (0, 2, 69, .9), (0, 3, 72, .8), (1, 0, 71, 1), (1, 1, 69, .7), (1, 2, 68, .9), (1, 3, 64, .7)]
for bar, shift, phrase in [(2, 0, PHRASE), (4, 0, PHRASE), (6, 0, ANSWER), (9, 12, PHRASE), (10, 12, ANSWER[:4])]:
    for b, beat, m, g in phrase:
        when = (bar + b) * BAR + beat * BEAT
        place(strings, santur(m + shift, gain=g), when)
        if bar >= 4 and g >= 0.9:  # santur tremolo on the strong notes once the track has built
            place(strings, santur(m + shift, gain=g * 0.45), when + BEAT / 4)

# Rolling arpeggio under the tour of screens.
for i in range(4, 9):
    chord = CHORDS[i]
    tones = [chord[0] + 12, chord[2] + 12, chord[1] + 24, chord[2] + 12]
    for step in range(16):
        place(strings, santur(tones[step % 4], length=1.1, gain=0.26 + 0.05 * (step % 4 == 0)), i * BAR + step * BEAT / 4)

# Frame drum: dum on one, syncopated taks, a fill approaching the reveal.
for i in range(4, 9):
    for beat, kind, g in [(0, dum, 1), (1.5, tak, .55), (2, dum, .7), (3, tak, .7), (3.5, tak, .4)]:
        place(drums, kind() * g, i * BAR + beat * BEAT)
for k in range(8):
    place(drums, tak() * (0.3 + 0.08 * k), HIT - BAR / 2 + k * BEAT / 4)
for i in range(10, 11):
    for beat, kind, g in [(0, dum, .8), (2, dum, .55), (3, tak, .4)]:
        place(drums, kind() * g, i * BAR + beat * BEAT)

# Cues.
place(bells, bell(76) * 0.55, 2.5)
place(bells, bell(83) * 0.3, 2.5 + BEAT)
place(fx, boom(2.0, 0.55), 2.5)
place(fx, whoosh(3.0, 0.82), 4.9)      # phone flies in
place(fx, boom(2.2, 0.8), 7.5)
place(bells, bell(81) * 0.42, 7.5)
for cue in (13.125, 16.25, 19.375):    # phone crosses the frame
    place(fx, whoosh(0.9, 0.5, 3500) * 0.55, cue - 0.4)
    place(bells, bell(88) * 0.14, cue + 0.2)
place(fx, whoosh(2.5, 0.97, 8000) * 1.1, HIT - 2.5)  # riser
place(fx, boom(3.6, 1.5), HIT)
for offset, m, gain in [(0, 81, .55), (BEAT, 84, .45), (BEAT * 2, 88, .4), (BEAT * 3, 93, .34), (BEAT * 4, 91, .3), (BEAT * 6, 88, .26)]:
    place(bells, bell(m) * gain, HIT + offset)


def stereo(x, ms=11):
    d = int(ms / 1000 * SR)
    return x, np.concatenate([np.zeros(d), x[:-d]])


def reverb(x, ir):
    return fftconvolve(x, ir)[:N] / np.sqrt((ir ** 2).sum())


t_ir = np.arange(int(2.8 * SR)) / SR
ir_l = lowpass(rng.standard_normal(len(t_ir)) * np.exp(-t_ir * 2.3), 5000)
ir_r = lowpass(rng.standard_normal(len(t_ir)) * np.exp(-t_ir * 2.3), 5000)

# The pad and bass duck on each drum stroke so the rhythm has room.
duck = 1 - 0.35 * np.minimum(1, lowpass(np.abs(drums), 18) * 3)
pads *= duck
low *= duck

str_l, str_r = stereo(strings, 9)
bell_l, bell_r = stereo(bells, 14)
pad_r = np.roll(pads, 340)

dry_l = 0.42 * pads + 0.5 * str_l + 0.34 * low + 0.42 * drums + 0.5 * fx + 0.42 * bell_l
dry_r = 0.42 * pad_r + 0.5 * str_r + 0.34 * low + 0.42 * drums + 0.5 * fx + 0.42 * bell_r

# A held breath just before the reveal: everything but the riser drops out, then the hit lands.
gate = np.ones(N)
g0, g1 = int((HIT - 0.28) * SR), int(HIT * SR)
gate[g0:g1] = 0.12
gate = lowpass(gate, 90)
dry_l *= gate
dry_r *= gate

wet_l = reverb(0.55 * pads + 0.75 * str_l + 0.2 * drums + 0.4 * fx + 0.9 * bell_l, ir_l)
wet_r = reverb(0.55 * pad_r + 0.75 * str_r + 0.2 * drums + 0.4 * fx + 0.9 * bell_r, ir_r)
mix = np.stack([dry_l + 0.3 * wet_l, dry_r + 0.3 * wet_r], axis=1)
mix = np.stack([highpass(mix[:, 0], 30), highpass(mix[:, 1], 30)], axis=1)

# Fades, then a soft limit so nothing clips.
pos = np.arange(N)
env = np.minimum(1, np.minimum(pos / (1.0 * SR), (N - pos) / (2.5 * SR)))
mix = mix * env[:, None]
mix = np.tanh(mix / np.abs(mix).max() * 1.35) * 0.89

with wave.open(sys.argv[1], "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((mix * 32767).astype(np.int16).tobytes())
