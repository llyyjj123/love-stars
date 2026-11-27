import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

/**
 * Prisma 7 使用 adapter 模式：连接串在 prisma.config.ts（CLI）和这里（运行时）各配一份。
 * 这里从 DATABASE_URL 读，默认指向本地 5433。
 */
const connectionString =
  process.env.DATABASE_URL ?? 'postgresql://postgres@127.0.0.1:5433/love_stars?schema=public';

const adapter = new PrismaPg({ connectionString });

export const prisma = new PrismaClient({ adapter });

export async function disconnect() {
  await prisma.$disconnect();
}
