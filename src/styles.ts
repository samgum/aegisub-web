// The editor stylesheet, injected once. Uses the shared row-height metric so the virtual
// list rows and the CSS agree. Theme variables switch light/dark via prefers-color-scheme.
import { ROW_H } from "./metrics";

let stylesInjected = false;
export function injectStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;
  const css = `
.se-root{--se-bg:#fff;--se-fg:#000;--se-muted:#4d4d4d;--se-border:#bebebe;--se-sel:#ceffe7;--se-sel-fg:#000;--se-head:#a5cfe7;--se-warn:#a85c00;--se-bad:#b51f2c;--se-accent:#2876c7;--se-active:#ff5bef;--se-inframe:#fffdea;--se-comment:#d8def5;--se-left-col:#c4ecc9;--se-row-height:${ROW_H}px;
  display:flex;flex-direction:column;height:100%;min-height:0;position:relative;font-family:"Segoe UI",Tahoma,system-ui,sans-serif;color:var(--se-fg);background:var(--se-bg);font-size:12px;}
.se-toolbar{display:flex;gap:1px;align-items:center;flex-wrap:nowrap;overflow:hidden;padding:2px 4px;border-bottom:1px solid var(--se-border);background:var(--se-head);}
.se-toolbar-hidden .se-toolbar{display:none;}
.se-toolbar>*{flex-shrink:0;}
.se-toolbar>.se-sp{flex:1 1 auto;flex-shrink:1;min-width:0;}
/* Overflow popover for the buttons that don't fit; positioned below the toolbar. */
.se-tb-overflow{position:absolute;right:8px;z-index:30;display:flex;flex-wrap:wrap;gap:6px;align-items:center;max-width:min(320px,80vw);padding:6px;background:var(--se-bg);border:1px solid var(--se-border);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.28);}
.se-tb-overflow[hidden]{display:none;}
.se-toolbar b{font-size:13px;margin-right:6px;}
.se-toolbar .se-sp{flex:1 1 auto;}
.se-tracks{display:flex;gap:4px;align-items:center;padding:4px 8px;border-bottom:1px solid var(--se-border);background:var(--se-head);overflow-x:auto;flex-shrink:0;}
.se-tracks.single{display:none;}
.se-toolbar{flex-shrink:0;}
.se-track{position:relative;display:flex;align-items:center;gap:4px;padding:3px 4px 3px 10px;border:1px solid var(--se-border);border-radius:6px;background:var(--se-bg);white-space:nowrap;flex-shrink:0;overflow:hidden;}
.se-track-add{flex-shrink:0;}
.se-track.on{border-color:var(--se-accent);background:var(--se-sel);color:var(--se-sel-fg);}
.se-track.busy{border-color:var(--se-accent);}
.se-track-prog{position:absolute;left:0;bottom:0;height:2px;background:var(--se-accent);transition:width .2s linear;pointer-events:none;}
.se-track-name{cursor:pointer;font-size:12px;}
.se-jobstrip{display:none;align-items:center;gap:8px;padding:5px 10px;border-bottom:1px solid var(--se-border);background:var(--se-head);flex-shrink:0;}
.se-jobstrip.on{display:flex;}
.se-jobstrip.err .se-job-fill{background:var(--se-bad);}
.se-jobstrip.err .se-job-label{color:var(--se-bad);}
.se-job-label{font-size:12px;color:var(--se-muted);white-space:nowrap;}
.se-job-bar{flex:1 1 auto;height:6px;border-radius:3px;background:var(--se-border);overflow:hidden;}
.se-job-fill{height:100%;background:var(--se-accent);transition:width .2s linear;}
.se-job-btn{border:1px solid var(--se-border);background:var(--se-bg);color:var(--se-fg);cursor:pointer;width:26px;height:24px;border-radius:6px;font-size:12px;line-height:1;flex-shrink:0;}
.se-job-btn:hover{border-color:var(--se-accent);color:var(--se-accent);}
.se-track-x{border:none;background:none;color:var(--se-muted);cursor:pointer;font-size:14px;line-height:1;padding:0 3px;border-radius:4px;}
.se-track-x:hover{color:var(--se-bad);}
.se-track-add{border:1px dashed var(--se-border);background:none;color:var(--se-muted);cursor:pointer;width:24px;height:24px;border-radius:6px;font-size:15px;line-height:1;}
.se-track-add:hover{border-color:var(--se-accent);color:var(--se-accent);}
.se-btn{font:inherit;padding:2px 5px;border:1px solid #a8a8a8;background:linear-gradient(#fff,#e7e7e7);color:var(--se-fg);border-radius:1px;cursor:pointer;}
.se-btn:hover{border-color:#6d91b8;background:#e3f0ff;}
.se-btn:disabled{opacity:.5;cursor:default;}
.se-iconbtn{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;padding:2px;color:var(--se-fg);}
.se-iconbtn:hover{color:var(--se-accent);}
.se-iconbtn.on{color:var(--se-accent);background:var(--se-sel);border-color:var(--se-accent);}
.se-iconbtn svg,.se-native-icon{display:block;max-width:20px;max-height:20px;object-fit:contain;}
.se-count{color:var(--se-muted);font-size:12px;}
.se-pane-switch{display:none;flex:0 0 auto;border-bottom:1px solid var(--se-border);background:var(--se-head);}
.se-pane-button{flex:1;min-height:42px;border:0;border-right:1px solid var(--se-border);background:transparent;color:var(--se-fg);display:flex;align-items:center;justify-content:center;gap:7px;font:600 13px inherit;}
.se-pane-button.on{background:var(--se-bg);box-shadow:inset 0 -3px 0 var(--se-accent);}
.se-pane-button .se-native-icon{width:22px;height:22px;}
.se-body{flex:1 1 auto;display:grid;min-height:0;grid-template-columns:minmax(300px,43%) minmax(360px,57%);grid-template-rows:minmax(210px,1fr) minmax(118px,auto) 22px minmax(150px,.92fr);grid-template-areas:"video audio" "video editor" "gridhead gridhead" "grid grid";}
.se-left{display:contents;}
.se-right{grid-area:video;display:flex;flex-direction:column;min-width:0;min-height:0;background:#000;position:relative;border-right:1px solid var(--se-border);}
.se-root[data-display-mode="audio-subs"] .se-right,.se-root[data-display-mode="subs"] .se-right{display:none;}
.se-root[data-display-mode="video-subs"] .se-timeline-wrap,.se-root[data-display-mode="subs"] .se-timeline-wrap{display:none;}
.se-root[data-display-mode="subs"] .se-body{grid-template-columns:1fr;grid-template-rows:minmax(140px,auto) 22px minmax(180px,1fr);grid-template-areas:"editor" "gridhead" "grid";}
.se-root[data-display-mode="audio-subs"] .se-body{grid-template-columns:1fr;grid-template-rows:minmax(180px,1fr) minmax(118px,auto) 22px minmax(180px,1fr);grid-template-areas:"audio" "editor" "gridhead" "grid";}
.se-root[data-display-mode="video-subs"] .se-body{grid-template-columns:1fr;grid-template-rows:minmax(220px,1fr) minmax(118px,auto) 22px minmax(180px,1fr);grid-template-areas:"video" "editor" "gridhead" "grid";}
.se-listhead,.se-row{display:grid;grid-template-columns:var(--se-grid-columns,32px 82px 82px 38px minmax(180px,1fr));align-items:stretch;gap:0;padding:0;min-width:100%;}
.se-actor{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--se-muted);}
.se-listhead{grid-area:gridhead;height:22px;border:1px solid var(--se-border);border-left:0;border-right:0;color:#000;font-size:12px;text-transform:none;letter-spacing:0;background:var(--se-head);}
.se-listhead .se-num{background:var(--se-head);}
.se-scroll{grid-area:grid;overflow:auto;position:relative;min-height:0;}
.se-inner{position:relative;width:100%;}
.se-inner:focus{outline:none;}
.se-row{position:absolute;left:0;right:0;height:var(--se-row-height);border-bottom:1px solid var(--se-border);cursor:default;box-sizing:border-box;background:#fff;}
.se-row:hover{filter:brightness(.98);}
.se-row.inframe{background:var(--se-inframe);}
.se-row.commented{background:var(--se-comment);}
.se-row.sel{background:var(--se-sel);color:var(--se-sel-fg);box-shadow:none;}
.se-row.sel.commented{background:#d3eeee;}
/* Keyboard focus: ring the selected cue when the list itself is focused. */
.se-inner:focus-visible .se-row.sel{box-shadow:inset 0 0 0 1px var(--se-active);}
/* Where the other people in a shared session are. An inset border rather than a background,
   so it reads on top of the row's own selected/playing colours instead of fighting them. */
.se-row.se-peer{box-shadow:inset 0 0 0 2px var(--se-peer-colour);}
.se-peerflags{position:absolute;right:6px;top:2px;display:flex;gap:3px;max-width:45%;pointer-events:none;}
.se-peerflag{
  font-style:normal;font-size:10px;line-height:14px;padding:0 5px;border-radius:7px;
  color:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}
.se-row.playing:not(.sel){box-shadow:inset 0 0 0 1px #588dcc;}
.se-row.primary{box-shadow:inset 0 0 0 1px var(--se-active);}
.se-row.primary .se-num{color:var(--se-accent);font-weight:600;}
.se-row.commented .se-text{opacity:.5;font-style:italic;}
.se-row.commented .se-num::after{content:" ⊘";color:var(--se-muted);}
.se-cell{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:2px 4px 1px;border-right:1px solid var(--se-border);box-sizing:border-box;line-height:calc(var(--se-row-height) - 4px);}
.se-num{color:#000;background:var(--se-left-col);text-align:center;}
.se-layer,.se-start,.se-end,.se-cps,.se-margin-l,.se-margin-r,.se-margin-v{text-align:center;}
.se-time{font-variant-numeric:tabular-nums;font-size:12px;}
.se-cps.warn{color:var(--se-warn);}
.se-cps.bad{color:var(--se-bad);font-weight:600;}
.se-text{white-space:pre;overflow:hidden;text-overflow:ellipsis;}
.se-detail{grid-area:editor;border-top:1px solid var(--se-border);padding:5px 7px;display:flex;flex-direction:column;gap:4px;background:#efefef;overflow:auto;min-height:0;max-height:230px;}
.se-times{display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;}
.se-cpsinfo{margin-left:auto;font-size:11px;color:var(--se-muted);font-variant-numeric:tabular-nums;padding-bottom:4px;white-space:nowrap;}
.se-cpsinfo.warn{color:var(--se-warn);}
.se-cpsinfo.bad{color:var(--se-bad);font-weight:600;}
.se-field{display:flex;flex-direction:column;gap:2px;font-size:11px;color:var(--se-muted);}
.se-field input{font:inherit;font-variant-numeric:tabular-nums;padding:2px 4px;border:1px solid var(--se-border);border-radius:1px;background:var(--se-bg);color:var(--se-fg);width:104px;}
.se-assbox{display:flex;flex-direction:column;gap:6px;}
.se-assextras{flex-wrap:wrap;}
.se-margins{flex-wrap:wrap;align-items:center;}
.se-grouplabel{font-size:10px;color:var(--se-muted);text-transform:uppercase;letter-spacing:.03em;align-self:center;}
.se-effectgroup{gap:3px;}
.se-effectrow{display:flex;gap:6px;align-items:flex-end;}
.se-effectparams{display:flex;gap:6px;align-items:flex-end;}
.se-effectgroup select,.se-selfield select{font:inherit;padding:3px 6px;border:1px solid var(--se-border);border-radius:5px;background:var(--se-bg);color:var(--se-fg);}
.se-numfield input{width:56px;}
.se-actorfield input,.se-effectfield input{width:100px;}
.se-checkfield{flex-direction:row;align-items:center;gap:5px;}
.se-checkfield input{width:auto;}
.se-stylerow{display:flex;gap:4px;align-items:center;}
.se-stylefield select{font:inherit;padding:3px 6px;border:1px solid var(--se-border);border-radius:5px;background:var(--se-bg);color:var(--se-fg);}
.se-styleedit,.se-styletoggle{padding:3px 6px;}
.se-detail textarea{font:inherit;min-height:54px;resize:vertical;padding:5px;border:1px solid var(--se-border);border-radius:1px;background:var(--se-bg);color:var(--se-fg);}
.se-ai-analysis{align-self:flex-end;padding:3px 10px;color:var(--se-accent);font-weight:700;}
.se-tabs{display:flex;gap:4px;border-bottom:1px solid var(--se-border);}
.se-tab{font:inherit;padding:4px 12px;border:1px solid transparent;border-bottom:none;border-radius:5px 5px 0 0;background:none;color:var(--se-muted);cursor:pointer;}
.se-tab.on{background:var(--se-bg);color:var(--se-fg);border-color:var(--se-border);}
.se-inlinebar{display:flex;gap:5px;align-items:center;flex-wrap:wrap;}
.se-cgroup{display:flex;align-items:center;gap:4px;padding:2px 6px;border:1px solid var(--se-border);border-radius:6px;}
.se-cglabel{color:var(--se-muted);font-size:11px;}
.se-widthfield{width:44px;font:inherit;padding:2px 4px;border:1px solid var(--se-border);border-radius:5px;background:var(--se-bg);color:var(--se-fg);}
.se-alpha{width:54px;}
.se-fontname{width:96px;font:inherit;padding:2px 4px;border:1px solid var(--se-border);border-radius:5px;background:var(--se-bg);color:var(--se-fg);}
.se-inbtn{font:600 12px system-ui;width:26px;height:24px;border:1px solid var(--se-border);border-radius:5px;background:var(--se-bg);color:var(--se-fg);cursor:pointer;}
.se-inbtn:hover{border-color:var(--se-accent);}
.se-in-i{font-style:italic;}
.se-in-u{text-decoration:underline;}
.se-incolor{width:26px;height:24px;padding:0;border:1px solid var(--se-border);border-radius:5px;background:none;cursor:pointer;}
.se-inalign{font:inherit;height:24px;border:1px solid var(--se-border);border-radius:5px;background:var(--se-bg);color:var(--se-fg);}
.se-inbtn.on,.se-posbtn.on{background:var(--se-accent);border-color:var(--se-accent);color:#fff;}
.se-posoverlay{position:absolute;z-index:5;cursor:crosshair;background:rgba(37,99,235,0.08);box-shadow:inset 0 0 0 2px var(--se-accent);}
.se-posdone{position:absolute;top:8px;right:8px;cursor:pointer;font:600 12px system-ui;padding:4px 10px;border:1px solid var(--se-accent);border-radius:6px;background:var(--se-accent);color:#fff;}
.se-poshint{position:absolute;bottom:8px;left:0;right:0;text-align:center;font:600 11px system-ui;color:#fff;text-shadow:0 1px 2px #000;pointer-events:none;}
.se-cliprect{position:absolute;border:1px dashed #fff;background:rgba(255,255,255,0.12);box-shadow:0 0 0 9999px rgba(0,0,0,0.35);pointer-events:none;}
.se-posbar{position:absolute;top:8px;right:8px;display:flex;gap:8px;z-index:1;}
.se-drawcanvas{position:absolute;inset:0;pointer-events:none;}
.se-obtn{cursor:pointer;font:600 12px system-ui;padding:4px 10px;border:1px solid var(--se-border);border-radius:6px;background:var(--se-head);color:var(--se-fg);}
.se-obtn.on,.se-obtn-primary{background:var(--se-accent);border-color:var(--se-accent);color:#fff;}
.se-fadepop{display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;padding:6px;border:1px solid var(--se-border);border-radius:6px;background:var(--se-bg);}
.se-fadepop input{width:70px;}
.se-xgroup{display:flex;flex-wrap:wrap;gap:6px;align-items:flex-end;padding:4px 8px;border:1px solid var(--se-border);border-radius:6px;}
.se-xgroup .se-xglabel{flex-basis:100%;color:var(--se-muted);font-size:11px;}
.se-xform input{width:56px;}
.se-empty,.se-noprev{flex:1 1 auto;display:flex;flex-direction:column;gap:8px;align-items:center;justify-content:center;text-align:center;padding:24px;color:var(--se-muted);}
.se-empty h3{margin:0;color:var(--se-fg);font-size:15px;}
.se-playerhost{flex:1 1 auto;min-height:0;width:100%;height:100%;overflow:hidden;background:#000;position:relative;touch-action:none;}
.se-playerhost .ot-media{overflow:hidden!important;}
.se-playerhost .ot-media-stage{transform-origin:center center;}
.se-playerhost video,.se-playerhost audio{border:0;outline:0;}
.se-media-loading{position:absolute;inset:0;display:grid;place-items:center;color:#ddd;background:#000;font-size:12px;}
.se-video-tools{position:absolute;z-index:13;left:3px;top:3px;display:flex;flex-direction:column;gap:1px;padding:2px;background:rgba(238,238,238,.92);border:1px solid #888;}
.se-video-tool{width:25px;height:25px;background:#efefef;border-color:transparent;}
.se-video-tool.on{background:#b7d7ff;border-color:#2876c7;box-shadow:inset 0 0 0 1px #fff;}
.se-video-controls{position:relative;z-index:13;flex:0 0 32px;display:flex;align-items:center;gap:1px;padding:2px 3px;background:#ededed;border-top:1px solid #888;box-sizing:border-box;}
.se-video-controls .se-iconbtn{flex:0 0 27px;width:27px;height:27px;}
.se-video-scrubber{flex:1 1 auto;min-width:70px;height:18px;margin:0 4px;accent-color:#2876c7;}
.se-video-time{flex:0 0 auto;min-width:112px;text-align:center;color:#222;font:10px ui-monospace,Consolas,monospace;white-space:nowrap;}
.se-video-zoom{flex:0 0 46px;height:25px;padding:0 4px;border:1px solid #aaa;background:linear-gradient(#fff,#e3e3e3);font:11px "Segoe UI",sans-serif;cursor:pointer;}
.se-font-warning{position:absolute;z-index:16;top:5px;right:5px;max-width:min(70%,520px);display:flex;align-items:center;gap:7px;padding:5px 6px;background:rgba(255,245,194,.96);color:#2d2500;border:1px solid #b59a32;box-shadow:1px 2px 5px rgba(0,0,0,.28);font-size:11px;}
.se-font-warning span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.se-font-warning button{flex:0 0 auto;border:1px solid #8c7728;background:linear-gradient(#fffdf1,#ebd986);color:#211b00;padding:2px 7px;cursor:pointer;font:inherit;}
.se-overscan{position:absolute;inset:10%;z-index:12;pointer-events:none;border:1px dashed rgba(255,255,255,.8);box-shadow:0 0 0 9999px rgba(0,0,0,.32);}
.se-vclip-overlay{position:absolute;inset:0;z-index:14;background:rgba(8,14,24,.18);touch-action:none;overflow:hidden;}
.se-vclip-canvas{position:absolute;inset:0;cursor:crosshair;}
.se-vclip-toolbar{position:absolute;top:8px;left:8px;right:8px;display:flex;gap:5px;flex-wrap:wrap;pointer-events:auto;}
.se-vclip-toolbar button{font:600 11px system-ui;padding:5px 8px;border:1px solid rgba(255,255,255,.55);border-radius:6px;background:rgba(12,18,28,.82);color:#fff;cursor:pointer;}
.se-vclip-toolbar button.on{background:var(--se-accent);border-color:var(--se-accent);}
/* Shared fallback styling for small canonical-command dialogs; richer dialog modules may add more. */
.ad-back{position:fixed;inset:0;z-index:1650;background:rgba(0,0,0,.58);display:grid;place-items:center;padding:16px}.ad-modal{width:min(760px,100%);max-height:calc(100dvh - 32px);overflow:auto;background:var(--se-bg,#1d2025);color:var(--se-fg,#e9ebef);border:1px solid var(--se-border,#373b44);border-radius:12px}.ad-head{display:flex;align-items:center;gap:8px;padding:11px 14px;background:var(--se-head,#24272d);border-bottom:1px solid var(--se-border,#373b44)}.ad-head h2{font-size:15px;margin:0;flex:1}.ad-body{padding:14px}.ad-list{display:flex;flex-direction:column;gap:6px}.ad-btn{font:inherit;padding:7px 11px;border:1px solid var(--se-border,#373b44);border-radius:7px;background:var(--se-head,#24272d);color:inherit;cursor:pointer}
.se-timeline-wrap{grid-area:audio;min-width:0;min-height:0;border-bottom:1px solid var(--se-border);background:var(--se-head);position:relative;display:grid;grid-template-rows:minmax(104px,1fr) 31px;overflow:hidden;}
.se-timeline{grid-row:1;min-height:104px;}
.se-audio-controls{grid-row:2;display:flex;align-items:center;gap:1px;padding:2px 4px;background:#ededed;border-top:1px solid #a9a9a9;overflow-x:auto;scrollbar-width:none;}
.se-audio-controls::-webkit-scrollbar{display:none;}
.se-audio-button{flex:0 0 27px;width:27px;height:26px;}
.se-timeline{touch-action:none;cursor:grab;}
.se-wave-status{position:absolute;top:20px;left:10px;z-index:1;font-size:11px;color:var(--se-muted);pointer-events:none;}
/* --- polish --- */
/* Smooth hover/selection transitions. */
.se-btn,.se-iconbtn,.se-row,.se-tab,.se-inbtn,.se-obtn,.se-job-btn,.se-track,.se-track-x,.se-track-add{transition:background-color .12s ease,border-color .12s ease,color .12s ease,box-shadow .12s ease;}
/* One consistent keyboard-focus ring for every interactive control. Mouse clicks don't show
   it (:focus-visible); the cue list opts out and rings its active row instead. */
.se-root :focus-visible{outline:2px solid var(--se-accent);outline-offset:1px;}
.se-inner:focus-visible{outline:none;}
.se-iconbtn:focus-visible,.se-btn:focus-visible{border-radius:6px;}
/* Slim, theme-aware scrollbar for the cue list. */
.se-scroll{scrollbar-width:thin;scrollbar-color:var(--se-border) transparent;}
.se-scroll::-webkit-scrollbar{width:11px;}
.se-scroll::-webkit-scrollbar-thumb{background:var(--se-border);border-radius:6px;border:3px solid var(--se-bg);}
.se-scroll::-webkit-scrollbar-thumb:hover{background:var(--se-muted);}
/* Non-blocking toast, bottom-center, auto-dismissed (no longer hijacks the cue count). */
.se-toast{position:absolute;left:50%;bottom:18px;transform:translate(-50%,10px);z-index:30;max-width:82%;padding:8px 14px;border-radius:8px;background:var(--se-fg);color:var(--se-bg);font-size:12px;line-height:1.35;box-shadow:0 6px 20px rgba(0,0,0,.28);opacity:0;pointer-events:none;transition:opacity .18s ease,transform .18s ease;}
.se-toast.on{opacity:.96;transform:translate(-50%,0);}
/* Find / replace bar. */
.se-findbar{display:flex;gap:6px;align-items:center;flex-wrap:wrap;padding:6px 8px;border-bottom:1px solid var(--se-border);background:var(--se-head);flex-shrink:0;}
.se-findinput{font:inherit;padding:4px 8px;border:1px solid var(--se-border);border-radius:6px;background:var(--se-bg);color:var(--se-fg);min-width:140px;}
.se-findcount{font-size:12px;color:var(--se-muted);font-variant-numeric:tabular-nums;min-width:64px;}
/* Problems panel: floating, top-right of the editor. */
.se-problems{position:absolute;top:8px;right:8px;z-index:25;width:280px;max-height:60%;overflow-y:auto;background:var(--se-bg);border:1px solid var(--se-border);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.28);padding:4px;}
.se-prob-empty{padding:14px;text-align:center;color:var(--se-muted);font-size:12px;}
.se-prob-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 8px 8px;border-bottom:1px solid var(--se-border);margin-bottom:4px;font-size:12px;color:var(--se-muted);}
.se-prob-row{display:flex;gap:8px;align-items:center;padding:6px 8px;border-radius:6px;cursor:pointer;font-size:12px;}
.se-prob-row:hover,.se-prob-row:focus-visible{background:var(--se-head);outline:none;}
.se-prob-idx{color:var(--se-muted);font-variant-numeric:tabular-nums;min-width:22px;text-align:right;}
.se-prob-msg{color:var(--se-warn);}
.se-context-menu{position:fixed;z-index:2200;min-width:228px;max-height:min(620px,calc(100dvh - 8px));overflow:auto;padding:3px;background:#f7f7f7;color:#151515;border:1px solid #777;box-shadow:2px 3px 12px rgba(0,0,0,.32);font:12px "Segoe UI",Tahoma,system-ui,sans-serif;}
.se-context-item{display:block;width:100%;padding:5px 22px;text-align:left;border:0;border-radius:1px;background:transparent;color:inherit;cursor:pointer;white-space:nowrap;}
.se-context-item:hover,.se-context-item:focus-visible{background:#d7eaff;outline:none;}
.se-context-separator{height:1px;margin:3px 2px;background:#aaa;}
/* Tablets use explicit workspaces. Subtitles are the default and always expose both the
   cue grid and the selected-line editor; media never squeezes them into a narrow half-pane. */
@media (max-width: 1100px){
.se-root{--se-row-height:40px;}
.se-pane-switch{display:flex;}
.se-body,.se-root[data-display-mode="subs"] .se-body,.se-root[data-display-mode="audio-subs"] .se-body,.se-root[data-display-mode="video-subs"] .se-body{grid-template-columns:1fr;grid-template-rows:22px minmax(210px,1fr) minmax(190px,auto);grid-template-areas:"gridhead" "grid" "editor";}
.se-root[data-mobile-pane="subtitles"] .se-right,.se-root[data-mobile-pane="subtitles"] .se-timeline-wrap{display:none!important;}
.se-root[data-mobile-pane="video"] .se-body{grid-template-rows:minmax(0,1fr);grid-template-areas:"video";}
.se-root[data-mobile-pane="video"] .se-listhead,.se-root[data-mobile-pane="video"] .se-scroll,.se-root[data-mobile-pane="video"] .se-detail,.se-root[data-mobile-pane="video"] .se-timeline-wrap{display:none!important;}
.se-root[data-mobile-pane="video"] .se-right{display:flex!important;border-right:0;}
.se-root[data-mobile-pane="audio"] .se-body{grid-template-rows:minmax(0,1fr);grid-template-areas:"audio";}
.se-root[data-mobile-pane="audio"] .se-listhead,.se-root[data-mobile-pane="audio"] .se-scroll,.se-root[data-mobile-pane="audio"] .se-detail,.se-root[data-mobile-pane="audio"] .se-right{display:none!important;}
.se-root[data-mobile-pane="audio"] .se-timeline-wrap{display:grid!important;}
.se-detail{max-height:45dvh;min-height:190px;}
.se-btn,.se-inbtn{min-height:34px;}
.se-iconbtn{min-width:36px;min-height:36px;}
.se-field input,.se-stylefield select,.se-effectgroup select,.se-selfield select{min-height:34px;}
.se-detail textarea{min-height:76px;font-size:14px;}
.se-problems{width:auto;left:8px;right:8px;}
}
@media (max-width: 680px){
.se-root{--se-row-height:44px;}
.se-pane-button{min-height:48px;font-size:13px;}
.se-body,.se-root[data-display-mode="subs"] .se-body,.se-root[data-display-mode="audio-subs"] .se-body,.se-root[data-display-mode="video-subs"] .se-body{grid-template-rows:22px minmax(150px,1fr) minmax(210px,46%);grid-template-areas:"gridhead" "grid" "editor";}
.se-listhead,.se-row{grid-template-columns:34px 82px 82px minmax(140px,1fr);}
.se-layer,.se-cps,.se-style,.se-actor,.se-effect,.se-margin-l,.se-margin-r,.se-margin-v{display:none;}
.se-times{gap:6px;}
.se-field input{width:82px;}
.se-detail{max-height:none;min-height:210px;}
.se-noprev{padding:10px;gap:6px;}
.se-noprev>div{display:none;}
.se-video-tools{flex-direction:row;right:3px;overflow-x:auto;}
.se-video-tool{flex:0 0 40px;width:40px;height:40px;}
.se-video-time{display:none;}
.se-video-zoom{flex-basis:42px;}
}
@media (prefers-color-scheme: dark){
.se-root{--se-bg:#1c1d21;--se-fg:#e6e7ea;--se-muted:#9aa0aa;--se-border:#33353b;--se-sel:#1e3a5f;--se-sel-fg:#eaf2ff;--se-head:#25272c;--se-warn:#f59e0b;--se-bad:#f87171;--se-accent:#60a5fa;}
}
:root[data-theme="dark"] .se-root{--se-bg:#1d2025;--se-fg:#e9ebef;--se-muted:#9aa2ae;--se-border:#373b44;--se-sel:#213a5e;--se-sel-fg:#eef5ff;--se-head:#24272d;--se-warn:#f5a524;--se-bad:#ff7373;--se-accent:#62a0ff;}
:root[data-theme="light"] .se-root{--se-bg:#fff;--se-fg:#000;--se-muted:#4d4d4d;--se-border:#bebebe;--se-sel:#ceffe7;--se-sel-fg:#000;--se-head:#a5cfe7;--se-warn:#a95d00;--se-bad:#b4232f;--se-accent:#2876c7;--se-active:#ff5bef;--se-inframe:#fffdea;--se-comment:#d8def5;--se-left-col:#c4ecc9;}
`;
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);
}
