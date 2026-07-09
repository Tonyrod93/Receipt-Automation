import fs from "node:fs/promises";
import path from "node:path";
import { Client } from "@microsoft/microsoft-graph-client";
import OpenAI from "openai";

const BOARD_ID = "18402506712";
const GROUP_ID = "topics";
const FILE_COLUMN_ID = "file_mm14qmnm";
const PROCESSED_FILE = ".processed-receipts.json";
const TMP_DIR = "tmp";
const COLUMNS = {
  status: "status",
  paymentType: "dropdown_mm14bx05",
  transactionDate: "date4",
  totalAmount: "numeric_mm14k06a",
  vendor: "text_mm14q95",
  category: "dropdown_mm14nmdm",
  description: "text_mm14dkzx",
  notes: "text_mm148sys"
};
const REQUIRED_ENV = [
  "MICROSOFT_TENANT_ID",
  "MICROSOFT_CLIENT_ID",
  "MICROSOFT_CLIENT_SECRET",
  "MAILBOX_USER",
  "MONDAY_API_TOKEN",
  "OPENAI_API_KEY"
];
const FOLDERS_TO_CHECK = [
  "Inbox/Capernaum Receipts",
  "Capernaum Studios/Finance/Capernaum Receipts",
  "Capernaum Studios/Finance/Capernaum Receipts/Ads",
  "Capernaum Studios/Finance/Capernaum Receipts/Holly",
  "Capernaum Studios/Finance/Capernaum Receipts/Stephanie",
  "Capernaum Studios/Finance/Capernaum Receipts/Tony"
];
const CATEGORY_LABELS = ["Promo Materiel", "Advertising", "Subscriptions", "Client Relations", "Travel", "Other"];
const PAYMENT_LABELS = ["Holly's Card", "Tony's Card", "Stephanie's Card"];

function requireEnv() {
  const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
  if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
}

async function getGraphToken() {
  const body = new URLSearchParams({
    client_id: process.env.MICROSOFT_CLIENT_ID,
    client_secret: process.env.MICROSOFT_CLIENT_SECRET,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials"
  });
  const response = await fetch(`https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  if (!response.ok) throw new Error(`Microsoft token request failed: ${response.status} ${await response.text()}`);
  return (await response.json()).access_token;
}

function graphClient(token) {
  return Client.init({ authProvider: (done) => done(null, token) });
}

async function monday(query, variables = {}) {
  const response = await fetch("https://api.monday.com/v2", {
    method: "POST",
    headers: { Authorization: process.env.MONDAY_API_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables })
  });
  const json = await response.json();
  if (!response.ok || json.errors) throw new Error(`Monday API failed: ${JSON.stringify(json.errors || json)}`);
  return json.data;
}

async function loadProcessed() {
  try {
    return new Set(JSON.parse(await fs.readFile(PROCESSED_FILE, "utf8")).messageIds || []);
  } catch {
    return new Set();
  }
}

async function saveProcessed(processed) {
  await fs.writeFile(PROCESSED_FILE, JSON.stringify({ messageIds: [...processed].sort(), updatedAt: new Date().toISOString() }, null, 2));
}

async function listFolders(client) {
  const folders = [];
  async function walk(endpoint, prefix = "") {
    let page = await client.api(endpoint).top(100).get();
    while (page) {
      for (const folder of page.value || []) {
        const folderPath = prefix ? `${prefix}/${folder.displayName}` : folder.displayName;
        folders.push({ ...folder, path: folderPath });
        if (folder.childFolderCount > 0) await walk(`/users/${process.env.MAILBOX_USER}/mailFolders/${folder.id}/childFolders`, folderPath);
      }
      page = page["@odata.nextLink"] ? await client.api(page["@odata.nextLink"]).get() : null;
    }
  }
  await walk(`/users/${process.env.MAILBOX_USER}/mailFolders`);
  return folders;
}

async function listRecentMessages(client, folder) {
  const lookbackDays = Number(process.env.LOOKBACK_DAYS || 7);
  const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();
  const page = await client
    .api(`/users/${process.env.MAILBOX_USER}/mailFolders/${folder.id}/messages`)
    .filter(`receivedDateTime ge ${since}`)
    .orderby("receivedDateTime desc")
    .select("id,subject,body,bodyPreview,sender,toRecipients,receivedDateTime,hasAttachments,webLink")
    .top(50)
    .get();
  return (page.value || []).map((message) => ({ ...message, folderPath: folder.path }));
}

async function readMondayItems() {
  const data = await monday(`query ($boardId: [ID!]) { boards(ids: $boardId) { items_page(limit: 500) { items { id name column_values(ids: ["${COLUMNS.vendor}", "${COLUMNS.transactionDate}", "${COLUMNS.totalAmount}"]) { id text value } } } } }`, { boardId: BOARD_ID });
  return data.boards?.[0]?.items_page?.items || [];
}

function itemKey({ vendor, transactionDate, totalAmount }) {
  return `${String(vendor || "").trim().toLowerCase()}|${transactionDate}|${Number(totalAmount || 0).toFixed(2)}`;
}

function existingItemKeys(items) {
  const keys = new Set();
  for (const item of items) {
    const values = Object.fromEntries((item.column_values || []).map((column) => [column.id, column.text]));
    if (values[COLUMNS.vendor] && values[COLUMNS.transactionDate] && values[COLUMNS.totalAmount]) {
      keys.add(itemKey({ vendor: values[COLUMNS.vendor], transactionDate: values[COLUMNS.transactionDate], totalAmount: values[COLUMNS.totalAmount] }));
    }
  }
  return keys;
}

async function extractReceipt(openai, message) {
  const content = message.body?.content || message.bodyPreview || "";
  const response = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `Extract one marketing receipt from an Outlook email. Return JSON only with: {"is_receipt": boolean, "vendor": string, "transaction_date": "YYYY-MM-DD", "total_amount": number, "payment_type": one of ${JSON.stringify(PAYMENT_LABELS)} or "", "category": one of ${JSON.stringify(CATEGORY_LABELS)}, "description": string, "notes": string, "confidence": "high" | "medium" | "low"}. Use existing labels only. If it is not a receipt/invoice/payment confirmation, set is_receipt false.`
      },
      {
        role: "user",
        content: JSON.stringify({ folder: message.folderPath, subject: message.subject, sender: message.sender, receivedDateTime: message.receivedDateTime, body: content.slice(0, 12000) })
      }
    ]
  });
  return JSON.parse(response.choices[0].message.content);
}

function columnValuesFor(receipt, message) {
  const values = {
    [COLUMNS.status]: { label: "New Submission" },
    [COLUMNS.transactionDate]: { date: receipt.transaction_date },
    [COLUMNS.totalAmount]: String(receipt.total_amount),
    [COLUMNS.vendor]: receipt.vendor,
    [COLUMNS.category]: receipt.category || "Other",
    [COLUMNS.description]: receipt.description || "",
    [COLUMNS.notes]: [
      receipt.notes,
      `Pulled automatically from Outlook folder ${message.folderPath}.`,
      `Email received ${message.receivedDateTime}.`,
      message.webLink ? `Outlook link: ${message.webLink}` : ""
    ].filter(Boolean).join(" ")
  };
  if (PAYMENT_LABELS.includes(receipt.payment_type)) values[COLUMNS.paymentType] = receipt.payment_type;
  return values;
}

async function createMondayItem(receipt, message) {
  const itemName = `${receipt.vendor} - $${Number(receipt.total_amount).toFixed(2)} - ${receipt.transaction_date}`;
  const data = await monday(`mutation ($boardId: ID!, $groupId: String!, $itemName: String!, $columnValues: JSON!) { create_item(board_id: $boardId, group_id: $groupId, item_name: $itemName, column_values: $columnValues) { id name url } }`, {
    boardId: BOARD_ID,
    groupId: GROUP_ID,
    itemName,
    columnValues: JSON.stringify(columnValuesFor(receipt, message))
  });
  return data.create_item;
}

async function listAttachments(client, messageId) {
  const page = await client.api(`/users/${process.env.MAILBOX_USER}/messages/${messageId}/attachments`).top(50).get();
  return (page.value || []).filter((attachment) =>
    attachment["@odata.type"] === "#microsoft.graph.fileAttachment" &&
    !attachment.isInline &&
    /^(application\/pdf|image\/jpeg|image\/png|image\/webp)$/i.test(attachment.contentType || "")
  );
}

async function downloadAttachment(client, messageId, attachment) {
  await fs.mkdir(TMP_DIR, { recursive: true });
  const safeName = attachment.name.replace(/[^\w.\- ()]/g, "_");
  const filePath = path.join(TMP_DIR, `${messageId.slice(0, 12)}-${safeName}`);
  const data = await client.api(`/users/${process.env.MAILBOX_USER}/messages/${messageId}/attachments/${attachment.id}`).get();
  await fs.writeFile(filePath, Buffer.from(data.contentBytes, "base64"));
  return filePath;
}

async function uploadFileToMonday(itemId, filePath, attachment) {
  const query = `mutation addFile($file: File!) { add_file_to_column(item_id: ${itemId}, column_id: "${FILE_COLUMN_ID}", file: $file) { id name } }`;
  const bytes = await fs.readFile(filePath);
  const form = new FormData();
  form.append("query", query);
  form.append("variables[file]", new Blob([bytes], { type: attachment.contentType }), attachment.name);
  const response = await fetch("https://api.monday.com/v2/file", { method: "POST", headers: { Authorization: process.env.MONDAY_API_TOKEN }, body: form });
  const json = await response.json();
  if (!response.ok || json.errors) throw new Error(`Monday file upload failed: ${JSON.stringify(json.errors || json)}`);
  return json.data.add_file_to_column;
}

async function main() {
  requireEnv();
  const processed = await loadProcessed();
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const client = graphClient(await getGraphToken());
  const folders = await listFolders(client);
  const targetFolders = folders.filter((folder) => FOLDERS_TO_CHECK.includes(folder.path));
  if (!targetFolders.length) throw new Error("No Capernaum receipt folders found in mailbox");
  const duplicateKeys = existingItemKeys(await readMondayItems());
  const summary = { checked: 0, created: 0, duplicates: 0, attachmentsUploaded: 0, skipped: 0 };

  for (const folder of targetFolders) {
    for (const message of await listRecentMessages(client, folder)) {
      summary.checked += 1;
      if (processed.has(message.id)) { summary.skipped += 1; continue; }
      const receipt = await extractReceipt(openai, message);
      if (!receipt.is_receipt || receipt.confidence === "low") { summary.skipped += 1; continue; }
      const key = itemKey({ vendor: receipt.vendor, transactionDate: receipt.transaction_date, totalAmount: receipt.total_amount });
      if (duplicateKeys.has(key)) { processed.add(message.id); summary.duplicates += 1; continue; }
      const item = await createMondayItem(receipt, message);
      duplicateKeys.add(key);
      processed.add(message.id);
      summary.created += 1;
      if (message.hasAttachments) {
        for (const attachment of await listAttachments(client, message.id)) {
          await uploadFileToMonday(item.id, await downloadAttachment(client, message.id, attachment), attachment);
          summary.attachmentsUploaded += 1;
        }
      }
    }
  }

  await saveProcessed(processed);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
