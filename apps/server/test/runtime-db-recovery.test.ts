import assert from "node:assert/strict";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { recoverRuntimeDatabase } from "../src/runtime-db.js";

test("startup recovers an interrupted runtime database transaction", async () => {
  const dir = mkdtempSync(join(tmpdir(), "openwork-recovery-"));
  const path = join(dir, "runtime.sqlite");
  const previous = process.env.OPENWORK_RUNTIME_DB;
  process.env.OPENWORK_RUNTIME_DB = path;
  try {
    const db = new DatabaseSync(path);
    db.exec("CREATE TABLE saved (value TEXT, padding TEXT); WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<200) INSERT INTO saved SELECT 'committed', hex(randomblob(2000)) FROM n");
    db.close();
    const child = spawnSync(process.execPath, ["-e", `
      const { DatabaseSync } = require('node:sqlite');
      const db = new DatabaseSync(process.argv[1]);
      db.exec("PRAGMA cache_size=10; BEGIN IMMEDIATE; UPDATE saved SET value = 'uncommitted'");
      process.exit(0);
    `, path]);
    assert.equal(child.status, 0, child.stderr.toString());
    assert.ok(existsSync(`${path}-journal`));
    const readonly = new DatabaseSync(path, { readOnly: true });
    try { assert.throws(() => readonly.prepare("SELECT * FROM saved").all(), /readonly/i); }
    finally { readonly.close(); }

    await recoverRuntimeDatabase({ configPath: join(dir, "server.json"), readOnly: false });
    const recovered = new DatabaseSync(path, { readOnly: true });
    try { assert.equal(recovered.prepare("SELECT value FROM saved").get()?.value, "committed"); }
    finally { recovered.close(); }
  } finally {
    if (previous === undefined) delete process.env.OPENWORK_RUNTIME_DB;
    else process.env.OPENWORK_RUNTIME_DB = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});
