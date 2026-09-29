import { NextResponse } from "next/server";

/** Public GET routes judges and agents curl from other origins. */
export function withCors(res: NextResponse): NextResponse {
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "Content-Type");
  return res;
}

export function corsPreflight(): NextResponse {
  return withCors(new NextResponse(null, { status: 204 }));
}

export function jsonCors(body: unknown, init?: { status?: number }): NextResponse {
  return withCors(NextResponse.json(body, init));
}
