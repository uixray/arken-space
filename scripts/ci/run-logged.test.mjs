import process from "node:process";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { URL } from "node:url";
import { runLogged } from "./run-logged.mjs";
test("captures both streams and preserves failure", async () => {
  const dir = mkdtempSync(join(tmpdir(), "arken-log-"));
  try {
    const path = join(dir, "run.log");
    assert.equal(
      await runLogged(
        process.execPath,
        [
          "-e",
          "console.log('stdout'); console.error('stderr'); process.exit(7)",
        ],
        path,
      ),
      7,
    );
    const text = readFileSync(path, "utf8");
    assert.ok(text.includes("stdout") && text.includes("stderr"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("preserves successful exit", async () => {
  const dir = mkdtempSync(join(tmpdir(), "arken-log-"));
  try {
    assert.equal(
      await runLogged(
        process.execPath,
        ["-e", "process.exit(0)"],
        join(dir, "run.log"),
      ),
      0,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("invalid graceful protocol rejects before opening the log", async () => {
  const dir = mkdtempSync(join(tmpdir(), "arken-log-"));
  try {
    const path = join(dir, "run.log");
    await assert.rejects(
      runLogged(process.execPath, ["-e", "process.exit(0)"], path, {
        gracefulSignal: "SIGKILL",
      }),
      /Unsupported graceful/,
    );
    assert.equal(existsSync(path), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("spawn and log-open errors reject rather than pass", async () => {
  const dir = mkdtempSync(join(tmpdir(), "arken-log-"));
  try {
    await assert.rejects(
      runLogged(join(dir, "missing-command"), [], join(dir, "run.log")),
      /ENOENT/,
    );
    await assert.rejects(
      runLogged(process.execPath, ["-e", "process.exit(0)"], dir),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("captures all large output before returning and removes listeners", async () => {
  const dir = mkdtempSync(join(tmpdir(), "arken-log-"));
  const before = ["SIGINT", "SIGTERM"].map((signal) =>
    process.listenerCount(signal),
  );
  try {
    const path = join(dir, "run.log");
    assert.equal(
      await runLogged(
        process.execPath,
        [
          "-e",
          "process.stdout.write('x'.repeat(256*1024)); process.stderr.write('y'.repeat(256*1024))",
        ],
        path,
      ),
      0,
    );
    const text = readFileSync(path, "utf8");
    assert.equal(text.replaceAll("y", "").length, 256 * 1024);
    assert.equal(text.replaceAll("x", "").length, 256 * 1024);
    assert.deepEqual(
      ["SIGINT", "SIGTERM"].map((signal) => process.listenerCount(signal)),
      before,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

import { existsSync } from "node:fs";
import {
  setInterval,
  clearInterval,
  setTimeout,
  clearTimeout,
} from "node:timers";

for (const [signal, expected] of [
  ["SIGINT", 130],
  ["SIGTERM", 143],
]) {
  test(`${signal} is forwarded, non-PASS, and child is reaped`, async () => {
    const dir = mkdtempSync(join(tmpdir(), "arken-cancel-"));
    const ready = join(dir, "ready");
    let poll;
    let deadline;
    try {
      const result = runLogged(
        process.execPath,
        [
          "-e",
          `const fs=require('node:fs'); process.on('${signal}',()=>{console.error('cleanup'); process.exit(0)}); fs.writeFileSync(${JSON.stringify(ready)},String(process.pid)); setTimeout(()=>process.exit(9),10000)`,
        ],
        join(dir, "run.log"),
      );
      poll = setInterval(() => {
        if (existsSync(ready)) {
          clearInterval(poll);
          // Windows cannot deliver a catchable POSIX signal to the wrapper.
          // Emitting exercises the same wrapper handler without killing test host.
          process.emit(signal);
        }
      }, 20);
      deadline = setTimeout(() => process.emit(signal), 11000);
      assert.equal(await result, expected);
      const pid = Number(readFileSync(ready, "utf8"));
      assert.throws(() => process.kill(pid, 0), /ESRCH/);
      if (process.platform !== "win32")
        assert.match(readFileSync(join(dir, "run.log"), "utf8"), /cleanup/);
    } finally {
      clearInterval(poll);
      clearTimeout(deadline);
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test("child terminated by a signal cannot become success", async () => {
  const dir = mkdtempSync(join(tmpdir(), "arken-log-"));
  try {
    assert.notEqual(
      await runLogged(
        process.execPath,
        ["-e", "process.kill(process.pid, 'SIGKILL')"],
        join(dir, "run.log"),
      ),
      0,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

import { spawnSync } from "node:child_process";

test(
  "cooperative SIGINT preserves first external cancellation and allows cleanup",
  { skip: process.platform === "win32" },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "arken-cooperative-"));
    const ready = join(dir, "ready");
    let poll;
    try {
      const child = `const fs=require('node:fs'); let signals=0; process.on('SIGINT',()=>{if(++signals>1)process.exit(8); setTimeout(()=>{console.log('cleanup done');process.exit(0)},150)}); fs.writeFileSync(${JSON.stringify(ready)},String(process.pid)); setTimeout(()=>process.exit(9),10000)`;
      const result = runLogged(
        process.execPath,
        ["-e", child],
        join(dir, "run.log"),
        {
          gracefulSignal: "SIGINT",
        },
      );
      poll = setInterval(() => {
        if (existsSync(ready)) {
          clearInterval(poll);
          process.emit("SIGTERM");
          process.emit("SIGINT");
          process.emit("SIGTERM");
        }
      }, 20);
      assert.equal(await result, 143);
      assert.match(readFileSync(join(dir, "run.log"), "utf8"), /cleanup done/);
      assert.throws(
        () => process.kill(Number(readFileSync(ready, "utf8")), 0),
        /ESRCH/,
      );
    } finally {
      clearInterval(poll);
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test(
  "unresponsive POSIX runner is forcibly reaped after grace period",
  { skip: process.platform === "win32" },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "arken-force-"));
    const ready = join(dir, "ready");
    let poll;
    try {
      const child = `process.on('SIGINT',()=>{}); require('node:fs').writeFileSync(${JSON.stringify(ready)},String(process.pid)); setTimeout(()=>process.exit(9),12000)`;
      const result = runLogged(
        process.execPath,
        ["-e", child],
        join(dir, "run.log"),
        {
          gracefulSignal: "SIGINT",
        },
      );
      poll = setInterval(() => {
        if (existsSync(ready)) {
          clearInterval(poll);
          process.emit("SIGTERM");
        }
      }, 20);
      assert.equal(await result, 143);
      assert.throws(
        () => process.kill(Number(readFileSync(ready, "utf8")), 0),
        /ESRCH/,
      );
    } finally {
      clearInterval(poll);
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test("tee error rejects and reaps the owned child", () => {
  // Do not inject stream errors into node:test's own reporting transport.
  const fixture = `
    import process from 'node:process';
    import assert from 'node:assert/strict';
    import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
    import { tmpdir } from 'node:os';
    import { join } from 'node:path';
    import { setInterval, clearInterval } from 'node:timers';
    import { runLogged } from ${JSON.stringify(new URL("./run-logged.mjs", import.meta.url).href)};
    const dir = mkdtempSync(join(tmpdir(), 'arken-tee-error-'));
    const ready = join(dir, 'ready');
    let poll;
    try {
      const code = "require('node:fs').writeFileSync(" + JSON.stringify(ready) + ",String(process.pid)); setTimeout(()=>process.exit(9),10000)";
      const result = runLogged(process.execPath, ['-e', code], join(dir, 'run.log'));
      poll = setInterval(() => {
        if (existsSync(ready)) {
          clearInterval(poll);
          process.stdout.emit('error', new Error('synthetic tee failure'));
        }
      }, 20);
      await assert.rejects(result, /synthetic tee failure/);
      assert.throws(() => process.kill(Number(readFileSync(ready, 'utf8')), 0), /ESRCH/);
    } finally {
      clearInterval(poll);
      rmSync(dir, { recursive: true, force: true });
    }
  `;
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", fixture],
    {
      encoding: "utf8",
      timeout: 15000,
    },
  );
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
});

test(
  "cancellation terminates descendants too",
  { skip: process.platform !== "win32" },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "arken-tree-"));
    const ready = join(dir, "ready");
    let poll;
    try {
      const grandchild = `require('node:fs').writeFileSync(${JSON.stringify(ready)},String(process.pid)); setTimeout(()=>process.exit(0),10000)`;
      const child = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(grandchild)}],{stdio:'inherit'}); setTimeout(()=>process.exit(0),10000)`;
      const result = runLogged(
        process.execPath,
        ["-e", child],
        join(dir, "run.log"),
      );
      poll = setInterval(() => {
        if (existsSync(ready)) {
          clearInterval(poll);
          process.emit("SIGTERM");
        }
      }, 20);
      assert.equal(await result, 143);
      assert.throws(
        () => process.kill(Number(readFileSync(ready, "utf8")), 0),
        /ESRCH/,
      );
    } finally {
      clearInterval(poll);
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test(
  "disk write failure is fail-closed",
  { skip: process.platform === "win32" },
  async () => {
    await assert.rejects(
      runLogged(
        process.execPath,
        [
          "-e",
          "console.log('cannot persist'); setTimeout(()=>process.exit(0),10000)",
        ],
        "/dev/full",
      ),
      /ENOSPC/,
    );
  },
);
