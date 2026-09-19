/**
 * Exa MCP extension for pi — minimal implementation.
 *
 * Registers `web_search_exa` and `web_fetch_exa`, calling Exa's stateless MCP
 * endpoint (https://mcp.exa.ai/mcp) over JSON-RPC/HTTP with SSE-framed
 * responses. Set `EXA_API_KEY` to lift the free-tier rate limit
 * (https://dashboard.exa.ai/api-keys).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const DEFAULT_MCP_URL = "https://mcp.exa.ai/mcp";

/** Resolve the endpoint, appending `EXA_API_KEY` when set (read per call). */
function endpoint(): string {
  const apiKey = process.env.EXA_API_KEY;
  return apiKey ? `${DEFAULT_MCP_URL}?exaApiKey=${encodeURIComponent(apiKey)}` : DEFAULT_MCP_URL;
}

interface McpResponse {
  result?: { content?: { type?: string; text?: string }[]; isError?: boolean };
  error?: { message?: string };
}

/** Call an MCP tool and return the decoded text of its result. */
async function callTool(name: string, args: unknown): Promise<string> {
  const response = await fetch(endpoint(), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-11-25",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  if (!response.ok) throw new Error(`Exa MCP HTTP ${response.status}`);

  const line = (await response.text())
    .split("\n")
    .find((entry) => entry.trim().startsWith("data:"));
  const message = JSON.parse(line?.slice(line.indexOf("data:") + 5).trim() || "{}") as McpResponse;
  if (message.error) throw new Error(message.error.message || "Exa MCP returned an error");

  const text = (message.result?.content ?? []).map((block) => block.text ?? "").join("\n");
  if (message.result?.isError) throw new Error(text || `Exa tool ${name} returned an error`);
  return text;
}

/** Wire the Exa tools into pi. */
export default function exaMcpExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "web_search_exa",
    label: "Web Search (Exa)",
    description: "Search the web for current information, news, and facts.",
    parameters: Type.Object({
      query: Type.String({ description: "Natural language search query." }),
      numResults: Type.Optional(
        Type.Integer({ minimum: 1, maximum: 100, description: "Number of results (default 10, max 100)." }),
      ),
    }),
    execute: async (_toolCallId, params) => ({
      content: [
        {
          type: "text",
          text: await callTool("web_search_exa", {
            query: params.query,
            numResults: params.numResults ?? 10,
          }),
        },
      ],
      details: undefined,
    }),
  });

  pi.registerTool({
    name: "web_fetch_exa",
    label: "Web Fetch (Exa)",
    description: "Fetch page content as clean markdown.",
    parameters: Type.Object({
      urls: Type.Array(Type.String({ pattern: "^https?://", description: "A URL to read." }), {
        minItems: 1,
        maxItems: 20,
        description: "URLs to read (1-20).",
      }),
      maxCharacters: Type.Optional(
        Type.Integer({ minimum: 100, maximum: 100_000, description: "Max characters per page (default 3000, max 100000)." }),
      ),
    }),
    execute: async (_toolCallId, params) => ({
      content: [
        {
          type: "text",
          text: await callTool("web_fetch_exa", {
            urls: params.urls,
            maxCharacters: params.maxCharacters ?? 3000,
          }),
        },
      ],
      details: undefined,
    }),
  });
}
