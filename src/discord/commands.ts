import { SlashCommandBuilder, type Client, type RESTPostAPIChatInputApplicationCommandsJSONBody } from "discord.js";
import type { Config } from "../config.ts";
import type { AgentBridge, RouteKey } from "../types.ts";

export const SLASH_COMMANDS: RESTPostAPIChatInputApplicationCommandsJSONBody[] = [
  new SlashCommandBuilder().setName("new").setDescription("Start a fresh conversation here").setDMPermission(true),
  new SlashCommandBuilder().setName("cancel").setDescription("Cancel the current response").setDMPermission(true),
  new SlashCommandBuilder().setName("status").setDescription("Show this conversation's status").setDMPermission(true),
  new SlashCommandBuilder().setName("help").setDescription("Show how to use the bot").setDMPermission(true),
].map((command) => command.toJSON());

export interface CommandClientLike {
  application: { commands: { set(commands: readonly unknown[]): Promise<unknown> } } | null;
  guilds: { fetch(id: string): Promise<{ commands: { set(commands: readonly unknown[]): Promise<unknown> } }> };
}

export interface CommandInteractionLike {
  commandName: string;
  reply(options: { content: string; ephemeral?: boolean }): Promise<unknown>;
}

export async function registerSlashCommands(client: Client | CommandClientLike, config: Config): Promise<void> {
  const commandClient = client as unknown as CommandClientLike;
  if (config.DISCORD_GUILD_IDS.length > 0) {
    await Promise.all(
      config.DISCORD_GUILD_IDS.map(async (guildId) => {
        const guild = await commandClient.guilds.fetch(guildId);
        await guild.commands.set(SLASH_COMMANDS);
      }),
    );
    return;
  }
  if (!commandClient.application) throw new Error("Discord application is not ready.");
  await commandClient.application.commands.set(SLASH_COMMANDS);
}

const HELP_TEXT = [
  "Mention the bot in a channel to start a thread, then keep replying in that thread. You can also use DMs when enabled and attach images or files.",
  "",
  "Commands:",
  "• `/new` — start a fresh conversation here",
  "• `/cancel` — cancel the current response",
  "• `/status` — show this conversation's status",
  "• `/help` — show this help",
  "",
  "The agent's model, tools, and settings are managed by its operator in Letta, not from Discord.",
].join("\n");

export async function handleCommand(
  interaction: CommandInteractionLike,
  deps: {
    bridge: AgentBridge;
    routeFor(interaction: CommandInteractionLike): RouteKey | null;
    isAdmin(interaction: CommandInteractionLike): boolean;
  },
): Promise<boolean> {
  if (!["new", "cancel", "status", "help"].includes(interaction.commandName)) return false;

  const route = deps.routeFor(interaction);
  if (!route) {
    await interaction.reply({ content: "This command only works where the bot is active.", ephemeral: true });
    return true;
  }

  switch (interaction.commandName) {
    case "new":
      await deps.bridge.reset(route);
      await interaction.reply({
        content: "Started a fresh conversation here. The agent still remembers what it has learned.",
      });
      return true;

    case "cancel": {
      const cancelled = await deps.bridge.cancel(route);
      await interaction.reply({ content: cancelled ? "Cancelled." : "Nothing to cancel.", ephemeral: true });
      return true;
    }

    case "status": {
      const admin = deps.isAdmin(interaction);
      const status = await deps.bridge.status(route, admin);
      const lines = [
        `Status: ${status.busy ? "busy" : "idle"}`,
        `Queued: ${status.queued}`,
        `Conversation: ${status.hasConversation ? "yes" : "no"}`,
        `Last active: ${status.lastActiveAt ?? "never"}`,
      ];
      if (admin) {
        if (status.conversationId) lines.push(`Conversation ID: ${status.conversationId}`);
        if (status.model) lines.push(`Model: ${status.model}`);
      }
      await interaction.reply({ content: lines.join("\n"), ephemeral: true });
      return true;
    }

    case "help":
      await interaction.reply({ content: HELP_TEXT, ephemeral: true });
      return true;

    default:
      return false;
  }
}
