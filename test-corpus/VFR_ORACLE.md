# Variable-frame-rate image oracle

Generated test pattern, not user media. The fixture is 320×180 H.264 with B frames and
explicit BT.709 colour tags.
The expected times from an independent FFprobe decode are, in milliseconds:
`0, 120, 200, 240, 360, 400, 480, 600, 720, 800, 840, 960`.

Reproduction (do not overwrite fixtures without reviewing changes):

```powershell
ffmpeg -f lavfi -i "testsrc2=size=320x180:rate=25:duration=1" -vf "select='not(mod(n,3))+not(mod(n,5))',scale=in_color_matrix=bt601:out_color_matrix=bt709" -fps_mode vfr -c:v libx264 -crf 18 -pix_fmt yuv420p -color_primaries bt709 -color_trc bt709 -colorspace bt709 -an -movflags +faststart vfr-frame-timing.mp4
ffmpeg -i vfr-frame-timing.mp4 -vf "select=eq(n\,0)" -frames:v 1 vfr-frame-0.png
ffmpeg -i vfr-frame-timing.mp4 -vf "select=eq(n\,1)" -frames:v 1 vfr-frame-1.png
ffprobe -v error -select_streams v:0 -show_entries frame=best_effort_timestamp_time,key_frame -of csv=p=0 vfr-frame-timing.mp4
```

Playwright compares the browser's decoded image (not the subtitle overlay) to both FFmpeg
PNGs using per-channel thresholded geometry; the correct image must have less than half
the structural error of the other frame. Raw RGB error is also attached to the report.
This checks frame identity, not colour matching: Firefox/Chromium colour management
produced different RGB differences against the same PNG, even with explicit metadata.
Stepping forward must select the second image, and stepping back must restore the first.
