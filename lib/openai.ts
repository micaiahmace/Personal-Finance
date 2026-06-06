import OpenAI from "openai";

export function getOpenAIClient() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("Missing OPENAI_API_KEY in .env");
  }

  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}
