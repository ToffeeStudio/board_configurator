import {defineConfig} from '@playwright/test';

export default defineConfig({testMatch: '**/factory.check.mjs', timeout: 95_000, workers: 1});
