# Little Wins
Contributers: Aathmika Gokula Krishna, Koko Mclaughlin, Fatima Rana, Anika Nagarajan

Financial budgeting app designed to analyse the user's past transactions and create personalised savings goals/challenges.

## What It Does

- Shows savings goals, daily quests, weekly quests, and a profile screen.
- Fetches rows from the Supabase `transactions` table.
- Sends the transaction details and savings goals to OpenAI for recurring spending analysis.
- Asks OpenAI to categorize every individual transaction.
- Writes the finalized transaction category back into the Supabase `category` column.
- Saves generated daily and weekly quests to the Supabase `quest` table.
- Lets users tick quest completion checkboxes, updating `completion` in Supabase.
- Supports local sign up and login with JWT tokens.
- Saves each user's dashboard goals in Supabase when `SUPABASE_SERVICE_ROLE_KEY` is set, with a local JSON fallback for laptop development.

## Setup

1. Copy the placeholder environment file:

```bash
cp .env.example .env
```

2. Fill in the Supabase and OpenAI values in `.env`.

3. Run the app:

```bash
npm install
npm run dev
```

4. Open:

```text
http://localhost:3000
```

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
