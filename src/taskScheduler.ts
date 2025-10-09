import axios from 'axios';
import { Client, TextChannel } from 'discord.js';
import { sendTaskMessage } from './messages';

/**
 * Task Scheduler for Discord Bot
 * Checks tasks channel every 60 seconds and triggers Letta when tasks are due.
 */

type Task = {
  task_name?: string;
  next_run?: string;
  active?: boolean;
  one_time?: boolean;
  schedule?: string; // e.g. "daily", "hourly", "every_3_hours", "weekly", "monthly", "yearly", "on_date"
  time?: string; // HH:MM format
  specific_date?: string; // For "on_date": YYYY-MM-DD or DD.MM.YYYY
  day_of_week?: string; // For "weekly": "monday", "tuesday", etc.
  day_of_month?: number; // For "monthly" or "yearly": 1-31
  month?: number; // For "yearly": 1-12
  message_id?: string;
  description?: string;
  action_type?: string; // e.g. "user_reminder" | "channel_post"
  action_target?: string; // e.g. user id or channel id/name
  action_template?: string; // Message template
  [key: string]: unknown;
};

const DISCORD_TOKEN = process.env.DISCORD_TOKEN || '';
const TASKS_CHANNEL_ID = process.env.TASKS_CHANNEL_ID || '';
const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID || ''; // Default channel for task responses

async function readTasksFromChannel(): Promise<Task[]> {
  try {
    if (!DISCORD_TOKEN || !TASKS_CHANNEL_ID) return [];
    const url = `https://discord.com/api/v10/channels/${TASKS_CHANNEL_ID}/messages?limit=100`;
    const headers = { Authorization: `Bot ${DISCORD_TOKEN}` };
    const response = await axios.get(url, { headers, timeout: 10_000 });
    if (response.status !== 200) {
      console.warn(`❌ Failed to read tasks channel: ${response.status}`);
      return [];
    }
    const messages: Array<{ id: string; content: string }> = response.data || [];
    const tasks: Task[] = [];
    for (const msg of messages) {
      const content = String(msg?.content || '');
      let jsonStr = content;
      if (content.includes('```json')) {
        const parts = content.split('```json');
        if (parts[1]) jsonStr = parts[1].split('```')[0].trim();
      } else if (content.includes('```')) {
        jsonStr = content.split('```')[1]?.split('```')[0]?.trim() || content;
      }
      try {
        const task = JSON.parse(jsonStr);
        if (task && typeof task === 'object') {
          (task as Task).message_id = msg.id;
          tasks.push(task as Task);
        }
      } catch (_e) {
        // ignore non-JSON messages
      }
    }
    return tasks;
  } catch (e) {
    console.error('❌ Error reading tasks:', e);
    return [];
  }
}

function checkDueTasks(tasks: Task[]): Task[] {
  const now = new Date();
  const due: Task[] = [];
  for (const t of tasks) {
    if (t.active === false) continue;
    const nextRunStr = t.next_run;
    if (!nextRunStr) continue;
    const nextRun = new Date(nextRunStr);
    if (!Number.isNaN(nextRun.getTime()) && nextRun <= now) {
      due.push(t);
    }
  }
  return due;
}

async function triggerLetta(
  task: Task, 
  client?: Client
): Promise<boolean> {
  try {
    // Try to get a target channel for Letta's response
    let targetChannel: TextChannel | undefined;
    
    if (client) {
      // Try action_target first (if it's a channel ID)
      if (task.action_target && task.action_type === 'channel_post') {
        try {
          const ch = await client.channels.fetch(task.action_target);
          if (ch && 'send' in ch) targetChannel = ch as TextChannel;
        } catch {}
      }
      
      // Fallback to DISCORD_CHANNEL_ID
      if (!targetChannel && DISCORD_CHANNEL_ID) {
        try {
          const ch = await client.channels.fetch(DISCORD_CHANNEL_ID);
          if (ch && 'send' in ch) targetChannel = ch as TextChannel;
        } catch {}
      }
    }

    // Send task to Letta via messages.ts infrastructure (streaming, chunking, error handling)
    await sendTaskMessage(task, targetChannel);
    console.log(`🗓️  ✅ Triggered Letta for task: ${task.task_name}`);
    return true;
  } catch (e: any) {
    console.error(`🗓️  ❌ Failed to trigger Letta: ${e?.message || e}`);
    return false;
  }
}

async function deleteTaskMessage(messageId?: string): Promise<boolean> {
  try {
    if (!messageId || !DISCORD_TOKEN || !TASKS_CHANNEL_ID) return false;
    const url = `https://discord.com/api/v10/channels/${TASKS_CHANNEL_ID}/messages/${messageId}`;
    const headers = { Authorization: `Bot ${DISCORD_TOKEN}` };
    const resp = await axios.delete(url, { headers, timeout: 10_000 });
    if (resp.status === 204) {
      console.log(`🗓️  ✅ Deleted task message: ${messageId}`);
      return true;
    }
    console.warn(`🗓️  ⚠️  Failed to delete: ${resp.status}`);
    return false;
  } catch (e) {
    console.error('🗓️  ❌ Error deleting message:', e);
    return false;
  }
}

async function updateRecurringTask(task: Task): Promise<boolean> {
  try {
    if (!DISCORD_TOKEN || !TASKS_CHANNEL_ID) return false;
    const schedule = String(task.schedule || '');
    const now = new Date();
    let newNext = new Date(now);
    
    // Calculate next run based on schedule type
    if (schedule === 'secondly') {
      newNext.setSeconds(now.getSeconds() + 1);
    } else if (schedule === 'minutely') {
      newNext.setMinutes(now.getMinutes() + 1);
    } else if (schedule === 'hourly') {
      newNext.setHours(now.getHours() + 1);
    } else if (schedule === 'daily') {
      newNext.setDate(now.getDate() + 1);
    } else if (schedule === 'weekly') {
      newNext.setDate(now.getDate() + 7);
    } else if (schedule === 'monthly') {
      newNext.setMonth(now.getMonth() + 1);
    } else if (schedule === 'yearly') {
      newNext.setFullYear(now.getFullYear() + 1);
    } else if (/^every_\d+_minutes$/.test(schedule)) {
      const minutes = parseInt(schedule.split('_')[1] || '0', 10) || 0;
      newNext.setMinutes(now.getMinutes() + minutes);
    } else if (/^every_\d+_hours$/.test(schedule)) {
      const hours = parseInt(schedule.split('_')[1] || '0', 10) || 0;
      newNext.setHours(now.getHours() + hours);
    } else if (/^every_\d+_days$/.test(schedule)) {
      const days = parseInt(schedule.split('_')[1] || '0', 10) || 0;
      newNext.setDate(now.getDate() + days);
    } else if (/^every_\d+_weeks$/.test(schedule)) {
      const weeks = parseInt(schedule.split('_')[1] || '0', 10) || 0;
      newNext.setDate(now.getDate() + (weeks * 7));
    } else {
      console.warn(`🗓️  ⚠️  Unknown recurring schedule: ${schedule}`);
      return false;
    }
    const updated: Task = { ...task };
    delete updated.message_id; // do not carry over old message id
    updated.next_run = newNext.toISOString();
    updated.active = true;
    const url = `https://discord.com/api/v10/channels/${TASKS_CHANNEL_ID}/messages`;
    const headers = { Authorization: `Bot ${DISCORD_TOKEN}`, 'Content-Type': 'application/json' };
    const taskType = 'Recurring';
    const actionType = String(updated.action_type || '');
    const actionTarget = String(updated.action_target || '');
    const actionDesc = actionType === 'user_reminder'
      ? `Discord DM → User ${actionTarget}`
      : actionType === 'channel_post'
        ? `Discord Channel → ${actionTarget}`
        : 'Internal Agent Task';
    const nextRunPretty = updated.next_run
      ? new Date(updated.next_run).toISOString().slice(0, 16).replace('T', ' ')
      : '';

    let formattedMessage = `📋 **Task: ${String(updated.task_name || '')}**\n`+
      `├─ Description: ${String(updated.description || '')}\n`+
      `├─ Schedule: ${String(updated.schedule || '')} (${taskType})\n`+
      `├─ Next Run: ${nextRunPretty}\n`+
      `└─ Action: ${actionDesc}\n\n`+
      `\`\`\`json\n${JSON.stringify(updated, null, 2)}\n\`\`\``;
    if (formattedMessage.length > 1900) {
      const jsonPreview = JSON.stringify(updated).slice(0, 1500);
      formattedMessage = `📋 **Task: ${String(updated.task_name || '')}**\n`+
        `Next Run: ${nextRunPretty}\n\n`+
        `\`\`\`json\n${jsonPreview}\n\`\`\``;
    }
    const payload = { content: formattedMessage };
    const resp = await axios.post(url, payload, { headers, timeout: 10_000 });
    if (resp.status === 200 || resp.status === 201) {
      console.log(`🗓️  ✅ Updated recurring task: ${String(task.task_name || '')}, next run: ${newNext.toISOString()}`);
      return true;
    }
    console.warn(`🗓️  ❌ Failed to update recurring task: ${resp.status}`);
    return false;
  } catch (e) {
    console.error('🗓️  ❌ Error updating recurring task:', e);
    return false;
  }
}

export function startTaskCheckerLoop(client?: Client): void {
  console.log('🗓️  Task Scheduler started');
  const LOOP_MS = 60_000;
  async function tick() {
    try {
      const tasks = await readTasksFromChannel();
      if (tasks.length) {
        console.log(`🗓️  Found ${tasks.length} task(s) in channel`);
        const due = checkDueTasks(tasks);
        if (due.length) {
          console.log(`🗓️  ${due.length} task(s) due for execution`);
          for (const t of due) {
            const name = String(t.task_name || '');
            const messageId = t.message_id;
            const oneTime = !!t.one_time;
            const ok = await triggerLetta(t, client);
            if (ok) {
              const deleted = await deleteTaskMessage(messageId);
              if (deleted) {
                if (!oneTime) {
                  await updateRecurringTask(t);
                } else {
                  console.log(`🗓️  🗑️  One-time task completed and deleted: ${name}`);
                }
              }
            }
          }
        }
      }
    } catch (e) {
      console.error('🗓️  ❌ Error in task checker:', e);
    } finally {
      setTimeout(tick, LOOP_MS);
    }
  }
  setTimeout(tick, 2_000); // small delay on start
}


