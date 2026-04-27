import { ThemeMode } from "@prisma/client";
import { getCurrentUser } from "./auth";
import { prisma } from "./prisma";

type BrokerLabelTarget = {
  accountName: string;
  broker: { brokerName: string } | null;
} | null | undefined;

function getDefaultWorkspacePreference() {
  return {
    themeMode: ThemeMode.LIGHT,
    activeBrokerAccountId: null,
    activeBrokerAccount: null,
  };
}

export async function getWorkspacePreference() {
  const user = await getCurrentUser();

  if (!user) {
    return getDefaultWorkspacePreference();
  }

  const preference = await prisma.userPreference.upsert({
    where: { userId: user.id },
    update: {},
    create: { userId: user.id },
    include: {
      activeBrokerAccount: {
        include: {
          broker: true,
        },
      },
    },
  });

  if (
    preference.activeBrokerAccountId &&
    (!preference.activeBrokerAccount || preference.activeBrokerAccount.userId !== user.id || !preference.activeBrokerAccount.isActive)
  ) {
    return prisma.userPreference.update({
      where: { userId: user.id },
      data: { activeBrokerAccountId: null },
      include: {
        activeBrokerAccount: {
          include: {
            broker: true,
          },
        },
      },
    });
  }

  return preference;
}

export function getBrokerScopedWhere(activeBrokerAccountId: string | null | undefined) {
  return activeBrokerAccountId
    ? { brokerAccountId: activeBrokerAccountId }
    : { brokerAccountId: { in: [] as string[] } };
}

export function formatBrokerAccountLabel(brokerAccount: BrokerLabelTarget) {
  if (!brokerAccount) {
    return "All Broker Accounts";
  }

  return `${brokerAccount.broker?.brokerName ?? "Broker"} · ${brokerAccount.accountName}`;
}

export function formatActiveBrokerLabel(activeBrokerAccount: BrokerLabelTarget) {
  return formatBrokerAccountLabel(activeBrokerAccount);
}

export function themeModeToAttribute(themeMode: string) {
  return themeMode.toLowerCase() === "dark" ? "dark" : "light";
}
