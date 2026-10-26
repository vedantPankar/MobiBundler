import { PrismaClient } from "@prisma/client";

export async function createTestPrisma(): Promise<PrismaClient> {
  return new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL });
}

export async function resetTestDb(prisma: PrismaClient): Promise<void> {
  await prisma.bundleItem.deleteMany();
  await prisma.bundleEvent.deleteMany();
  await prisma.bundle.deleteMany();
  await prisma.shopDiscount.deleteMany();
  await prisma.bundleOrderRevenue.deleteMany();
  await prisma.orderRecord.deleteMany();
  await prisma.revenueSyncState.deleteMany();
}
