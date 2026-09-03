type EditorHandle = {
  getText(): string;
  getDoc(): { format: string; cues: { startMs: number; endMs: number; text: string }[] };
  runAegisubCommand(command: string): boolean;
};

const editor = (): Cypress.Chainable<EditorHandle> =>
  cy.window().then((window) => (window as unknown as { subHandle: EditorHandle }).subHandle);

function openAss(): void {
  cy.get("#file").selectFile("test-corpus/base.ass", { force: true });
  cy.get(".se-row").should("have.length", 6);
  cy.contains(".se-text", "Hello, world.").should("be.visible");
}

function replaceSelectedText(value: string): void {
  cy.get(".se-detail textarea").then(($textarea) => {
    const textarea = $textarea[0] as HTMLTextAreaElement;
    textarea.value = value;
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("production subtitle workflows", () => {
  it("edits, retimes, previews and round-trips a styled ASS project on desktop", () => {
    cy.viewport(1440, 900);
    cy.visit("/");
    openAss();
    replaceSelectedText("{\\b1}Production-ready edit{\\b0}");
    cy.get(".se-times .se-field input").eq(0).clear().type("00:00:02.000").blur();
    cy.get(".se-times .se-field input").eq(1).clear().type("00:00:05.000").blur();
    editor().then((handle) => {
      expect(handle.getDoc().cues[0]).to.deep.include({ startMs: 2000, endMs: 5000, text: "{\\b1}Production-ready edit{\\b0}" });
    });

    cy.get("#media-file").selectFile("test-corpus/tiny.mp4", { force: true });
    cy.get(".se-has-media", { timeout: 10000 }).should("exist");
    cy.get(".se-right video").should("exist");
    editor().then((handle) => handle.runAegisubCommand("audio/view/spectrum"));
    cy.get('.se-timeline[data-audio-view="spectrum"]', { timeout: 20000 }).should("be.visible");

    editor().then((handle) => {
      const saved = handle.getText();
      expect(saved).to.contain("Production-ready edit");
      cy.get(".se-right video").then(($video) => $video.attr("data-media-identity", "keep"));
      cy.get("#file").selectFile({ contents: Cypress.Buffer.from(saved), fileName: "roundtrip.ass" }, { force: true });
    });
    cy.get(".se-row").should("have.length", 6);
    cy.get('.se-right video[data-media-identity="keep"]').should("exist").and("not.have.attr", "controls");
    editor().then((handle) => {
      expect(handle.getDoc().format).to.equal("ass");
      expect(handle.getDoc().cues[0]).to.deep.include({ startMs: 2000, endMs: 5000, text: "{\\b1}Production-ready edit{\\b0}" });
    });
  });

  it("uses the native Aegisub grid columns and stops/seeks when a row is chosen", () => {
    cy.viewport(1440, 900);
    cy.visit("/");
    openAss();
    cy.get(".se-listhead .se-cell").then(($cells) => {
      expect([...$cells].map((cell) => [...cell.classList].find((name) => name.startsWith("se-") && name !== "se-cell")))
        .to.deep.equal(["se-num", "se-start", "se-end", "se-cps", "se-style", "se-text"]);
    });
    cy.get("#media-file").selectFile("test-corpus/tiny-timing.mp4", { force: true });
    cy.get(".se-right video", { timeout: 10000 }).should("exist");
    cy.get(".se-video-controls button").first().click();
    cy.wait(100);
    cy.get(".se-row").eq(1).click();
    cy.get(".se-right video").then(($video) => {
      const video = $video[0] as HTMLVideoElement;
      expect(video.paused).to.equal(true);
      expect(Math.round(video.currentTime * 1000)).to.equal(4000);
      expect(video.controls).to.equal(false);
    });
  });

  it("shows ASS line breaks as literal \\N in the grid and edit box", () => {
    cy.viewport(1440, 900);
    cy.visit("/");
    openAss();
    cy.get(".se-row").eq(1).click();
    cy.get(".se-detail textarea").should("have.value", "Two lines here\\Nand a second line");
    cy.get(".se-row").eq(1).find(".se-text").should("contain.text", "\\N").and("not.contain.text", "⏎");
    cy.get(".se-detail textarea").then(($textarea) => {
      const textarea = $textarea[0] as HTMLTextAreaElement;
      textarea.value = "First\nSecond";
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      expect(textarea.value).to.equal("First\\NSecond");
    });
    editor().then((handle) => expect(handle.getDoc().cues[1].text).to.equal("First\\NSecond"));
  });

  it("feeds embedded or collected font bytes into the live libass preview", () => {
    cy.viewport(1440, 900);
    cy.visit("/");
    openAss();
    cy.get("#media-file").selectFile("test-corpus/tiny-timing.mp4", { force: true });
    cy.get(".se-playerhost video", { timeout: 10000 }).should("exist");
    editor().then((handle) => handle.runAegisubCommand("tool/font_collector"));
    cy.get('.aw-toolbox input[accept*=".ttf"]').selectFile("demo/public/octopus/default.woff2", { force: true });
    cy.contains(".aw-toolbox button", "嵌入所选字体").click();
    cy.get('.se-root[data-preview-fonts="1"]', { timeout: 10000 }).should("exist");
    cy.get(".se-playerhost video").should("exist").and("not.have.attr", "controls");
    editor().then((handle) => expect(handle.getText()).to.contain("[Fonts]").and.to.contain("fontname: default.woff2"));
  });

  it("completes the same edit/media/audio cycle on a tablet without losing the subtitle editor", () => {
    cy.viewport(820, 1180);
    cy.visit("/");
    openAss();
    cy.get(".se-row").eq(1).click();
    replaceSelectedText("Tablet workflow line");
    cy.get("#media-file").selectFile("test-corpus/tiny.mp4", { force: true });
    cy.get('.se-root[data-mobile-pane="video"] .se-right').should("be.visible");
    editor().then((handle) => handle.runAegisubCommand("audio/view/waveform"));
    cy.get('.se-root[data-mobile-pane="audio"] .se-timeline-wrap').should("be.visible");
    cy.contains(".se-pane-button", "字幕").click();
    cy.get(".se-detail textarea").should("be.visible").and("have.value", "Tablet workflow line");
    editor().then((handle) => expect(handle.getText()).to.contain("Tablet workflow line"));
  });
});
