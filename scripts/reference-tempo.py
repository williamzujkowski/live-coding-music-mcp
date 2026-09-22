#!/usr/bin/env python3
"""Second opinions on tempo, from tools with no stake in our being right.

`verify-export-audio.ts` already shells out to `ffprobe` on exactly this
principle. This is the same move for the harder question: our detector
says a WAV is 130 BPM, and we would like that checked by something that
did not come out of this repository.

Prints one JSON object per line, so a TypeScript caller can read it
without a JSON dependency. Every estimator is optional and independently
reported: a missing library yields `null` and a `skipped` note rather
than a failure, because this runs on developer machines where nobody
should be forced to install a scientific Python stack to run the tests.

    pip install librosa aubio
    python3 scripts/reference-tempo.py take-01.wav take-02.wav

WHAT THIS CAN AND CANNOT SETTLE
-------------------------------

It settles the beat PERIOD. It does not settle the OCTAVE, and it is
worth being exact about why, because the temptation to treat a
well-known library as ground truth is strong.

Measured on a synthetic click track with no ambiguity in it at all:

    librosa.feature.tempo on a 165 BPM click
        start_bpm=60  ->  55.0
        start_bpm=90  ->  82.0
        start_bpm=120 -> 166.7
        start_bpm=150 -> 166.7

    aubio on a 174 BPM click -> 87.8

The octave is not in the audio. Every estimator supplies it from a
prior, ours included — `exp(-(log2(bpm/120)^2)/2)`, centred on 120,
which is the same shape as librosa's `start_bpm`. So a disagreement
about the octave between us and a reference tool is a disagreement
between two priors, not evidence that either read the audio wrong. Use
`--prior-sweep` to see a file's octave answer move as the prior moves.

Compare periods modulo the octave, and treat an octave difference as
information about the priors rather than as a defect.

ONE MORE TRAP
-------------

On a SILENT wav, librosa reports 120.19 — its prior's centre, with
nothing in the audio at all. aubio correctly reports 0.

That is the same failure this repository named in #366: "a BPM with
confidence 0.00 is not a weak measurement, it is the tempo prior's
centre with a measurement's face on." The reference tool has it too, so
do not calibrate against a number taken from near-silence. Every result
carries `rms` and `silent` for exactly that check.
"""

import json
import sys

# Both estimators are optional, and their absence is reported per file
# rather than aborting: a developer without a Python audio stack still
# gets a usable run, the same way a missing ffprobe only skips one check
# in verify-export-audio.ts.
try:
    import numpy as np
except ImportError:
    np = None

try:
    import librosa
except ImportError:
    librosa = None

try:
    import aubio
except ImportError:
    aubio = None


def librosa_tempo(path, start_bpm=120.0):
    """librosa's autocorrelation tempo estimate, and its beat tracker.

    Two different algorithms: `feature.tempo` scores a tempogram against
    a log-normal prior on `start_bpm`, while `beat.beat_track` runs
    Ellis's dynamic-programming tracker. They disagree on sparse
    material often enough to be worth reporting separately.
    """
    y, sr = librosa.load(path, sr=None, mono=True)
    tempo = float(np.atleast_1d(librosa.feature.tempo(y=y, sr=sr, start_bpm=start_bpm))[0])
    tracked, _ = librosa.beat.beat_track(y=y, sr=sr, start_bpm=start_bpm)
    return tempo, float(np.atleast_1d(tracked)[0])


def aubio_tempo(path, win=2048, hop=512):
    """aubio's running tempo estimate.

    `get_bpm()`, not the median of the gaps between detected beats. The
    median is what a single missed beat destroys: four beats detected
    over twelve seconds of a 130 BPM click read 32.57 that way, while
    aubio's own running estimate was unmoved at 132.05. Measured, not
    assumed — the median version was written first and it was wrong.

    win=2048 rather than the more commonly quoted 1024: at 1024 the same
    130 BPM click detected four beats instead of ten.
    """
    src = aubio.source(path, 0, hop)
    tracker = aubio.tempo('default', win, hop, src.samplerate)
    latest = 0.0
    beats = 0
    while True:
        samples, read = src()
        if tracker(samples):
            latest = tracker.get_bpm()
            beats += 1
        if read < hop:
            break
    return float(latest), beats


def prior_sweep(path):
    """The same file read at five different priors.

    If these disagree, the octave is the prior's answer rather than the
    audio's — which is the whole reason this script refuses to call
    itself ground truth for the octave.
    """
    if librosa is None:
        return None
    out = {}
    y, sr = librosa.load(path, sr=None, mono=True)
    for start in (60, 90, 120, 150, 180):
        value = librosa.feature.tempo(y=y, sr=sr, start_bpm=float(start))
        out[str(start)] = round(float(np.atleast_1d(value)[0]), 2)
    return out


def signal_level(path):
    """RMS of the file, so a near-silent input can be discounted.

    librosa reports 120.19 for a file of pure zeroes. Reporting the
    level alongside the tempo is what lets a caller tell that number
    from a measurement.
    """
    if np is None or librosa is None:
        return None
    y, _ = librosa.load(path, sr=None, mono=True)
    return float(np.sqrt(np.mean(np.square(y)))) if y.size else 0.0


def analyse(path, sweep=False):
    result = {'file': path, 'librosa': None, 'librosaBeatTrack': None,
              'aubio': None, 'aubioBeats': None, 'rms': None, 'silent': None,
              'skipped': [], 'errors': {}}

    try:
        rms = signal_level(path)
        if rms is not None:
            result['rms'] = round(rms, 6)
            # Same threshold shape AudioExportService uses to refuse
            # calling a silent capture a success.
            result['silent'] = rms < 1e-4
    except Exception as error:  # noqa: BLE001
        result['errors']['rms'] = str(error)

    if np is None or librosa is None:
        result['skipped'].append('librosa')
    else:
        try:
            tempo, tracked = librosa_tempo(path)
            result['librosa'] = round(tempo, 2)
            result['librosaBeatTrack'] = round(tracked, 2)
        except Exception as error:  # noqa: BLE001 - reported, not swallowed
            result['errors']['librosa'] = str(error)

    if aubio is None:
        result['skipped'].append('aubio')
    else:
        try:
            tempo, beats = aubio_tempo(path)
            result['aubio'] = round(tempo, 2)
            result['aubioBeats'] = beats
        except Exception as error:  # noqa: BLE001
            result['errors']['aubio'] = str(error)

    if sweep:
        try:
            result['priorSweep'] = prior_sweep(path)
        except Exception as error:  # noqa: BLE001
            result['errors']['priorSweep'] = str(error)

    return result


def main(argv):
    sweep = '--prior-sweep' in argv
    paths = [a for a in argv[1:] if not a.startswith('--')]
    if not paths:
        print('usage: reference-tempo.py [--prior-sweep] FILE.wav [FILE.wav ...]',
              file=sys.stderr)
        return 2
    for path in paths:
        print(json.dumps(analyse(path, sweep)))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
