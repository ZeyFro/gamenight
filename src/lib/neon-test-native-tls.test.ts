import { expect, it } from "vitest";
import { strictNativeConnection } from "../../scripts/neon-test/native-tls.mjs";

const fixture = new URL("postgresql://migrator:fake@127.0.0.1/neondb");
fixture.hostname = "db.example.test";
const target = fixture.href;
it.each(["require", "verify-full"])("impose le TLS natif et la vérification certificat/hôte pour %s", mode => {
  const url = new URL(strictNativeConnection(`${target}?sslmode=${mode}`));
  expect(url.searchParams.get("sslmode")).toBe("require");
  expect(url.searchParams.get("sslaccept")).toBe("strict");
  expect(url.hostname).toBe("db.example.test");
});
it.each([
  "", "?sslmode=disable", "?sslmode=prefer",
  "?sslmode=require&sslmode=disable", "?sslmode=require&sslaccept=accept_invalid_certs",
  "?sslmode=require&host=other.example.test", "?sslmode=require&sslcert=/tmp/other-ca",
  "?sslmode=require&sslidentity=/tmp/identity", "?sslmode=require&unknown=1",
])("refuse une configuration TLS ou cible ambiguë : %s", suffix => {
  expect(() => strictNativeConnection(target + suffix)).toThrow("NEON_TEST_NATIVE_TLS_CONFIGURATION");
});
it("préserve uniquement les réglages natifs explicitement admis", () => {
  const url = new URL(strictNativeConnection(`${target}?sslmode=require&sslaccept=strict&channel_binding=require&connect_timeout=15`));
  expect(url.searchParams.get("channel_binding")).toBe("require");
  expect(url.searchParams.get("connect_timeout")).toBe("15");
});
