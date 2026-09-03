/*
 * Browser bundle entry for Aurora.js 0.4.9 (MIT) + alac.js 0.1.0 (Apache-2.0).
 * The generated bundle is loaded only for ALAC files and exposes the decoder framework
 * through one namespaced global consumed by src/alac.ts.
 */
const AV = require("av");
require("alac");
global.AegisubAuroraAV = AV;
