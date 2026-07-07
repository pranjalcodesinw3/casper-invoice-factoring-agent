import OpenAI from "openai";

if (!process.env.OPENROUTER_API_KEY) {
  throw new Error("OPENROUTER_API_KEY environment variable is required");
}

export const ai = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

export async function generateUnderwritingMemo(
  invoice: {
    invoice_id: string;
    debtor_name: string;
    face_value: number;
    days_overdue: number;
  },
  riskReport: {
    debtor: string;
    riskScore: number;
    factors: string[];
  }
): Promise<string> {
  const prompt = `You are an invoice factoring underwriter. Given the invoice and risk assessment, write a brief (2-3 sentences) plain-language underwriting memo explaining the key factors and recommendation.

Invoice:
- ID: ${invoice.invoice_id}
- Debtor: ${invoice.debtor_name}
- Face Value: $${invoice.face_value}
- Days Overdue: ${invoice.days_overdue}

Risk Assessment:
- Risk Score: ${riskReport.riskScore}/100
- Factors: ${riskReport.factors.join(", ")}

Write the memo directly without any preamble or explanation.`;

  const response = await ai.chat.completions.create({
    model: "anthropic/claude-3.5-sonnet",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.3,
    max_tokens: 256,
  });

  const content = response.choices[0].message.content;
  if (!content) throw new Error("Empty response from AI");
  return content;
}
