#!/usr/bin/env node
// any-mcp: a local MCP server that wraps the "Any" (Anytwo backend) HTTP API
// at http://127.0.0.1:7001/v1 so Claude can read and write your local,
// end-to-end-encrypted Any database through Claude Desktop / Claude Code.
//
// This talks ONLY to your own machine's loopback address. Nothing here
// sends your Any data anywhere else.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE_URL = (process.env.ANY_API_URL || "http://127.0.0.1:7001/v1").replace(/\/+$/, "");

// ---- tiny HTTP helper -------------------------------------------------

async function anyRequest(method, path, body) {
  const url = `${BASE_URL}${path}`;
  const opts = { method, headers: { "content-type": "application/json" } };
  if (body !== undefined) opts.body = JSON.stringify(body);

  // A space's search index can be rebuilding (503 index.not_ready). Retry a few times.
  const maxAttempts = 4;
  let res, text, data;
  for (let attempt = 1; ; attempt++) {
    try {
      res = await fetch(url, opts);
    } catch (err) {
      throw new Error(
        `Could not reach any at ${url} (${err.message}). Is "any run" running on this machine? ` +
          `Newer builds may listen on 127.0.0.1:2046 instead of 7001; set ANY_API_URL if so.`
      );
    }

    text = await res.text();
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }

    const code = data?.error?.code || data?.code;
    if (res.status === 503 && code === "index.not_ready" && attempt < maxAttempts) {
      await new Promise((r) => setTimeout(r, 1000 * attempt));
      continue;
    }
    break;
  }

  if (!res.ok) {
    const code = data?.error?.code || data?.code || res.status;
    const msg = data?.error?.message || data?.message || text || res.statusText;
    throw new Error(`any API error ${res.status} ${code}: ${msg}`);
  }
  return data;
}

const get = (path) => anyRequest("GET", path);
const post = (path, body) => anyRequest("POST", path, body ?? {});
const patch = (path, body) => anyRequest("PATCH", path, body ?? {});
const del = (path) => anyRequest("DELETE", path);

const asText = (obj) => ({
  content: [{ type: "text", text: typeof obj === "string" ? obj : JSON.stringify(obj, null, 2) }],
});

const asError = (err) => ({
  content: [{ type: "text", text: `Error: ${err.message}` }],
  isError: true,
});

// ---- server -------------------------------------------------------------

const server = new McpServer({
  name: "any-mcp",
  version: "0.2.0",
});

function tool(name, description, schema, handler) {
  server.registerTool(
    name,
    { description, inputSchema: schema },
    async (args) => {
      try {
        return await handler(args);
      } catch (err) {
        return asError(err);
      }
    }
  );
}

// --- Meta / health ---

tool(
  "any_health",
  "Check whether the local any server is running and which account (if any) is booted.",
  {},
  async () => asText(await get("/health"))
);

// --- Spaces ---

tool(
  "any_list_spaces",
  "List spaces (workspaces) in the local any database. Active spaces only by default.",
  { includeAll: z.boolean().optional().describe("Include deleted/pending spaces too") },
  async ({ includeAll }) => asText(await get(`/spaces${includeAll ? "?status=all" : ""}`))
);

tool(
  "any_create_space",
  "Create a new space (a container for related objects/notes).",
  {
    name: z.string().describe("Display name for the space"),
    description: z.string().optional(),
  },
  async ({ name, description }) => asText(await post("/spaces", { name, description }))
);

tool(
  "any_get_space",
  "Get details of one space by id.",
  { spaceId: z.string() },
  async ({ spaceId }) => asText(await get(`/spaces/${encodeURIComponent(spaceId)}`))
);

// --- Objects ---

tool(
  "any_create_object",
  "Create a new object (e.g. a page) in a space, optionally with initial properties.",
  {
    spaceId: z.string(),
    type: z.string().default("page").describe('Object type xKey, e.g. "page"'),
    name: z.string().optional().describe("Convenience: sets initialProperties.any.name"),
    initialProperties: z
      .record(z.any())
      .optional()
      .describe('Full initialProperties map keyed by owner, e.g. {"any":{"name":"Dune"}}'),
  },
  async ({ spaceId, type, name, initialProperties }) => {
    const body = { type };
    const props = initialProperties || (name ? { any: { name } } : undefined);
    if (props) body.initialProperties = props;
    return asText(await post(`/spaces/${encodeURIComponent(spaceId)}/objects`, body));
  }
);

tool(
  "any_get_object",
  "Get the raw object row (properties) for one object.",
  { spaceId: z.string(), objectId: z.string() },
  async ({ spaceId, objectId }) =>
    asText(await get(`/spaces/${encodeURIComponent(spaceId)}/objects/${encodeURIComponent(objectId)}`))
);

tool(
  "any_delete_object",
  "Delete (tombstone) an object. This is a real deletion, offline-first.",
  { spaceId: z.string(), objectId: z.string() },
  async ({ spaceId, objectId }) => {
    await del(`/spaces/${encodeURIComponent(spaceId)}/objects/${encodeURIComponent(objectId)}`);
    return asText({ deleted: objectId });
  }
);

tool(
  "any_query_objects",
  "Query objects in a space with a Mongo-style filter, sort and limit.",
  {
    spaceId: z.string(),
    filter: z.record(z.any()).optional().describe('e.g. {"any.type":"page"}'),
    sort: z.array(z.string()).optional().describe('e.g. ["-modifiedAt"]'),
    limit: z.number().int().positive().max(200).optional(),
    offset: z.number().int().nonnegative().optional(),
  },
  async ({ spaceId, filter, sort, limit, offset }) =>
    asText(
      await post(`/spaces/${encodeURIComponent(spaceId)}/objects/query`, {
        filter,
        sort,
        limit: limit ?? 20,
        offset,
        includeTotal: true,
      })
    )
);

// --- Search ---

tool(
  "any_search",
  "Search a space's local index. Title matches come first. Use mode \"title\" to search titles only.",
  {
    spaceId: z.string(),
    query: z.string(),
    limit: z.number().int().positive().max(50).optional(),
    mode: z
      .string()
      .optional()
      .describe('Search mode: "hybrid", "fts" or "title". Omit for the server default.'),
  },
  async ({ spaceId, query, limit, mode }) => {
    const body = { query, limit: limit ?? 10 };
    if (mode) body.mode = mode;
    return asText(await post(`/spaces/${encodeURIComponent(spaceId)}/search`, body));
  }
);

tool(
  "any_backlinks",
  "Find objects across all indexed spaces that mention a given identity. Target looks like any://u/<identity>.",
  { target: z.string().describe("e.g. any://u/<identity>") },
  async ({ target }) => asText(await get(`/backlinks?target=${encodeURIComponent(target)}`))
);

// --- Editor (markdown) ---

tool(
  "any_read_markdown",
  "Read an object's editor content (blocks) rendered as markdown.",
  {
    spaceId: z.string(),
    objectId: z.string(),
    collection: z.string().default("editor_blocks"),
  },
  async ({ spaceId, objectId, collection }) =>
    asText(
      await get(
        `/spaces/${encodeURIComponent(spaceId)}/objects/${encodeURIComponent(objectId)}/editor/${encodeURIComponent(
          collection
        )}/markdown`
      )
    )
);

tool(
  "any_write_markdown",
  "Replace an object's editor content with the given markdown (parses, diffs, applies block ops).",
  {
    spaceId: z.string(),
    objectId: z.string(),
    content: z.string(),
    collection: z.string().default("editor_blocks"),
  },
  async ({ spaceId, objectId, content, collection }) =>
    asText(
      await anyRequest(
        "PUT",
        `/spaces/${encodeURIComponent(spaceId)}/objects/${encodeURIComponent(objectId)}/editor/${encodeURIComponent(
          collection
        )}/markdown`,
        { content }
      )
    )
);

tool(
  "any_edit_markdown",
  "Edit part of an object's editor content by find-and-replace. All edits apply or none do. Each oldText must match exactly once unless replaceAll is true.",
  {
    spaceId: z.string(),
    objectId: z.string(),
    edits: z
      .array(
        z.object({
          oldText: z.string(),
          newText: z.string(),
          replaceAll: z.boolean().optional(),
        })
      )
      .min(1),
    collection: z.string().default("editor_blocks"),
  },
  async ({ spaceId, objectId, edits, collection }) =>
    asText(
      await patch(
        `/spaces/${encodeURIComponent(spaceId)}/objects/${encodeURIComponent(objectId)}/editor/${encodeURIComponent(
          collection
        )}/markdown`,
        { edits }
      )
    )
);

tool(
  "any_append_markdown",
  "Append markdown content to the end of an object's editor content (no diff, fast).",
  {
    spaceId: z.string(),
    objectId: z.string(),
    content: z.string(),
    collection: z.string().default("editor_blocks"),
  },
  async ({ spaceId, objectId, content, collection }) =>
    asText(
      await post(
        `/spaces/${encodeURIComponent(spaceId)}/objects/${encodeURIComponent(objectId)}/editor/${encodeURIComponent(
          collection
        )}/markdown/append`,
        { content }
      )
    )
);

// --- Types (schema introspection) ---

tool(
  "any_list_types",
  "List the object types registered in a space (built-ins plus user-defined types).",
  { spaceId: z.string(), includeHidden: z.boolean().optional() },
  async ({ spaceId, includeHidden }) =>
    asText(
      await get(
        `/spaces/${encodeURIComponent(spaceId)}/types${includeHidden ? "?includeHidden=true" : ""}`
      )
    )
);

// ---- run ----------------------------------------------------------------

const transport = new StdioServerTransport();
await server.connect(transport);
