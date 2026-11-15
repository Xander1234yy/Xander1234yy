"""
Showreel soundtrack — 100% synthesized with numpy. No samples.
128 BPM, F minor, 8 bars = exactly 15.000 s.
Every hit is placed on the same beat grid the visuals use (see reel.html).
"""
import numpy as np, wave, sys

SR = 48000
BPM = 128
B = 60 / BPM          # 0.46875 s
BAR = 4 * B           # 1.875 s
DUR = 15.0
N = int(SR * DUR)
rng = np.random.default_rng(7)


def T(beat):          # beat -> seconds
    return beat * B


def mtof(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def tt(n):
    return np.arange(n) / SR


# ---------------------------------------------------------------- buses
class Bus:
    def __init__(self):
        self.L = np.zeros(N)
        self.R = np.zeros(N)

    def add(self, t0, sig, gain=1.0, pan=0.0):
        """sig: mono (n,) or stereo (2,n). pan -1..1 (equal power)."""
        i0 = int(round(t0 * SR))
        if sig.ndim == 1:
            th = (pan + 1) * np.pi / 4
            l, r = sig * np.cos(th) * 1.4142, sig * np.sin(th) * 1.4142
        else:
            l, r = sig[0], sig[1]
        if i0 < 0:
            l, r = l[-i0:], r[-i0:]
            i0 = 0
        n = min(len(l), N - i0)
        if n <= 0:
            return
        self.L[i0:i0 + n] += l[:n] * gain
        self.R[i0:i0 + n] += r[:n] * gain


drums, bass, synth, fx, verb_send = Bus(), Bus(), Bus(), Bus(), Bus()

# ---------------------------------------------------------------- DSP
def saw(freq, n, ph0=0.0):
    inc = np.full(n, freq / SR) if np.isscalar(freq) else np.asarray(freq) / SR
    p = (ph0 + np.cumsum(inc)) % 1.0
    y = 2 * p - 1
    m = p < inc
    x = p[m] / inc[m]
    y[m] -= 2 * x - x * x - 1
    m = p > 1 - inc
    x = (p[m] - 1) / inc[m]
    y[m] -= x * x + 2 * x + 1
    return y


def sine(freq, n, ph0=0.0):
    inc = np.full(n, freq / SR) if np.isscalar(freq) else np.asarray(freq) / SR
    return np.sin(2 * np.pi * (ph0 + np.cumsum(inc)))


def square(freq, n):
    inc = np.full(n, freq / SR) if np.isscalar(freq) else np.asarray(freq) / SR
    p = np.cumsum(inc) % 1.0
    return np.where(p < 0.5, 1.0, -1.0)


def svf(x, fc, q=0.707, mode="lp"):
    """Zavalishin TPT state-variable filter; fc may be an array (time-varying)."""
    n = len(x)
    fc = np.clip(np.broadcast_to(np.asarray(fc, dtype=float), (n,)), 10, SR * 0.45)
    g = np.tan(np.pi * fc / SR)
    k = 1.0 / q
    a1 = 1 / (1 + g * (g + k))
    a2 = g * a1
    a3 = g * a2
    a1, a2, a3, xs = a1.tolist(), a2.tolist(), a3.tolist(), x.tolist()
    out = [0.0] * n
    ic1 = ic2 = 0.0
    if mode == "lp":
        for i in range(n):
            v3 = xs[i] - ic2
            v1 = a1[i] * ic1 + a2[i] * v3
            v2 = ic2 + a2[i] * ic1 + a3[i] * v3
            ic1 = 2 * v1 - ic1
            ic2 = 2 * v2 - ic2
            out[i] = v2
    elif mode == "bp":
        for i in range(n):
            v3 = xs[i] - ic2
            v1 = a1[i] * ic1 + a2[i] * v3
            v2 = ic2 + a2[i] * ic1 + a3[i] * v3
            ic1 = 2 * v1 - ic1
            ic2 = 2 * v2 - ic2
            out[i] = v1
    else:  # hp
        for i in range(n):
            v3 = xs[i] - ic2
            v1 = a1[i] * ic1 + a2[i] * v3
            v2 = ic2 + a2[i] * ic1 + a3[i] * v3
            ic1 = 2 * v1 - ic1
            ic2 = 2 * v2 - ic2
            out[i] = xs[i] - k * v1 - v2
    return np.array(out)


def fft_filter(x, lo=None, hi=None):
    """zero-phase brickwall-ish (smooth-edged) filter for long buffers."""
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    H = np.ones_like(f)
    if lo:
        H *= 1 / (1 + (lo / np.maximum(f, 1e-3)) ** 4)
    if hi:
        H *= 1 / (1 + (f / hi) ** 4)
    return np.fft.irfft(X * H, len(x))


def env_ad(n, a, d, curve=1.0):
    t = tt(n)
    e = np.minimum(t / max(a, 1e-4), 1.0) * np.exp(-np.maximum(t - a, 0) / d)
    return e ** curve


def noise(n, seed=None):
    r = np.random.default_rng(seed) if seed is not None else rng
    return r.uniform(-1, 1, n)


# ---------------------------------------------------------------- instruments
def kick(dur=0.55, punch=1.0):
    n = int(dur * SR)
    t = tt(n)
    f = 46 + 130 * np.exp(-t * 28) + 40 * np.exp(-t * 180)
    body = sine(f, n) * np.exp(-t * 5.5) * np.minimum(t / 0.002, 1)
    click = svf(noise(int(0.006 * SR), 1), 3500, 0.8, "bp") * 1.5
    body[: len(click)] += click * punch
    return np.tanh(body * 1.8) * 0.9


def clap(seed=2):
    n = int(0.4 * SR)
    t = tt(n)
    e = np.zeros(n)
    for k, off in enumerate([0, 0.011, 0.022]):
        e += np.exp(-np.maximum(t - off, 0) / 0.006) * (t >= off)
    e += 0.6 * np.exp(-np.maximum(t - 0.03, 0) / 0.11) * (t >= 0.03)
    y = svf(noise(n, seed), 1250, 1.3, "bp") * e
    return y * 2.6


def snare(seed=3, tone=190):
    n = int(0.25 * SR)
    t = tt(n)
    y = svf(noise(n, seed), 2200, 0.9, "bp") * np.exp(-t / 0.06) * 1.6
    y += sine(tone * (1 + 0.5 * np.exp(-t * 60)), n) * np.exp(-t / 0.05) * 0.6
    return y


def metal(n, seed=0):
    """808-style metallic cluster: six detuned squares."""
    fs = [205.3, 304.4, 369.6, 522.7, 540.0, 800.0]
    y = sum(square(f * 1.71, n) for f in fs) / 6
    return y


def hat(open_=False, seed=4):
    d = 0.24 if open_ else 0.035
    n = int((d * 4 + 0.02) * SR)
    t = tt(n)
    src = 0.55 * metal(n) + 0.45 * noise(n, seed)
    y = svf(src, 8500, 0.9, "hp") * np.exp(-t / d) * np.minimum(t / 0.001, 1)
    return y


def crash(dur=2.4, seed=5):
    n = int(dur * SR)
    t = tt(n)
    src = 0.4 * metal(n) + 0.6 * noise(n, seed)
    y = svf(src, 5200, 0.7, "hp") * np.exp(-t / 0.55) * np.minimum(t / 0.002, 1)
    return y


def boom(dur=2.6):
    n = int(dur * SR)
    t = tt(n)
    f = 34 + 70 * np.exp(-t * 9)
    y = sine(f, n) * np.exp(-t / 0.9) * np.minimum(t / 0.003, 1)
    nz = svf(noise(n, 11), 300 + 2500 * np.exp(-t * 8), 0.8, "lp") * np.exp(-t / 0.35)
    return np.tanh(1.6 * y) + 0.7 * nz


def supersaw(notes, dur, cutoff, q=0.9, detune=(-22, -13, -6, 0, 6, 13, 22), seed=0, amp_env=None):
    n = int(dur * SR)
    r = np.random.default_rng(seed)
    L = np.zeros(n)
    R = np.zeros(n)
    for m in notes:
        f0 = mtof(m)
        for j, c in enumerate(detune):
            v = saw(f0 * 2 ** (c / 1200), n, r.uniform())
            pan = (j / (len(detune) - 1)) * 2 - 1
            th = (pan * 0.85 + 1) * np.pi / 4
            L += v * np.cos(th)
            R += v * np.sin(th)
    L /= len(notes) * len(detune) ** 0.5
    R /= len(notes) * len(detune) ** 0.5
    L = svf(L, cutoff, q)
    R = svf(R, cutoff, q)
    if amp_env is not None:
        L *= amp_env
        R *= amp_env
    return np.stack([L, R])


def pluck(m, dur=0.28, bright=7000, seed=0):
    n = int(dur * SR)
    t = tt(n)
    f = mtof(m)
    r = np.random.default_rng(seed)
    v = saw(f, n, r.uniform()) + 0.6 * saw(f * 1.006, n, r.uniform()) + 0.3 * square(f * 0.5, n)
    v = svf(v, 300 + bright * np.exp(-t * 22), 1.4)
    return v * np.exp(-t / 0.11) * np.minimum(t / 0.002, 1) * 0.5


def bassnote(m, dur):
    n = int(dur * SR)
    t = tt(n)
    f = mtof(m)
    v = 0.8 * saw(f, n) + 0.8 * sine(f / 2, n)
    v = svf(v, 180 + 1400 * np.exp(-t * 14), 1.2)
    e = np.minimum(t / 0.004, 1) * np.minimum((dur - t) / 0.02, 1).clip(0, 1)
    return np.tanh(v * e * 1.5) * 0.6


def fm_bell(m, dur=2.2, idx=4.0, ratio=3.5):
    n = int(dur * SR)
    t = tt(n)
    f = mtof(m)
    mod = sine(f * ratio, n) * idx * np.exp(-t * 3)
    y = np.sin(2 * np.pi * f * t + mod) * np.exp(-t / 0.7) * np.minimum(t / 0.002, 1)
    return y * 0.5


def tick(freq=2400, seed=0):
    n = int(0.03 * SR)
    t = tt(n)
    return sine(freq, n) * np.exp(-t / 0.006) * 0.5 + noise(n, seed) * np.exp(-t / 0.002) * 0.2


def whoosh(dur=0.55, f0=300, f1=7000, seed=21):
    n = int(dur * SR)
    t = tt(n)
    x = t / dur
    fc = f0 * (f1 / f0) ** (np.sin(np.pi * np.minimum(x * 1.1, 1)) ** 1.5)
    y = svf(noise(n, seed), fc, 2.0, "bp")
    e = np.sin(np.pi * x) ** 2 * (x ** 0.5)
    return y * e * 2.2


def riser(dur, seed=31):
    n = int(dur * SR)
    t = tt(n)
    x = t / dur
    fc = 250 * (40 ** x)
    nz = svf(noise(n, seed), fc, 3.0, "bp") * 2.0
    tone = saw(110 * (8 ** (x ** 1.6)), n)
    tone = svf(tone, fc * 1.5, 1.0)
    return (nz + 0.25 * tone) * x ** 2


def boing(dur=0.9):
    """dot hitting the string: pitch wobbles with the same 28 rad/s the visual uses."""
    n = int(dur * SR)
    t = tt(n)
    f = 170 * (1 + 0.12 * np.exp(-t * 5) * np.sin(t * 28))
    y = sine(f, n) * np.exp(-t / 0.22) + 0.5 * sine(f * 2.01, n) * np.exp(-t / 0.1)
    return y * np.minimum(t / 0.002, 1) * 0.6


def sweep_tone(f0, f1, dur, decay=None):
    n = int(dur * SR)
    t = tt(n)
    x = t / dur
    f = f0 * (f1 / f0) ** x
    e = np.sin(np.pi * x) ** 0.7 if decay is None else np.exp(-t / decay)
    return sine(f, n) * e


def blip(freq, dur=0.05, crush=8):
    n = int(dur * SR)
    t = tt(n)
    y = square(freq, n) * np.exp(-t / (dur / 3))
    return np.round(y * crush) / crush * 0.3


# ---------------------------------------------------------------- arrangement
K = kick()
K_soft = kick(punch=0.5) * 0.7
CL = clap()
HC = [hat(False, s) for s in (4, 5, 6)]
HO = hat(True, 7)
SN = [snare(s) for s in range(10, 14)]
CR = crash()

kicks = []  # times for sidechain


def put_kick(beat, g=1.0, soft=False):
    drums.add(T(beat), K_soft if soft else K, g)
    kicks.append(T(beat))


# ----- bar 1 (0-4): boot. line draws, ruler ticks blink on 8ths, dot falls, boing
fx.add(0.05, sweep_tone(180, 1700, 0.75), 0.10, -0.2)
for i in range(8):
    fx.add(T(i * 0.5), tick(2600 if i % 2 == 0 else 1900, i), 0.25 + 0.04 * i, 0.5 if i % 2 else -0.5)
pad1 = supersaw([41, 53, 56, 60], BAR + 0.3, np.linspace(250, 1400, int((BAR + 0.3) * SR)), seed=1,
                amp_env=np.minimum(tt(int((BAR + 0.3) * SR)) / 1.2, 1))
synth.add(0, pad1, 0.35)
verb_send.add(0, pad1, 0.15)
fx.add(T(2) - 0.35, sweep_tone(1600, 380, 0.35, decay=1.0), 0.12)        # dot falling
fx.add(T(2), boing(), 0.55)                                                # impact on the string
put_kick(2, 0.45, soft=True)
fx.add(T(3), sweep_tone(220, 900, 0.3), 0.15)                              # dot grows
suck = svf(noise(int(0.17 * SR), 40), np.linspace(9000, 300, int(0.17 * SR)), 1.5, "bp")
fx.add(1.705, suck * np.linspace(0.2, 1, len(suck)) ** 2, 0.6)            # dot implodes
verb_send.add(T(2), boing(), 0.25)

# ----- bar 2 (4-8): kinetic type, one stamp per word
stab_chords = [[53, 56, 60, 65], [49, 53, 56, 61], [51, 55, 58, 63], [51, 55, 58, 63]]
for k in range(4):
    b = 4 + k
    put_kick(b, 0.85)
    drums.add(T(b), CL, 0.45)
    st = supersaw(stab_chords[k], 0.42, 400 + 5000 * np.exp(-tt(int(0.42 * SR)) * 12), seed=10 + k,
                  amp_env=np.exp(-tt(int(0.42 * SR)) / 0.16))
    synth.add(T(b), st, 0.55)
    verb_send.add(T(b), st, 0.3)
    if k < 3:
        drums.add(T(b + 0.5), HC[k % 3], 0.18)
# snare roll over the last beat, accelerating
roll_t = [7.0, 7.25, 7.5, 7.625, 7.6875]
for i, b in enumerate(np.concatenate([np.arange(7.0, 7.5, 0.25), np.arange(7.5, 7.75, 0.0625)])):
    drums.add(T(b), SN[i % 4], 0.18 + 0.4 * (b - 7.0))
fx.add(T(4), riser(T(3.75)), 0.35)
zip_ = saw(np.linspace(150, 2400, int(0.2 * SR)) ** 1.0, int(0.2 * SR))
zip_ = svf(zip_, np.linspace(600, 9000, len(zip_)), 2.0) * np.linspace(0.2, 1, len(zip_))
fx.add(T(7.47), zip_, 0.18)
rc = CR[::-1][-int(0.9 * SR):]
fx.add(T(7.75) - 0.9, rc[: int(0.9 * SR)], 0.35)
# silence from 7.75 to 8 -> the drop hits harder

# ----- bars 3-6 (8-24): the drop
drop_chords = [[53, 56, 60], [49, 53, 56], [56, 60, 63], [51, 55, 58]]  # Fm Db Ab Eb
roots = [41, 37, 44, 39]
fx.add(T(8), boom(), 0.8)
fx.add(T(8), CR, 0.5)
verb_send.add(T(8), CR, 0.3)
for bar in range(4):
    b0 = 8 + bar * 4
    for q in range(4):
        put_kick(b0 + q)
        if q in (1, 3):
            drums.add(T(b0 + q), CL, 0.5)
            verb_send.add(T(b0 + q), CL, 0.12)
        drums.add(T(b0 + q + 0.5), HO, 0.22, 0.15)
        for s in range(4):
            acc = [0.5, 0.25, 0.35, 0.25][s]
            drums.add(T(b0 + q + s * 0.25), HC[(q + s) % 3], 0.16 * acc, -0.25)
        # pumping house bass on the offbeat (+ a 16th pickup)
        bass.add(T(b0 + q + 0.5), bassnote(roots[bar], B * 0.42), 0.75)
        if q == 3:
            bass.add(T(b0 + q + 0.75), bassnote(roots[bar] + 12, B * 0.2), 0.45)
    # sustained supersaw pad, pumped by sidechain below
    notes = drop_chords[bar] + [drop_chords[bar][0] + 12]
    padn = int(BAR * SR) + 2000
    open_ = 1800 + (bar / 3) * 3000
    pd = supersaw(notes, padn / SR, open_, seed=20 + bar)
    synth.add(T(b0), pd, 0.38)
    verb_send.add(T(b0), pd, 0.12)
    # 16th arp
    ch = drop_chords[bar]
    oct_ = 12 if bar < 2 else 24
    seq = [ch[0], ch[1], ch[2], ch[0] + 12, ch[2], ch[1], ch[0] + 12, ch[2],
           ch[0], ch[1], ch[2], ch[0] + 12, ch[1] + 12, ch[2], ch[0] + 12, ch[1]]
    for s, m in enumerate(seq):
        p = pluck(m + oct_, seed=s + bar * 16)
        pan = -0.45 if s % 2 == 0 else 0.45
        synth.add(T(b0 + s * 0.25), p, 0.33, pan)
        # ping-pong 3/16 delay
        for tap in range(1, 4):
            synth.add(T(b0 + s * 0.25 + tap * 0.75), p, 0.33 * 0.38 ** tap, -pan if tap % 2 else pan)
        verb_send.add(T(b0 + s * 0.25), p, 0.08)
    # transition whoosh into the next scene
    fx.add(T(b0 + 4) - 0.42, whoosh(0.55, seed=bar), 0.42, -0.6 + 0.4 * bar)

# scene 6 (beats 20-24): odometer digits roll -> burst of tiny ticks each beat
for q in range(4):
    for j in range(9):
        fx.add(T(20 + q) + j * 0.022 * (1 + j * 0.12), tick(3200 - j * 120, j), 0.10 * (1 - j / 10), 0.3)

# ----- bar 7 (24-28): montage, cuts on 8ths then 16ths; build to the end card
mont_chords = [[46, 49, 53, 58]] * 3 + [[48, 52, 55, 60]] * 3 + [[48, 52, 55, 60]] * 4
cuts = [0, .5, 1, 1.5, 2, 2.5, 3, 3.25, 3.5]
for i, c in enumerate(cuts):
    b = 24 + c
    put_kick(b, 0.9 if c < 3 else 0.75)
    ln = 0.22 if c < 3 else 0.11
    st = supersaw(mont_chords[i], ln, 600 + 6000 * (i / 9) * np.exp(-tt(int(ln * SR)) * 10), seed=40 + i,
                  amp_env=np.exp(-tt(int(ln * SR)) / (ln / 2.5)))
    synth.add(T(b), st, 0.5)
    fx.add(T(b), blip(400 * 2 ** (i / 4), 0.04), 0.35, (-1) ** i * 0.6)
for b in range(24, 28):
    drums.add(T(b), CL, 0.45)
for i, b in enumerate(np.arange(24, 27.75, 0.25)):
    drums.add(T(b), SN[i % 4], 0.06 + 0.035 * (b - 24))
# countdown beeps 3-2-1 on the 16ths of the last beat
for j, b in enumerate([27.0, 27.25, 27.5]):
    fx.add(T(b), sine(1320 * 2 ** (j * 2 / 12), int(0.09 * SR)) * np.exp(-tt(int(0.09 * SR)) / 0.03), 0.22)
fx.add(T(24), riser(T(3.75), seed=33), 0.4)
fx.add(T(28) - 0.6, CR[::-1][-int(0.6 * SR):], 0.35)

# ----- bar 8 (28-32): end card
fx.add(T(28), boom(3.0), 0.9)
fx.add(T(28), CR, 0.55)
verb_send.add(T(28), CR, 0.35)
put_kick(28, 1.0)
endn = int((DUR - T(28)) * SR)
endenv = np.minimum(tt(endn) / 0.01, 1) * np.exp(-tt(endn) / 1.4)
final = supersaw([41, 48, 53, 56, 60, 67], endn / SR, 600 + 5000 * np.exp(-tt(endn) * 1.6), seed=77,
                 amp_env=endenv)
synth.add(T(28), final, 0.5)
verb_send.add(T(28), final, 0.35)
sub = sine(mtof(29), endn) * np.exp(-tt(endn) / 1.0) * np.minimum(tt(endn) / 0.01, 1)
bass.add(T(28), sub, 0.5)
# logo shapes land -> three bell notes from the chord
for b, m in [(28.5, 72), (28.75, 77), (29.0, 80)]:
    synth.add(T(b), fm_bell(m, 1.6, idx=2.0, ratio=2.0), 0.22, (b - 28.75) * 2)
    verb_send.add(T(b), fm_bell(m, 1.6, idx=2.0, ratio=2.0), 0.18)
fx.add(T(29.5) - 0.25, whoosh(0.45, 200, 4000, seed=90), 0.25)        # name rises
synth.add(T(30), fm_bell(89, 2.0), 0.18)                               # underline / role text
verb_send.add(T(30), fm_bell(89, 2.0), 0.25)

# ---------------------------------------------------------------- sidechain
tline = tt(N)
duck = np.ones(N)
for tk in kicks:
    i0, i1 = int(tk * SR), min(int((tk + 0.32) * SR), N)
    x = (tline[i0:i1] - tk) / 0.32
    duck[i0:i1] *= 1 - 0.85 * (1 - x) ** 2.2
# no pumping on the final tail
duck[int(T(28.4) * SR):] = np.maximum(duck[int(T(28.4) * SR):], 1.0)
for bus in (synth, bass):
    bus.L *= duck
    bus.R *= duck

# ---------------------------------------------------------------- reverb (synthetic IR, FFT convolution)
def make_ir(seed, dur=2.4):
    n = int(dur * SR)
    t = tt(n)
    ir = noise(n, seed) * np.exp(-t * 2.9)
    ir = fft_filter(ir, lo=200, hi=7000)
    ir[: int(0.012 * SR)] = 0  # pre-delay
    return ir / np.sqrt(np.sum(ir ** 2))


def conv(x, ir):
    nf = 1 << int(np.ceil(np.log2(len(x) + len(ir))))
    return np.fft.irfft(np.fft.rfft(x, nf) * np.fft.rfft(ir, nf), nf)[: len(x)]


wetL = conv(verb_send.L, make_ir(101))
wetR = conv(verb_send.R, make_ir(202))

# ---------------------------------------------------------------- master
L = drums.L * 1.0 + bass.L + synth.L + fx.L + wetL * 0.55
R = drums.R * 1.0 + bass.R + synth.R + fx.R + wetR * 0.55
L = fft_filter(L, lo=28)
R = fft_filter(R, lo=28)
peak = max(np.abs(L).max(), np.abs(R).max())
L, R = L / peak, R / peak
drive = 1.6
L, R = np.tanh(L * drive) / np.tanh(drive), np.tanh(R * drive) / np.tanh(drive)
fade_in = np.minimum(tline / 0.004, 1)
fade_out = np.clip((DUR - tline) / 0.55, 0, 1) ** 1.5
L *= fade_in * fade_out * 0.93
R *= fade_in * fade_out * 0.93

out = sys.argv[1] if len(sys.argv) > 1 else "music.wav"
pcm = (np.stack([L, R], 1) * 32767).astype(np.int16)
with wave.open(out, "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())
print("wrote", out, f"{N / SR:.3f}s", "peak", np.abs(pcm).max())
