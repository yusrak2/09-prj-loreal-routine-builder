# Project 9: L'Oréal Routine Builder

L’Oréal is expanding what’s possible with AI, and now your chatbot is getting smarter. This week, you’ll upgrade it into a product-aware routine builder.

Users will be able to browse real L’Oréal brand products, select the ones they want, and generate a personalized routine using AI. They can also ask follow-up questions about their routine—just like chatting with a real advisor.

## How to run and deploy

1. Serve this folder (e.g., with a static server like `npx serve` or via GitHub Pages).
2. Deploy the included `cloudflare-worker.js` as a Cloudflare Worker and add a secret binding named `OPENAI_API_KEY` to the worker with your OpenAI API key.
   - See Cloudflare docs: https://developers.cloudflare.com/workers/
3. Update `CF_WORKER_URL` at the top of `script.js` with your worker's public URL (for example `https://your-worker.<your-domain>.workers.dev`).
4. Open the site. Select products, click "Generate Routine" and the browser will send the selected products and chat messages to your worker. The OpenAI key is only stored in the worker environment and never exposed to the browser.

## Notes and limitations

- The worker proxies chat requests to OpenAI and asks the model to include a `SOURCES:` section when possible. The model may still hallucinate links — for production use you should add a controlled product URL field or a trusted knowledge source.
- Selected products and recent chat history persist in localStorage on the client and restore on reload.
- RTL support is available via the RTL toggle in the UI (top right of the search area).
