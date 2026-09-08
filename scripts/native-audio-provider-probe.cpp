// Diagnostic FFMS C API probe. This does not stand in for the exact target Aegisub
// executable; see test-corpus/NATIVE_AUDIO_PROVIDER_AUDIT.md for version limits.
#include "ffms.h"
#include <iostream>
#include <iomanip>
#include <vector>
#include <filesystem>
#include <algorithm>

int main(int argc, char **argv) {
    FFMS_Init(0, 0);
    std::cout << "{\"ffmsVersion\":" << FFMS_GetVersion() << ",\"files\":[";
    for (int i = 1; i < argc; ++i) {
        char message[2048]{};
        FFMS_ErrorInfo error{0, 0, sizeof(message), message};
        auto indexer = FFMS_CreateIndexer(argv[i], &error);
        if (!indexer) { std::cerr << message; return 1; }
        FFMS_TrackTypeIndexSettings(indexer, FFMS_TYPE_AUDIO, 1, 0);
        auto index = FFMS_DoIndexing2(indexer, FFMS_IEH_ABORT, &error);
        if (!index) { std::cerr << message; return 2; }
        int track = FFMS_GetFirstIndexedTrackOfType(index, FFMS_TYPE_AUDIO, &error);
        auto audio = FFMS_CreateAudioSource(argv[i], track, index, FFMS_DELAY_FIRST_VIDEO_TRACK, &error);
        if (!audio) { std::cerr << message; return 3; }
        auto original = *FFMS_GetAudioProperties(audio);
        auto options = FFMS_CreateResampleOptions(audio);
        options->ChannelLayout = FFMS_CH_FRONT_CENTER;
        options->SampleFormat = FFMS_FMT_S16;
        int converted = FFMS_SetOutputFormatA(audio, options, &error);
        FFMS_DestroyResampleOptions(options);
        if (converted) { std::cerr << message; return 4; }
        auto output = *FFMS_GetAudioProperties(audio);
        int count = static_cast<int>(std::min<int64_t>(32, output.NumSamples));
        std::vector<int16_t> tail(count), head(count), middle(count);
        if (FFMS_GetAudio(audio, head.data(), 0, count, &error) ||
            FFMS_GetAudio(audio, middle.data(), output.SampleRate/10, count, &error) ||
            FFMS_GetAudio(audio, tail.data(), output.NumSamples-count, count, &error)) { std::cerr << message; return 5; }
        if (i > 1) std::cout << ',';
        std::cout << std::setprecision(12) << "{\"name\":\"" << std::filesystem::path(argv[i]).filename().string()
          << "\",\"rate\":" << output.SampleRate << ",\"samples\":" << output.NumSamples
          << ",\"firstTime\":" << original.FirstTime << ",\"lastEndTime\":" << original.LastEndTime
          << ",\"sourceChannels\":" << original.Channels << ",\"sourceFormat\":" << original.SampleFormat;
        for (auto pair : {std::make_pair("head", &head), std::make_pair("middle", &middle), std::make_pair("tail", &tail)}) {
            std::cout << ",\"" << pair.first << "\":[";
            for (int n = 0; n < count; ++n) { if (n) std::cout << ','; std::cout << (*pair.second)[n]; }
            std::cout << ']';
        }
        std::cout << '}';
        FFMS_DestroyAudioSource(audio); FFMS_DestroyIndex(index);
    }
    std::cout << "]}\n";
}
