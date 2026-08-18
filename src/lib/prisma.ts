import { PrismaClient } from '@prisma/client';

// Reusable PrismaClient singleton.
// In development, prevent multiple instances from being created
// due to hot-reloading (ts-node-dev rebuilds the module on change).
declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

const prisma: PrismaClient = global.__prisma ?? new PrismaClient();

if (process.env['NODE_ENV'] !== 'production') {
  global.__prisma = prisma;
}

export default prisma;
