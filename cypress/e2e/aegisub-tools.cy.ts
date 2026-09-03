type Handle = {
  getText(): string;
  getDoc(): { format: string; cues: { startMs: number; endMs: number; text: string }[] };
  runAegisubCommand(command: string): boolean;
};

const handle = (): Cypress.Chainable<Handle> =>
  cy.window().then((window) => (window as unknown as { subHandle: Handle }).subHandle);

const SAMPLE = [
  "1", "00:00:01,000 --> 00:00:01,300", "汉语。  “test”  ", "",
  "2", "00:00:01,350 --> 00:00:04,000", "第二行（未闭合", "",
  "3", "00:00:04,050 --> 00:00:05,000", "最后一行", "",
].join("\n");

function openSample(): void {
  cy.get("#file").selectFile({ contents: Cypress.Buffer.from(SAMPLE), fileName: "tools.srt" }, { force: true });
  cy.get(".se-row").should("have.length", 3);
  cy.contains(".se-text", "汉语").should("be.visible");
}

describe("Aegisub Web application tools", () => {
  beforeEach(() => {
    cy.visit("/");
    openSample();
    cy.get("#tools").click();
    cy.get(".aw-toolbox").should("be.visible");
  });

  it("runs the SGMY common-error repair through the real UI", () => {
    cy.contains(".aw-card", "修复常见错误").within(() => {
      cy.contains("button", "执行修复").click();
    });
    handle().then((editor) => {
      const cues = editor.getDoc().cues;
      expect(cues[0].endMs).to.be.lessThan(cues[1].startMs);
      expect(cues[0].text.endsWith(" ")).to.equal(false);
    });
  });

  it("cleans tags safely and converts Simplified Chinese with bundled OpenCC", () => {
    cy.contains(".aw-tool-nav button", "文字与语言").click();
    cy.contains(".aw-card", "字幕文字清理").within(() => {
      cy.contains("button", "清理").click();
    });
    cy.contains(".aw-card", "简繁转换").within(() => {
      cy.contains("button", "转换").click();
      cy.contains("changed lines:", { timeout: 10000 }).should("be.visible");
    });
    handle().then((editor) => {
      expect(editor.getDoc().cues[0].text).to.contain("漢語");
      expect(editor.getDoc().cues[0].text).to.contain('"test"');
      expect(editor.getDoc().cues[0].text).not.to.contain("  ");
    });
  });

  it("finds punctuation issues and jumps to the affected row", () => {
    cy.contains(".aw-card", "标点与溢出检查").within(() => {
      cy.contains("button", "检查").click();
      cy.get(".aw-result").contains("Unclosed").click();
    });
    cy.get(".se-row").eq(1).should("have.class", "sel");
  });

  it("generates an ASS scrolling-lyrics project", () => {
    cy.contains(".aw-tool-nav button", "ASS 与歌词").click();
    cy.contains(".aw-card", "滚动歌词生成器").within(() => {
      cy.contains("button", "生成滚动项目").click();
    });
    handle().then((editor) => {
      expect(editor.getDoc().format).to.equal("ass");
      expect(editor.getDoc().cues.length).to.be.greaterThan(3);
      expect(editor.getText()).to.contain("AegisubWeb Current");
    });
  });
});

describe("mobile and installable shell", () => {
  it("keeps the editor and toolbox operable at an iPhone-sized viewport", () => {
    cy.viewport(390, 844);
    cy.visit("/");
    cy.get("#editor").should("be.visible");
    cy.get("#tools").click();
    cy.get(".aw-toolbox").should("be.visible").then(($toolbox) => {
      expect($toolbox[0].getBoundingClientRect().width).to.be.at.most(390);
    });
    cy.document().then((document) => {
      expect(document.documentElement.scrollWidth).to.be.at.most(390);
      expect(getComputedStyle(document.querySelector<HTMLElement>("#filename")!).display).to.equal("none");
      for (const button of document.querySelectorAll<HTMLElement>(".menu-button")) {
        expect(button.getBoundingClientRect().height).to.be.at.most(30);
        expect(getComputedStyle(button).whiteSpace).to.equal("nowrap");
      }
    });
  });

  it("ships a valid manifest and offline worker", () => {
    cy.request("/manifest.webmanifest").its("body").then((body) => {
      const manifest = typeof body === "string" ? JSON.parse(body) : body;
      expect(manifest.name).to.equal("Aegisub Web");
      expect(manifest.display).to.equal("standalone");
      expect(manifest.file_handlers[0].accept["text/plain"]).to.include.members([".ass", ".json3", ".txt"]);
      expect(manifest.file_handlers[0].accept["audio/ogg"]).to.include.members([".ogg", ".opus"]);
      expect(manifest.file_handlers[0].accept["audio/mp4"]).to.include.members([".m4a", ".alac"]);
    });
    cy.request("/sw.js").then((response) => {
      expect(response.status).to.equal(200);
      expect(response.body).to.contain("aegisub-web-shell-v9");
    });
  });

  it("uses the original Aegisub artwork without promotional architecture badges", () => {
    cy.visit("/");
    cy.get('.quickbar img[src*="aegisub-icons/"]').should("have.length.at.least", 15);
    cy.get('img.brand-mark[src$="icon.svg"]').should("be.visible");
    cy.get("body").should("not.contain.text", "纯前端").and("not.contain.text", "仅在此设备处理");
    cy.request("/aegisub-icons/save_toolbutton.svg").its("status").should("equal", 200);
  });

  it("opens a subtitle delivered through the installed-PWA launch queue", () => {
    let consumer: ((params: { files: { getFile(): Promise<File> }[] }) => void | Promise<void>) | undefined;
    cy.visit("/", {
      onBeforeLoad(window) {
        Object.defineProperty(window, "launchQueue", { value: { setConsumer: (callback: typeof consumer) => { consumer = callback; } } });
      },
    });
    cy.then(async () => {
      await consumer?.({ files: [{ getFile: async () => new File([SAMPLE], "launched.srt", { type: "text/plain" }) }] });
    });
    cy.contains("#filename", "launched.srt").should("exist");
    cy.get(".se-row").should("have.length", 3);
  });
});

describe("native Aegisub responsive workspace", () => {
  it("keeps the subtitle grid and line editor visible and editable on an iPad-sized viewport", () => {
    cy.viewport(820, 1180);
    cy.visit("/");
    openSample();
    cy.get('.se-root[data-mobile-pane="subtitles"]').should("exist");
    cy.get(".se-pane-switch").should("be.visible");
    cy.get(".se-scroll").should("be.visible").then(($grid) => {
      expect($grid[0].getBoundingClientRect().height).to.be.greaterThan(220);
    });
    cy.get(".se-detail textarea").should("be.visible").clear().type("平板上可以直接修改字幕");
    handle().then((editor) => expect(editor.getDoc().cues[0].text).to.equal("平板上可以直接修改字幕"));
    cy.contains(".se-pane-button", "视频").click();
    cy.get('.se-root[data-mobile-pane="video"] .se-right').should("be.visible");
    cy.contains(".se-pane-button", "字幕").click();
    cy.get(".se-detail textarea").should("have.value", "平板上可以直接修改字幕");
  });

  it("keeps subtitle editing as the default workspace on an Android phone-sized viewport", () => {
    cy.viewport(412, 915);
    cy.visit("/");
    openSample();
    cy.get('.se-root[data-mobile-pane="subtitles"] .se-scroll').should("be.visible");
    cy.get(".se-detail textarea").should("be.visible").clear().type("Android edit works");
    handle().then((editor) => expect(editor.getDoc().cues[0].text).to.equal("Android edit works"));
  });

  it("matches the native desktop hierarchy: video left, audio and editor right, grid below", () => {
    cy.viewport(1440, 900);
    cy.visit("/");
    openSample();
    cy.get(".se-pane-switch").should("not.be.visible");
    cy.get(".se-body").then(($body) => {
      const body = $body[0].getBoundingClientRect();
      const video = $body.find(".se-right")[0].getBoundingClientRect();
      const audio = $body.find(".se-timeline-wrap")[0].getBoundingClientRect();
      const editor = $body.find(".se-detail")[0].getBoundingClientRect();
      const header = $body.find(".se-listhead")[0].getBoundingClientRect();
      const grid = $body.find(".se-scroll")[0].getBoundingClientRect();
      expect(video.left).to.be.lessThan(audio.left);
      expect(Math.abs(video.top - audio.top)).to.be.lessThan(3);
      expect(editor.left).to.be.at.least(audio.left - 2);
      expect(editor.top).to.be.at.least(audio.bottom - 2);
      expect(header.top).to.be.at.least(editor.bottom - 3);
      expect(grid.width).to.be.greaterThan(body.width * .95);
      expect($body.find(".se-row")[0].getBoundingClientRect().height).to.be.at.most(28);
    });
  });

  it("shows and hides the actual main Aegisub toolbar", () => {
    cy.viewport(1440, 900);
    cy.visit("/");
    handle().then((editor) => editor.runAegisubCommand("app/toggle/toolbar"));
    cy.get(".quickbar").should("not.be.visible");
    cy.get("#app").should("have.class", "toolbar-hidden");
    handle().then((editor) => editor.runAegisubCommand("app/toggle/toolbar"));
    cy.get(".quickbar").should("be.visible");
  });
});

describe("upstream command compatibility", () => {
  beforeEach(() => {
    cy.visit("/");
    openSample();
  });

  it("opens the full shift/select/paste-over dialogs from canonical ids", () => {
    handle().then((editor) => editor.runAegisubCommand("time/shift"));
    cy.get(".ad-modal").should("contain.text", "Shift Times");
    cy.get(".ad-head button").click();
    handle().then((editor) => editor.runAegisubCommand("tool/line/select"));
    cy.get(".ad-modal").should("contain.text", "Select Lines");
    cy.get(".ad-head button").click();
    handle().then((editor) => {
      editor.runAegisubCommand("edit/line/copy");
      editor.runAegisubCommand("edit/line/paste/over");
    });
    cy.get(".ad-modal").should("contain.text", "Select Fields to Paste Over");
  });

  it("routes toolbox commands straight to their owning feature page", () => {
    const checks: [string, string][] = [
      ["subtitle/attachment", "ass"],
      ["tool/text/chinese_convert", "language"],
      ["tool/time/stitch", "timing"],
      ["am/manager", "automation"],
      ["tool/time/fix_common_errors", "qa"],
    ];
    for (const [command, page] of checks) {
      handle().then((editor) => expect(editor.runAegisubCommand(command)).to.equal(true));
      cy.get(`.aw-tool-page[data-page="${page}"]`).should("have.class", "on");
      cy.contains(".aw-tool-head button", "关闭").click();
    }
  });

  it("honours the upstream Medusa global audio-hotkey toggle", () => {
    cy.window().then((window) => {
      window.localStorage.setItem("aegisub-web.global-hotkeys", "false");
      expect((window as unknown as { subHandle: Handle }).subHandle.runAegisubCommand("app/toggle/global_hotkeys")).to.equal(true);
    });
    cy.get(".se-root").trigger("keydown", { key: "x", code: "KeyX" });
    cy.get(".se-row").eq(1).should("have.class", "sel");
    handle().then((editor) => editor.runAegisubCommand("app/toggle/global_hotkeys"));
    cy.get(".se-root").trigger("keydown", { key: "x", code: "KeyX" });
    cy.get(".se-row").eq(1).should("have.class", "sel");
  });

  it("runs a real Aegisub Lua macro through the Automation 4 bridge", () => {
    cy.get("#tools").click();
    cy.contains(".aw-tool-nav button", "自动化扩展").click();
    const lua = [
      'script_name = "Append marker"',
      'aegisub.register_macro("Append marker", "test", function(subs, sel, active)',
      '  for _, i in ipairs(sel) do',
      '    if subs[i].class == "dialogue" then subs[i].text = subs[i].text .. " [lua]" end',
      '  end',
      'end)',
    ].join("\n");
    cy.contains(".aw-card", "JavaScript 自动化桥").within(() => {
      cy.get('input[type="file"]').selectFile({ contents: Cypress.Buffer.from(lua), fileName: "append.lua" }, { force: true });
      cy.contains("button", "运行扩展").click();
      cy.contains("Lua Automation completed", { timeout: 10000 }).should("be.visible");
    });
    handle().then((editor) => expect(editor.getDoc().cues[0].text).to.contain("[lua]"));
  });

  it("opens styling, translation, spellcheck, AI and vector-clip interfaces", () => {
    handle().then((editor) => editor.runAegisubCommand("tool/style/assistant"));
    cy.get(".aa-modal").should("contain.text", "Styling Assistant");
    cy.get(".aa-head button").click({ force: true });
    handle().then((editor) => editor.runAegisubCommand("tool/translation_assistant"));
    cy.get(".aa-modal").should("contain.text", "Translation Assistant");
    cy.get(".aa-head button").click({ force: true });
    handle().then((editor) => editor.runAegisubCommand("subtitle/spellcheck"));
    cy.get(".sp-modal", { timeout: 10000 }).should("contain.text", "Spell Checker");
    cy.get(".sp-head button").click({ force: true });
    handle().then((editor) => editor.runAegisubCommand("tool/ai/analysis_settings"));
    cy.get(".ai-modal").should("contain.text", "AI Grammar Analysis Settings");
    cy.get(".ai-head button").click({ force: true });

    cy.get("#media-file").selectFile("test-corpus/tiny.mp4", { force: true });
    cy.get(".se-playerhost video", { timeout: 10000 }).should("exist");
    handle().then((editor) => editor.runAegisubCommand("video/tool/vector_clip"));
    cy.get(".se-vclip-overlay").should("be.visible");
    cy.get(".se-vclip-toolbar").contains("Line").click();
    cy.get(".se-vclip-canvas").click(200, 150);
    handle().then((editor) => expect(editor.getText()).to.contain("\\clip("));
  });

  it("generates long dummy media with WebCodecs", () => {
    handle().then((editor) => expect(editor.runAegisubCommand("video/open/dummy")).to.equal(true));
    cy.get('.ad-modal input[type="number"]').eq(0).clear().type("640");
    cy.get('.ad-modal input[type="number"]').eq(1).clear().type("360");
    cy.get('.ad-modal input[type="number"]').eq(2).clear().type("120");
    cy.get('.ad-modal input[type="number"]').eq(3).clear().type("24");
    cy.contains(".ad-foot button", "创建").click();
    cy.get('.se-root[data-dummy-status="ready"]', { timeout: 20000 }).should("exist");
    cy.get("video").should(($video) => expect(($video[0] as HTMLVideoElement).duration).to.be.greaterThan(100));
  });

  it("decodes audio and renders a real FFT spectrum", () => {
    cy.get("#media-file").selectFile("test-corpus/tiny.mp4", { force: true });
    cy.get(".se-has-media", { timeout: 10000 }).should("exist");
    handle().then((editor) => editor.runAegisubCommand("audio/view/spectrum"));
    cy.get('.se-timeline[data-audio-view="spectrum"]', { timeout: 20000 }).should("be.visible");
    handle().then((editor) => editor.runAegisubCommand("audio/view/waveform"));
    cy.get('.se-timeline[data-audio-view="waveform"]').should("be.visible");
  });
});
