import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { updateCurrentUserInstructions } from "@/lib/gateway";

type UpdateInstructionsBody = {
  user_instructions?: string | null;
};

function unauthorizedResponse() {
  return NextResponse.json({ detail: "Not authenticated." }, { status: 401 });
}

function normalizeInstructions(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export async function PATCH(request: Request) {
  const session = getSession();

  if (!session) {
    return unauthorizedResponse();
  }

  let body: UpdateInstructionsBody;

  try {
    body = (await request.json()) as UpdateInstructionsBody;
  } catch {
    return NextResponse.json({ detail: "Invalid JSON body." }, { status: 400 });
  }

  try {
    const user = await updateCurrentUserInstructions(
      session,
      normalizeInstructions(body.user_instructions)
    );

    return NextResponse.json(user);
  } catch (error) {
    return NextResponse.json(
      {
        detail:
          error instanceof Error
            ? error.message
            : "No se pudieron guardar las instrucciones del usuario."
      },
      { status: 502 }
    );
  }
}
