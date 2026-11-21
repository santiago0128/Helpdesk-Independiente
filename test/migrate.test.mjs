import assert from "node:assert/strict";
import test from "node:test";
import { splitSqlBatches, validateDatabaseName } from "../scripts/migrate.mjs";

test("separa lotes SQL Server por GO", () => {
  assert.deepEqual(
    splitSqlBatches("SELECT 1;\nGO\nSELECT 2;\ngo -- comentario\nSELECT 3;"),
    ["SELECT 1;", "SELECT 2;", "SELECT 3;"],
  );
});

test("acepta un nombre seguro de base de datos", () => {
  assert.equal(validateDatabaseName("GLOBAL_HELPDESK_2"), "GLOBAL_HELPDESK_2");
});

test("rechaza identificadores que podrían alterar el SQL", () => {
  assert.throws(() => validateDatabaseName("helpdesk]; DROP DATABASE master;--"));
});
