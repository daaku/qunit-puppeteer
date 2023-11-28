#!/usr/bin/env node
import which from 'which';
import { mkdirp } from 'mkdirp';
import fs from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const onConsole = (msg) => {
  const type = msg.type();
  const prefix = type === 'log' ? '' : `[${type}] `;
  console.log(prefix + msg.text());
};

const terminate = (browser, status = 0) => {
  browser.close();
  process.exit(status);
};

const firstPath = async (choices, msg) => {
  for (const choice of choices) {
    try {
      await fs.stat(choice);
      return choice;
    } catch {
      continue;
    }
  }
  throw new Error(msg);
};

const browserPath = async () => {
  return await firstPath(
    [
      '/usr/bin/chromium',
      '/usr/bin/google-chrome',
      '/usr/bin/brave',
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      await which('chromium', { nothrow: true }),
      await which('google-chrome', { nothrow: true }),
      await which('brave', { nothrow: true }),
    ],
    'no chrome or chromium binary found',
  );
};

const getTimeout = () => {
  if (process.env.TIMEOUT) {
    return parseInt(process.env.TIMEOUT, 10);
  }
  return 5000;
};

const getURI = async () => {
  if (process.env.URI) {
    return process.env.URI;
  }
  const file = await firstPath(
    [
      path.resolve('dist/test/index.html'),
      path.resolve('dist/tests/index.html'),
      path.resolve('test/index.html'),
      path.resolve('tests/index.html'),
    ],
    'could not determine HTML entrypoint',
  );
  return `file://${file}`;
};

const main = async () => {
  const start = Date.now();
  const timeout = getTimeout();
  const uri = await getURI();

  const binary = await browserPath();
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--allow-file-access-from-files'],
    executablePath: binary,
  });

  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(timeout);
  page.on('console', onConsole);

  const timer = setTimeout(() => {
    console.error('Timeout - aborting tests.');
    terminate(browser, 1);
  }, timeout);

  let resolveRunEnd;
  const runEnd = new Promise((resolve) => {
    resolveRunEnd = resolve;
  });
  await page.exposeFunction('HARNESS_RUN_END', (data) => resolveRunEnd(data));
  await page.coverage.startJSCoverage({
    resetOnNavigation: false,
    includeRawScriptCoverage: true,
  });
  await page.goto(uri);

  const { testCounts, runtime } = await runEnd;
  clearTimeout(timer);
  const coverage = await page.coverage.stopJSCoverage();
  const outdir = process.env.NODE_V8_COVERAGE || 'coverage/tmp';
  await mkdirp(outdir);
  await fs.writeFile(
    `${outdir}/out.json`,
    JSON.stringify({
      result: coverage.map((ci) => ci.rawScriptCoverage),
    }),
  );

  const success = testCounts.failed === 0;
  const prefix = success
    ? `✓ passed ${testCounts.passed}`
    : `✗ failed ${testCounts.failed}`;
  const duration = Date.now() - start;
  console.error(
    `${prefix} / ${testCounts.total} (tests: ${Math.floor(
      runtime,
    )}ms / total: ${duration}ms)`,
  );

  terminate(browser, success ? 0 : 1);
};

await main();
