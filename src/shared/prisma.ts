import { PrismaClient } from '../generated/prisma/client.js'

const prismaClient = new PrismaClient()

export const prisma = prismaClient
