/**
 * Example Slack Bot Integration for Weekly Update Assessment
 * 
 * This is a template showing how to integrate the assessment script
 * with a Slack bot using @slack/bolt
 */

import { App } from '@slack/bolt';
import { assessWeeklyUpdate, formatAssessmentForSlack } from './assess_weekly_update';

// Initialize Slack app
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN,
});

// Channel ID for weekly status updates
const WEEKLY_STATUS_CHANNEL = 'C043FKMNUNM';

// Known reminder message patterns
const REMINDER_PATTERNS = [
  /weekly status updates/i,
  /your top wins for this week and impact created/i
];

/**
 * Check if a message is a weekly status reminder
 */
function isWeeklyStatusReminder(text: string): boolean {
  return REMINDER_PATTERNS.some(pattern => pattern.test(text));
}

/**
 * Check if a message is a reply to a weekly status thread
 */
async function isWeeklyStatusReply(message: any): Promise<boolean> {
  if (!message.thread_ts || message.channel !== WEEKLY_STATUS_CHANNEL) {
    return false;
  }
  
  // Fetch parent message to check if it's a reminder
  try {
    const result = await app.client.conversations.replies({
      channel: message.channel,
      ts: message.thread_ts,
      limit: 1
    });
    
    if (result.messages && result.messages.length > 0) {
      const parentText = result.messages[0].text || '';
      return isWeeklyStatusReminder(parentText);
    }
  } catch (error) {
    console.error('Error checking parent message:', error);
  }
  
  return false;
}

/**
 * Main message handler - assesses weekly updates
 */
app.message(async ({ message, say, client }) => {
  // Only process messages in weekly status channel
  if (message.channel !== WEEKLY_STATUS_CHANNEL) {
    return;
  }
  
  // Skip bot messages
  if (message.subtype === 'bot_message' || message.bot_id) {
    return;
  }
  
  // Check if this is a reply to weekly status thread
  const isReply = await isWeeklyStatusReply(message);
  
  if (!isReply && message.text) {
    // Check if this is a new weekly status reminder
    if (isWeeklyStatusReminder(message.text)) {
      await say({
        text: "👋 I'm here to help improve your weekly updates! Post your updates as replies to this thread, and I'll provide feedback.",
        thread_ts: message.ts
      });
    }
    return;
  }
  
  if (!message.text || message.text.length < 10) {
    return; // Skip very short messages
  }
  
  // Get user info
  let userName = 'Unknown';
  try {
    const userInfo = await client.users.info({ user: message.user });
    userName = userInfo.user?.real_name || userInfo.user?.display_name || message.user;
  } catch (error) {
    console.error('Error fetching user info:', error);
  }
  
  // Assess the update
  const update = {
    text: message.text,
    user: userName,
    date: new Date(parseFloat(message.ts) * 1000).toISOString().split('T')[0]
  };
  
  const result = assessWeeklyUpdate(update);
  const formatted = formatAssessmentForSlack(result, update);
  
  // Reply with assessment
  await say({
    text: formatted,
    thread_ts: message.ts || message.thread_ts,
    mrkdwn: true
  });
  
  // If it doesn't qualify, offer to help improve
  if (!result.qualifiesAsWin && result.clarifyingQuestions.length > 0) {
    await say({
      text: `💡 *Want to improve this update?* I can help you refine it. Just reply with your improved version, or ask me questions about any of the suggestions above.`,
      thread_ts: message.ts || message.thread_ts
    });
  }
});

/**
 * Interactive command: /assess-update
 * Allows manual assessment of any text
 */
app.command('/assess-update', async ({ command, ack, respond }) => {
  await ack();
  
  const text = command.text;
  if (!text) {
    await respond('Please provide an update to assess. Usage: `/assess-update Your update text here`');
    return;
  }
  
  const update = {
    text: text,
    user: command.user_name,
    date: new Date().toISOString().split('T')[0]
  };
  
  const result = assessWeeklyUpdate(update);
  const formatted = formatAssessmentForSlack(result, update);
  
  await respond({
    text: formatted,
    mrkdwn: true
  });
});

/**
 * Interactive button: "Get Assessment"
 * Can be added to messages for on-demand assessment
 */
app.action('assess_update', async ({ ack, body, respond }) => {
  await ack();
  
  // Extract message text from the action
  const messageText = body.message?.text || '';
  
  if (!messageText) {
    await respond('No text found to assess.');
    return;
  }
  
  const update = {
    text: messageText,
    user: body.user.name,
    date: new Date().toISOString().split('T')[0]
  };
  
  const result = assessWeeklyUpdate(update);
  const formatted = formatAssessmentForSlack(result, update);
  
  await respond({
    text: formatted,
    mrkdwn: true,
    replace_original: false
  });
});

/**
 * Start the bot
 */
(async () => {
  await app.start();
  console.log('⚡️ Weekly Update Assessment Bot is running!');
})();

export { app };
