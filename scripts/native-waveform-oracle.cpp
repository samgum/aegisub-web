// Native arithmetic oracle: audio_renderer_waveform.cpp / audio_renderer.h at dc2a5b4.
// Copyright (c) 2010, Niels Martin Hansen
// All rights reserved.
//
// Redistribution and use in source and binary forms, with or without
// modification, are permitted provided that the following conditions are met:
//
//   * Redistributions of source code must retain the above copyright notice,
//     this list of conditions and the following disclaimer.
//   * Redistributions in binary form must reproduce the above copyright notice,
//     this list of conditions and the following disclaimer in the documentation
//     and/or other materials provided with the distribution.
//   * Neither the name of the Aegisub Group nor the names of its contributors
//     may be used to endorse or promote products derived from this software
//     without specific prior written permission.
//
// THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
// AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
// IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
// ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE
// LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
// CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
// SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
// INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
// CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
// ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
// POSSIBILITY OF SUCH DAMAGE.
//
// Aegisub Project http://www.aegisub.org/

#include <algorithm>
#include <cstdint>
#include <iomanip>
#include <iostream>

int sample(int64_t index, int64_t count) {
    if (index < 0 || index >= count) return 0;
    if (index % 23497 == 1) return -32768;
    if (index % 104729 == 13) return 32767;
    return static_cast<int>((index * 37 + index / 17 * 3) % 2001) - 1000;
}
int main() {
    std::cout << "["; bool first = true;
    for (int rate : {32000, 44100, 48000, 96000}) for (double pps : {0.5, 50., 675.}) for (int begin : {0, 31, 128}) {
        const int width = pps < 1 ? 3 : 35;
        const int64_t count = int64_t(rate) * 64;
        const double pixel_ms = 1000. / pps;
        const double pixel_samples = pixel_ms * rate / 1000.;
        if (!first) std::cout << ','; first = false;
        std::cout << std::setprecision(17) << "{\"rate\":" << rate << ",\"pps\":" << pps << ",\"startPixel\":" << begin
          << ",\"width\":" << width << ",\"sampleCount\":" << count << ",\"sampleSpan\":" << pixel_samples << ",\"pixels\":[";
        double cur_sample = 0;
        for (int x = 0; x < width; ++x) {
            const int pixel = begin + x;
            if (x == 0 || pixel % 32 == 0) {
                cur_sample = (pixel / 32 * 32) * pixel_samples;
                for (int skip = 0; skip < pixel % 32; ++skip) cur_sample += pixel_samples;
            }
            const int64_t start = static_cast<int64_t>(cur_sample);
            cur_sample += pixel_samples;
            int peak_min = 0, peak_max = 0;
            int64_t avg_min_accum = 0, avg_max_accum = 0;
            for (int si = 0; si < static_cast<int>(pixel_samples); ++si) {
                const int aud = sample(start + si, count);
                if (aud > 0) { peak_max = std::max(peak_max, aud); avg_max_accum += aud; }
                else { peak_min = std::min(peak_min, aud); avg_min_accum += aud; }
            }
            if (x) std::cout << ',';
            std::cout << '[' << start << ',' << peak_min << ',' << peak_max << ',' << avg_min_accum << ',' << avg_max_accum << ']';
        }
        std::cout << "]}";
    }
    std::cout << "]\n";
}
