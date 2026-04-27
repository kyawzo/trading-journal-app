import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

export async function findOwnedPositionForUser(userId: string, positionId: string): Promise<Prisma.PositionGetPayload<Record<string, never>> | null>;
export async function findOwnedPositionForUser<T extends Prisma.PositionInclude>(
  userId: string,
  positionId: string,
  include: T,
): Promise<Prisma.PositionGetPayload<{ include: T }> | null>;
export async function findOwnedPositionForUser<T extends Prisma.PositionInclude>(
  userId: string,
  positionId: string,
  include?: T,
) {
  return prisma.position.findFirst({
    where: {
      id: positionId,
      brokerAccount: {
        is: {
          userId,
        },
      },
    },
    include,
  }) as Promise<Prisma.PositionGetPayload<{ include: T }> | null>;
}

export async function findOwnedHoldingForUser(userId: string, holdingId: string): Promise<Prisma.HoldingGetPayload<Record<string, never>> | null>;
export async function findOwnedHoldingForUser<T extends Prisma.HoldingInclude>(
  userId: string,
  holdingId: string,
  include: T,
): Promise<Prisma.HoldingGetPayload<{ include: T }> | null>;
export async function findOwnedHoldingForUser<T extends Prisma.HoldingInclude>(
  userId: string,
  holdingId: string,
  include?: T,
) {
  return prisma.holding.findFirst({
    where: {
      id: holdingId,
      brokerAccount: {
        is: {
          userId,
        },
      },
    },
    include,
  }) as Promise<Prisma.HoldingGetPayload<{ include: T }> | null>;
}

export async function findOwnedPositionActionForUser(
  userId: string,
  positionId: string,
  actionId: string,
): Promise<Prisma.PositionActionGetPayload<Record<string, never>> | null>;
export async function findOwnedPositionActionForUser<T extends Prisma.PositionActionInclude>(
  userId: string,
  positionId: string,
  actionId: string,
  include: T,
): Promise<Prisma.PositionActionGetPayload<{ include: T }> | null>;
export async function findOwnedPositionActionForUser<T extends Prisma.PositionActionInclude>(
  userId: string,
  positionId: string,
  actionId: string,
  include?: T,
) {
  return prisma.positionAction.findFirst({
    where: {
      id: actionId,
      position: {
        is: {
          id: positionId,
          brokerAccount: {
            is: {
              userId,
            },
          },
        },
      },
    },
    include,
  }) as Promise<Prisma.PositionActionGetPayload<{ include: T }> | null>;
}

export async function findOwnedHoldingEventForUser(
  userId: string,
  holdingId: string,
  eventId: string,
): Promise<Prisma.HoldingEventGetPayload<Record<string, never>> | null>;
export async function findOwnedHoldingEventForUser<T extends Prisma.HoldingEventInclude>(
  userId: string,
  holdingId: string,
  eventId: string,
  include: T,
): Promise<Prisma.HoldingEventGetPayload<{ include: T }> | null>;
export async function findOwnedHoldingEventForUser<T extends Prisma.HoldingEventInclude>(
  userId: string,
  holdingId: string,
  eventId: string,
  include?: T,
) {
  return prisma.holdingEvent.findFirst({
    where: {
      id: eventId,
      holding: {
        is: {
          id: holdingId,
          brokerAccount: {
            is: {
              userId,
            },
          },
        },
      },
    },
    include,
  }) as Promise<Prisma.HoldingEventGetPayload<{ include: T }> | null>;
}
