# Setting up the shared database (Supabase)

Right now the web page saves votes only on each person's own phone. Supabase is a free hosted database that lets everyone in the group see each other's votes, notes and statuses. Setup takes about 15 minutes and needs no coding.

You can do this now, while the scraper and the page are still being built.

---

## 1. Make a Supabase account

1. Go to **supabase.com** and click **Start your project**.
2. Sign up with **Continue with GitHub** (easiest if you already have GitHub; you'll need it for the website anyway) or with your email.
3. The **Free** plan is all we need. Don't add a credit card.

## 2. Create a project

1. Click **New project**.
2. Fill in:
   - **Name:** `london-housing`
   - **Database password:** click **Generate a password** and save it in your password manager. You won't need it day to day.
   - **Region:** **Canada (Central)**, since it's closest to London, Ontario.
3. Click **Create new project** and wait 1–2 minutes while it sets up.

## 3. Create the tables

1. In the left sidebar, open **SQL Editor**.
2. Click **+ New query**.
3. Open `supabase/schema.sql` from this project, copy **all** of it, and paste it into the editor.
4. Click **Run** (bottom right). You should see **Success. No rows returned**.

If you ever run it again, nothing is lost. It only adds what's missing.

## 4. Pick your group code and add your friends

The group code is the password inside your invite link. Anyone with the link can vote, so make it long and random. Make one in Terminal:

```bash
python3 -c "import secrets; print(secrets.token_urlsafe(12))"
```

That prints something like `q3V9xL0pT7mA2bKc`. Then, back in the **SQL Editor**, run a new query with **your code** and **your group's first names**:

```sql
select setup_group('q3V9xL0pT7mA2bKc', array['Paxton', 'Jordan', 'Maya', 'Sam']);
```

You should see `Group ready with 4 members`.

- The names must match `members` in `site/js/config.js` exactly, including capitals.
- Only a scrambled version (a hash) of the code is stored, so keep a copy of the code itself somewhere safe, like your notes app.

## 5. Copy the two values the page needs

1. Left sidebar: **Project Settings** (gear icon), then **API Keys**. On some projects this is under **Data API**.
2. Copy:
   - **Project URL**, which looks like `https://abcdefgh.supabase.co`
   - The **public** key: either **Publishable key** (starts with `sb_publishable_`) or, on the legacy tab, **anon public** (a long `eyJ...` string). Either one works.
3. Open `site/js/config.js` and replace `supabase: null` with:

   ```js
   supabase: { url: "https://abcdefgh.supabase.co", anonKey: "PASTE_THE_PUBLIC_KEY" },
   ```

> **Never** put the **secret** / **service_role** key in the page or anywhere in this repo. That key skips every lock. It only goes into GitHub Secrets later (step 8).

## 6. Check it works (optional, 1 minute)

In Terminal, with your values swapped in:

```bash
curl -s "https://abcdefgh.supabase.co/rest/v1/rpc/get_group_state" -H "apikey: PASTE_THE_PUBLIC_KEY" -H "Content-Type: application/json" -d '{"p_code":"q3V9xL0pT7mA2bKc"}'
```

- **Right code:** `{"members": ["Paxton", ...], "votes": {}, "notes": {}, "status": {}, "budgets": {}}`
- **Wrong code** (change one letter): an error saying `bad group code`. That's the lock working.

## 7. Your invite link

Once the website is on GitHub Pages, the link you pin in the group chat is:

```
https://YOUR-GITHUB-USERNAME.github.io/london-housing/#join=q3V9xL0pT7mA2bKc
```

The part after `#` never leaves the phone: browsers don't send it to any server.

## 8. Give the daily GitHub job its keys (as soon as your GitHub repo exists)

The daily scrape job pings Supabase each morning so the free project never pauses. It also uses this to send phone alerts (`docs/github-setup.md`, 6d). It needs two values, stored as GitHub **secrets** (hidden, never shown in the code):
1. Repo on GitHub → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**.
2. Add `SUPABASE_URL` (the Project URL from step 5).
3. Add `SUPABASE_SERVICE_KEY`: in Supabase, **Project Settings** → **API Keys**, the **secret** key (`sb_secret_...`) or, on the legacy tab, **service_role**. Click reveal, then copy.

If you haven't made the GitHub repo yet, skip this for now. `docs/github-setup.md` brings you back here.

---

## Good to know

- **Adding a friend:** run `setup_group` again with the **same** code and the new name added, and add them to `config.js`. Everyone keeps their votes.
- **Changing the code** (e.g. the link got shared too widely): run `setup_group` with a new code. Old links stop working immediately, and nobody's votes are lost.
- **Free projects pause after about a week with no activity.** Once step 8 is done, the daily job's "Keep Supabase awake" step prevents that. If it does pause, open the project on supabase.com and click **Restore**.
- **"RLS enabled, no policies" warnings** in Supabase's Security Advisor are expected. That's on purpose: the page can only use the locked functions, never the tables.

## Tests

`schema.sql` is tested on a real Postgres engine running on your laptop (PGlite). The tests act as the web page and confirm:
- the page can't read tables directly
- every function rejects a wrong code
- votes, notes, statuses, budgets and push subscriptions follow the same rules as the page
- the daily job's secret key can only do what phone alerts need: it can't read the group code or notes

```bash
cd supabase
```
```bash
npm install
```
```bash
npm test
```
