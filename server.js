import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";

const root = resolve(".");
loadEnv();

const config = {
  port: Number(process.env.PORT || 3000),
  supabaseUrl: stripTrailingSlash(process.env.SUPABASE_URL || ""),
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY || "",
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
  transactionsTable: process.env.SUPABASE_TRANSACTIONS_TABLE || "transactions",
  questsTable: process.env.SUPABASE_QUESTS_TABLE || "quest",
  usersTable: process.env.SUPABASE_USERS_TABLE || "user",
  transactionIdColumn: process.env.SUPABASE_TRANSACTION_ID_COLUMN || "id",
  transactionCategoryColumn: process.env.SUPABASE_TRANSACTION_CATEGORY_COLUMN || "category",
  maxTransactionsForAnalysis: Number(process.env.MAX_TRANSACTIONS_FOR_ANALYSIS || 75),
  appUserId: normalizeOptionalUuid(process.env.APP_USER_ID || ""),
  openaiApiKey: process.env.OPENAI_API_KEY || "",
  openaiModel: cleanEnvValue(process.env.OPENAI_MODEL || "gpt-4o-mini")
};

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg"
};

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host}`);

    if (url.pathname === "/api/config") {
      return sendJson(response, {
        configured: Boolean(config.supabaseUrl && config.supabaseAnonKey && config.openaiApiKey),
        supabase: Boolean(config.supabaseUrl && config.supabaseAnonKey),
        ai: Boolean(config.openaiApiKey),
        provider: "openai",
        model: config.openaiModel,
        table: config.transactionsTable,
        questsTable: config.questsTable,
        maxTransactionsForAnalysis: config.maxTransactionsForAnalysis
      });
    }

    if (url.pathname === "/api/transactions" && request.method === "GET") {
      const transactions = await fetchTransactions();
      return sendJson(response, { transactions });
    }

    if (url.pathname === "/api/auth/signup" && request.method === "POST") {
      const body = await readJson(request);
      const auth = await signUp(body);
      const user = auth.user || auth.session?.user;
      if (user) {
        await upsertUserProfile({
          authUserId: user.id,
          email: user.email || body.email,
          fullName: body.fullName
        });
      }
      return sendJson(response, auth);
    }

    if (url.pathname === "/api/auth/login" && request.method === "POST") {
      const body = await readJson(request);
      const auth = await login(body);
      if (auth.user) {
        await upsertUserProfile({
          authUserId: auth.user.id,
          email: auth.user.email || body.email,
          fullName: auth.user.user_metadata?.full_name || body.fullName || ""
        });
      }
      return sendJson(response, auth);
    }

    if (url.pathname === "/api/user-goals" && request.method === "GET") {
      const authUser = await getAuthenticatedUser(request);
      const goals = await fetchUserGoals(authUser.id);
      return sendJson(response, { goals });
    }

    if (url.pathname === "/api/user-goals" && request.method === "POST") {
      const authUser = await getAuthenticatedUser(request);
      const body = await readJson(request);
      const goal = await saveUserGoal({
        authUserId: authUser.id,
        email: authUser.email,
        fullName: body.fullName,
        goalName: body.name,
        goalAmount: body.target,
        goalSaved: body.saved
      });
      return sendJson(response, { goal });
    }

    if (url.pathname.startsWith("/api/user-goals/") && request.method === "DELETE") {
      const authUser = await getAuthenticatedUser(request);
      const id = decodeURIComponent(url.pathname.replace("/api/user-goals/", ""));
      await deleteUserGoal(authUser.id, id);
      return sendJson(response, { ok: true });
    }

    if (url.pathname === "/api/analyse" && request.method === "POST") {
      const body = await readJson(request);
      const authUser = await getOptionalAuthenticatedUser(request);
      const transactions = await fetchTransactions();
      const result = await analyseTransactions(transactions, body?.goals || []);
      const categorizedTransactions = normalizeCategorizedTransactions(
        transactions,
        result.categorized_transactions || result.categorizedTransactions || []
      );
      const analysis = normalizeAnalysis(result);

      await updateTransactionCategories(categorizedTransactions);
      const savedQuests = await saveGeneratedQuests(analysis, authUser?.id);
      attachSavedQuestsToAnalysis(analysis, savedQuests);

      return sendJson(response, {
        analysis,
        categorizedTransactions,
        savedQuests
      });
    }

    if (url.pathname.startsWith("/api/quests/") && request.method === "PATCH") {
      const id = decodeURIComponent(url.pathname.replace("/api/quests/", ""));
      const body = await readJson(request);
      const quest = await updateQuestCompletion(id, Boolean(body?.completion));
      return sendJson(response, { quest });
    }

    return serveStatic(url.pathname, response);
  } catch (error) {
    console.error(error);
    return sendJson(response, { error: error.message || "Something went wrong" }, 500);
  }
});

server.listen(config.port, () => {
  console.log(`Little Wins is running at http://localhost:${config.port}`);
});

async function serveStatic(pathname, response) {
  const filePath = pathname === "/" ? "/index.html" : pathname;
  const fullPath = resolve(join(root, filePath));

  if (!fullPath.startsWith(root)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const file = await readFile(fullPath);
    response.writeHead(200, {
      "content-type": mimeTypes[extname(fullPath)] || "application/octet-stream"
    });
    response.end(file);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
}

async function fetchTransactions() {
  assertSupabaseConfig();
  const url = `${config.supabaseUrl}/rest/v1/${encodeURIComponent(config.transactionsTable)}?select=*`;
  const response = await fetch(url, {
    headers: supabaseHeaders()
  });

  if (!response.ok) {
    throw new Error(`Supabase transactions fetch failed: ${response.status} ${await response.text()}`);
  }

  const transactions = await response.json();
  return transactions.map((transaction) => normalizeTransactionForClient(transaction));
}

async function signUp(body) {
  assertSupabaseConfig();
  if (!body?.email || !body?.password) {
    throw new Error("Email and password are required.");
  }

  const response = await fetch(`${config.supabaseUrl}/auth/v1/signup`, {
    method: "POST",
    headers: supabaseAuthHeaders(),
    body: JSON.stringify({
      email: String(body.email).trim(),
      password: String(body.password),
      data: {
        full_name: String(body.fullName || "").trim()
      }
    })
  });

  if (!response.ok) {
    throw new Error(`Supabase sign up failed: ${response.status} ${await response.text()}`);
  }

  return response.json();
}

async function upsertUserProfile({ authUserId, email, fullName }) {
  assertSupabaseConfig();
  if (!authUserId) throw new Error("A Supabase auth user id is required.");

  const existingRows = await fetchUserRows(authUserId);
  if (existingRows.length) {
    return updateUserProfile(existingRows[0].id, { email, fullName });
  }

  return saveUserGoal({
    authUserId,
    email,
    fullName,
    goalName: "First savings goal",
    goalAmount: 0,
    goalSaved: 0
  });
}

async function updateUserProfile(id, { email, fullName }) {
  const response = await fetch(`${config.supabaseUrl}/rest/v1/${encodeURIComponent(config.usersTable)}?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: {
      ...supabaseHeaders(),
      prefer: "return=representation"
    },
    body: JSON.stringify({
      email: String(email || ""),
      full_name: String(fullName || "")
    })
  });

  if (!response.ok) {
    throw new Error(`Supabase user profile update failed: ${response.status} ${await response.text()}`);
  }

  const rows = await response.json();
  return rows[0];
}

async function login(body) {
  assertSupabaseConfig();
  if (!body?.email || !body?.password) {
    throw new Error("Email and password are required.");
  }

  const response = await fetch(`${config.supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: supabaseAuthHeaders(),
    body: JSON.stringify({
      email: String(body.email).trim(),
      password: String(body.password)
    })
  });

  if (!response.ok) {
    throw new Error(`Supabase login failed: ${response.status} ${await response.text()}`);
  }

  return response.json();
}

async function getAuthenticatedUser(request) {
  const user = await getOptionalAuthenticatedUser(request);
  if (!user) throw new Error("You need to log in first.");
  return user;
}

async function getOptionalAuthenticatedUser(request) {
  const authorization = request.headers.authorization || "";
  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;

  const response = await fetch(`${config.supabaseUrl}/auth/v1/user`, {
    headers: supabaseAuthHeaders(token)
  });

  if (!response.ok) return null;
  return response.json();
}

async function fetchUserGoals(authUserId) {
  assertSupabaseConfig();
  const rows = await fetchUserRows(authUserId);
  return rows.filter((row) => row.savings_goal_name !== "First savings goal" || Number(row.savings_goal_amount || 0) > 0).map(userGoalRowToGoal);
}

async function fetchUserRows(authUserId) {
  const url = `${config.supabaseUrl}/rest/v1/${encodeURIComponent(config.usersTable)}?auth_user_id=eq.${encodeURIComponent(authUserId)}&select=*&order=created_at.desc`;
  const response = await fetch(url, {
    headers: supabaseHeaders()
  });

  if (!response.ok) {
    throw new Error(`Supabase user goals fetch failed: ${response.status} ${await response.text()}`);
  }

  return response.json();
}

async function saveUserGoal({ authUserId, email, fullName, goalName, goalAmount, goalSaved }) {
  assertSupabaseConfig();
  if (!authUserId) throw new Error("A Supabase auth user id is required.");

  const body = {
    auth_user_id: authUserId,
    email: String(email || ""),
    full_name: String(fullName || ""),
    savings_goal_name: String(goalName || "Savings goal"),
    savings_goal_amount: Number(goalAmount || 0),
    savings_goal_saved: Number(goalSaved || 0)
  };

  const response = await fetch(`${config.supabaseUrl}/rest/v1/${encodeURIComponent(config.usersTable)}`, {
    method: "POST",
    headers: {
      ...supabaseHeaders(),
      prefer: "return=representation"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`Supabase user goal save failed: ${response.status} ${await response.text()}`);
  }

  const rows = await response.json();
  return userGoalRowToGoal(rows[0]);
}

async function deleteUserGoal(authUserId, id) {
  assertSupabaseConfig();
  const response = await fetch(`${config.supabaseUrl}/rest/v1/${encodeURIComponent(config.usersTable)}?id=eq.${encodeURIComponent(id)}&auth_user_id=eq.${encodeURIComponent(authUserId)}`, {
    method: "DELETE",
    headers: supabaseHeaders(true)
  });

  if (!response.ok) {
    throw new Error(`Supabase user goal delete failed: ${response.status} ${await response.text()}`);
  }
}

function userGoalRowToGoal(row) {
  return {
    id: row.id,
    name: row.savings_goal_name,
    category: "Savings",
    target: Number(row.savings_goal_amount || 0),
    saved: Number(row.savings_goal_saved || 0),
    icon: "savings",
    email: row.email,
    fullName: row.full_name
  };
}

async function analyseTransactions(transactions, goals) {
  if (!config.openaiApiKey) {
    throw new Error("OPENAI_API_KEY is missing. Add it to .env before running AI analysis.");
  }

  const transactionsForAnalysis = transactions.slice(0, Math.max(1, config.maxTransactionsForAnalysis));
  const response = await requestOpenAIJson(transactionsForAnalysis, goals);

  if (!response.ok) {
    throw new Error(`OpenAI analysis failed: ${response.status} ${await response.text()}`);
  }

  const payload = await response.json();
  return parseJsonFromModel(extractOpenAIText(payload));
}

async function requestOpenAIJson(transactions, goals) {
  return fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.openaiApiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: config.openaiModel,
      temperature: 0.2,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: "You are a budgeting assistant for a mobile app named Little Wins. Speak directly to the user using supportive second-person language. Return only data that follows the provided JSON schema."
            }
          ]
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: buildAnalysisPrompt(transactions, goals)
            }
          ]
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "little_wins_spending_analysis",
          strict: true,
          schema: analysisSchema()
        }
      },
      max_output_tokens: 1800
    })
  });
}

function buildAnalysisPrompt(transactions, goals) {
  return `
Analyse the transaction history from a Supabase transactions table and the user's saving goals.
For every individual transaction, infer one concise finalized category and return that category with the original transaction id as a string. The app will write those finalized values into the Supabase category column.

Speak directly to the user in the summary and quest reasons, using "you" and "your".
Identify only the top categories with unnecessary or excessive spending. Do not list categories that are normal or unavoidable.
For each excessive category, include how many transactions in that category are unnecessary.

Use the 50/30/20 budget rule:
- 50% of income can go to needs: rent or mortgage, utilities, groceries, transport needed for work, insurance, health essentials, and minimum loan payments.
- 30% of income can go to wants: coffee, eating out, entertainment, hobbies, shopping, subscriptions, rideshares, and non-essential travel.
- 20% of income should go to savings.

Determine whether spending is unnecessary or excessive proportionate to the user's income. Estimate income from transactions categorized as Income, salary, pay, wages, transfer in, or deposits that appear to be income. If income is unclear, say that in the summary and judge unnecessary spending by frequency and category pattern.
When generating daily and weekly quests, make the tasks help the user move toward saving 20% of income. Quests should reduce unnecessary wants or redirect a specific amount toward savings.

Category rules:
- Use plain category names such as Coffee, Eating out, Groceries, Transport, Rent or mortgage, Utilities, Subscriptions, Shopping, Entertainment, Income, Health, Education, Travel, or Other.
- Do not mark rent, mortgage, loan repayments, utilities, or income as excessive spending.
- Excessive spending should focus on controllable recurring habits, especially coffee, eating out, rideshares, subscriptions, shopping, and entertainment. Groceries are a need, but can be mentioned only if there is evidence of unusually high or repeated non-essential grocery spending.
- Daily and weekly goals must be specific, measurable, realistic, and tied to the recurring spending habits you identify.
- Return 2 to 5 excessive categories at most.
- Return 2 to 4 daily goals and 2 to 4 weekly goals.

Transactions:
${JSON.stringify(transactions, null, 2)}

Saving goals:
${JSON.stringify(goals, null, 2)}
`.trim();
}

function analysisSchema() {
  const goalSchema = {
    type: "object",
    additionalProperties: false,
    required: ["title", "saving", "category", "reason", "completion"],
    properties: {
      title: { type: "string" },
      saving: { type: "number" },
      category: { type: "string" },
      reason: { type: "string" },
      completion: { type: "boolean" }
    }
  };

  return {
    type: "object",
    additionalProperties: false,
    required: ["excessive spending", "daily goals", "weekly goals", "categorized_transactions"],
    properties: {
      "excessive spending": {
        type: "object",
        additionalProperties: false,
        required: ["summary", "estimated_income", "needs_budget", "wants_budget", "savings_target", "categories"],
        properties: {
          summary: { type: "string" },
          estimated_income: { type: "number" },
          needs_budget: { type: "number" },
          wants_budget: { type: "number" },
          savings_target: { type: "number" },
          categories: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["category", "amount", "transaction_count", "unnecessary_transaction_count", "reason"],
              properties: {
                category: { type: "string" },
                amount: { type: "number" },
                transaction_count: { type: "number" },
                unnecessary_transaction_count: { type: "number" },
                reason: { type: "string" }
              }
            }
          }
        }
      },
      "daily goals": {
        type: "array",
        items: goalSchema
      },
      "weekly goals": {
        type: "array",
        items: goalSchema
      },
      categorized_transactions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "category"],
          properties: {
            id: { type: "string" },
            category: { type: "string" }
          }
        }
      }
    }
  };
}

async function saveGeneratedQuests(analysis, authUserId) {
  assertSupabaseConfig();
  const quests = [
    ...normalizeQuestRows(analysis["daily goals"], "daily", authUserId),
    ...normalizeQuestRows(analysis["weekly goals"], "weekly", authUserId)
  ];

  if (!quests.length) return [];

  const response = await fetch(`${config.supabaseUrl}/rest/v1/${encodeURIComponent(config.questsTable)}`, {
    method: "POST",
    headers: {
      ...supabaseHeaders(),
      prefer: "return=representation"
    },
    body: JSON.stringify(quests)
  });

  if (!response.ok) {
    throw new Error(`Supabase quest save failed: ${response.status} ${await response.text()}`);
  }

  return response.json();
}

function normalizeQuestRows(quests, questType, authUserId) {
  return (Array.isArray(quests) ? quests : []).map((quest) => ({
    user_id: config.appUserId || authUserId || null,
    quest_type: questType,
    title: String(quest.title || "Little win"),
    saving: Number(quest.saving || 0),
    category: String(quest.category || "Savings"),
    reason: String(quest.reason || ""),
    completion: Boolean(quest.completion)
  }));
}

function attachSavedQuestsToAnalysis(analysis, savedQuests) {
  const daily = savedQuests.filter((quest) => quest.quest_type === "daily");
  const weekly = savedQuests.filter((quest) => quest.quest_type === "weekly");

  analysis["daily goals"] = mergeSavedQuestRows(analysis["daily goals"], daily);
  analysis["weekly goals"] = mergeSavedQuestRows(analysis["weekly goals"], weekly);
}

function mergeSavedQuestRows(quests, savedRows) {
  return quests.map((quest, index) => ({
    ...quest,
    id: savedRows[index]?.id || quest.id,
    completion: Boolean(savedRows[index]?.completion ?? quest.completion)
  }));
}

async function updateQuestCompletion(id, completion) {
  assertSupabaseConfig();
  if (!id) throw new Error("Quest id is required.");

  const response = await fetch(`${config.supabaseUrl}/rest/v1/${encodeURIComponent(config.questsTable)}?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: {
      ...supabaseHeaders(),
      prefer: "return=representation"
    },
    body: JSON.stringify({ completion })
  });

  if (!response.ok) {
    throw new Error(`Supabase quest completion update failed: ${response.status} ${await response.text()}`);
  }

  const rows = await response.json();
  return rows[0] || null;
}

async function updateTransactionCategories(categorizedTransactions) {
  assertSupabaseConfig();
  const updates = categorizedTransactions.filter((transaction) => transaction.id != null && transaction.category);
  const headers = supabaseHeaders(true);

  for (const update of updates) {
    const id = encodeURIComponent(String(update.id));
    const body = JSON.stringify({ [config.transactionCategoryColumn]: update.category });
    const url = `${config.supabaseUrl}/rest/v1/${encodeURIComponent(config.transactionsTable)}?${encodeURIComponent(config.transactionIdColumn)}=eq.${id}`;
    const response = await fetch(url, {
      method: "PATCH",
      headers,
      body
    });

    if (!response.ok) {
      throw new Error(`Supabase category update failed for ${update.id}: ${response.status} ${await response.text()}`);
    }
  }
}

function normalizeCategorizedTransactions(transactions, categorizedTransactions) {
  const fallback = new Map(
    transactions.map((transaction) => [
      String(transaction[config.transactionIdColumn]),
      {
        ...transaction,
        id: transaction[config.transactionIdColumn],
        category: inferCategory(transaction)
      }
    ])
  );

  for (const item of categorizedTransactions) {
    if (item?.id == null || !item?.category) continue;
    const original = transactions.find((transaction) => String(transaction[config.transactionIdColumn]) === String(item.id)) || {};
    fallback.set(String(item.id), {
      ...original,
      id: original[config.transactionIdColumn] ?? item.id,
      category: String(item.category).trim()
    });
  }

  return [...fallback.values()];
}

function normalizeTransactionForClient(transaction) {
  return {
    ...transaction,
    id: transaction[config.transactionIdColumn],
    category: transaction[config.transactionCategoryColumn] || transaction.category || ""
  };
}

function normalizeAnalysis(result) {
  const excessive = result["excessive spending"] && typeof result["excessive spending"] === "object"
    ? result["excessive spending"]
    : {};

  return {
    "excessive spending": {
      summary: String(excessive.summary || "Recurring spending analysis complete."),
      estimated_income: Number(excessive.estimated_income || 0),
      needs_budget: Number(excessive.needs_budget || 0),
      wants_budget: Number(excessive.wants_budget || 0),
      savings_target: Number(excessive.savings_target || 0),
      categories: Array.isArray(excessive.categories) ? excessive.categories : []
    },
    "daily goals": normalizeQuestAnalysis(result["daily goals"]),
    "weekly goals": normalizeQuestAnalysis(result["weekly goals"])
  };
}

function normalizeQuestAnalysis(quests) {
  return (Array.isArray(quests) ? quests : []).map((quest) => ({
    title: String(quest.title || "Little win"),
    saving: Number(quest.saving || 0),
    category: String(quest.category || "Savings"),
    reason: String(quest.reason || ""),
    completion: Boolean(quest.completion)
  }));
}

function inferCategory(transaction) {
  const text = Object.values(transaction).join(" ").toLowerCase();
  const checks = [
    ["Coffee", ["coffee", "cafe", "espresso", "starbucks"]],
    ["Eating out", ["restaurant", "mcdonald", "kfc", "uber eats", "doordash", "pizza"]],
    ["Groceries", ["grocery", "supermarket", "woolworths", "coles", "aldi"]],
    ["Transport", ["uber", "lyft", "taxi", "bus", "train", "transport"]],
    ["Rent or mortgage", ["rent", "mortgage"]],
    ["Subscriptions", ["netflix", "spotify", "subscription", "apple.com/bill"]],
    ["Shopping", ["amazon", "target", "kmart", "shopping"]],
    ["Utilities", ["electric", "water", "gas", "internet", "phone"]]
  ];

  const match = checks.find(([, terms]) => terms.some((term) => text.includes(term)));
  return match ? match[0] : "Other";
}

function parseJsonFromModel(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("OpenAI did not return valid JSON.");
    return JSON.parse(match[0]);
  }
}

function extractOpenAIText(payload) {
  if (payload.output_text) return payload.output_text;

  const content = payload.output
    ?.flatMap((item) => item.content || [])
    ?.find((item) => item.type === "output_text" || item.text);

  if (content?.text) return content.text;
  throw new Error("OpenAI did not return JSON text.");
}

function supabaseHeaders(preferRepresentation = false) {
  const key = config.supabaseServiceRoleKey || config.supabaseAnonKey;
  return {
    apikey: config.supabaseAnonKey,
    authorization: `Bearer ${key}`,
    "content-type": "application/json",
    ...(preferRepresentation ? { prefer: "return=minimal" } : {})
  };
}

function supabaseAuthHeaders(accessToken = config.supabaseAnonKey) {
  return {
    apikey: config.supabaseAnonKey,
    authorization: `Bearer ${accessToken}`,
    "content-type": "application/json"
  };
}

function assertSupabaseConfig() {
  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    throw new Error("Supabase is not configured. Add SUPABASE_URL and SUPABASE_ANON_KEY to .env.");
  }
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function sendJson(response, body, status = 200) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function loadEnv() {
  try {
    const envPath = join(root, ".env");
    const text = readFileSync(envPath, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const index = trimmed.indexOf("=");
      if (index === -1) continue;
      const key = trimmed.slice(0, index).trim();
      const value = cleanEnvValue(trimmed.slice(index + 1));
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // The app can still serve the UI with placeholder configuration.
  }
}

function stripTrailingSlash(value) {
  return value.replace(/\/$/, "");
}

function cleanEnvValue(value) {
  return String(value)
    .replace(/\s+#.*$/, "")
    .trim()
    .replace(/^['"]|['"]$/g, "")
    .trim();
}

function normalizeOptionalUuid(value) {
  const cleaned = cleanEnvValue(value);
  if (!cleaned || cleaned === "00000000-0000-0000-0000-000000000000") return "";
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidPattern.test(cleaned) ? cleaned : "";
}
