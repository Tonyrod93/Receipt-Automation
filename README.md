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
identity, vendor/reference identity, vendor/date/amount, and saved attachment content hashes. A source hash and
original Outlook identity/link are saved in the item creation itself. This does
not depend on ephemeral runner files or editable transaction fields. One workflow
run at a time is enforced by GitHub concurrency.

Categories come from current Monday labels. No new labels are created, and Other
is never silently mapped to Contract. Unknown category/card remains blank.
Ordinary PDFs, PDF-signature octet-stream files, scanned PDFs and PNG/JPEG/WebP
receipt images are read locally with pinned pypdf/PDFium/Pillow and Tesseract.
The existing OpenAI model extracts from email text plus document text/OCR and
independently checks the original PDF/image. Both readings must agree on vendor,
transaction date, total type/amount, reference and printed card digits. Exact source
excerpts must support the output. Paid totals and invoice totals remain distinct;
balance due never substitutes for a payment total. Unknown card/category stays blank.

New unresolved sources create a Need Information item in Submitted Receipts with
blank financial fields, source identity/link, an actionable reason, and safely read
original attachments. Statements, free replacements, multiple transactions and
uncertain values are review holds, never automatically counted as expenses. Existing
historical reconciliation holds remain untouched. Unsupported or active documents
stay in the intact source email and are referenced for manual review.

Receipt attachments are fetched before item creation, uploaded, and read back.
If an upload fails after creation, a later run resumes missing files on the same
source-keyed item. No legacy receipt or approval status is overwritten.

## Run controls

The existing daily 13:00 UTC schedule is live, capped at 25 new pending items per
run. Code-update runs are read-only. Manual runs default to dry_run=true and a
one-item cap; dry_run and max_creates can be set explicitly. The repair passed
live preflight, one pending-item creation/readback, and a second live run which
created zero duplicates. No receipt was approved or posted to a budget sheet.

Existing secrets are reused: MICROSOFT_TENANT_ID, MICROSOFT_CLIENT_ID,
MICROSOFT_CLIENT_SECRET, MAILBOX_USER, MONDAY_API_TOKEN, OPENAI_API_KEY.
MAILBOX_USER must be Tony@jtstrategies.net. No additional credentials or Microsoft
permissions are requested. The importer only uses Microsoft read operations.

Run focused checks with `node --test test/*.test.mjs`. Production installs the document dependencies from PyPI and the Ubuntu package repository; no new service credentials are needed.

## Scheduler limitation

GitHub disabled this public repository's scheduled workflow for inactivity on
September 7, 2026. GitHub can disable schedules after 60 days without repository
activity. Re-enabling is a repair, not a permanent removal of that platform rule.
The last pre-repair job also failed because Promo Materiel was not a valid Monday
label. Check the live workflow state and run history rather than assuming a
successful manual run proves the schedule is healthy.
