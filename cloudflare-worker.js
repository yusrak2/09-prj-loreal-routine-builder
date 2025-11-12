// Cloudflare Worker: proxy to OpenAI
// Deploy this file as a Cloudflare Worker and set the secret OPENAI_API_KEY
// Bind the secret to the worker environment as OPENAI_API_KEY.

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method === "OPTIONS") {
    // Handle CORS preflight
    event.respondWith(new Response(null, { headers: CORS_HEADERS }));
    return;
  }
  event.respondWith(handle(event.request));
});

async function handle(request) {
  if (request.method !== "POST") {
    return new Response("Only POST allowed", { status: 405 });
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return new Response("Invalid JSON", { status: 400 });
  }

  // Basic guard: ensure we don't proxy arbitrary things
  const { messages = [], products = [] } = body;

  // Build a system prompt that instructs the model to include sources/citations
  const system = `You are a friendly, concise product routine assistant for L'Or\u00e9al products.
When possible, include verifiable sources or links in a 'SOURCES:' list at the end of your reply.
If you reference product pages, use the product name and brand, and, when no direct URL is available,
list the brand homepage. Keep answers factual and avoid hallucination. Provide step-by-step routine instructions
and short warnings if ingredients may interact.`;

  // Compose the messages to send to OpenAI
  const toSend = [{ role: "system", content: system }].concat(
    messages.map((m) => ({ role: m.role, content: m.content }))
  );

  // Attach product summaries to help the model reference them
  if (products && products.length) {
    const summary = products
      .map((p) => `- ${p.name} (${p.brand}): ${p.description}`)
      .join("\n");
    toSend.push({ role: "system", content: `Product data:\n${summary}` });
  }

  // Call OpenAI's chat completions API
  try {
    const openaiResp = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: "gpt-4o",
          messages: toSend,
          max_tokens: 800,
          temperature: 0.7,
        }),
      }
    );

    if (!openaiResp.ok) {
      const t = await openaiResp.text();
      return new Response("OpenAI error: " + t, { status: 502 });
    }

    const openaiData = await openaiResp.json();
    const reply = openaiData.choices?.[0]?.message?.content || "";

    // Return a simple JSON structure the client expects, include CORS headers for browser calls.
    return new Response(JSON.stringify({ reply }), {
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  } catch (err) {
    return new Response("Worker error: " + String(err), {
      status: 500,
      headers: CORS_HEADERS,
    });
  }
}
