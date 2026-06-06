import { NextResponse } from "next/server";
import { safeErrorMessage, sanitizeCategorizationPayload } from "@/lib/data-safety";
import { getOpenAIClient } from "@/lib/openai";

type CategorizeRequest = {
  categories: unknown[];
  rules: unknown[];
  transactions: unknown[];
};

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as CategorizeRequest;
    const openai = getOpenAIClient();
    const sanitizedPayload = sanitizeCategorizationPayload(payload);

    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "You are a careful personal finance categorization agent. You receive sanitized data only. Return JSON with suggestions: transactionId, categoryId, confidence, reason, internalTransfer."
        },
        {
          role: "user",
          content: JSON.stringify(sanitizedPayload)
        }
      ]
    });

    return NextResponse.json(JSON.parse(response.choices[0]?.message.content || "{\"suggestions\":[]}"));
  } catch (error) {
    return NextResponse.json({ error: safeErrorMessage(error, "Unable to categorize transactions") }, { status: 500 });
  }
}
