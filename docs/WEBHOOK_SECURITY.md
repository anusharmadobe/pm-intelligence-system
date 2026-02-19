# Webhook Security Configuration

This document explains how to configure webhook signature validation for all supported webhook integrations.

## Overview

All webhook endpoints now support signature validation to prevent unauthorized parties from injecting malicious data. Signature validation is **backward compatible** - if you don't configure secrets, webhooks will continue to work but will log warnings.

## Security Best Practices

1. **Always configure webhook secrets in production**
2. **Never commit webhook secrets to version control**
3. **Rotate secrets periodically** (every 90 days recommended)
4. **Monitor webhook rejection logs** for security incidents
5. **Use HTTPS** for all webhook endpoints in production

---

## Slack Webhook Configuration

### Step 1: Get Your Slack Signing Secret

1. Go to https://api.slack.com/apps
2. Select your app
3. Navigate to **Settings > Basic Information**
4. Under **App Credentials**, find **Signing Secret**
5. Click **Show** and copy the secret

### Step 2: Configure Environment Variable

```bash
export SLACK_SIGNING_SECRET="your_slack_signing_secret_here"
```

### Step 3: Verify Configuration

```bash
# Test with invalid signature (should be rejected)
curl -X POST http://localhost:3000/webhooks/slack \
  -H "Content-Type: application/json" \
  -d '{"type":"event_callback","event":{"type":"message","text":"test"}}'

# Expected: 401 Unauthorized - Invalid signature
```

### How Slack Signature Works

Slack uses HMAC-SHA256 with the following format:
- Signature header: `X-Slack-Signature`
- Timestamp header: `X-Slack-Request-Timestamp`
- Signature format: `v0=<hex-encoded-hmac>`
- Base string: `v0:{timestamp}:{request_body}`

**Replay Attack Protection:** Requests older than 5 minutes are automatically rejected.

---

## Microsoft Teams Webhook Configuration

### Step 1: Generate a Shared Secret

```bash
# Generate a secure random secret
openssl rand -hex 32
```

### Step 2: Configure Environment Variable

```bash
export TEAMS_WEBHOOK_SECRET="your_generated_secret_here"
```

### Step 3: Configure Teams Webhook

1. In Microsoft Teams, go to your webhook configuration
2. Add the **Authorization** header format:
   - Header name: `Authorization`
   - Header value: `HMAC <base64-encoded-signature>`
3. Configure signature algorithm: **HMAC-SHA256**
4. Set secret to your `TEAMS_WEBHOOK_SECRET`

### How Teams Signature Works

Teams uses HMAC-SHA256 with the following format:
- Signature header: `Authorization: HMAC <base64-signature>`
- Signature input: Request body (JSON string)
- Encoding: Base64

---

## Grafana Webhook Configuration

### Step 1: Generate a Shared Secret

```bash
# Generate a secure random secret
openssl rand -hex 32
```

### Step 2: Configure Environment Variable

```bash
export GRAFANA_WEBHOOK_SECRET="your_generated_secret_here"
```

### Step 3: Configure Grafana Webhook

1. In Grafana, navigate to **Alerting > Contact points**
2. Edit or create a webhook contact point
3. Set URL: `https://your-domain.com/webhooks/grafana`
4. Add HTTP header:
   - Header name: `X-Grafana-Signature`
   - Header value: Use Grafana's template to compute HMAC:
     ```
     {{ define "grafana.webhook.signature" }}
       {{ hmacSHA256 .ExternalURL "your_secret_here" }}
     {{ end }}
     ```

### How Grafana Signature Works

Grafana uses HMAC-SHA256 with the following format:
- Signature header: `X-Grafana-Signature`
- Signature input: Request body (JSON string)
- Encoding: Hexadecimal

---

## Splunk Webhook Configuration

Splunk supports **two authentication methods**. You can use either or both:

### Option 1: HEC Token Authentication (Recommended)

#### Step 1: Get Your Splunk HEC Token

1. In Splunk, go to **Settings > Data Inputs > HTTP Event Collector**
2. Create a new HEC token or use an existing one
3. Copy the token value

#### Step 2: Configure Environment Variable

```bash
export SPLUNK_HEC_TOKEN="your-hec-token-here"
```

#### Step 3: Configure Splunk Webhook

1. In Splunk alert configuration, set:
   - URL: `https://your-domain.com/webhooks/splunk`
   - Authorization header: `Splunk your-hec-token-here`

### Option 2: HMAC Signature (Custom)

#### Step 1: Generate a Shared Secret

```bash
# Generate a secure random secret
openssl rand -hex 32
```

#### Step 2: Configure Environment Variable

```bash
export SPLUNK_WEBHOOK_SECRET="your_generated_secret_here"
```

#### Step 3: Configure Splunk to Send Signature

Configure Splunk to compute and send HMAC-SHA256 signature:
- Header name: `X-Splunk-Signature`
- Signature: HMAC-SHA256 of request body
- Encoding: Hexadecimal

---

## Environment Variables Summary

```bash
# Slack
SLACK_SIGNING_SECRET=your_slack_signing_secret

# Microsoft Teams
TEAMS_WEBHOOK_SECRET=your_teams_webhook_secret

# Grafana
GRAFANA_WEBHOOK_SECRET=your_grafana_webhook_secret

# Splunk (choose one or both)
SPLUNK_HEC_TOKEN=your_splunk_hec_token
SPLUNK_WEBHOOK_SECRET=your_splunk_webhook_secret
```

---

## Testing Webhook Security

### Test Script

Create a file `scripts/test_webhook_security.ts`:

```typescript
import crypto from 'crypto';
import fetch from 'node-fetch';

async function testSlackWebhook() {
  const secret = process.env.SLACK_SIGNING_SECRET!;
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const body = JSON.stringify({
    type: 'event_callback',
    event: { type: 'message', text: 'test' }
  });

  const sigBasestring = `v0:${timestamp}:${body}`;
  const signature = crypto
    .createHmac('sha256', secret)
    .update(sigBasestring)
    .digest('hex');

  const response = await fetch('http://localhost:3000/webhooks/slack', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Slack-Signature': `v0=${signature}`,
      'X-Slack-Request-Timestamp': timestamp
    },
    body
  });

  console.log('Slack webhook test:', response.status, await response.text());
}

testSlackWebhook();
```

### Run Tests

```bash
# Set your secrets
export SLACK_SIGNING_SECRET="your_secret"

# Run test
ts-node scripts/test_webhook_security.ts
```

---

## Monitoring and Alerts

### Log Monitoring

All webhook signature failures are logged with details:

```json
{
  "level": "warn",
  "message": "Slack webhook rejected: invalid signature",
  "ip": "203.0.113.1",
  "headers": {
    "signature": "v0=abc123...",
    "timestamp": "1234567890"
  }
}
```

### Recommended Alerts

Set up alerts for:
1. **High rejection rate** (>10 rejections/hour)
2. **Rejections from unexpected IPs**
3. **Timestamp replay attacks** (old timestamps)

### Security Audit

Query webhook rejection logs:

```bash
# PostgreSQL query for API key usage (webhook endpoints)
SELECT
  endpoint,
  status_code,
  COUNT(*) as requests,
  COUNT(*) FILTER (WHERE status_code = 401) as rejections
FROM api_key_usage_log
WHERE endpoint LIKE '/webhooks/%'
  AND created_at > NOW() - INTERVAL '24 hours'
GROUP BY endpoint, status_code
ORDER BY rejections DESC;
```

---

## Troubleshooting

### "Invalid signature" errors

1. **Check secret is correct**: Verify environment variable matches webhook configuration
2. **Check timestamp**: Slack requests must be within 5 minutes
3. **Check body format**: Signature is computed over exact JSON body (no whitespace changes)
4. **Check encoding**: Verify hex vs base64 encoding matches documentation

### "Missing signature header" errors

1. **Check header name**: Must be exact (case-sensitive)
2. **Check webhook configuration**: Ensure signature is being sent
3. **Check logs**: Look for detailed error messages

### Backward Compatibility Mode

If you need to temporarily disable validation:

```bash
# Remove or unset the secret environment variables
unset SLACK_SIGNING_SECRET
unset TEAMS_WEBHOOK_SECRET
unset GRAFANA_WEBHOOK_SECRET
unset SPLUNK_HEC_TOKEN
unset SPLUNK_WEBHOOK_SECRET
```

**Warning:** This is NOT recommended for production use!

---

## Migration Guide

### For Existing Deployments

1. **Phase 1: Add secrets** (webhooks continue working)
   ```bash
   export SLACK_SIGNING_SECRET="your_secret"
   ```

2. **Phase 2: Monitor logs** (verify no legitimate rejections)
   ```bash
   tail -f logs/combined.log | grep "webhook rejected"
   ```

3. **Phase 3: Full enforcement** (already active - rejections return 401)

### Rollback Plan

If you need to rollback signature validation:

1. Remove environment variables
2. Restart service
3. Webhooks will log warnings but continue working

---

## Security Considerations

### Secrets Management

- **Development**: Use `.env` file (never commit)
- **Staging/Production**: Use secret management service (AWS Secrets Manager, Vault, etc.)
- **CI/CD**: Use encrypted environment variables

### Secret Rotation

When rotating secrets:

1. Generate new secret
2. Update environment variable
3. Update webhook configuration in external service
4. Restart application
5. Verify webhooks work with new secret
6. Invalidate old secret

### Network Security

- Use HTTPS in production (TLS 1.2+)
- Restrict webhook endpoints to known IP ranges (firewall rules)
- Use VPN or private networks when possible
- Monitor for unusual traffic patterns

---

## Support

For issues or questions:
1. Check logs: `logs/combined.log` and `logs/error.log`
2. Review this documentation
3. File an issue with log excerpts (redact secrets!)

