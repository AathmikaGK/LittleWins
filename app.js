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
  dailyQuestDay: "today",
  editingGoalId: null,
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
  bankLastSynced: document.querySelector("#bank-last-synced"),
  goalsList: document.querySelector("#goals-list"),
  goalForm: document.querySelector("#goal-form"),
  editGoalModal: document.querySelector("#edit-goal-modal"),
  editGoalForm: document.querySelector("#edit-goal-form"),
  editGoalAllocation: document.querySelector("#edit-goal-allocation"),
  openGoalForm: document.querySelector("#open-goal-form"),
  analyseButton: document.querySelector("#analyse-button"),
  analysisOutput: document.querySelector("#analysis-output"),
  refreshTransactions: document.querySelector("#refresh-transactions"),
  transactionsChart: document.querySelector("#transactions-chart"),
  transactionsList: document.querySelector("#transactions-list"),
  dailyQuests: document.querySelector("#daily-quests"),
  weeklyQuests: document.querySelector("#weekly-quests"),
  dailyDayToggle: document.querySelector("#daily-day-toggle"),
  dailyDayLabel: document.querySelector("#daily-day-label"),
  coinCelebration: document.querySelector("#coin-celebration"),
  totalSaved: document.querySelector("#total-saved"),
  questProgressTitle: document.querySelector("#quest-progress-title"),
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
    state.editingGoalId = null;
    elements.goalForm.classList.toggle("hidden");
    elements.goalForm.reset();
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

    if (state.editingGoalId) {
      const goal = await updateGoalInApi(state.editingGoalId, goalInput);
      state.goals = state.goals.map((item) => item.id === state.editingGoalId
        ? { ...item, ...(goal || goalInput), id: state.editingGoalId }
        : item);
      state.editingGoalId = null;
    } else {
      const goal = await saveGoalToApi(goalInput);
      const savedGoal = goal || { ...goalInput, id: crypto.randomUUID(), icon: "savings" };
      state.goals = [savedGoal, ...state.goals.filter((item) => String(item.id) !== String(savedGoal.id))];
      state.goals = defaultGoalAllocations(state.goals);
    }
    state.goals = ensureGoalAllocations(state.goals);
    saveGoals();
    elements.goalForm.reset();
    elements.goalForm.classList.add("hidden");
    render();
  });

  elements.editGoalForm.addEventListener("input", updateEditGoalAllocation);
  elements.editGoalForm.addEventListener("submit", saveEditedGoal);
  document.querySelectorAll("[data-close-edit-goal]").forEach((button) => {
    button.addEventListener("click", closeEditGoalModal);
  });
  elements.editGoalModal.addEventListener("click", (event) => {
    if (event.target === elements.editGoalModal) closeEditGoalModal();
  });

  elements.analyseButton.addEventListener("click", analyseSpending);
  elements.refreshTransactions.addEventListener("click", loadTransactions);
  elements.dailyDayToggle.addEventListener("click", toggleDailyQuestDay);
  elements.analysisOutput.addEventListener("click", (event) => {
    if (event.target.closest("[data-go-to-quests]")) showScreen("quests", { scrollTop: true });
  });
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

function showScreen(screen, options = {}) {
  if (screen === "quests") state.dailyQuestDay = "today";
  document.querySelectorAll(".screen").forEach((section) => {
    section.classList.toggle("active", section.id === `${screen}-screen`);
  });
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.screen === screen);
  });
  if (options.scrollTop) requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" }));
}

function render() {
  renderBankLastSynced();
  renderGoals();
  renderQuests();
}

function renderBankLastSynced() {
  if (!elements.bankLastSynced) return;
  elements.bankLastSynced.textContent = `Now, ${new Date().toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit"
  })}`;
}

function renderGoals() {
  state.goals = ensureGoalAllocations(state.goals);
  elements.goalsList.innerHTML = state.goals.map((goal, index) => {
    const progress = goalProgressPercent(goal);
    const allocation = goalAllocationPercent(goal);
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
          <details class="goal-menu">
            <summary aria-label="Goal actions for ${escapeHtml(goal.name)}">
              <span class="material-symbols-outlined">more_horiz</span>
            </summary>
            <div class="goal-menu-list">
              <button type="button" data-edit-goal="${goal.id}">Edit</button>
              <button type="button" data-delete-goal="${goal.id}">Delete</button>
            </div>
          </details>
        </div>
        <div class="progress-copy">
          <span>Progress</span>
          <span>${formatProgressPercent(progress)}</span>
        </div>
        <div class="progress-track" style="--progress:${progress}%"><span></span></div>
        <div class="allocation-chip">
          <span>${escapeHtml(goal.name)} allocation</span>
          <strong>${allocation}%</strong>
        </div>
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

  document.querySelectorAll("[data-edit-goal]").forEach((button) => {
    button.addEventListener("click", () => {
      const goal = state.goals.find((item) => item.id === button.dataset.editGoal);
      openEditGoalModal(goal);
    });
  });

  renderTotalSaved();
}

function goalProgressPercent(goal) {
  const target = Number(goal.target || 0);
  if (target <= 0) return 0;
  const saved = Number(goal.saved || 0);
  return Math.min(100, Math.max(0, Math.round((saved / target) * 1000) / 10));
}

function formatProgressPercent(progress) {
  return `${Number.isInteger(progress) ? progress : progress.toFixed(1)}%`;
}

function openEditGoalModal(goal) {
  if (!goal) return;
  state.editingGoalId = goal.id;
  elements.editGoalForm.elements.name.value = goal.name || "";
  elements.editGoalForm.elements.target.value = Number(goal.target || 0);
  elements.editGoalForm.elements.saved.value = Number(goal.saved || 0);
  elements.editGoalForm.elements.allocation.value = goalAllocationPercent(goal);
  updateEditGoalAllocation();
  elements.editGoalModal.classList.remove("hidden");
  elements.editGoalForm.elements.name.focus();
}

function closeEditGoalModal() {
  state.editingGoalId = null;
  elements.editGoalForm.reset();
  elements.editGoalModal.classList.add("hidden");
  updateEditGoalAllocation();
}

function updateEditGoalAllocation() {
  const allocation = clampPercent(elements.editGoalForm.elements.allocation.value);
  elements.editGoalForm.elements.allocation.value = allocation;
  elements.editGoalAllocation.textContent = "Total 100%";
}

function goalAllocationPercent(goal) {
  return clampPercent(goal?.allocation ?? 0);
}

function ensureGoalAllocations(goals) {
  if (!goals.length) return [];

  const hasAllocations = goals.some((goal) => Number.isFinite(Number(goal.allocation)));
  if (hasAllocations) {
    const total = goals.reduce((sum, goal) => sum + clampPercent(goal.allocation), 0);
    if (total === 100) return goals.map((goal) => ({ ...goal, allocation: clampPercent(goal.allocation) }));
  }

  const weights = goals.map((goal) => Math.max(0, Number(goal.target || 0)));
  const allocations = percentagesFromWeights(weights);
  return goals.map((goal, index) => ({ ...goal, allocation: allocations[index] }));
}

function defaultGoalAllocations(goals) {
  if (!goals.length) return [];
  const weights = goals.map((goal) => Math.max(0, Number(goal.target || 0)));
  const allocations = percentagesFromWeights(weights);
  return goals.map((goal, index) => ({ ...goal, allocation: allocations[index] }));
}

function rebalanceGoalAllocations(goals, editedGoalId, editedAllocation) {
  if (!goals.length) return [];
  if (goals.length === 1) return goals.map((goal) => ({ ...goal, allocation: 100 }));

  const selectedAllocation = clampPercent(editedAllocation);
  const remaining = 100 - selectedAllocation;
  const otherGoals = goals.filter((goal) => goal.id !== editedGoalId);
  const otherWeights = otherGoals.map((goal) => Math.max(0, Number(goal.allocation ?? goal.target ?? 0)));
  const otherAllocations = percentagesFromWeights(otherWeights, remaining);
  const allocationById = new Map(otherGoals.map((goal, index) => [goal.id, otherAllocations[index]]));

  return goals.map((goal) => ({
    ...goal,
    allocation: goal.id === editedGoalId ? selectedAllocation : allocationById.get(goal.id) || 0
  }));
}

function percentagesFromWeights(weights, totalPercent = 100) {
  if (!weights.length) return [];
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  if (totalWeight <= 0) {
    const base = Math.floor(totalPercent / weights.length);
    const remainder = totalPercent - base * weights.length;
    return weights.map((_, index) => base + (index < remainder ? 1 : 0));
  }

  const raw = weights.map((weight) => (weight / totalWeight) * totalPercent);
  const floored = raw.map(Math.floor);
  let remainder = totalPercent - floored.reduce((sum, value) => sum + value, 0);
  const order = raw
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((left, right) => right.fraction - left.fraction);

  for (let index = 0; index < order.length && remainder > 0; index += 1) {
    floored[order[index].index] += 1;
    remainder -= 1;
  }

  return floored;
}

function clampPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(100, Math.max(0, Math.round(number)));
}

async function saveEditedGoal(event) {
  event.preventDefault();
  const goal = state.goals.find((item) => item.id === state.editingGoalId);
  if (!goal) return;

  const form = new FormData(elements.editGoalForm);
  const goalInput = {
    name: String(form.get("name") || "").trim(),
    target: Number(form.get("target") || 0),
    saved: Number(form.get("saved") || 0),
    category: goal.category || "Custom",
    allocation: clampPercent(form.get("allocation"))
  };

  const rebalancedGoals = rebalanceGoalAllocations(state.goals, goal.id, goalInput.allocation);
  const allocationPayload = rebalancedGoals.map(({ id, allocation }) => ({ id, allocation }));
  const updatedGoal = await updateGoalInApi(goal.id, { ...goalInput, allocations: allocationPayload });
  state.goals = rebalancedGoals.map((item) => item.id === goal.id
    ? { ...item, ...(updatedGoal || goalInput), id: goal.id }
    : item);
  saveGoals();
  closeEditGoalModal();
  render();
}

function renderQuests() {
  const hasAnalysis = Boolean(state.analysis);
  const todayGoals = hasAnalysis ? asArray(state.analysis?.["daily goals"], []) : [];
  const dailyGoals = state.dailyQuestDay === "tomorrow" ? buildTomorrowDailyGoals(todayGoals) : todayGoals;
  const weeklyGoals = hasAnalysis ? asArray(state.analysis?.["weekly goals"], []) : [];
  const isTomorrow = state.dailyQuestDay === "tomorrow";

  elements.dailyDayLabel.textContent = isTomorrow ? "Tomorrow" : "Today";
  elements.questProgressTitle.textContent = isTomorrow ? "Tomorrow's Progress" : "Today's Progress";
  elements.dailyDayToggle.setAttribute("aria-label", isTomorrow ? "Show today's daily quests" : "Show tomorrow's daily quests");
  elements.dailyDayToggle.classList.toggle("tomorrow", isTomorrow);

  if (!hasAnalysis) {
    elements.dailyQuests.innerHTML = `<article class="quest-card empty-state"><h3>No quests yet</h3><p class="muted">Run a spending analysis from the Dashboard to generate daily quests.</p></article>`;
    elements.weeklyQuests.innerHTML = `<article class="quest-card empty-state"><h3>No weekly quests yet</h3><p class="muted">Weekly trackers will appear after your analysis is ready.</p></article>`;
    elements.questProgressLabel.textContent = "0 / 0 Quests";
    elements.questProgressBar.style.setProperty("--progress", "0%");
    renderTotalSaved();
    return;
  }

  const hasSavedDailyQuests = dailyGoals.some((goal) => goal.id);
  elements.dailyQuests.innerHTML = dailyGoals.map((goal, index) => questCard(goal, index, false, isTomorrow || !hasSavedDailyQuests)).join("");
  elements.weeklyQuests.innerHTML = weeklyGoals.map((goal, index) => questCard(goal, index, true)).join("");
  if (!isTomorrow) bindQuestCompletionEvents();

  const completed = dailyGoals.filter((goal) => goal.completion).length;
  const total = dailyGoals.length || 1;
  const progress = Math.round((completed / total) * 100);
  elements.questProgressLabel.textContent = `${completed} / ${total} Quests`;
  elements.questProgressBar.style.setProperty("--progress", `${progress}%`);
  renderTotalSaved();
}

function toggleDailyQuestDay() {
  state.dailyQuestDay = state.dailyQuestDay === "today" ? "tomorrow" : "today";
  renderQuests();
}

function buildTomorrowDailyGoals(todayGoals) {
  const templates = {
    coffee: {
      title: "Pack Tomorrow's Coffee",
      reason: "Set up coffee at home tonight so tomorrow starts with an easy win."
    },
    eating: {
      title: "Plan One Packed Meal",
      reason: "Choose tomorrow's lunch or dinner now so eating out is less tempting."
    },
    restaurant: {
      title: "Plan One Packed Meal",
      reason: "Choose tomorrow's lunch or dinner now so eating out is less tempting."
    },
    transport: {
      title: "Map a Lower-Cost Trip",
      reason: "Check tomorrow's route early and choose the cheaper travel option."
    },
    travel: {
      title: "Map a Lower-Cost Trip",
      reason: "Check tomorrow's route early and choose the cheaper travel option."
    },
    shopping: {
      title: "Wait Before Buying",
      reason: "Put tomorrow's non-essential purchase on pause and keep the money moving toward savings."
    },
    subscription: {
      title: "Check One Subscription",
      reason: "Review one recurring payment tomorrow and cancel it if it no longer earns its place."
    },
    groceries: {
      title: "Use What You Have",
      reason: "Plan tomorrow around food already at home before adding anything new."
    }
  };

  return todayGoals.filter((goal) => !String(goal.category || goal.title || "").toLowerCase().includes("subscription")).map((goal, index) => {
    const text = String(goal.category || goal.title || "").toLowerCase();
    const templateKey = Object.keys(templates).find((key) => text.includes(key));
    const template = templates[templateKey] || {
      title: `Tomorrow's ${goal.category || "Savings"} Win`,
      reason: "Give tomorrow one clear money-saving choice that still feels realistic."
    };

    return {
      ...goal,
      id: "",
      title: template.title,
      reason: template.reason,
      saving: Math.max(1, Number(goal.saving || 0)),
      completion: false,
      tomorrowPreview: true,
      previewIndex: index
    };
  });
}

function questCard(goal, index, weekly, preview = false) {
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
      ` : preview ? `
        <p class="quest-tracker-note">${goal.tomorrowPreview ? "Tomorrow preview" : "Run analysis to save this quest"}</p>
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

      const quest = findQuestById(questId);
      const wasComplete = Boolean(quest?.completion);
      const saving = Number(quest?.saving || 0);
      const nextCompletion = Boolean(checkbox.checked);
      const previousTotal = state.totalSavedLittleWins;
      const previousGoals = state.goals.map((goal) => ({ ...goal }));
      const delta = nextCompletion === wasComplete ? 0 : nextCompletion ? saving : -saving;

      updateLocalQuestCompletion(questId, nextCompletion);
      state.totalSavedLittleWins = Math.max(0, state.totalSavedLittleWins + delta);
      applyQuestSavingToGoals(delta);
      saveTotalSavedLittleWinsToSession();
      saveGoals();
      render();
      if (!wasComplete && nextCompletion) {
        showCoinCelebration({ quest, saving });
      }

      try {
        const response = await fetch(`/api/quests/${encodeURIComponent(questId)}`, {
          method: "PATCH",
          headers: authHeaders(),
          body: JSON.stringify({
            completion: nextCompletion,
            previousCompletion: wasComplete,
            saving,
            userId: state.session?.user?.id
          })
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Could not update quest");
        updateLocalQuestCompletion(questId, Boolean(payload.quest?.completion ?? nextCompletion));
        if (payload.totalSavedLittleWins !== null && payload.totalSavedLittleWins !== undefined) {
          state.totalSavedLittleWins = Number(payload.totalSavedLittleWins || 0);
        }
        saveTotalSavedLittleWinsToSession();
        await persistGoalSavings();
        render();
      } catch (error) {
        updateLocalQuestCompletion(questId, wasComplete);
        state.totalSavedLittleWins = previousTotal;
        state.goals = previousGoals;
        saveTotalSavedLittleWinsToSession();
        saveGoals();
        render();
        setAnalysisStatus(error.message);
      }
    });
  });
}

function applyQuestSavingToGoals(delta) {
  const amount = roundMoney(delta);
  if (!amount || !state.goals.length) return;

  state.goals = ensureGoalAllocations(state.goals);
  const distributions = distributeByAllocation(amount, state.goals);
  state.goals = state.goals.map((goal, index) => ({
    ...goal,
    saved: Math.max(0, roundMoney(Number(goal.saved || 0) + distributions[index]))
  }));
}

function distributeByAllocation(amount, goals) {
  if (!goals.length) return [];
  const cents = Math.round(amount * 100);
  const direction = cents < 0 ? -1 : 1;
  const absoluteCents = Math.abs(cents);
  const allocations = goals.map((goal) => clampPercent(goal.allocation));
  const totalAllocation = allocations.reduce((sum, allocation) => sum + allocation, 0);
  const weights = totalAllocation === 100 ? allocations : percentagesFromWeights(goals.map((goal) => Number(goal.target || 0)));
  const raw = weights.map((weight) => (absoluteCents * weight) / 100);
  const floored = raw.map(Math.floor);
  let remainder = absoluteCents - floored.reduce((sum, value) => sum + value, 0);
  const order = raw
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((left, right) => right.fraction - left.fraction);

  for (let index = 0; index < order.length && remainder > 0; index += 1) {
    floored[order[index].index] += 1;
    remainder -= 1;
  }

  return floored.map((value) => direction * value / 100);
}

function roundMoney(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.round(number * 100) / 100;
}

async function persistGoalSavings() {
  await Promise.all(state.goals.map((goal) => updateGoalInApi(goal.id, {
    name: goal.name,
    target: goal.target,
    saved: goal.saved,
    category: goal.category,
    allocation: goal.allocation
  })));
}

function findQuestById(questId) {
  for (const group of ["daily goals", "weekly goals"]) {
    const quest = state.analysis?.[group]?.find((item) => String(item.id) === String(questId));
    if (quest) return quest;
  }
  return null;
}

function updateLocalQuestCompletion(questId, completion) {
  for (const group of ["daily goals", "weekly goals"]) {
    const quest = state.analysis?.[group]?.find((item) => String(item.id) === String(questId));
    if (quest) quest.completion = completion;
  }
}

function showCoinCelebration({ quest, saving }) {
  if (!elements.coinCelebration) return;

  const title = quest?.title || "Daily quest complete";
  const amount = Number(saving || quest?.saving || 0);
  const coinCount = 16;

  elements.coinCelebration.innerHTML = `
    <div class="coin-message">
      <span class="coin-message-icon">$</span>
      <div>
        <strong>${escapeHtml(title)}</strong>
        <span>${formatMoney(amount)} added across your savings goals</span>
      </div>
    </div>
    <div class="coin-stage" aria-hidden="true">
      ${Array.from({ length: coinCount }, (_, index) => {
        const left = 8 + ((index * 29) % 84);
        const delay = (index % 6) * 0.08;
        const drift = ((index % 5) - 2) * 18;
        return `<span class="coin" style="--left:${left}%; --delay:${delay}s; --drift:${drift}px">$</span>`;
      }).join("")}
    </div>
  `;
  elements.coinCelebration.classList.remove("leaving");
  elements.coinCelebration.classList.add("active");
  elements.coinCelebration.setAttribute("aria-hidden", "false");

  document.body.classList.add("coin-side-effects");
  elements.totalSaved.classList.remove("saved-pop");
  void elements.totalSaved.offsetWidth;
  elements.totalSaved.classList.add("saved-pop");

  clearTimeout(showCoinCelebration.hideTimer);
  showCoinCelebration.hideTimer = setTimeout(() => {
    elements.coinCelebration.classList.add("leaving");
    document.body.classList.remove("coin-side-effects");
  }, 3200);

  clearTimeout(showCoinCelebration.removeTimer);
  showCoinCelebration.removeTimer = setTimeout(() => {
    elements.coinCelebration.classList.remove("active", "leaving");
    elements.coinCelebration.setAttribute("aria-hidden", "true");
  }, 3900);
}

function renderTotalSaved() {
  elements.totalSaved.textContent = formatMoney(state.totalSavedLittleWins);
}

function saveTotalSavedLittleWinsToSession() {
  if (!state.session?.user) return;
  state.session.user.Total_saved_littlewins = state.totalSavedLittleWins;
  localStorage.setItem("little-wins-session", JSON.stringify(state.session));
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
    state.dailyQuestDay = "today";
    renderQuests();
    renderAnalysis(payload);
    renderTransactions(payload.categorizedTransactions);
    elements.buddyMessage.textContent = "Fresh quests are ready. Tiny choices, real money.";
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
        <div class="loading-progress" aria-hidden="true">
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
      <button class="primary-button compact analysis-action" type="button" data-go-to-quests>Go to quests!</button>
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

async function updateGoalInApi(id, goal) {
  try {
    const payload = await apiFetch(`/api/user-goals/${encodeURIComponent(id)}`, {
      method: "PATCH",
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
  const rows = [...transactions].sort((left, right) => {
    const leftTime = transactionTimestamp(left);
    const rightTime = transactionTimestamp(right);
    return rightTime - leftTime;
  });

  renderTransactionsChart(rows);

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

function renderTransactionsChart(transactions) {
  if (!elements.transactionsChart) return;

  const spendingByCategory = new Map();
  for (const transaction of transactions) {
    const amount = Number(transaction.amount ?? transaction.value ?? 0);
    const category = transaction.category || "Uncategorised";
    if (amount <= 0 || category.toLowerCase() === "income") continue;
    spendingByCategory.set(category, (spendingByCategory.get(category) || 0) + amount);
  }

  const slices = [...spendingByCategory.entries()]
    .map(([category, amount]) => ({ category, amount }))
    .sort((left, right) => right.amount - left.amount);
  const total = slices.reduce((sum, slice) => sum + slice.amount, 0);

  if (!slices.length || total <= 0) {
    elements.transactionsChart.innerHTML = `
      <article class="chart-card">
        <div>
        <p class="eyebrow">Spending Split</p>
        <h2>No spending to chart yet</h2>
        </div>
        <p class="muted">Transactions will appear here once spending rows are available.</p>
      </article>
    `;
    return;
  }

  const colors = ["#14696d", "#640031", "#1a237e", "#7b5e00", "#006d3c", "#8b1e3f", "#455a64", "#6a4c93"];
  elements.transactionsChart.innerHTML = `
    <article class="chart-card">
      <div>
        <p class="eyebrow">Spending Split</p>
        <h2>Category overview</h2>
        <p class="muted">${formatMoney(total)} across ${slices.length} categories</p>
      </div>
      <div class="bar-chart" aria-label="Transaction spending by category">
        ${slices.map((slice, index) => {
          const percent = Math.max(4, Math.round((slice.amount / slices[0].amount) * 100));
          const share = Math.round((slice.amount / total) * 100);
          return `
            <div class="bar-row">
              <div class="bar-copy">
                <strong>${escapeHtml(slice.category)}</strong>
                <span>${formatMoney(slice.amount)} • ${share}%</span>
              </div>
              <div class="bar-track">
                <span style="--bar:${percent}%; --bar-color:${colors[index % colors.length]}"></span>
              </div>
            </div>
          `;
        }).join("")}
      </div>
    </article>
  `;
}

function transactionTimestamp(transaction) {
  const value = transaction.date || transaction.transaction_date || transaction.created_at || "";
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
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
