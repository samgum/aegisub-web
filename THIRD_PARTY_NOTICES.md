# Third-party notices

## subedit

Browser editor foundation from `hikashop-nicolas/subedit`, commit
`62075bd48e7f533ca8f9f5c777d4fe3e06ad522f`.

Copyright (c) 2026 hikashop-nicolas. Licensed under the MIT License; the full text is retained
in `LICENSE`.

## Aegisub

Workflow and SGMY-tool behavior are based on `samgum/Aegisub`, itself derived from the Aegisub
Project. Its repository-level notice states:

> Copyright (c) 2004-2012, Aegisub Project. All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are permitted
under the conditions in the upstream `LICENCE`. See
https://github.com/samgum/Aegisub/blob/master/LICENCE for the complete notice and disclaimer.

The application icon and toolbar artwork in `demo/public/aegisub-icons/` are copied from the
same pinned Aegisub source tree. The redistributed BSD notice is included beside those assets.

## Vendored translation worker

`src/localml/` is adapted from `hikashop-nicolas/localml`, commit
`f05924cba88680afe79306e66bf223cfca672016`, under the MIT License.

## Vendored ALAC decoder

`vendor/aurora-alac-0.1.0.js` is a browser bundle of Aurora.js `0.4.9` and alac.js
`0.1.0`. Aurora.js is Copyright Audiocogs and licensed under MIT. alac.js is an
Apache-2.0 port of Apple's open-source Apple Lossless decoder. The bundle is loaded only
when an ALAC M4A/CAF, PCM CAF or AIFF file needs a playback fallback. Source and notices:

- https://github.com/audiocogs/aurora.js
- https://github.com/audiocogs/alac.js

## Bundled Chinese preview fonts

The libass preview includes selected region-specific subset OTFs from Adobe Source Han Sans
`2.005R` (CN Regular, Medium and Heavy) and Source Han Serif `2.003R` (CN Heavy). They are
Copyright 2014–2025 Adobe and licensed under the SIL Open Font License 1.1. The complete
license texts and reproducible source/version hashes are stored in `vendor/fonts/`.

- https://github.com/adobe-fonts/source-han-sans/releases/tag/2.005R
- https://github.com/adobe-fonts/source-han-serif/releases/tag/2.003R

## Runtime libraries

- `mediaplay` — MIT.
- `mediabunny` — Mozilla Public License 2.0.
- `opencc-js` — MIT and Apache-2.0; bundled OpenCC dictionary derivatives retain their
  upstream notices.
- `fengari` — MIT; Lua 5.3 virtual machine used for the browser Automation 4 bridge.
- `nspell` — MIT; Hunspell-compatible spelling engine.
- `dictionary-en` — MIT and BSD; its word list retains the notices distributed by the package.
- `@huggingface/transformers` — Apache-2.0.
- `@jellyfin/libass-wasm` and its compiled components — retain the licenses supplied in their
  distributions.

The exact dependency versions and package license metadata are recorded in `package-lock.json`.
