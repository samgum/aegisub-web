# Native spectrum arithmetic and streaming acceptance

Reference: `samgum/Aegisub` dc2a5b448174a194127f165e2446fcb5810a8a55.
`aegisub-fft/fft.cpp` and `fft.h` retain the original non-FFTW implementation;
`hsl.cpp` extracts the unchanged HSL conversion body with a build-only clamp helper.
The exception adapter permits compiling the original FFT without the wxWidgets app.
Copyright notices remain beside the source and are redistributed with the website.

`native-spectrum-oracle.cpp` invokes that FFT and the renderer's scaling formula.
The golden JSON covers 24 FFT vectors at 32/48/96 kHz and all four exposed quality
levels, 32 Icy Blue colours across all rendering priorities, and 30 native frequency
row maps across heights and all five mapping presets. MSVC and GCC outputs were
compared; `check-native-spectrum.mjs` recompiles/checks them on CI. FFT/libm float
differences are limited to 0.0001 power units, not arbitrary visual tolerance.

Unlike the previous web implementation, the native path has no Hann window, uses
centered zero-padded PCM16 windows, and stores `log10(magnitude * scale + 1)` rather
than a hand-tuned byte/dB image. Above 50 kHz it scales FFT size/hop and compensates
the magnitude. Rendering excludes DC, caps the displayed range at 20 kHz/Nyquist,
interpolates or maximizes native bin intervals, and applies gain after logarithmic
power calculation. Native Icy Blue/Green palettes distinguish normal, inactive,
selected and primary ranges without a second tint layer.

The web worker derives only the FFT blocks used by the current viewport. It consumes
the shared streamed PCM provider and keeps one ring window plus the resulting power
blocks; no complete-track float PCM or 16 kHz ASR buffer remains. Two viewport tiles
are retained subject to the configured cache budget. The active working tile itself
may exceed a deliberately tiny budget, as documented in the cache implementation.
Blank/noise audio derives only the requested windows, not all 150 minutes.

Tests also inspect the actual rendered 12 kHz band at native linear/log positions,
source-rate FFT data, EOF blanking, 96 kHz quality changes, gain/mapping/pan reuse and
mode/source cancellation. A 115 MB WAV instrumentation case verifies under 4 MiB read
for a narrow viewport near 500 seconds and under 200 KB of retained FFT data.

Limits: this matches the non-FFTW parameter path, consistent with the Windows CI's
dependency setup, not the +2 quality shift used by FFTW-equipped desktop builds.
It does not certify the exact released desktop GUI, compressed-provider mixing or
codec endpoint identity. The existing web default remains waveform; complete native
default/preference migration and physical-device acceptance are still outstanding.
