import assert from "node:assert/strict";

export function recetteDatabaseTarget(env = process.env) {
  const required = [
    "GAMENIGHT_RECIPE_PG_CONTAINER",
    "GAMENIGHT_RECIPE_PG_PORT",
    "GAMENIGHT_RECIPE_PG_DATABASE",
  ];
  for (const name of required) {
    assert.ok(typeof env[name] === "string" && env[name].trim(), `Missing recipe PostgreSQL target variable: ${name}`);
  }
  const target = {
    container: env.GAMENIGHT_RECIPE_PG_CONTAINER,
    port: env.GAMENIGHT_RECIPE_PG_PORT,
    database: env.GAMENIGHT_RECIPE_PG_DATABASE,
  };
  assert.match(target.container, /^[A-Za-z0-9][A-Za-z0-9_.-]*$/, "Invalid recipe PostgreSQL container");
  assert.match(target.port, /^[1-9]\d{0,4}$/, "Invalid recipe PostgreSQL port");
  assert.ok(Number(target.port) >= 1 && Number(target.port) <= 65535, "Invalid recipe PostgreSQL port");
  assert.match(target.database, /^[A-Za-z0-9_]+$/, "Invalid recipe PostgreSQL database");
  return target;
}
