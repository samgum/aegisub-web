# Bundled CJK preview fonts

These files are unmodified region-specific subset OTFs used by the libass preview. They are
copied into the built site by `scripts/copy-octopus-assets.mjs` and fetched only for ASS
documents that contain CJK text or request one of the matching Source Han families.

Sources:

- Source Han Sans 2.005R, asset `19_SourceHanSansCN.zip`:
  https://github.com/adobe-fonts/source-han-sans/releases/download/2.005R/19_SourceHanSansCN.zip
- Source Han Serif 2.003R, asset `14_SourceHanSerifCN.zip`:
  https://github.com/adobe-fonts/source-han-serif/releases/download/2.003R/14_SourceHanSerifCN.zip

SHA-256:

- `SourceHanSansCN-Regular.otf`: `e2bc8a2e7f37474b774fff8db758681ece40bb6947a90d571bce9dd60671a8e4`
- `SourceHanSansCN-Medium.otf`: `a94e558a2fe972bee4f46bce0843abff37063fd68c33f1e7d9058f6f09432b01`
- `SourceHanSansCN-Heavy.otf`: `88c749b0a54a0800124ded6544e399302ed224aa49992ea364b88769f825c54c`
- `SourceHanSerifCN-Heavy.otf`: `053e911fdb1a55d4d8512a1f11203f1fb9a7291e34bc260474b8c80358c69fa6`

All four fonts are licensed under the SIL Open Font License 1.1; the unmodified license texts
from each release are included beside them.
