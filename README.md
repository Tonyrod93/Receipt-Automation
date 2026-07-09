# Capernaum Receipt Importer

Daily cloud job that reads Outlook receipt emails and creates missing Monday.com
items on the `Marketing Receipts` board.

## What It Does

- Reads receipt emails from:
  - `Inbox/Capernaum Receipts`
  - `Capernaum Studios/Finance/Capernaum Receipts`
  - `Capernaum Studios/Finance/Capernaum Receipts/Ads`
  - `Capernaum Studios/Finance/Capernaum Receipts/Holly`
  - `Capernaum Studios/Finance/Capernaum Receipts/Stephanie`
  - `Capernaum Studios/Finance/Capernaum Receipts/Tony`
- Extracts receipt fields with OpenAI.
- Creates Monday.com items in board `18402506712`, group `topics`.
- Uploads PDF/image email attachments to Monday file column `file_mm14qmnm`.
- Avoids duplicates using both Monday item matching and `.processed-receipts.json`.

## Required GitHub Secrets

Add these in GitHub under:
`Settings` -> `Secrets and variables` -> `Actions` -> `New repository secret`.

```text
MICROSOFT_TENANT_ID
MICROSOFT_CLIENT_ID
MICROSOFT_CLIENT_SECRET
MAILBOX_USER
MONDAY_API_TOKEN
OPENAI_API_KEY
```

Use this value for `MAILBOX_USER`:

```text
Tony@jtstrategies.net
```

## Schedule

The workflow runs daily at `13:00 UTC`, which is `8:00 AM Central` during
daylight saving time. If you need exact Central time across daylight/standard
time changes, update the cron seasonally or move the job to Azure Functions
with an America/Chicago timer.

## Manual Run

In GitHub Actions, open `Daily Outlook Receipts To Monday`, then click
`Run workflow`.

## Azure Permissions

The Microsoft Entra app needs Microsoft Graph application permission:

```text
Mail.Read
```

After adding it, grant admin consent.
