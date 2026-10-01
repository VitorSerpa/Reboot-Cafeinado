import assert from "node:assert/strict";
import { test } from "node:test";

import { conferirHash, gerarHash } from "./autenticacao.js";

test("hash da senha confere só com a senha certa", async () => {
  const hash = await gerarHash("uma senha bem longa");
  assert.match(hash, /^scrypt\$16384\$8\$1\$[^$]+\$[^$]+$/);
  assert.equal(await conferirHash("uma senha bem longa", hash), true);
  assert.equal(await conferirHash("uma senha bem longA", hash), false);
});

test("a mesma senha gera hashes diferentes (sal próprio)", async () => {
  assert.notEqual(await gerarHash("mesma senha 123"), await gerarHash("mesma senha 123"));
});

test("hash em formato desconhecido não confere", async () => {
  assert.equal(await conferirHash("qualquer", "md5$abc"), false);
});
