const fallbackDailyGoals = [
  { title: "No Coffee Today", saving: 5, category: "Coffee", reason: "Brew at home and keep the small win." },
  { title: "Grocery List Only", saving: 10, category: "Groceries", reason: "Buy only what is on the list." }
];

const fallbackWeeklyGoals = [
  { title: "No Eating Out", saving: 50, category: "Eating out", reason: "Meal prep three dinners before the week gets loud." },
  { title: "Public Transport Streak", saving: 30, category: "Transport", reason: "Swap rideshares for bus or train trips." }
];

const state = {
  session: loadSession(),
  user: null,
  goals: [],
  totalSavedLittleWins: Number(loadSession()?.user?.Total_saved_littlewins || 0),
  analysis: null
};

const elements = {
  appShell: document.querySelectorAll(".app-shell"),
  authScreen: document.querySelector("#auth-screen"),
  loginForm: document.querySelector("#login-form"),
  signupForm: document.querySelector("#signup-form"),
  authMessage: document.querySelector("#auth-message"),
  logoutButton: document.querySelector("#logout-button"),
  profileTitle: document.querySelector("#profile-title"),
  profileEmail: document.querySelector("#profile-email"),
  profileMessage: document.querySelector("#profile-message"),
  goalsList: document.querySelector("#goals-list"),
  goalForm: document.querySelector("#goal-form"),
  openGoalForm: document.querySelector("#open-goal-form"),
  analyseButton: document.querySelector("#analyse-button"),
  analysisOutput: document.querySelector("#analysis-output"),
  refreshTransactions: document.querySelector("#refresh-transactions"),
  transactionsList: document.querySelector("#transactions-list"),
  dailyQuests: document.querySelector("#daily-quests"),
  weeklyQuests: document.querySelector("#weekly-quests"),
  totalSaved: document.querySelector("#total-saved"),
  questProgressLabel: document.querySelector("#quest-progress-label"),
  questProgressBar: document.querySelector("#quest-progress-bar"),
  buddyMessage: document.querySelector("#buddy-message")
};

bindEvents();
init();

function bindEvents() {
  document.querySelectorAll("[data-screen]").forEach((button) => {
    button.addEventListener("click", () => showScreen(button.dataset.screen));
  });

  elements.openGoalForm.addEventListener("click", () => {
    elements.goalForm.classList.toggle("hidden");
  });

  document.querySelectorAll("[data-auth-tab]").forEach((button) => {
    button.addEventListener("click", () => showAuthTab(button.dataset.authTab));
  });

  elements.loginForm.addEventListener("submit", login);
  elements.signupForm.addEventListener("submit", signup);
  elements.logoutButton.addEventListener("click", logout);

  elements.goalForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(elements.goalForm);
    const goalInput = {
      name: String(form.get("name") || "").trim(),
      target: Number(form.get("target") || 0),
      saved: Number(form.get("saved") || 0),
      category: String(form.get("category") || "Custom").trim()
    };

    const goal = await saveGoalToApi(goalInput);
    state.goals = [goal || { ...goalInput, id: crypto.randomUUID(), icon: "savings" }, ...state.goals];
    saveGoals();
    elements.goalForm.reset();
    elements.goalForm.classList.add("hidden");
    render();
  });

  elements.analyseButton.addEventListener("click", analyseSpending);
  elements.refreshTransactions.addEventListener("click", loadTransactions);
}

async function init() {
  renderAuthState();
  if (state.session?.access_token) {
    await loadUserGoals();
    await checkConfiguration();
  }
  render();
}

function renderAuthState() {
  const signedIn = Boolean(state.session?.access_token);
  elements.authScreen.classList.toggle("hidden", signedIn);
  elements.appShell.forEach((element) => element.classList.toggle("hidden", !signedIn));

  const user = state.session?.user;
  const fullName = user?.user_metadata?.full_name || user?.email?.split("@")[0] || "Your Profile";
  if (elements.profileTitle) elements.profileTitle.textContent = fullName;
  if (elements.profileEmail) elements.profileEmail.textContent = user?.email || "";
  if (elements.profileMessage) elements.profileMessage.textContent = `Ready to help you protect your progress, ${fullName}.`;
}

function showAuthTab(tab) {
  document.querySelectorAll("[data-auth-tab]").forEach((button) => {
    button.classList.toggle("active", button.dataset.authTab === tab);
  });
  elements.loginForm.classList.toggle("hidden", tab !== "login");
  elements.signupForm.classList.toggle("hidden", tab !== "signup");
  setAuthMessage("");
}

async function login(event) {
  event.preventDefault();
  const form = new FormData(elements.loginForm);
  setAuthMessage("Logging you in...");

  try {
    const payload = await apiFetch("/api/auth/login", {
      method: "POST",
      body: {
        email: form.get("email"),
        password: form.get("password")
      },
      auth: false
    });
    setSession(payload);
    await init();
    setAuthMessage("");
  } catch (error) {
    setAuthMessage(error.message);
  }
}

async function signup(event) {
  event.preventDefault();
  const form = new FormData(elements.signupForm);
  setAuthMessage("Creating your account...");

  try {
    const payload = await apiFetch("/api/auth/signup", {
      method: "POST",
      body: {
        fullName: form.get("fullName"),
        email: form.get("email"),
        password: form.get("password")
      },
      auth: false
    });

    state.goals = [];
    state.totalSavedLittleWins = 0;
    saveGoals();
    showAuthTab("login");
    setAuthMessage(payload.needsConfirmation
      ? "Account created. Confirm your email, then log in."
      : "Account created. Log in now.");
  } catch (error) {
    setAuthMessage(error.message);
  }
}

function logout() {
  state.session = null;
  state.user = null;
  state.goals = [];
  state.totalSavedLittleWins = 0;
  localStorage.removeItem("little-wins-session");
  localStorage.removeItem("little-wins-goals");
  renderAuthState();
  render();
}

function setSession(payload) {
  state.totalSavedLittleWins = Number(payload.user?.Total_saved_littlewins || 0);
  state.session = {
    access_token: payload.access_token,
    refresh_token: payload.refresh_token,
    user: payload.user
  };
  localStorage.setItem("little-wins-session", JSON.stringify(state.session));
}

function setAuthMessage(message) {
  elements.authMessage.textContent = message;
}

function showScreen(screen) {
  document.querySelectorAll(".screen").forEach((section) => {
    section.classList.toggle("active", section.id === `${screen}-screen`);
  });
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.screen === screen);
  });
}

function render() {
  renderGoals();
  renderQuests();
}

function renderGoals() {
  elements.goalsList.innerHTML = state.goals.map((goal, index) => {
    const progress = goal.target > 0 ? Math.min(100, Math.round((goal.saved / goal.target) * 100)) : 0;
    const remaining = Math.max(0, goal.target - goal.saved);
    return `
      <article class="goal-card">
        <div class="goal-top">
          <div class="goal-title">
            <div class="goal-icon ${index % 2 ? "alt" : ""}">
              <span class="material-symbols-outlined">${escapeHtml(goal.icon || "savings")}</span>
            </div>
            <div>
              <h3>${escapeHtml(goal.name)}</h3>
              <p class="muted">${escapeHtml(goal.category || "Custom")}</p>
            </div>
          </div>
          <button class="delete-goal" data-delete-goal="${goal.id}" aria-label="Delete ${escapeHtml(goal.name)}">
            <span class="material-symbols-outlined">delete</span>
          </button>
        </div>
        <div class="progress-copy">
          <span>Progress</span>
          <span>${progress}%</span>
        </div>
        <div class="progress-track" style="--progress:${progress}%"><span></span></div>
        <p class="muted">${formatMoney(goal.saved)} saved • ${formatMoney(remaining)} to go</p>
      </article>
    `;
  }).join("");

  document.querySelectorAll("[data-delete-goal]").forEach((button) => {
    button.addEventListener("click", async () => {
      await deleteGoalFromApi(button.dataset.deleteGoal);
      state.goals = state.goals.filter((goal) => goal.id !== button.dataset.deleteGoal);
      saveGoals();
      render();
    });
  });

  renderTotalSaved();
}

function renderQuests() {
  const dailyGoals = asArray(state.analysis?.["daily goals"], fallbackDailyGoals);
  const weeklyGoals = asArray(state.analysis?.["weekly goals"], fallbackWeeklyGoals);
  elements.dailyQuests.innerHTML = dailyGoals.map((goal, index) => questCard(goal, index, false)).join("");
  elements.weeklyQuests.innerHTML = weeklyGoals.map((goal, index) => questCard(goal, index, true)).join("");
  bindQuestCompletionEvents();

  const completed = dailyGoals.filter((goal) => goal.completion).length;
  const total = dailyGoals.length || 1;
  const progress = Math.round((completed / total) * 100);
  elements.questProgressLabel.textContent = `${completed} / ${total} Quests`;
  elements.questProgressBar.style.setProperty("--progress", `${progress}%`);
  renderTotalSaved();
}

function questCard(goal, index, weekly) {
  const title = goal.title || goal.name || "Little win";
  const saving = Number(goal.saving || goal.save || 0);
  const category = goal.category || "Savings";
  const reason = goal.reason || goal.description || "A small choice that protects your bigger goal.";
  const icon = iconForCategory(category);
  const checked = goal.completion ? "checked" : "";
  const disabled = goal.id ? "" : "disabled";
  const weeklyProgress = weekly ? linkedWeeklyProgress(goal) : null;
  const progressLabel = weekly ? weeklyProgress.label : goal.completion ? "1 / 1" : "0 / 1";
  const progressValue = weekly ? weeklyProgress.progress : goal.completion ? "100%" : "0%";

  return `
    <article class="quest-card ${goal.completion ? "complete" : ""}">
      <div class="quest-top">
        <div class="quest-icon ${index % 2 ? "alt" : ""}">
          <span class="material-symbols-outlined">${icon}</span>
        </div>
        <div>
          <span class="eyebrow">${weekly ? "Weekly Impact" : "Impact"}</span>
          <strong>${formatMoney(saving)}</strong>
        </div>
      </div>
      <h3>${escapeHtml(title)}</h3>
      <p class="muted">${escapeHtml(reason)}</p>
      <div class="progress-copy">
        <span>${weekly ? "Weekly Tracker" : "Progress"}</span>
        <span>${progressLabel}</span>
      </div>
      <div class="progress-track" style="--progress:${progressValue}"><span></span></div>
      ${weekly ? `
        <p class="quest-tracker-note">Updates when you finish linked daily quests.</p>
      ` : `<label class="quest-completion">
        <input type="checkbox" data-quest-id="${escapeHtml(goal.id || "")}" ${checked} ${disabled}>
        <span>Done?</span>
      </label>`}
    </article>
  `;
}

function linkedWeeklyProgress(weeklyGoal) {
  const dailyGoals = asArray(state.analysis?.["daily goals"], fallbackDailyGoals);
  const linkedDailyGoals = dailyGoals.filter((goal) => sameQuestCategory(goal.category, weeklyGoal.category));
  const total = weeklyTargetForCategory(weeklyGoal.category);
  const completed = Math.min(total, linkedDailyGoals.filter((goal) => goal.completion).length);
  const noun = categoryUnit(weeklyGoal.category);
  const progress = Math.min(100, Math.round((completed / total) * 100));
  return {
    label: `${completed} / ${total} ${noun} saved`,
    progress: `${progress}%`
  };
}

function sameQuestCategory(left, right) {
  return String(left || "").trim().toLowerCase() === String(right || "").trim().toLowerCase();
}

function weeklyTargetForCategory(category) {
  const text = String(category || "").toLowerCase();
  if (text.includes("coffee")) return 3;
  if (text.includes("eating") || text.includes("restaurant")) return 2;
  if (text.includes("transport") || text.includes("rideshare")) return 2;
  if (text.includes("subscription")) return 1;
  return 3;
}

function categoryUnit(category) {
  const text = String(category || "").toLowerCase();
  if (text.includes("coffee")) return "coffees";
  if (text.includes("eating") || text.includes("restaurant")) return "meals";
  if (text.includes("transport") || text.includes("rideshare")) return "rides";
  if (text.includes("subscription")) return "checks";
  return "wins";
}

function bindQuestCompletionEvents() {
  document.querySelectorAll("[data-quest-id]").forEach((checkbox) => {
    checkbox.addEventListener("change", async () => {
      const questId = checkbox.dataset.questId;
      if (!questId) return;

      checkbox.disabled = true;
      try {
        const response = await fetch(`/api/quests/${encodeURIComponent(questId)}`, {
          method: "PATCH",
          headers: authHeaders(),
          body: JSON.stringify({ completion: checkbox.checked })
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Could not update quest");
        updateLocalQuestCompletion(questId, Boolean(payload.quest?.completion));
        if (payload.totalSavedLittleWins !== null && payload.totalSavedLittleWins !== undefined) {
          state.totalSavedLittleWins = Number(payload.totalSavedLittleWins || 0);
          if (state.session?.user) {
            state.session.user.Total_saved_littlewins = state.totalSavedLittleWins;
            localStorage.setItem("little-wins-session", JSON.stringify(state.session));
          }
        }
        renderQuests();
        renderTotalSaved();
      } catch (error) {
        checkbox.checked = !checkbox.checked;
        setAnalysisStatus(error.message);
      } finally {
        checkbox.disabled = false;
      }
    });
  });
}

function updateLocalQuestCompletion(questId, completion) {
  for (const group of ["daily goals", "weekly goals"]) {
    const quest = state.analysis?.[group]?.find((item) => String(item.id) === String(questId));
    if (quest) quest.completion = completion;
  }
}

function renderTotalSaved() {
  elements.totalSaved.textContent = formatMoney(state.totalSavedLittleWins);
}

async function analyseSpending() {
  setAnalyseLoading(true);
  elements.analyseButton.disabled = true;

  try {
    const response = await fetch("/api/analyse", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        goals: state.goals.map(({ name, category, target, saved }) => ({ name, category, target, saved }))
      })
    });

    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Analysis failed");

    state.analysis = payload.analysis;
    renderQuests();
    renderAnalysis(payload);
    renderTransactions(payload.categorizedTransactions);
    elements.buddyMessage.textContent = "Fresh quests are ready. Tiny choices, real money.";
    showScreen("quests");
  } catch (error) {
    setAnalysisStatus(error.message);
  } finally {
    elements.analyseButton.disabled = false;
    setAnalyseLoading(false);
  }
}

function setAnalyseLoading(isLoading) {
  elements.analyseButton.classList.toggle("loading", isLoading);
  elements.analyseButton.innerHTML = isLoading
    ? `<span class="button-spinner" aria-hidden="true"></span><span>Analysing...</span>`
    : "Analyse";

  if (isLoading) {
    elements.analysisOutput.innerHTML = `
      <article class="analysis-card loading-card" aria-live="polite">
        <div class="loading-orbit" aria-hidden="true">
          <span></span>
        </div>
        <div>
          <p class="eyebrow">AI Coach</p>
          <h3>Reading your spending rhythm</h3>
          <p class="muted">Checking transactions, spotting flexible spending, and building quests that help your savings grow.</p>
        </div>
        <div class="loading-steps" aria-hidden="true">
          <span></span>
          <span></span>
          <span></span>
        </div>
      </article>
    `;
  }
}

function renderAnalysis(payload) {
  const excessive = payload.analysis?.["excessive spending"] || {};
  const categories = asArray(excessive.categories, []);
  const categoryNames = categories.map((item) => item.category).filter(Boolean);
  const positiveMessage = buildPositiveSpendingMessage(categoryNames);
  elements.analysisOutput.innerHTML = `
    <article class="analysis-card">
      <p class="eyebrow">Your Money Check-In</p>
      <h3>Small shifts, real progress</h3>
      <p class="muted">${escapeHtml(positiveMessage)}</p>
      <p class="muted">Your estimated income is ${formatMoney(Number(excessive.estimated_income || 0))}, which puts a healthy 20% savings target around ${formatMoney(Number(excessive.savings_target || 0))}. You do not need a huge reset here, just a few softer boundaries around repeat wants.</p>
      ${categories.length ? `
        <div class="analysis-highlights">
          ${categories.map((item) => `
            <div class="analysis-highlight">
              <strong>${escapeHtml(item.category || "Category")}</strong>
              <span>${formatMoney(Number(item.amount || 0))}</span>
              <p>${Number(item.unnecessary_transaction_count || 0)} transactions look flexible. ${escapeHtml(item.reason || "This is a good place to trim gently.")}</p>
            </div>
          `).join("")}
        </div>
      ` : `<p class="muted">Your spending looks nicely balanced from the transactions available. Keep protecting your savings rhythm.</p>`}
    </article>
    <article class="analysis-card">
      <h3>Fresh Quests Ready</h3>
      <p class="muted">I prepared daily and weekly quests that help move extra money toward your savings goal without making the plan feel punishing.</p>
    </article>
  `;
}

function buildPositiveSpendingMessage(excessiveCategories) {
  const checkedNeeds = ["Groceries", "Rent or mortgage", "Utilities"];
  const doingWell = checkedNeeds.filter((category) => !excessiveCategories.includes(category));
  const excessive = excessiveCategories.length ? excessiveCategories.join(", ") : "none of the main spending areas";

  if (doingWell.length) {
    return `You are doing well with ${doingWell.join(", ").toLowerCase()}, which suggests your essentials are not the main issue. The gentler opportunity is trimming ${excessive.toLowerCase()} so more of your income can move toward savings.`;
  }

  return `You have a good starting point. The clearest opportunity is trimming ${excessive.toLowerCase()} in a way that still feels realistic day to day.`;
}

async function loadTransactions() {
  if (!elements.transactionsList) return;
  elements.transactionsList.innerHTML = `<article class="transaction-row"><p class="muted">Fetching transactions...</p></article>`;

  try {
    const response = await fetch("/api/transactions");
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Could not fetch transactions");
    renderTransactions(payload.transactions || []);
  } catch (error) {
    elements.transactionsList.innerHTML = `<article class="transaction-row"><p class="muted">${escapeHtml(error.message)}</p></article>`;
  }
}

async function loadUserGoals() {
  try {
    const payload = await apiFetch("/api/user-goals");
    state.goals = payload.goals?.length ? payload.goals : [];
    state.totalSavedLittleWins = Number(payload.totalSavedLittleWins || 0);
    saveGoals();
  } catch (error) {
    setAnalysisStatus(error.message);
  }
}

async function saveGoalToApi(goal) {
  try {
    const payload = await apiFetch("/api/user-goals", {
      method: "POST",
      body: goal
    });
    return payload.goal;
  } catch (error) {
    setAnalysisStatus(error.message);
    return null;
  }
}

async function deleteGoalFromApi(id) {
  try {
    await apiFetch(`/api/user-goals/${encodeURIComponent(id)}`, {
      method: "DELETE"
    });
  } catch (error) {
    setAnalysisStatus(error.message);
  }
}

function renderTransactions(transactions) {
  if (!elements.transactionsList) return;
  const rows = transactions.slice(0, 12);
  if (!rows.length) {
    elements.transactionsList.innerHTML = `<article class="transaction-row"><p class="muted">No transactions found yet.</p></article>`;
    return;
  }

  elements.transactionsList.innerHTML = rows.map((transaction) => {
    const merchant = transaction.merchant || transaction.description || transaction.name || `Transaction ${transaction.id ?? ""}`;
    const category = transaction.category || "Uncategorised";
    const amount = Number(transaction.amount ?? transaction.value ?? 0);
    const date = transaction.date || transaction.transaction_date || transaction.created_at || "";

    return `
      <article class="transaction-row">
        <div>
          <strong>${escapeHtml(merchant)}</strong>
          <p class="muted">${escapeHtml(category)}${date ? ` • ${escapeHtml(formatDate(date))}` : ""}</p>
        </div>
        <span>${formatMoney(amount)}</span>
      </article>
    `;
  }).join("");
}

function setAnalysisStatus(message) {
  elements.analysisOutput.innerHTML = `<article class="analysis-card"><p class="muted">${escapeHtml(message)}</p></article>`;
}

async function checkConfiguration() {
  try {
    const response = await fetch("/api/config");
    const payload = await response.json();
    if (!payload.configured) {
      setAnalysisStatus("Add Supabase and OpenAI placeholders to a local .env file when you are ready to run live analysis.");
      return;
    }

    await loadTransactions();
  } catch {
    setAnalysisStatus("The local API is not reachable yet.");
  }
}

async function apiFetch(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || "GET",
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.auth === false ? {} : authHeaders())
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Request failed");
  return payload;
}

function authHeaders() {
  return {
    "content-type": "application/json",
    ...(state.session?.access_token ? { authorization: `Bearer ${state.session.access_token}` } : {})
  };
}

function loadSession() {
  try {
    return JSON.parse(localStorage.getItem("little-wins-session"));
  } catch {
    return null;
  }
}

function loadGoals() {
  try {
    return JSON.parse(localStorage.getItem("little-wins-goals")) || [];
  } catch {
    return [];
  }
}

function saveGoals() {
  localStorage.setItem("little-wins-goals", JSON.stringify(state.goals));
}

function asArray(value, fallback) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.values(value);
  return fallback;
}

function iconForCategory(category) {
  const text = String(category).toLowerCase();
  if (text.includes("coffee")) return "coffee";
  if (text.includes("eating") || text.includes("restaurant")) return "restaurant";
  if (text.includes("grocery")) return "shopping_cart";
  if (text.includes("transport") || text.includes("rideshare")) return "directions_bus";
  if (text.includes("subscription")) return "subscriptions";
  return "savings";
}

function formatMoney(value) {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: value % 1 ? 2 : 0
  }).format(Number(value || 0));
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("en-AU", { month: "short", day: "numeric" }).format(date);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
