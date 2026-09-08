# Native audio provider investigation (not a parity certificate)

The designated desktop source is `samgum/Aegisub` dc2a5b448174a194127f165e2446fcb5810a8a55.
Its FFMS wrap pins 3af2ef2ae47bc30b64597c9e419e5b19c4bda7d8 (5.1.2). The official
SGMY 2026-09-01 Windows portable archive was downloaded and its published SHA-256
verified: `cdd9ccfc8b4d5bf66c9d70d8bff878b2d77f21c546ea2ee63ae72fea73defc50`.
The executable statically links FFMS, so it cannot serve as an independently loadable
audio DLL. A temporary isolated reference profile was started, but its hidden window
was not targetable by the available desktop UI channel; that test process was stopped.
No existing user project window was manipulated. Exact SGMY GUI export is **not verified**.

`scripts/native-audio-provider-probe.cpp` was compiled with MSVC and run against the
official separately available FFMS 5.0 x64 DLL, using the same API calls and delay mode
as Aegisub's FFmpegSource provider. The full diagnostic output is preserved in
`ffms-5.0-audio-diagnostic.json`. This older DLL is **not the target build**. Source
comparison shows the same sample-count/delay formulas, but runtime codec versions
and other changes can matter. Its numbers must not be blindly enforced on the website.
The diagnostic DLL SHA-256 is
`970d3f8d170fd13a2dd8a7e8a7f56b0ce5a1dc7eea79d1774bbb2c2cab47e3f0`.

| Input | Diagnostic native rate | Diagnostic native samples |
|---|---:|---:|
| tiny.opus | 48000 | 38088 |
| tiny.ogg | 48000 | 38400 |
| tiny-aac.m4a | 48000 | 38912 |
| audio-clip-ac3.mka | 48000 | 38160 |
| tiny.flac | 48000 | 38400 |

The critical finding is that container duration, decoded sample count, and the desktop
provider length are distinct. `IndexAudioPacket` sums decoder `nb_samples`; `FillAP`
uses the final sample start/count; `FFMS_AudioSource::Init` then applies first-track
delay, potentially adding silence or trimming samples. The generic converter separately
downmixes and doubles low rates. FFmpegSource can instead perform its own channel-layout
mix before that converter. Therefore a universal "trim to the last granule" change
would not prove native behavior and was not implemented in this increment. Exact
target-build beginning/end alignment, compressed mixing and GUI clip output remain open.

## Waveform arithmetic verified separately

`scripts/native-waveform-oracle.cpp` follows the pinned waveform renderer's signed
min/max, signed arithmetic averages, integer sample counts, double-precision stepping,
and 32-pixel bitmap resets. MSVC produced `native-waveform-oracle.json`; Linux CI
recompiles the C++ and checks the same 36 cases. This is source-derived native arithmetic,
not a screenshot of the desktop application. It covers 32/44.1/48/96 kHz, 0.5/50/675
pixels per second, nonzero starts, cache-block crossings, and zero padding beyond EOF.

`src/waveform-data.test.ts` compares the streaming JavaScript results with those native
numbers and tests PCM channel cancellation, single-sample impulses, asymmetric waveforms
and procedural noise. Browser tests inspect both raw pixel statistics and actual canvas
ink, plus mean-style controls, tile reuse and source-replacement cancellation. Colours,
compressed-provider bit identity and full physical-device/native-GUI parity are not proven.
