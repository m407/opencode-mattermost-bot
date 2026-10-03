# Mattermost adapter

`src/mattermost/` is a standalone transport adapter, independent of grammY and the
Telegram configuration. It uses native Node fetch and the existing `ws` dependency.
The package exposes it as `@grinev/opencode-telegram-bot/mattermost`.

This is not yet a second runnable OpenCode bot. The existing command handlers,
streamers, application container, and persistent single-user state still depend on
Telegram. The adapter deliberately does not emulate Telegram numeric IDs or invoke
Telegram handlers with fabricated grammY contexts.

## REST and events

```js
import { MattermostClient, MattermostEvents } from "./dist/mattermost/index.js";

const client = new MattermostClient(process.env.MATTERMOST_URL, process.env.MATTERMOST_BOT_TOKEN);
const events = new MattermostEvents(client, {
  allowedUserId: process.env.MATTERMOST_ALLOWED_USER_ID,
  allowedChannelIds: [process.env.MATTERMOST_CHANNEL_ID],
  async onPost({ kind, post }) {
    // Edits must not execute an already-submitted coding task again.
    if (kind !== "posted") return;
    await client.createPost({
      channel_id: post.channel_id,
      root_id: post.root_id || post.id,
      message: `Received: ${post.message}`,
    });
  },
});
await events.start();
process.once("SIGINT", () => {
  void events.stop();
});
process.once("SIGTERM", () => {
  void events.stop();
});
```

Run `npm run build` first. The environment names above belong to this example; the
Telegram CLI does not read them or switch transports. Use a bot access token, grant
channel access, and provide the allowed user's Mattermost ID. Server URLs may
include a deployment subpath, but must not include `/api/v4`.

`start()` validates the bot with `users/me` and starts the socket. `onConnected`
runs after the server's `hello` on each connection. Authentication uses the bearer
header, including on WebSocket upgrades. Reconnection uses bounded exponential
backoff; ping/pong detects a stale connection. 401/403 upgrades stop retries.
Call `stop()` outside an event handler to close the socket and drain running work.

Only explicitly allowed users and channels are delivered. Own, system, and deleted
posts are excluded. Posts and edits are separate event kinds, with string IDs and
millisecond timestamps. Delivery is serialized. A bounded in-memory duplicate
cache survives reconnects but not process restarts; failed handlers are reported
through `onError` and are not retried automatically. Non-system post types such as
`me`, `slack_attachment`, and `custom_*` retain the same access checks.

At most 2000 running or queued delivery callbacks are retained, including
`onConnected` recovery. If the queue fills, the adapter reports an error through
`onError` and reconnects, keeping already accepted callbacks in order. Rejected
events are not marked as duplicates. Recover overflowed events through the same
cursor reconciliation used for outages; WebSocket reconnection alone does not
replay them.

WebSocket is not a durable queue. An application requiring recovery must persist
a cursor and reconcile posts using `getPostsSince(channelId, timestamp)` in
`onConnected`, ordering and deduplicating them against live events. The `since` endpoint returns
at most 1000 modified posts; large gaps require additional paginated history
retrieval rather than assuming this response is complete. The adapter
does not automatically resubmit tasks missed during an outage.

REST operations include create/get/edit/delete post, file upload/download and metadata,
send-file, reaction, slash-command registration, and opening a dialog. `editPost` uses `PUT /posts/{id}/patch`
to preserve omitted properties. File sending uploads first and creates a post
with `file_ids`. HTTP requests time out and reject redirects. Non-idempotent REST
operations are not retried, avoiding duplicate posts after ambiguous failures.

## Interactive buttons and menus

```js
import { MattermostActions } from "./dist/mattermost/index.js";

const actions = new MattermostActions("https://bridge.example/actions", async (data, request) => {
  // Dispatch a transport-neutral application action here.
  return { ephemeral_text: `Selected ${data}` };
});
const post = await client.createPost({ channel_id: channelId, message: "Choose" });
const attachment = actions.createAttachment({ userId: allowedUserId, channelId, postId: post.id }, [
  { name: "Approve", data: "permission:approve" },
]);
await client.editPost(post.id, { props: { ...post.props, attachments: [attachment] } });
```

Mount a JSON HTTP POST handler at the callback URL: call `actions.handle(body)`
and return its `status` and JSON `body`. Mattermost calls this endpoint from its
server, so it must be reachable by that server. Restrict the endpoint to trusted
Mattermost traffic using network rules or an authenticated reverse proxy; payload
`user_id` alone does not authenticate the sender. Enforce request body limits at
the HTTP layer. No HTTP listener or public port is opened by this library.

Action context contains opaque random tokens. Tokens expire after 15 minutes by
default, are bound to user/channel/post, and are consumed before dispatch to reject
concurrent replay. Dropdown choices are validated. After an action failure, issue
a new token rather than retrying the old one. Call `invalidatePost` when replacing
or removing a card. Restarting the process invalidates existing buttons.

The synchronous response supports `update` and `ephemeral_text`. Opening a modal
is a separate `client.openDialog(trigger_id, dialog, callbackUrl)` request; it is
not a dialog object returned in the button response. Dialog submissions and slash
command HTTP endpoints belong to the host application's routing and authentication.
`createCommand` registers a native command for a team and returns its token; the
host must verify this token on every slash-command request. Registration requires
the relevant server permission and is not performed automatically. Use the existing
command catalog when integrating application commands rather than duplicating it.

Attachment actions provide compatibility with the matrix and older deployments.
Current Mattermost documentation recommends Mattermost Blocks for new integrations;
the generic `props` field can carry that format without changing the REST client.

## Porting boundaries

Before wiring the OpenCode bot to this adapter, agree on the application boundary:

- Extract command/prompt/action use cases from grammY contexts.
- Represent transport IDs as strings and key session routing by channel and root post.
- Separate Markdown output from Telegram HTML and keyboard formatting.
- Inject a message transport into streamers and the event subscription service.
- Define isolation for Telegram and Mattermost settings/session state before running both.
- Implement host HTTP routes for buttons, slash commands, and dialog submissions,
  with caller authentication, timeout policy, and localized responses.

Mattermost IDs are 26-character strings, not 36-character UUIDs. A channel and a
thread are different routing dimensions. Telegram forum topics do not map directly
to Mattermost root posts. Mattermost delete-post is a soft deletion, not a guarantee
of physical erasure. Outgoing webhooks have restrictions (including public-channel
usage) and do not replace the WebSocket event stream for all chat types.

References:

- https://docs.mattermost.com/api/reference/mattermost-api
- https://docs.mattermost.com/api/reference/connect-web-socket
- https://docs.mattermost.com/developers/integrate/plugins/interactive-messages
- https://docs.mattermost.com/developers/integrate/plugins/interactive-dialogs
