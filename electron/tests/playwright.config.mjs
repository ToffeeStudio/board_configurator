import {defineConfig} from '@playwright/test';

export default defineConfig({testMatch: '**/package.check.mjs', timeout: 45_000, workers: 1});
