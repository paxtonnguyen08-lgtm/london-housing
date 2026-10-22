# Putting the project on GitHub (step by step)

This gets the code onto GitHub so the **Daily scrape** workflow (`.github/workflows/scrape.yml`) can run every morning on GitHub's computers, even when your laptop is closed. It takes about 15 minutes. You'll use **GitHub Desktop**, which is already installed on your Mac and handles signing in for you.

---

## 1. What's already done for you

Claude has already made the first **commit** (a saved snapshot of the project), after every test passed. The repo will be **public**, which is what makes GitHub Pages free, so that commit was checked for privacy:

- `.venv/` (the Python environment) and `node_modules/` are listed in `.gitignore`, so they won't be uploaded.
- `data/listings.json` has no landlord phone numbers, emails or names. The scraper never saves them.
- There are no passwords or keys in the code. Supabase and alert keys go in later as GitHub **secrets**, never in files.

## 2. Open the project in GitHub Desktop

1. Open **GitHub Desktop**.
2. Sign in if it asks: **GitHub Desktop → Settings → Accounts → Sign in**.
3. **File → Add Local Repository…**, choose the `london-housing` folder, then **Add Repository**.

## 3. Check the commit is there

1. Click the **History** tab (top left). You should see at least one commit. Click it to see the files it saved.
2. The **Changes** tab should say **No local changes**.
   - If it lists files, something changed after the commit. Don't commit them yourself. Tell Claude what's listed, and it'll sort it out first.

## 4. Publish to GitHub

1. Click **Publish repository** (top bar).
2. Name: `london-housing`.
3. **Untick "Keep this code private"**, so the repo is public.
   - Public is free for both Actions and Pages.
   - A private repo also works for the daily scrape (2,000 free Action minutes a month is plenty), but private GitHub Pages needs GitHub Pro. GitHub Pro is free for students through GitHub Education (education.github.com) with your Western email.
4. Click **Publish Repository**.

Your code is now at `https://github.com/<your-username>/london-housing`.

## 5. Check that Actions is allowed to save data

On github.com, in your repo:

1. **Settings → Actions → General**.
2. Under **Actions permissions**, choose **Allow all actions and reusable workflows**. This is usually already selected.
3. Under **Workflow permissions**, either option works: the workflow asks for write access itself (`permissions: contents: write`). If a run fails with a "permission denied" error on the push step, choose **Read and write permissions** and click **Save**.

## 6. Run it once by hand

1. Go to the **Actions** tab.
2. Click **Daily scrape** on the left, then **Run workflow → Run workflow**.
3. Click the run to watch it.
   - **The first run takes about 30 minutes.** It opens every matching listing once, 10 seconds apart, as the site asks. Later runs take a few minutes.
   - The summary page of a finished run shows a table of the new listings.
4. When it's done, the **Code** tab shows a new commit from `github-actions[bot]` like "Update listings: 42 new (2027-…)".

From then on it runs **every day around 7 am Toronto time** with nothing for you to do.

## 6b. Turn on the website (GitHub Pages)

The **Publish website** workflow (`.github/workflows/pages.yml`) puts `site/` and the latest listings online. It runs whenever the website changes, after every successful daily scrape, and when you click its Run button. It needs to be switched on once:

1. On github.com: **Settings → Pages**.
2. Under **Build and deployment → Source**, choose **GitHub Actions**. Not "Deploy from a branch".
3. Go to **Actions → Publish website → Run workflow → Run workflow**. It takes about a minute.
4. Open the finished run. The **publish** box shows your link: `https://<your-username>.github.io/london-housing/`.
5. Open that link on your phone and check that you see real listings, not the sample ones.
   - If the daily scrape hasn't finished its first run yet, you'll see sample listings until it does. The site republishes itself right after each scrape.
   - Then pin the link in your group chat.

The website is public, like the repo, but it holds nothing private: listings and the first names in `site/js/config.js`. Votes and notes will live in Supabase behind your group code (Phase 2).

## 6c. Email alerts (Gmail)

After each daily scrape, the **Email the group about new houses** step sends one email listing the houses that are new that morning, cheapest first, with a **Vote with the group** button. No new houses means no email. Until you do the steps below, the step just writes what it *would* have sent into the run's log.

**1. Choose the Gmail account that sends it.** A new Gmail made just for this, like `ourhousehunt2027@gmail.com`, is the tidiest. It keeps your own account's password-related settings separate. Your own Gmail also works.

**2. Turn on 2-Step Verification on that account.** Gmail only allows app passwords once this is on.
1. Go to **myaccount.google.com** while signed in as that account.
2. **Security → 2-Step Verification → Turn on**, and follow the steps.

**3. Make an app password.** This is a separate 16-letter password just for the house finder. Your real password never goes into GitHub, and you can delete this one any time.
1. Go to **myaccount.google.com/apppasswords**.
2. Name it `House finder` and click **Create**.
3. Copy the 16 letters it shows. **It's only shown once.**

**4. Add three secrets on GitHub.** In your repo, go to **Settings → Secrets and variables → Actions → New repository secret**. Add each of these:

| Name | Value |
|---|---|
| `SMTP_USER` | the Gmail address from step 1 |
| `SMTP_PASSWORD` | the 16-letter app password, **typed without spaces** |
| `ALERT_TO` | everyone who should get the email, separated by commas: `you@gmail.com, jordan@gmail.com, maya@uwo.ca` |

Secrets stay hidden. Even you can't view them again after saving, and they never show up in run logs.

**5. Optional: link straight into the group.** The email button opens `https://<your-username>.github.io/london-housing/` by default. To have it open your invite link instead (so a friend on a new phone joins in one tap), set a variable:
1. Same page, **Variables** tab → **New repository variable**.
2. Name: `SITE_URL`. Value: your full invite link with `#join=…` (from `supabase/SETUP.md`, step 7).

**6. Check it.** Go to **Actions → Daily scrape → Run workflow**.
- If there are new houses, check everyone's inbox, **and the spam folder the first time**. Mark it "Not spam" once and later emails land in the inbox.
- If nothing is new that run, the email step's log says "No new houses this run, so no email". The next new house will trigger one.
- **The very first scrape finds everything at once.** If the secrets are in before that run, the first email lists the 15 cheapest houses, plus "And N more on the group page".

**If it goes wrong:**
- The email step turns orange (warning), but the scrape and the website carry on as normal. A mail problem never blocks them.
- Its log says what happened. **"Gmail didn't accept the login"** almost always means one of two things: the app password has spaces or a typo, or 2-Step Verification was turned off (which deletes app passwords). Make a new app password and update `SMTP_PASSWORD`.

**Preview the email on your laptop** (nothing is sent):

```bash
.venv/bin/python -m alerts.email_digest --preview email-preview.html
```

Then open `email-preview.html` in your browser. It only has content when the latest scrape found new houses.

## 7. Working on your laptop after that

The bot commits to GitHub every day, so your laptop copy falls behind. **Before you change anything, get the latest:** in GitHub Desktop click **Fetch origin**, then **Pull origin**. After changing things: write a summary, **Commit to main**, then **Push origin**.

If you forget and GitHub Desktop says your branch has diverged, click **Pull origin** anyway. It merges the bot's data commits with your changes. They touch different files, so there's nothing to fix by hand.

## Things to know

- **If the site blocks GitHub's computers.** offcampus.uwo.ca works from a home connection. Some sites block cloud servers, though. If the "Run the scraper" step shows errors like 403 or timeouts, tell Claude. The fallback is running it from your laptop on a schedule.
- **If the tests fail, nothing is scraped.** The workflow runs `pytest` first and stops there if anything is broken, so a bad change can't overwrite good data. You'll get an email from GitHub when a run fails.
- **The 60-day rule.** GitHub pauses scheduled workflows in a public repo after 60 days with no commits. The bot commits after every successful run (each run updates the timestamp in `listings.json` even when nothing is new), so this shouldn't happen while the daily scrape is working. If it ever does, the Actions tab shows a banner with an **Enable workflow** button.
- **Why the website waits for the scrape to finish.** Commits the bot makes with its built-in token can't start other workflows. So **Publish website** listens for **Daily scrape** finishing instead of for the bot's commit. If a scrape fails, the site keeps showing the last good listings.

## Coming later

- **Supabase secrets.** Once you've set up Supabase (`supabase/SETUP.md`), add `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` under Settings → Secrets and variables → Actions → **New repository secret**. Step 8 of that guide says where each value comes from. You can do this as soon as Supabase exists, without waiting for alerts: the daily scrape's last step, **Keep Supabase awake**, then reads from it every morning so the free project never pauses. Until the secrets exist, that step skips itself.
- **Phone push alerts** (Phase 3): same Secrets page. Claude will tell you each name and where its value comes from.
