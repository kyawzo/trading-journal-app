import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

const emailInput = process.env.PHASE1_USER_EMAIL?.trim().toLowerCase();
const displayName = process.env.PHASE1_USER_DISPLAY_NAME?.trim() || null;
const passwordHash = process.env.PHASE1_PASSWORD_HASH?.trim() || "PHASE1_PLACEHOLDER_HASH";

if (!emailInput) {
  throw new Error("PHASE1_USER_EMAIL is required");
}

const email = emailInput;

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

async function main() {
  const user = await prisma.user.upsert({
    where: { email },
    update: {
      displayName,
      isActive: true,
      passwordHash,
    },
    create: {
      email,
      displayName,
      passwordHash,
    },
  });

  const brokerAccountUpdate = await prisma.brokerAccount.updateMany({
    where: { userId: null },
    data: { userId: user.id },
  });

  await prisma.userPreference.upsert({
    where: { userId: user.id },
    update: {},
    create: {
      userId: user.id,
      themeMode: "LIGHT",
      activeBrokerAccountId: null,
    },
  });

  console.log(`Bootstrapped user ${email}`);
  console.log(`Attached ${brokerAccountUpdate.count} broker account(s) with null user_id to ${user.id}`);
  console.log("Ensured user preference exists with user-scoped defaults.");

  if (passwordHash === "PHASE1_PLACEHOLDER_HASH") {
    console.log("Warning: using placeholder password hash. Replace it once the real auth flow is implemented.");
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
