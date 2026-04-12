# Little Wins

Mobile-friendly savings coach app built from the hackathon UX files.

## What It Does

- Shows savings goals, daily quests, weekly quests, and a profile screen.
- Fetches rows from the Supabase `transactions` table.
- Sends the transaction details and savings goals to OpenAI for recurring spending analysis.
- Asks OpenAI to categorize every individual transaction.
- Writes the finalized transaction category back into the Supabase `category` column.
- Saves generated daily and weekly quests to the Supabase `quest` table.
- Lets users tick quest completion checkboxes, updating `completion` in Supabase.
- Supports local sign up and login with JWT tokens.
- Saves each user's dashboard goals in a local JSON user store.
- Displays the AI response in this JSON shape:

```json
{
  "excessive spending": {
    "summary": "short explanation",
    "categories": [
      {
        "category": "Coffee",
        "amount": 24.5,
        "reason": "short reason"
      }
    ]
  },
  "daily goals": [
    {
      "title": "No coffee today",
      "saving": 5,
      "category": "Coffee",
      "reason": "short reason"
    }
  ],
  "weekly goals": [
    {
      "title": "No eating out",
      "saving": 50,
      "category": "Eating out",
      "reason": "short reason"
    }
  ]
}
```

The backend also asks OpenAI for an internal `categorized_transactions` array so it can update Supabase.

## Setup

1. Copy the placeholder environment file:

```bash
cp .env.example .env
```

2. Fill in the Supabase and OpenAI values in `.env`.

3. Run the app:

```bash
npm run dev
```

4. Open:

```text
http://localhost:3000
```

## Supabase Notes

Authentication is local and uses JWT tokens. Supabase is still used for transactions and quest rows, but not for sign up/login.

The default table and column names are:

- Table: `transactions`
- Quest table: `quest`
- ID column: `id`
- Category column: `category`

If your schema uses different names, update these values in `.env`:

```text
SUPABASE_TRANSACTIONS_TABLE=transactions
SUPABASE_QUESTS_TABLE=quest
SUPABASE_TRANSACTION_ID_COLUMN=id
SUPABASE_TRANSACTION_CATEGORY_COLUMN=category
APP_USER_ID=00000000-0000-0000-0000-000000000000
SITE_URL=http://localhost:3000
JWT_SECRET=change-this-local-jwt-secret
LOCAL_USERS_FILE=local_users.json
```

Use `SUPABASE_SERVICE_ROLE_KEY` only on the server. It is intentionally not exposed to the browser.

Run [supabase_quest_table.sql](/Users/kokomclaughlin/Desktop/LittleWins/FinanceBuddy/supabase_quest_table.sql) in the Supabase SQL editor to create the quest table.

## OpenAI Notes

The app uses the OpenAI Responses API from the server only. Your API key is never sent to the browser.

The default model is:

```text
OPENAI_MODEL=gpt-4o-mini
```

To keep testing costs low, the server sends only the most recent configured number of transactions per analysis:

```text
MAX_TRANSACTIONS_FOR_ANALYSIS=75
```

Lower that number while tuning prompts if you want to spend less per click.
