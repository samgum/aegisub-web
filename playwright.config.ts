import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./playwright",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  reporter: process.env.CI ? "github" : "line",
  use: {
    baseURL: "http://127.0.0.1:4175",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run preview -- --host 127.0.0.1 --port 4175 --strictPort",
    url: "http://127.0.0.1:4175",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [
    { name: "windows-chromium", use: { browserName: "chromium", viewport: { width: 1440, height: 900 } } },
    {
      name: "linux-firefox",
      use: {
        browserName: "firefox",
        viewport: { width: 1366, height: 768 },
        // Keep user-gesture playback deterministic in the headless browser. CI provides a
        // PulseAudio null sink so the real Firefox media clock still has to advance.
        firefoxUserPrefs: {
          "media.autoplay.default": 0,
          "media.autoplay.blocking_policy": 0,
        },
      },
    },
    { name: "macos-webkit", use: { browserName: "webkit", viewport: { width: 1440, height: 900 }, userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15" } },
    { name: "android-chromium", use: { ...devices["Pixel 7"], browserName: "chromium" } },
    { name: "ipad-webkit", use: { ...devices["iPad Pro 11"], browserName: "webkit" } },
    { name: "iphone-webkit", use: { ...devices["iPhone 15"], browserName: "webkit" } },
  ],
});
