# Capernaum Receipt Importer

Existing GitHub intake for Tony's Outlook receipts. It reads the active Marketing
and Business Development receipt folders and creates pending Monday items only.
It does not move emails, approve receipts, send messages, or write a budget sheet.

## Destinations

- Inbox/Capernaum Receipts -> board 18402506712, Submitted Receipts (`topics`).
- Inbox/Biz Development Receipts (formerly nested in Inbox/CS Projects) ->
  board 18434866560, Submitted Receipts (`topics`).
- FedEx, AlphaGraphics, Signs2Go and Displays2Go are held out of Marketing intake.
  The separate authorized Outlook sorter moves eligible new vendor receipts.
- Business approval is New Submission and posting state is Not Posted.
  Its existing manual approval and separate approved-only exporter remain controlling.

## Integrity

The full active folder is scanned because receivedDateTime does not change when
an old message is moved into a folder. Historical archive folders are excluded.
A 2026-10-14 snapshot of the 37 existing Marketing message identities holds
unreviewed historical backfill. Only individually reconciled messages are allowed.

Before creation, both boards and every group are checked for durable source
identity, vendor/reference identity, and vendor/date/amount. A source hash and
original Outlook identity/link are saved in the item creation itself. This does
not depend on ephemeral runner files or editable transaction fields. One workflow
run at a time is enforced by GitHub concurrency.

Categories come from current Monday labels. No new labels are created, and Other
is never silently mapped to Contract. Unknown category/card remains blank.
Statements, uncertain/zero totals, inferred dates, and attachment-only essential
values are held for manual source review. The extractor must supply exact body
excerpts and their amounts/dates must agree with the output.

Receipt attachments are fetched before item creation, uploaded, and read back.
If an upload fails after creation, a later run resumes missing files on the same
source-keyed item. No legacy receipt or approval status is overwritten.

## Run controls

The workflow supports manual dry_run true/false and max_creates inputs. Initial
repair deployment defaults to read-only, with a one-item pilot cap. Scheduled
live activation requires successful live preflight and pilot readback.

Existing secrets are reused: MICROSOFT_TENANT_ID, MICROSOFT_CLIENT_ID,
MICROSOFT_CLIENT_SECRET, MAILBOX_USER, MONDAY_API_TOKEN, OPENAI_API_KEY.
MAILBOX_USER must be Tony@jtstrategies.net. No additional credentials or Microsoft
permissions are requested. The importer only uses Microsoft read operations.

Run focused checks with `node --test test/import-receipts.test.mjs`.

## Scheduler limitation

GitHub disabled this public repository's scheduled workflow for inactivity on
September 7, 2026. GitHub can disable schedules after 60 days without repository
activity. Re-enabling is a repair, not a permanent removal of that platform rule.
The last pre-repair job also failed because Promo Materiel was not a valid Monday
label. Check the live workflow state and run history rather than assuming a
successful manual run proves the schedule is healthy.
