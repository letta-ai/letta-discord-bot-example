# Tools and permissions

Anyone who can message the bot can ask the agent to call tools. This page covers how to choose
which tools exist on each Discord surface and who signs off on them.

## What the agent can call

A turn has three kinds of tools:

| Kind | Examples | Controlled by |
|---|---|---|
| Client tools | `Bash`, `Read`, `Edit`, `Grep`, plus mod tools on a connected computer | `TOOLSET_BASE`, `ALLOWED_TOOLS`, or a routing-table `policy` |
| Discord tools | `discord_send_message`, `discord_read_history`, `discord_react`, `discord_send_file` | `ENABLE_DISCORD_TOOLS` |
| Server tools | `web_search`, `fetch_webpage`, MCP tools attached to the agent | The agent's own configuration in Letta |

Client tools run where the turn executes: the conversation's Cloud sandbox, or the computer named
by `LETTA_COMPUTER`. Server tools are attached to the agent and run on Letta's servers, so the bot
cannot remove them. Detach them from the agent if a deployment must not have them.

## Removing tools

`ALLOWED_TOOLS` is an exact allowlist of client tools. Anything not on it is gone for the session,
including the tools of mods installed on a connected computer. The bot's own Discord tools stay
available under any allowlist.

```bash
# A support agent that can read files and search, but has no shell or editor.
ALLOWED_TOOLS=Read,Glob,Grep
```

`TOOLSET_BASE=none` removes every built-in client tool. On a connected computer, its mod tools
still load, so pair it with `ALLOWED_TOOLS` when the computer has mods.

There is no denylist. The SDK rejects `disallowedTools` when opening an existing agent's session,
which is all this bot does, so "everything except Bash" has to be written as an allowlist.

## Approvals and permission modes

`PERMISSION_MODE` is the harness permission mode (`strict`, `standard`, `acceptEdits`,
`unrestricted`). Calls the mode does not auto-allow go to `APPROVAL_MODE`, which decides who signs
off in Discord (`deny`, `admins`, `requester`, `allow`, see [Approvals](../README.md#-approvals)).

The defaults are `PERMISSION_MODE=standard` and `APPROVAL_MODE=admins`. `standard` runs read-only
calls on its own: `Read`, `Glob`, `Grep` and similar inside the working directory, read-only shell
commands, and the agent's own memory writes. Everything else needs an admin's click, and with no
`DISCORD_ADMIN_USER_IDS` or `DISCORD_ADMIN_ROLE_IDS` it is denied. For a private server where
everyone is trusted, `PERMISSION_MODE=unrestricted` with `APPROVAL_MODE=allow` never asks.

Approvals are a second line of defense, not a substitute for removing tools. They only see the
calls the permission mode sends for approval, and `unrestricted` sends none.

## Per-surface policy

The env settings above apply to every surface. A [routing table](../README.md#routing-table) entry
can override them with a `policy`, and the table's top-level `policy` applies to every route:

```json
{
  "policy": { "approvalMode": "admins" },
  "routes": [
    { "guild": "123456789012345678", "policy": { "toolset": "none", "allowedTools": ["web_search"] } },
    { "channel": "223456789012345678", "policy": { "approvalMode": "deny" } },
    { "dm": "323456789012345678", "policy": { "allowedTools": [], "toolset": "default", "approvalMode": "allow" } }
  ]
}
```

| Field | Same as | Values |
|---|---|---|
| `allowedTools` | `ALLOWED_TOOLS` | Tool names. `[]` means the toolset's defaults. |
| `toolset` | `TOOLSET_BASE` | `auto`, `default`, `codex`, `gemini`, `none` |
| `permissionMode` | `PERMISSION_MODE` | `strict`, `standard`, `acceptEdits`, `unrestricted` |
| `approvalMode` | `APPROVAL_MODE` | `deny`, `admins`, `requester`, `allow` |

Each field is resolved on its own: the most specific matching entry that sets it (thread, channel,
DM user, guild), then the top-level `policy`, then the env setting. In the example, a thread in the
guild has no shell and needs an admin to approve calls; the DM user gets the full toolset with no
approvals.

An entry can carry a `policy` without a `conversation`; the conversation then comes from less
specific entries or `fallback`. Surfaces pinned to one conversation may have different policies.
The bot reopens the session when the next turn comes from a surface with a different policy, so
each turn runs with its own surface's tools.

`bun run doctor` prints each policy and warns when `approvalMode: "admins"` is used without any
admin users or roles configured.
