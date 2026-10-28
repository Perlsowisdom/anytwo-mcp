# anytwo-mcp

A local [MCP](https://modelcontextprotocol.io) server that lets Claude read and
write your **Any** database (the new backend behind Anytwo) through Any's local
HTTP API. It is unofficial: Any's own guide says the server has no MCP endpoint,
so this wraps the HTTP API instead.

It is a single-file Node.js stdio server (`index.js`). It only talks to your own
machine's loopback address, so your data never leaves your computer.

> This is for **Any** (docs.any.org), not the original Anytype app. The existing
> `@anyproto/anytype-mcp` server targets Anytype's API and will not work against
> Any, and this one will not work against Anytype.

## What you need

- **Node.js 18 or newer** (it uses the built-in `fetch`). Check with `node --version`.
- **Any, installed and initialized.** Follow the quickstart at
  https://docs.any.org/ (`any init`, then `any run`). Keep the 12-word recovery
  phrase that `any init` prints; it is the only way to restore the account.
- **Claude Desktop**, or any other MCP client that can launch a local stdio server.

## Install

1. **Get the code.**

   ```sh
   git clone https://github.com/Perlsowisdom/anytwo-mcp.git
   cd anytwo-mcp
   ```

2. **Install dependencies.**

   ```sh
   npm install
   ```

3. **Have Any running.** With the Any desktop app, open it and sign in; that is
   all you need. If you use the standalone `any` binary instead, start it in its
   own terminal window and leave it running. Don't run both on the same account:
   a second server fails with `409 auth.account_in_use`.

   ```sh
   any run
   ```

   In another terminal, confirm it is up:

   ```sh
   any status
   ```

4. **Find the full path to Node and to `index.js`.** Claude Desktop does not
   always see your shell's PATH, so use full paths.

   - Windows: `where node` (for example `C:\Program Files\nodejs\node.exe`)
   - macOS / Linux: `which node`

5. **Add the server to your Claude Desktop config.**

   | OS | Config file |
   | --- | --- |
   | Windows | `%APPDATA%\Claude\claude_desktop_config.json` |
   | macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |

   Add an `any` entry **inside the existing top-level `mcpServers` object**,
   next to any servers you already have:

   Windows (backslashes must be doubled in JSON):

   ```json
   {
     "mcpServers": {
       "any": {
         "command": "C:\\Program Files\\nodejs\\node.exe",
         "args": ["C:\\Users\\YOU\\path\\to\\anytwo-mcp\\index.js"]
       }
     }
   }
   ```

   macOS / Linux:

   ```json
   {
     "mcpServers": {
       "any": {
         "command": "/usr/local/bin/node",
         "args": ["/Users/YOU/path/to/anytwo-mcp/index.js"]
       }
     }
   }
   ```

   There must be only one `mcpServers` key in the file. Putting a second
   `"mcpServers"` inside the first is a common mistake, and Claude Desktop then
   silently ignores the server.

6. **Fully quit and reopen Claude Desktop.** Closing the window is not enough;
   quit from the system tray or menu bar.

7. **Check it works.** In a new chat, ask Claude to run `any_health`, or to
   list your Any spaces. If `any run` is going, you should get a response.

### Finding the server

With `ANY_API_URL` unset, the server tries two addresses, in this order, and
nothing else:

1. `http://127.0.0.1:31330/v1`, the Any desktop app
2. `http://127.0.0.1:7001/v1`, a hand-started `any run` (the address used in the
   docs; Any v0.3.3's release notes mention a default of `2046`, so check the
   address `any run` prints)

If yours is somewhere else, set `ANY_API_URL` in the same config entry:

```json
"any": {
  "command": "node",
  "args": ["/path/to/anytwo-mcp/index.js"],
  "env": { "ANY_API_URL": "http://127.0.0.1:7001/v1" }
}
```

## Authentication

There is no API key or token, and none appears in this code. Any's HTTP API
listens only on loopback, and your identity is the account the server has open
(signed in through the app, or created with `any init`). Any process on your
computer that can reach the server has the same access as the app, so:

- Do not expose the server's port beyond localhost.
- If you point `ANY_API_URL` at a remote host, nothing here protects that traffic.
- If Any later adds tokens, they would go in the request helper in `index.js`
  and should be read from an environment variable, never hard-coded.

## Tools

Each tool is a thin wrapper over one Any HTTP endpoint.

| Tool | Request |
| --- | --- |
| `any_health` | `GET /health` |
| `any_auth_status` | `GET /auth` (read-only: who is signed in) |
| `any_list_spaces` | `GET /spaces` (optionally `?status=all`) |
| `any_create_space` | `POST /spaces` |
| `any_get_space` | `GET /spaces/{spaceId}` |
| `any_list_types` | `GET /spaces/{spaceId}/types` |
| `any_create_object` | `POST /spaces/{spaceId}/objects` |
| `any_get_object` | `GET /spaces/{spaceId}/objects/{objectId}` |
| `any_delete_object` | `DELETE /spaces/{spaceId}/objects/{objectId}` |
| `any_query_objects` | `POST /spaces/{spaceId}/objects/query` |
| `any_search` | `POST /spaces/{spaceId}/search` (optional `mode`: `hybrid`, `fts`, `title`) |
| `any_backlinks` | `GET /backlinks?target=<global any:// URI>` (optional `kind`, `limit`) |
| `any_object_backlinks` | `GET /spaces/{spaceId}/objects/{objectId}/backlinks` (optional `record`, `dataset`, `prop`, `kind`, `limit`) |
| `any_list_datasets` | `GET /spaces/{spaceId}/datasets` |
| `any_query_dataset` | `POST /spaces/{spaceId}/query` with `objectId` and `dataset` |
| `any_chat_find` | `POST /catalog/general-chat/setup` (finds the space's one chat; creates it if missing) |
| `any_chat_read` | `POST /spaces/{spaceId}/query` on the chat's `chat_messages`, newest first |
| `any_chat_send` | `POST /spaces/{spaceId}/objects/{chatId}/chat/messages` as a named agent |
| `any_read_markdown` | `GET /spaces/{spaceId}/objects/{objectId}/editor/{collection}/markdown` |
| `any_write_markdown` | `PUT` the same path (replaces the body) |
| `any_edit_markdown` | `PATCH` the same path with `{edits: [{oldText, newText, replaceAll?}]}` (all or nothing) |
| `any_append_markdown` | `POST` the same path plus `/append` |

Creating a page is two steps: `any_create_object` makes the object and returns
its ID, then `any_write_markdown` or `any_append_markdown` fills in the body.

Asking Bao for a brief works through the chat tools, but Bao only answers in a
space where it has been "seated", and the app has to be open on its active
device. Any's own `bao_space.py` helper (linked from https://any.org/connect)
does the seating on your computer. This server only sends and reads messages.

Not covered yet: files, invites and sharing/ACL, editing or deleting chat
messages, and running or scheduling Bao programs. They
can be added the same way, one `tool(...)` block each in `index.js`.

## Troubleshooting

- **`any` doesn't show up in Claude Desktop.** Check, in order: the config is
  valid JSON with a single `mcpServers` key; the `args` path is the absolute path
  to `index.js`; you ran `npm install` in this folder; you fully quit and
  reopened Claude Desktop. Running `node index.js` in a terminal should sit
  silently waiting for input; if it prints an error and exits, that error is the
  problem. Claude Desktop's logs are in `%APPDATA%\Claude\logs` on Windows and
  `~/Library/Logs/Claude` on macOS.
- **"Could not find a running Any server"** means neither the desktop app
  address nor `7001` answered. Open the Any app (or start `any run`), and set
  `ANY_API_URL` if yours is on another address.
- **`401 auth.required`** means nobody is signed in. Open the app and sign in.
- **An API error such as `any API error 404 ...`** usually means an endpoint
  changed. Compare `index.js` with https://docs.any.org/reference/http-api.html.

## For agents

[`AGENTS.md`](AGENTS.md) holds working rules for an AI agent using this server,
taken from Any's own guide at https://any.org/connect (read, write and approval
rules, how to save knowledge, how to handle conflicts). A short version is also
sent to the client automatically as the server's instructions.

## Notes

- `any_create_object` defaults `type` to `"page"` and accepts either a simple
  `name` or a full `initialProperties` map such as `{"any": {"name": "Dune"}}`.
- Deletes are real tombstones, not a UI hide. `any_delete_object` removes the object.

## Status

Early. `any_health` has been confirmed against a live Any v0.3.3 server. The
other tools were written from the HTTP API reference (checked again on 28
October 2026) and tested only against a mock server, not the real one. Any is a
developer preview, so endpoints may change. Reads and searches that hit
`503 index.not_ready` (a space's search index rebuilding) are retried
automatically. Writes are never retried.
Issues and pull requests are welcome.
