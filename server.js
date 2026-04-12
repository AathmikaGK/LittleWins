import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { createHmac, pbkdf2Sync, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

const root = resolve(".");
loadEnv();

const config = {
  port: Number(process.env.PORT || 3000),
  supabaseUrl: stripTrailingSlash(process.env.SUPABASE_URL || ""),
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY || "",
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
  siteUrl: stripTrailingSlash(process.env.SITE_URL || ""),
  transactionsTable: process.env.SUPABASE_TRANSACTIONS_TABLE || "transactions",
  questsTable: process.env.SUPABASE_QUESTS_TABLE || "quest",
  usersTable: process.env.SUPABASE_USERS_TABLE || "user",
  userIdColumn: process.env.SUPABASE_USER_ID_COLUMN || "user_id",
  transactionIdColumn: process.env.SUPABASE_TRANSACTION_ID_COLUMN || "id",
  transactionCategoryColumn: process.env.SUPABASE_TRANSACTION_CATEGORY_COLUMN || "category",
  maxTransactionsForAnalysis: Number(process.env.MAX_TRANSACTIONS_FOR_ANALYSIS || 75),
  appUserId: normalizeOptionalUuid(process.env.APP_USER_ID || ""),
  jwtSecret: cleanEnvValue(process.env.JWT_SECRET || "little-wins-dev-secret-change-me"),
  localUsersFile: resolve(join(root, cleanEnvValue(process.env.LOCAL_USERS_FILE || "local_users.json"))),
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

async function handleRequest(request, response) {
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
      return sendJson(response, {
        user: auth.user,
        needsConfirmation: false,
        message: "Account created. Log in now."
      });
    }

    if (url.pathname === "/api/auth/login" && request.method === "POST") {
      const body = await readJson(request);
      const auth = await login(body);
      return sendJson(response, auth);
    }

    if (url.pathname === "/api/user-goals" && request.method === "GET") {
      const authUser = await getAuthenticatedUser(request);
      const userGoals = await fetchUserGoals(authUser.id);
      return sendJson(response, userGoals);
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

    if (url.pathname.startsWith("/api/user-goals/") && request.method === "PATCH") {
      const authUser = await getAuthenticatedUser(request);
      const id = decodeURIComponent(url.pathname.replace("/api/user-goals/", ""));
      const body = await readJson(request);
      const goal = await updateUserGoal(authUser.id, id, {
        goalName: body.name,
        goalAmount: body.target,
        goalSaved: body.saved,
        category: body.category,
        allocation: body.allocation,
        allocations: body.allocations
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
      if (authUser?.id) await ensureUserSynced(authUser.id);
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
      const authUser = await getOptionalAuthenticatedUser(request);
      const authUserId = authUser?.id || normalizeOptionalUuid(body?.userId || "");
      const result = await updateQuestCompletion(id, Boolean(body?.completion), authUserId, {
        previousCompletion: body?.previousCompletion,
        saving: body?.saving
      });
      return sendJson(response, result);
    }

    return serveStatic(url.pathname, response);
  } catch (error) {
    console.error(error);
    return sendJson(response, { error: error.message || "Something went wrong" }, 500);
  }
}

export default handleRequest;

if (!process.env.VERCEL) {
  const server = createServer(handleRequest);
  server.listen(config.port, () => {
    console.log(`Little Wins is running at http://localhost:${config.port}`);
  });
}

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
  if (!body?.email || !body?.password) {
    throw new Error("Email and password are required.");
  }

  const db = await readLocalUsersDb();
  const email = normalizeEmail(body.email);
  if (db.users.some((user) => user.user_email === email)) {
    throw new Error("An account with this email already exists.");
  }

  const now = new Date().toISOString();
  const password = hashPassword(String(body.password));
  const user = {
    userid: randomUUID(),
    user_email: email,
    password_hash: password.hash,
    password_salt: password.salt,
    full_name: String(body.fullName || "").trim(),
    savings_goal_id: [],
    savings_goal_name: [],
    savings_goal_amount: [],
    savings_goal_saved: [],
    savings_goal_allocation: [],
    Total_saved_littlewins: 0,
    created_at: now,
    updated_at: now
  };

  db.users.push(user);
  await writeLocalUsersDb(db);
  await syncUserToSupabase(user);
  return { user: publicUser(user) };
}

async function upsertUserProfile({ authUserId, email, fullName }) {
  if (!authUserId) throw new Error("A Supabase auth user id is required.");

  return updateUserProfile(authUserId, { email, fullName });
}

async function updateUserProfile(authUserId, { email, fullName }) {
  const db = await readLocalUsersDb();
  const user = db.users.find((item) => item.userid === authUserId);
  if (!user) return null;
  user.user_email = normalizeEmail(email || user.user_email);
  user.full_name = String(fullName || user.full_name || "");
  user.updated_at = new Date().toISOString();
  await writeLocalUsersDb(db);
  await syncUserToSupabase(user);
  return publicUser(user);
}

async function login(body) {
  if (!body?.email || !body?.password) {
    throw new Error("Email and password are required.");
  }

  const db = await readLocalUsersDb();
  const user = db.users.find((item) => item.user_email === normalizeEmail(body.email));
  if (!user || !verifyPassword(String(body.password), user)) {
    throw new Error("Invalid email or password.");
  }

  await syncUserToSupabase(user);

  return {
    access_token: createJwt(user),
    token_type: "bearer",
    expires_in: 60 * 60 * 24 * 7,
    user: publicUser(user)
  };
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

  try {
    const payload = verifyJwt(token);
    const db = await readLocalUsersDb();
    const user = db.users.find((item) => item.userid === payload.sub);
    return user ? publicUser(user) : null;
  } catch {
    return null;
  }
}

async function fetchUserGoals(authUserId) {
  const rows = await fetchUserRows(authUserId);
  return rows[0] ? {
    goals: goalsFromUserRow(rows[0]),
    totalSavedLittleWins: Number(rows[0].Total_saved_littlewins || 0)
  } : { goals: [], totalSavedLittleWins: 0 };
}

async function fetchUserRows(authUserId) {
  const db = await readLocalUsersDb();
  return db.users.filter((user) => user.userid === authUserId);
}

async function saveUserGoal({ authUserId, email, fullName, goalName, goalAmount, goalSaved }) {
  if (!authUserId) throw new Error("A user id is required.");

  const db = await readLocalUsersDb();
  const user = db.users.find((item) => item.userid === authUserId);
  if (!user) throw new Error("User not found.");
  const goal = {
    id: randomUUID(),
    name: String(goalName || "Savings goal"),
    category: "Savings",
    target: Number(goalAmount || 0),
    saved: Number(goalSaved || 0),
    icon: "savings"
  };

  user.user_email = normalizeEmail(email || user.user_email);
  user.full_name = String(fullName || user.full_name || "");
  user.savings_goal_id.unshift(goal.id);
  user.savings_goal_name.unshift(goal.name);
  user.savings_goal_amount.unshift(goal.target);
  user.savings_goal_saved.unshift(goal.saved);
  if (!Array.isArray(user.savings_goal_allocation)) user.savings_goal_allocation = [];
  user.savings_goal_allocation.unshift(0);
  user.savings_goal_allocation = defaultGoalAllocations(user.savings_goal_amount);
  goal.allocation = user.savings_goal_allocation[0] ?? 100;
  user.updated_at = new Date().toISOString();
  await writeLocalUsersDb(db);
  await syncUserToSupabase(user);

  return goal;
}

async function deleteUserGoal(authUserId, id) {
  const db = await readLocalUsersDb();
  const user = db.users.find((item) => item.userid === authUserId);
  if (!user) throw new Error("User not found.");
  const index = user.savings_goal_id.findIndex((goalId) => String(goalId) === String(id));
  if (index === -1) return;
  user.savings_goal_id.splice(index, 1);
  user.savings_goal_name.splice(index, 1);
  user.savings_goal_amount.splice(index, 1);
  user.savings_goal_saved.splice(index, 1);
  if (Array.isArray(user.savings_goal_allocation)) user.savings_goal_allocation.splice(index, 1);
  user.updated_at = new Date().toISOString();
  await writeLocalUsersDb(db);
  await syncUserToSupabase(user);
}

async function updateUserGoal(authUserId, id, { goalName, goalAmount, goalSaved, category, allocation, allocations }) {
  const db = await readLocalUsersDb();
  const user = db.users.find((item) => item.userid === authUserId);
  if (!user) throw new Error("User not found.");

  const index = user.savings_goal_id.findIndex((goalId) => String(goalId) === String(id));
  if (index === -1) throw new Error("Goal not found.");

  user.savings_goal_name[index] = String(goalName || "Savings goal");
  user.savings_goal_amount[index] = Number(goalAmount || 0);
  user.savings_goal_saved[index] = Number(goalSaved || 0);
  if (!Array.isArray(user.savings_goal_allocation)) user.savings_goal_allocation = [];
  user.savings_goal_allocation[index] = Number(allocation || 0);
  if (Array.isArray(allocations)) {
    for (const item of allocations) {
      const allocationIndex = user.savings_goal_id.findIndex((goalId) => String(goalId) === String(item.id));
      if (allocationIndex !== -1) user.savings_goal_allocation[allocationIndex] = Number(item.allocation || 0);
    }
  }
  user.updated_at = new Date().toISOString();
  await writeLocalUsersDb(db);
  await syncUserToSupabase(user);

  return {
    id,
    name: user.savings_goal_name[index],
    category: String(category || "Savings"),
    target: user.savings_goal_amount[index],
    saved: user.savings_goal_saved[index],
    allocation: user.savings_goal_allocation[index],
    icon: "savings"
  };
}

function goalsFromUserRow(row) {
  const goals = normalizeGoalLists(row);
  return goals.savings_goal_name.map((name, index) => ({
    id: goals.savings_goal_id[index],
    name: String(name || "Savings goal"),
    category: "Savings",
    target: goals.savings_goal_amount[index],
    saved: goals.savings_goal_saved[index],
    allocation: goals.savings_goal_allocation[index],
    icon: "savings",
    email: row.user_email,
    fullName: row.full_name
  }));
}

function defaultGoalAllocations(goalAmounts) {
  const weights = Array.isArray(goalAmounts)
    ? goalAmounts.map((amount) => Math.max(0, Number(amount || 0)))
    : [];
  if (!weights.length) return [];

  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  if (totalWeight <= 0) {
    const base = Math.floor(100 / weights.length);
    const remainder = 100 - base * weights.length;
    return weights.map((_, index) => base + (index < remainder ? 1 : 0));
  }

  const raw = weights.map((weight) => (weight / totalWeight) * 100);
  const floored = raw.map(Math.floor);
  let remainder = 100 - floored.reduce((sum, value) => sum + value, 0);
  const order = raw
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((left, right) => right.fraction - left.fraction);

  for (let index = 0; index < order.length && remainder > 0; index += 1) {
    floored[order[index].index] += 1;
    remainder -= 1;
  }

  return floored;
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
Quest saving amounts must be realistic and based on the transaction data:
- Daily quest savings should represent what the user can plausibly save in one day by skipping or reducing that behavior once or twice.
- Weekly quest savings can represent several repeated choices across a week, but should not exceed the user's weekly spending pattern for that category.
- Use observed average transaction amounts when possible. For example, if coffee transactions are usually $4-$8, a daily "skip coffee" quest should save about $5-$8, not $20.
- A daily coffee quest should almost never exceed $10 unless the transaction data clearly shows individual coffee purchases above $10.
- A daily eating-out quest should usually be $15-$30 depending on the user's meal transactions.
- Subscription review quests should use a realistic subscription cost, not a made-up large amount.
- Do not make one daily quest account for a full week's or full month's savings.
- Keep each quest saving lower than or equal to the amount the user could actually avoid by completing that specific task.
Daily and weekly quests must be linked by category:
- Create daily quests as the actions the user can complete today.
- Create weekly quests as read-only trackers for the same categories, not separate user-editable actions.
- For example, a daily quest "Skip coffee today" in category "Coffee" should connect to a weekly quest like "Limit coffee purchases" in category "Coffee".
- Weekly quest savings should be the realistic total for completing the linked daily action multiple times in a week.
- Weekly quest titles and reasons should describe the weekly target, while daily quest titles and reasons should describe today's action.

Category rules:
- Use plain category names such as Coffee, Eating out, Groceries, Transport, Rent or mortgage, Utilities, Subscriptions, Shopping, Entertainment, Income, Health, Education, Travel, or Other.
- Categorise Translink as Travel.
- Categorise restaurants and fast food as Eating out, including Sushi Hub, Sushi Train, Grill'd, Noodle Box, Guzman y Gomez, Subway, McDonald's, KFC, pizza shops, takeaway, food delivery, Uber Eats, and DoorDash.
- Categorise Target, Kmart, Big W, Amazon, department stores, and general retail purchases as Shopping.
- Do not mark rent, mortgage, loan repayments, utilities, or income as excessive spending.
- Excessive spending should focus on controllable recurring habits, especially coffee, eating out, rideshares, subscriptions, shopping, and entertainment. Groceries are a need, but can be mentioned only if there is evidence of unusually high or repeated non-essential grocery spending.
- Daily and weekly goals must be specific, measurable, realistic, and tied to the recurring spending habits you identify.
- Return weekly goals only for categories that also appear in daily goals.
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
    user_id: authUserId || null,
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

async function updateQuestCompletion(id, completion, authUserId, options = {}) {
  assertSupabaseConfig();
  if (!id) throw new Error("Quest id is required.");

  const existingResponse = await fetch(`${config.supabaseUrl}/rest/v1/${encodeURIComponent(config.questsTable)}?id=eq.${encodeURIComponent(id)}&select=id,saving,completion`, {
    headers: supabaseHeaders()
  });

  if (!existingResponse.ok) {
    throw new Error(`Supabase quest fetch failed: ${existingResponse.status} ${await existingResponse.text()}`);
  }

  const existingRows = await existingResponse.json();
  const existingQuest = existingRows[0] || null;
  const hasClientPreviousCompletion = typeof options.previousCompletion === "boolean";
  const wasComplete = hasClientPreviousCompletion ? options.previousCompletion : Boolean(existingQuest?.completion);
  const saving = Number(options.saving ?? existingQuest?.saving ?? 0);

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
  const quest = rows[0] || null;
  const delta = completion === wasComplete ? 0 : completion ? saving : -saving;
  const totalSavedLittleWins = await updateLittleWinsSavings(authUserId, delta);
  return { quest, delta, totalSavedLittleWins };
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
    "daily goals": normalizeQuestAnalysis(result["daily goals"], "daily"),
    "weekly goals": normalizeQuestAnalysis(result["weekly goals"], "weekly")
  };
}

function normalizeQuestAnalysis(quests, questType) {
  return (Array.isArray(quests) ? quests : []).map((quest) => ({
    title: String(quest.title || "Little win"),
    saving: normalizeQuestSaving(quest, questType),
    category: String(quest.category || "Savings"),
    reason: String(quest.reason || ""),
    completion: Boolean(quest.completion)
  }));
}

function normalizeQuestSaving(quest, questType) {
  const category = String(quest.category || "").toLowerCase();
  const rawSaving = Number(quest.saving || 0);
  const dailyCaps = [
    [["coffee", "cafe"], 10],
    [["eating", "restaurant", "takeaway"], 30],
    [["subscription"], 15],
    [["transport", "rideshare", "uber"], 25],
    [["shopping", "entertainment", "hobbies"], 35]
  ];
  const weeklyCaps = [
    [["coffee", "cafe"], 35],
    [["eating", "restaurant", "takeaway"], 90],
    [["subscription"], 40],
    [["transport", "rideshare", "uber"], 70],
    [["shopping", "entertainment", "hobbies"], 100]
  ];
  const caps = questType === "weekly" ? weeklyCaps : dailyCaps;
  const matchedCap = caps.find(([terms]) => terms.some((term) => category.includes(term)))?.[1];
  const defaultCap = questType === "weekly" ? 75 : 25;
  const cap = matchedCap || defaultCap;
  return Math.max(0, Math.min(rawSaving, cap));
}

function inferCategory(transaction) {
  const text = Object.values(transaction).join(" ").toLowerCase();
  const checks = [
    ["Coffee", ["coffee", "cafe", "espresso", "starbucks"]],
    ["Eating out", ["restaurant", "mcdonald", "mcdonalds", "kfc", "uber eats", "doordash", "pizza", "sushi hub", "sushi train", "grill'd", "grilld", "noodle box", "guzman y gomez", "guzman", "subway", "takeaway", "fast food"]],
    ["Groceries", ["grocery", "supermarket", "woolworths", "coles", "aldi"]],
    ["Travel", ["translink"]],
    ["Transport", ["uber", "lyft", "taxi", "bus", "train", "transport"]],
    ["Rent or mortgage", ["rent", "mortgage"]],
    ["Subscriptions", ["netflix", "spotify", "subscription", "apple.com/bill"]],
    ["Shopping", ["amazon", "target", "kmart", "big w", "department store", "retail", "shopping"]],
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

async function readLocalUsersDb() {
  if (useSupabaseUserStore()) {
    return readSupabaseUsersDb();
  }

  try {
    const text = await readFile(config.localUsersFile, "utf8");
    const parsed = JSON.parse(text);
    return {
      users: Array.isArray(parsed.users) ? parsed.users.map(normalizeStoredUser) : []
    };
  } catch {
    return { users: [] };
  }
}

async function writeLocalUsersDb(db) {
  if (useSupabaseUserStore()) {
    await writeSupabaseUsersDb(db);
    return;
  }

  await writeFile(config.localUsersFile, `${JSON.stringify({ users: db.users.map(normalizeStoredUser) }, null, 2)}\n`);
}

async function syncUserToSupabase(user) {
  if (!config.supabaseUrl || !config.supabaseAnonKey) return;
  await upsertSupabaseUser(user);
}

function useSupabaseUserStore() {
  return Boolean(config.supabaseUrl && config.supabaseServiceRoleKey);
}

async function readSupabaseUsersDb() {
  assertSupabaseConfig();
  const response = await fetch(`${config.supabaseUrl}/rest/v1/${encodeURIComponent(config.usersTable)}?select=*`, {
    headers: supabaseHeaders()
  });

  if (!response.ok) {
    throw new Error(`Supabase users fetch failed: ${response.status} ${await response.text()}`);
  }

  const rows = await response.json();
  return {
    users: Array.isArray(rows) ? rows.map(normalizeStoredUser) : []
  };
}

async function writeSupabaseUsersDb(db) {
  const users = Array.isArray(db?.users) ? db.users.map(normalizeStoredUser) : [];
  for (const user of users) {
    await upsertSupabaseUser(user);
  }
}

async function upsertSupabaseUser(user) {
  assertSupabaseConfig();

  const normalizedUser = normalizeStoredUser(user);
  const response = await fetch(`${config.supabaseUrl}/rest/v1/${encodeURIComponent(config.usersTable)}?on_conflict=${encodeURIComponent(config.userIdColumn)}`, {
    method: "POST",
    headers: {
      ...supabaseHeaders(),
      prefer: "resolution=merge-duplicates,return=minimal"
    },
    body: JSON.stringify({
      [config.userIdColumn]: normalizedUser.userid,
      user_email: normalizedUser.user_email,
      password_hash: normalizedUser.password_hash,
      password_salt: normalizedUser.password_salt,
      full_name: normalizedUser.full_name,
      savings_goal_id: normalizedUser.savings_goal_id,
      savings_goal_name: normalizedUser.savings_goal_name,
      savings_goal_amount: normalizedUser.savings_goal_amount,
      savings_goal_saved: normalizedUser.savings_goal_saved,
      Total_saved_littlewins: normalizedUser.Total_saved_littlewins,
      created_at: normalizedUser.created_at,
      updated_at: normalizedUser.updated_at
    })
  });

  if (!response.ok) {
    throw new Error(`Supabase user sync failed: ${response.status} ${await response.text()}`);
  }
}

async function ensureUserSynced(authUserId) {
  const db = await readLocalUsersDb();
  const user = db.users.find((item) => item.userid === authUserId);
  if (user) await syncUserToSupabase(user);
}

async function updateLittleWinsSavings(authUserId, delta) {
  if (!authUserId) throw new Error("You need to log in first.");

  if (!Number.isFinite(Number(delta)) || Number(delta) === 0) {
    const db = await readLocalUsersDb();
    const user = db.users.find((item) => item.userid === authUserId);
    return Number(user?.Total_saved_littlewins || 0);
  }

  const db = await readLocalUsersDb();
  const user = db.users.find((item) => item.userid === authUserId);
  if (!user) throw new Error("User not found.");

  const nextTotal = Math.max(0, Number(user.Total_saved_littlewins || 0) + Number(delta));
  user.Total_saved_littlewins = nextTotal;
  user.updated_at = new Date().toISOString();
  await writeLocalUsersDb(db);
  await syncUserToSupabase(user);
  return nextTotal;
}

function normalizeStoredUser(user) {
  const goals = normalizeGoalLists(user);
  return {
    userid: String(user.userid || user.user_id || randomUUID()),
    user_email: normalizeEmail(user.user_email || user.email || ""),
    password_hash: String(user.password_hash || ""),
    password_salt: String(user.password_salt || ""),
    full_name: String(user.full_name || ""),
    savings_goal_id: goals.savings_goal_id,
    savings_goal_name: goals.savings_goal_name,
    savings_goal_amount: goals.savings_goal_amount,
    savings_goal_saved: goals.savings_goal_saved,
    savings_goal_allocation: goals.savings_goal_allocation,
    Total_saved_littlewins: toMoneyNumber(user.Total_saved_littlewins),
    created_at: user.created_at || new Date().toISOString(),
    updated_at: user.updated_at || new Date().toISOString()
  };
}

function normalizeGoalLists(user) {
  const ids = Array.isArray(user.savings_goal_id) ? user.savings_goal_id : [];
  const names = Array.isArray(user.savings_goal_name) ? user.savings_goal_name : [];
  const amounts = Array.isArray(user.savings_goal_amount) ? user.savings_goal_amount : [];
  const savedAmounts = Array.isArray(user.savings_goal_saved) ? user.savings_goal_saved : [];
  const allocations = Array.isArray(user.savings_goal_allocation) ? user.savings_goal_allocation : [];
  const goalCount = Math.max(ids.length, names.length, amounts.length, savedAmounts.length, allocations.length);
  const goals = {
    savings_goal_id: [],
    savings_goal_name: [],
    savings_goal_amount: [],
    savings_goal_saved: [],
    savings_goal_allocation: []
  };
  const seenGoals = new Set();
  const seenGoalValues = new Set();

  for (let index = 0; index < goalCount; index += 1) {
    const name = String(names[index] || "").trim();
    const amount = toMoneyNumber(amounts[index]);
    const saved = toMoneyNumber(savedAmounts[index]);
    if (!name && amount === 0 && saved === 0) continue;

    const id = String(ids[index] || randomUUID());
    const valueKey = `${(name || "Savings goal").toLowerCase()}|${amount}|${saved}`;
    if (seenGoals.has(id) || seenGoalValues.has(valueKey)) continue;
    seenGoals.add(id);
    seenGoalValues.add(valueKey);

    goals.savings_goal_id.push(id);
    goals.savings_goal_name.push(name || "Savings goal");
    goals.savings_goal_amount.push(amount);
    goals.savings_goal_saved.push(saved);
    goals.savings_goal_allocation.push(toMoneyNumber(allocations[index]));
  }

  return goals;
}

function toMoneyNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function publicUser(user) {
  return {
    id: user.userid,
    email: user.user_email,
    Total_saved_littlewins: Number(user.Total_saved_littlewins || 0),
    user_metadata: {
      full_name: user.full_name || user.user_email.split("@")[0]
    }
  };
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  return {
    salt,
    hash: pbkdf2Sync(password, salt, 120000, 32, "sha256").toString("hex")
  };
}

function verifyPassword(password, user) {
  if (!user.password_hash || !user.password_salt) return false;
  const attempted = Buffer.from(hashPassword(password, user.password_salt).hash, "hex");
  const stored = Buffer.from(user.password_hash, "hex");
  return attempted.length === stored.length && timingSafeEqual(attempted, stored);
}

function createJwt(user) {
  const now = Math.floor(Date.now() / 1000);
  return signJwt({
    sub: user.userid,
    email: user.user_email,
    iat: now,
    exp: now + 60 * 60 * 24 * 7
  });
}

function signJwt(payload) {
  const header = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64UrlEncode(JSON.stringify(payload));
  const signature = jwtSignature(`${header}.${body}`);
  return `${header}.${body}.${signature}`;
}

function verifyJwt(token) {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid token.");
  const [header, body, signature] = parts;
  const expected = jwtSignature(`${header}.${body}`);
  const actual = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actual.length !== expectedBuffer.length || !timingSafeEqual(actual, expectedBuffer)) {
    throw new Error("Invalid token signature.");
  }

  const payload = JSON.parse(base64UrlDecode(body));
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error("Token expired.");
  }
  return payload;
}

function jwtSignature(value) {
  return createHmac("sha256", config.jwtSecret).update(value).digest("base64url");
}

function base64UrlEncode(value) {
  return Buffer.from(value).toString("base64url");
}

function base64UrlDecode(value) {
  return Buffer.from(value, "base64url").toString("utf8");
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
