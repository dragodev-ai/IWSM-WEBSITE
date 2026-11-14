'use strict';
const http = require('node:http'), path = require('node:path'), fs = require('node:fs'), { spawn } = require('node:child_process');

function health() {
  return new Promise(resolve => {
    const req = http.get('http://127.0.0.1:4180/api/aliceblue/health', { timeout: 5000 }, res => {
      let text = '';
      res.on('data', chunk => {
        text += chunk;
        if (text.length > 4096) req.destroy();
      });
      res.on('end', () => {
        try {
          const svc = JSON.parse(text).service;
          resolve(res.statusCode === 200 && (svc === 'iwsm-market-data' || svc === 'aliceblue-read-only'));
        } catch {
          resolve(false);
        }
      });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
  });
}

function launch() {
  const folder = path.resolve(__dirname, '../backend/aliceblue');
  const python = path.join(folder, '.venv/Scripts/python.exe');
  if (!fs.existsSync(python)) throw Error('Market-data local Python environment is unavailable');
  const child = spawn(python, [path.join(folder, 'run_local.py')], {
    cwd: folder,
    windowsHide: true,
    stdio: 'ignore',
  });
  child.on('error', () => {});
  child.unref();
}

function createSupervisor({
  health: check = health,
  launch: start = launch,
  delay = ms => new Promise(r => setTimeout(r, ms)),
  attempts = 48,
} = {}) {
  let pending = null, lastLaunch = 0, healthyUntil = 0;
  return {
    invalidate() {
      healthyUntil = 0;
    },
    ensure() {
      if (Date.now() < healthyUntil) return Promise.resolve();
      if (pending) return pending;
      pending = (async () => {
        if (await check()) {
          healthyUntil = Date.now() + 15000;
          return;
        }
        if (Date.now() - lastLaunch < 8000) {
          for (let i = 0; i < 20; i++) {
            await delay(250);
            if (await check()) {
              healthyUntil = Date.now() + 15000;
              return;
            }
          }
          throw Error('Market-data backend unavailable; retry shortly');
        }
        lastLaunch = Date.now();
        start();
        for (let i = 0; i < attempts; i++) {
          await delay(250);
          if (await check()) {
            healthyUntil = Date.now() + 15000;
            return;
          }
        }
        throw Error('Market-data backend unavailable; check the local Python environment');
      })().finally(() => {
        pending = null;
      });
      return pending;
    },
  };
}

module.exports = { createSupervisor };
