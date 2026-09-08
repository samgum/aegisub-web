// Compiles the unchanged FFT from the designated Aegisub source. Spectrum scale
// follows audio_renderer_spectrum.cpp's non-FFTW branch at dc2a5b4.
#include <cmath>
#include <cstddef>
#include <algorithm>
#include <iomanip>
#include <iostream>
#include <vector>
#include "../test-corpus/aegisub-fft/fft.h"
void hsl_to_rgb(int, int, int, unsigned char*, unsigned char*, unsigned char*);

int main() {
  std::cout << std::setprecision(9) << "{\"powers\":["; bool first = true;
  for (int rate : {32000, 48000, 96000}) for (int quality : {0, 1, 2, 3}) for (int signal : {0, 1}) {
    const int distances[] = {8, 8, 7, 6};
    int size = quality ? 9 : 8, original = size, distance = distances[quality];
    float ratio = float(rate) / 50000.f; while (ratio > 1) { ++size; ++distance; ratio *= .5f; }
    int n = 2 << size, bins = n / 2;
    int maxband = std::min(int(floorf(bins * 20000.f / (rate * .5f) + .5f)), bins);
    int stored = std::min(bins, maxband + 1);
    float fix = 1.f / sqrtf(float(1 << (size - original))), scale = fix * 9 / sqrtf(2 * float(n));
    std::vector<float> input(n), real(n), imag(n);
    for (int i = 0; i < n; ++i) {
      int value = signal ? ((i % 4 == 1) ? 2000 : (i % 4 == 3) ? -2000 : 0) : (i * 237 + (i % 37) * 17) % 5001 - 2500;
      input[i] = float(value) / 32768.f;
    }
    FFT fft; fft.Transform(n, input.data(), real.data(), imag.data());
    if (!first) std::cout << ','; first = false;
    std::cout << "{\"rate\":" << rate << ",\"quality\":" << quality << ",\"signal\":" << signal << ",\"fftSize\":" << n << ",\"hop\":" << (1 << distance) << ",\"values\":[";
    for (int i = 0; i < stored; ++i) { if (i) std::cout << ','; std::cout << log10f(sqrtf(real[i] * real[i] + imag[i] * imag[i]) * scale + 1); }
    std::cout << "]}";
  }
  std::cout << "],\"colours\":["; first = true;
  for (int style = 0; style < 4; ++style) for (int index : {0, 17, 256, 1024, 2048, 3000, 4095, 4096}) {
    double t = double(index) / 4096;
    int h = std::clamp(int(191 - 128 * t), 0, 255), s = std::clamp(int((style == 1 ? 63 : 127) + (style == 1 ? 192 : 128) * t), 0, 255);
    int l = std::clamp(int((style == 0 ? 0 : style == 3 ? 64 : 32) + (style == 0 ? 255 : 192) * t), 0, 255);
    unsigned char r, g, b; hsl_to_rgb(h, s, l, &r, &g, &b);
    if (!first) std::cout << ','; first = false;
    std::cout << '[' << style << ',' << index << ',' << int(r) << ',' << int(g) << ',' << int(b) << ']';
  }
  std::cout << "],\"rows\":["; first = true;
  for (int rate : {48000, 96000}) for (int height : {16, 173, 400}) for (int curve = 0; curve < 5; ++curve) {
    int bins = rate > 50000 ? 1024 : 512;
    int maxband = std::min(int(floorf(bins * 20000.f / (rate * .5f) + .5f)), bins);
    const float positions[] = {.001f, .125f, .333f, .425f, .999f};
    float pos = positions[curve], scale_log = logf(float(maxband));
    float b_ref = std::clamp(bins * 1000.f / (rate * .5f), 1.f, float(maxband - 1));
    float c_lin = 1 + (maxband - 1) * pos, c_log = expf(pos * scale_log);
    float ratio = std::clamp((b_ref - c_lin) / (c_log - c_lin), 0.f, 1.f), previous = 1, current = 1;
    if (!first) std::cout << ','; first = false;
    std::cout << "{\"rate\":" << rate << ",\"height\":" << height << ",\"curve\":" << curve << ",\"rows\":[";
    for (int y = 0; y < height; ++y) {
      float next = float(maxband);
      if (y + 1 < height) { float rel = float(y + 1) / height, lin = 1 + rel * (maxband - 1), logarithmic = expf(rel * scale_log); next = lin + ratio * (logarithmic - lin); }
      int from, to, maximum; float fraction;
      if (next - previous < 2) { from = int(floorf(current)); to = std::min(from + 1, bins - 1); fraction = current - from; maximum = 0; }
      else { from = std::min(int(floorf((previous + current) * .5f)), bins - 2); to = std::min(int(floorf((current + next) * .5f)), bins - 1); fraction = 0; maximum = 1; }
      if (y) std::cout << ','; std::cout << '[' << from << ',' << to << ',' << fraction << ',' << maximum << ']'; previous = current; current = next;
    }
    std::cout << "]}";
  }
  std::cout << "]}\n";
}
