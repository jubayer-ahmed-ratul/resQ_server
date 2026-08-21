/**
 * Seed script to create default users for the hackathon demo.
 * 
 * Run with:
 *   npx ts-node seed-users.ts
 */

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();
const SALT_ROUNDS = 12;

async function seed() {
  console.log('🌱 Seeding default users...');

  try {
    // 1. ADMIN (main admin)
    const adminPassword = await bcrypt.hash('AdminPassword123!', SALT_ROUNDS);
    const admin = await prisma.user.upsert({
      where: { email: 'admin@resq.com' },
      update: {},
      create: {
        name: 'System Admin',
        email: 'admin@resq.com',
        password: adminPassword,
        role: 'ADMIN',
      },
    });
    console.log(`✅ ADMIN: ${admin.email} (password: AdminPassword123!)`);

    // 2. COORDINATOR
    const coordPassword = await bcrypt.hash('Coordinator123!', SALT_ROUNDS);
    const coordinator = await prisma.user.upsert({
      where: { email: 'coordinator@resq.com' },
      update: {},
      create: {
        name: 'Emergency Coordinator',
        email: 'coordinator@resq.com',
        password: coordPassword,
        role: 'COORDINATOR',
      },
    });
    console.log(`✅ COORDINATOR: ${coordinator.email} (password: Coordinator123!)`);

    // 3. OPERATOR
    const operatorPassword = await bcrypt.hash('Operator123!', SALT_ROUNDS);
    const operator = await prisma.user.upsert({
      where: { email: 'operator@resq.com' },
      update: {},
      create: {
        name: 'Field Operator',
        email: 'operator@resq.com',
        password: operatorPassword,
        role: 'OPERATOR',
      },
    });
    console.log(`✅ OPERATOR: ${operator.email} (password: Operator123!)`);

    // 4. CITIZEN (self-register example)
    const citizenPassword = await bcrypt.hash('Citizen123!', SALT_ROUNDS);
    const citizen = await prisma.user.upsert({
      where: { email: 'citizen@resq.com' },
      update: {},
      create: {
        name: 'John Citizen',
        email: 'citizen@resq.com',
        password: citizenPassword,
        role: 'CITIZEN',
      },
    });
    console.log(`✅ CITIZEN: ${citizen.email} (password: Citizen123!)`);

    console.log('\n🎉 Seeding complete! Use these credentials to login.');
    console.log('=========================================================');
    console.log('ADMIN:       email=admin@resq.com       password=AdminPassword123!');
    console.log('COORDINATOR: email=coordinator@resq.com password=Coordinator123!');
    console.log('OPERATOR:    email=operator@resq.com    password=Operator123!');
    console.log('CITIZEN:     email=citizen@resq.com     password=Citizen123!');
    console.log('=========================================================');
  } catch (error) {
    console.error('❌ Seed failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

seed();
