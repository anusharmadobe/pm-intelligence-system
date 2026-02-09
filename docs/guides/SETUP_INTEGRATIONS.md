# Integration Setup Guide

This guide helps you set up integrations with Slack, Teams, Grafana, and Splunk for automatic signal ingestion.

## Prerequisites

- PM Intelligence API server running (default: http://localhost:3000)
- Admin access to the platforms you want to integrate

---

## 1. Slack Integration

### Option A: Slack Events API (Recommended)

1. **Create a Slack App:**
   - Go to https://api.slack.com/apps
   - Click "Create New App" → "From scratch"
   - Name it "PM Intelligence" and select your workspace

2. **Enable Events:**
   - Go to "Event Subscriptions" in the left sidebar
   - Enable "Enable Events"
   - Set Request URL to: `http://your-server:3000/webhooks/slack`
   - Slack will send a verification challenge - ensure your server handles it

3. **Subscribe to Events:**
   - Subscribe to `message.channels` (messages in channels)
   - Subscribe to `app_mentions` (when your app is mentioned)

4. **Install App:**
   - Go to "Install App" → "Install to Workspace"
   - Copy the Bot Token (starts with `xoxb-`)

5. **Set Environment Variable (Optional):**
   ```bash
   export SLACK_BOT_TOKEN=xoxb-your-token-here
   ```

### Option B: Slack MCP (Model Context Protocol)

If you're using Cursor with Slack MCP integration:

1. **Configure Slack MCP in Cursor:**
   - Open Cursor Settings
   - Go to MCP (Model Context Protocol) settings
   - Add Slack MCP server configuration

2. **Create Signal Ingestion Script:**
   - Use Cursor's MCP to read Slack messages
   - Call PM Intelligence API: `POST /api/signals` with Slack message data

**Example MCP Integration Script:**
```typescript
// This would be called from Cursor MCP context
async function ingestSlackMessageViaMCP(message: any) {
  const signal = {
    source: 'slack',
    id: message.ts,
    type: 'message',
    text: message.text,
    metadata: {
      channel: message.channel,
      user: message.user
    }
  };
  
  await fetch('http://localhost:3000/api/signals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(signal)
  });
}
```

---

## 2. Microsoft Teams Integration

### Using Teams Webhooks

1. **Create Incoming Webhook:**
   - In Teams, go to your channel
   - Click "..." → "Connectors"
   - Search for "Incoming Webhook" → Configure
   - Copy the webhook URL

2. **Create Outgoing Webhook (for signal ingestion):**
   - You'll need to create a Teams app with webhook support
   - Set webhook URL to: `http://your-server:3000/webhooks/teams`

3. **Alternative: Teams Bot Framework**
   - Create a Teams bot that forwards messages to PM Intelligence API
   - Use Bot Framework SDK to handle messages

**Teams Webhook Payload Format:**
```json
{
  "type": "message",
  "id": "message-id",
  "text": "Message content",
  "from": { "id": "user-id", "name": "User Name" },
  "channelId": "channel-id",
  "timestamp": "2024-01-01T00:00:00Z"
}
```

---

## 3. Grafana Integration

### Using Grafana Alerting Webhooks

1. **Create Notification Channel:**
   - In Grafana, go to Alerting → Notification channels
   - Click "Add channel"
   - Select "Webhook"
   - Name: "PM Intelligence"
   - URL: `http://your-server:3000/webhooks/grafana`
   - Method: POST
   - Save

2. **Configure Alert Rules:**
   - Create or edit alert rules
   - Add "PM Intelligence" to notification channels
   - Alerts will automatically send signals when firing

**Grafana Alert Payload Format:**
```json
{
  "alerts": [
    {
      "status": "firing",
      "labels": {
        "alertname": "High Response Time",
        "severity": "warning"
      },
      "annotations": {
        "summary": "Response time exceeded threshold",
        "description": "Average response time is 3.2s"
      },
      "startsAt": "2024-01-01T00:00:00Z"
    }
  ]
}
```

---

## 4. Splunk Integration

### Using Splunk Webhooks

1. **Create Webhook Alert Action:**
   - In Splunk, go to Settings → Searches, reports, and alerts
   - Create or edit an alert
   - Under "Trigger Actions", add "Webhook"
   - URL: `http://your-server:3000/webhooks/splunk`
   - Method: POST
   - Configure payload format (JSON)

2. **Splunk Alert Configuration:**
   - Set alert conditions (e.g., "number of results > 0")
   - Enable webhook action
   - Save alert

**Splunk Webhook Payload Format:**
```json
{
  "search_name": "Error Monitoring",
  "owner": "admin",
  "app": "search",
  "results": [
    {
      "_time": "2024-01-01T00:00:00Z",
      "error_count": "150",
      "severity": "high"
    }
  ]
}
```

---

## Testing Integrations

### Test Slack Webhook:
```bash
curl -X POST http://localhost:3000/webhooks/slack \
  -H "Content-Type: application/json" \
  -d '{
    "type": "event_callback",
    "event": {
      "type": "message",
      "text": "Test message from Slack",
      "channel": "C123456",
      "user": "U123456",
      "ts": "1234567890.123456"
    }
  }'
```

### Test Grafana Webhook:
```bash
curl -X POST http://localhost:3000/webhooks/grafana \
  -H "Content-Type: application/json" \
  -d '{
    "alerts": [{
      "status": "firing",
      "labels": {"alertname": "Test Alert", "severity": "warning"},
      "annotations": {"summary": "Test alert", "description": "This is a test"}
    }]
  }'
```

### Verify Signal Ingestion:
```bash
curl http://localhost:3000/api/signals
```

---

## Using Cursor MCP for Slack

If you're using Cursor with Slack MCP:

1. **Enable Slack MCP in Cursor:**
   - Cursor automatically integrates with Slack MCP if configured
   - Check Cursor settings → MCP → Slack

2. **Create MCP Signal Ingestion Helper:**
   - Use Cursor's chat to create a helper function
   - This function reads Slack messages via MCP
   - Sends them to PM Intelligence API

**Example: Use Cursor Chat:**
```
Create a function that:
1. Uses Cursor's Slack MCP to read recent messages from #support channel
2. For each message, calls POST /api/signals with the message data
3. Returns count of signals ingested
```

---

## Security Considerations

1. **Webhook Authentication:**
   - Add webhook signature verification (future enhancement)
   - Use HTTPS in production
   - Consider IP whitelisting

2. **API Security:**
   - Enable RBAC: `export ENABLE_RBAC=true`
   - Add API keys for external integrations
   - Use environment variables for sensitive data

3. **Network:**
   - Use ngrok or similar for local development webhooks
   - Configure firewall rules appropriately

---

## Troubleshooting

### Webhook not receiving data:
- Check API server is running: `curl http://localhost:3000/health`
- Check webhook URL is accessible from external services
- Review API server logs for errors

### Signals not appearing:
- Verify webhook payload format matches adapter expectations
- Check database connection
- Review signal validation errors in logs

### Integration-specific issues:
- **Slack:** Verify bot token and event subscriptions
- **Grafana:** Check alert rule configuration and notification channel
- **Splunk:** Verify webhook action is enabled and payload format

---

## Next Steps

After setting up integrations:

1. Monitor signal ingestion: `GET /api/metrics`
2. Detect opportunities: `POST /api/opportunities/detect`
3. Use Cursor extension to create judgments and artifacts
4. Review adoption metrics regularly
