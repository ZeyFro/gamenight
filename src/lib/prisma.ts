import { PrismaClient, type Prisma } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const testDatabaseUrl = process.env.NODE_ENV !== "production" ? process.env.TEST_DATABASE_URL : undefined;
if (testDatabaseUrl) {
  const url = new URL(testDatabaseUrl);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    throw new Error("TEST_DATABASE_URL doit désigner un PostgreSQL local de recette.");
  }
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const options: Prisma.PrismaClientOptions = testDatabaseUrl
  ? { datasourceUrl: testDatabaseUrl }
  : { adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }) };
export const prisma = globalForPrisma.prisma ?? new PrismaClient(options);

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
