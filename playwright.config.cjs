const {defineConfig} = require('@playwright/test');
module.exports = defineConfig({
  testDir: './tests/browser', timeout: 60000, workers: 1,
  use: {baseURL: process.env.LAB_TEST_URL || 'http://127.0.0.1:8080', viewport: {width: 1440, height: 1100}},
});
