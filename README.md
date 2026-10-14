# any-mcp

A local MCP server that lets Claude read and write your **Any** (Anytwo
backend) database through its HTTP API at `http://127.0.0.1:7001/v1`.

This is a plain Node.js stdio MCP server. It only talks to your own
machine's loopback address — nothing here uploads your data anywhere.

## What it can do

Tools exposed to Claude:

- `any_health` — check the server is up
- `any_list_spaces`, `any_create_space`, `any_get_space`
- `any_create_object`, `any_get_object`, `any_delete_object`, `any_query_objects`
- `any_search` — full-text/hybrid search
- `any_read_markdown`, `any_write_markdown`, `any_append_markdown` — read/edit note content
- `any_list_types` — see what object types exist in a space

This is a reasonable starting set (spaces, objects, search, editor content).
It does **not** cover chat, files, ACL/sharing, or agent/bao config — those
can be added the same way if you want them later.

## Requirements

- Node.js 18+ (uses the built-in `fetch`)
- `any` installed and initialized (see `any init` / `any run` from the
  Anytwo quickstart)

## Setup

1. Unzip/copy this folder somewhere permanent, e.g. `~/mcp-servers/any-mcp`.
2. Install dependencies:

   ```sh
   cd ~/mcp-servers/any-mcp
   npm install
   ```

3. Make sure `any` is running in the background:

   ```sh
   any run &
   until any status >/dev/null 2>&1; do sleep 0.2; done
   ```

4. Add it to your Claude Desktop config
   (`~/Library/Application Support/Claude/claude_desktop_config.json` on
   macOS, `%APPDATA%\Claude\claude_desktop_config.json` on Windows):

   ```json
   {
     "mcpServers": {
       "any": {
         "command": "node",
         "args": ["/absolute/path/to/any-mcp/index.js"]
       }
     }
   }
   ```

5. Restart Claude Desktop. You should see "any" listed under connected
   MCP servers, with the tools above available.

### Optional: point at a different port/host

If your `any` server isn't on the default `127.0.0.1:7001`, set an env var
in the config:

```json
{
  "mcpServers": {
    "any": {
      "command": "node",
      "args": ["/absolute/path/to/any-mcp/index.js"],
      "env": { "ANY_API_URL": "http://127.0.0.1:7001/v1" }
    }
  }
}
```

## Notes

- `any_create_object` defaults `type` to `"page"` (the plain document type)
  and lets you pass either a simple `name` or a full `initialProperties` map.
- Deletes are real offline-first tombstones, not just a UI hide — the
  `any_delete_object` tool will actually remove the object.
- The any HTTP API and this wrapper are both a moving target (any is a
  developer preview). If an endpoint's shape changes, check
  `https://docs.any.org/reference/http-api.html` and update `index.js`
  accordingly — it's a plain single-file server, easy to extend.

## Status

Early and untested against a live server. The tool shapes were written from the
HTTP API reference at https://docs.any.org/reference/http-api.html, and Any is a
developer preview, so endpoints may change. Issues and PRs welcome.
