import { NextResponse } from "next/server";
import { getCurrentUser, redirectToLoginResponse } from "../../../../../lib/auth";
import { findOwnedPositionForUser } from "../../../../../lib/ownership";
import { prisma } from "../../../../../lib/prisma";

type RouteProps = {
  params: Promise<{ id: string }>;
};

function redirectWithMessage(req: Request, id: string, tone: "success" | "error", message: string) {
  const url = new URL(`/positions/${id}`, req.url);
  url.searchParams.set("tone", tone);
  url.searchParams.set("notice", message);
  return NextResponse.redirect(url);
}

export async function POST(req: Request, { params }: RouteProps) {
  const { id } = await params;
  const user = await getCurrentUser();

  if (!user) {
    return redirectToLoginResponse(req, `/positions/${id}`);
  }

  const form = await req.formData();
  const thesis = form.get("thesis") as string | null;
  const entryPlan = form.get("entryPlan") as string | null;
  const exitPlan = form.get("exitPlan") as string | null;
  const tradeNotes = form.get("tradeNotes") as string | null;

  const position = await findOwnedPositionForUser(user.id, id);

  if (!position) {
    return redirectWithMessage(req, id, "error", "Position not found.");
  }

  await prisma.position.update({
    where: { id },
    data: {
      thesis: thesis || null,
      entryPlan: entryPlan || null,
      exitPlan: exitPlan || null,
      tradeNotes: tradeNotes || null,
    },
  });

  return NextResponse.redirect(new URL(`/positions/${id}`, req.url));
}
