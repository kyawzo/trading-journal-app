import { NextResponse } from "next/server";
import { destroyAuthSession } from "@/src/lib/auth";

export async function POST(req: Request) {
  await destroyAuthSession();

  const url = new URL("/login", req.url);
  url.searchParams.set("tone", "success");
  url.searchParams.set("notice", "Signed out successfully.");
  return NextResponse.redirect(url);
}
