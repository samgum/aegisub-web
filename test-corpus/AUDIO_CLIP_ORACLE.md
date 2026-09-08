# Audio clip acceptance fixtures

`scripts/gen-audio-clip-oracle.mjs` decodes the existing synthetic WAV/FLAC/Opus/Vorbis/
AAC/ALAC/AIFF/CAF fixtures with FFmpeg, and generates a mono AC-3 Matroska fixture plus
four 4-second chirps (Opus, Vorbis, AAC and AC-3). `audio-clip-oracle.json` contains 31
independently decoded PCM points, including first/last, for each tested interval.
The mid-file intervals start at 3001 ms, beyond the exporter's 1-second preroll.
Two additional FLAC sweeps cover every signed PCM16 result, once as 16-bit/48 kHz
input and once as 24-bit/96 kHz input with nonzero low bytes. The unit decoder test
compares every result, not just the sampled browser oracle points.

Regenerate intentionally with `node scripts/gen-audio-clip-oracle.mjs` (FFmpeg and
FFprobe on PATH, or `FFMPEG`/`FFPROBE`). Inputs, reference JSON and the generator are
committed so platform CI uses identical encoded bytes without needing an encoder.
Matroska timestamps/UIDs can change on regeneration; changes should be reviewed.

`playwright/audio-clip.spec.ts` imports the files through the real editor, invokes the
export command, and inspects actual downloaded WAV samples, sample rate, channel count
and byte count. Lossless sample error must be <=1 PCM unit; compressed decoder/rounding
error must be <=3. A phase/timestamp shift is not accepted by widening this threshold.
The WAV multi-selection fixture compares every sample exactly, including gaps between
selected lines; gain, speed, pending timing and document state are checked separately.

Unit tests independently exercise 8/16/24/32/64-bit PCM, integer downmix and repeated
low-rate interpolation, chunk seams, ceiling boundaries, silent gaps, overlapping
packets, overflow rejection, cancellation and bounded reads from a 115 MB WAV.
Matroska metadata tests verify the actual 256-sample AC-3 CodecDelay.

These are not full native-GUI/provider equivalence tests. Compressed surround downmix,
terminal Ogg granule/discard padding, high-bit-depth ALAC before the intermediate WAV,
unusual container layouts and physical iOS/Android output remain in the replication plan.
