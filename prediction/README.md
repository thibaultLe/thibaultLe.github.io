# FBR Talks Prediction Page

This page is only reachable by direct link (e.g. `https://YOUR_USERNAME.github.io/prediction/`). It is not linked from the homepage.

## 1. Fill the candidates list

The source page (MPA fbrslides) may require login. Open https://wwwmpa.mpa-garching.mpg.de/fbrslides/index2.php in your browser and copy the list of names and picture URLs into `candidates.json`.

Format for `candidates.json`:

```json
[
  { "id": "1", "name": "Full Name", "imageUrl": "https://..." },
  { "id": "2", "name": "Another Name", "imageUrl": "https://..." }
]
```

Use a unique `id` (string) for each person. `imageUrl` can be the full image URL from the MPA site if they are publicly accessible, or any image URL.

## 2. Set up Supabase (for saving predictions)

GitHub Pages cannot write to a file or database. Predictions are stored in Supabase (free tier).

1. Create a free account at https://supabase.com and create a new project.
2. In the SQL Editor, run:

```sql
create table predictions (
  id uuid default gen_random_uuid() primary key,
  submitter_name text not null,
  selected_ids text[] not null,
  created_at timestamptz default now()
);

alter table predictions enable row level security;

create policy "Allow anonymous insert"
  on predictions for insert to anon with check (true);

create policy "Allow anonymous select"
  on predictions for select to anon using (true);
```

3. In Supabase: **Settings → API** copy your **Project URL** and **anon public** key.
4. Edit `config.js` and set `window.SUPABASE_URL` and `window.SUPABASE_ANON_KEY`.

## 3. Results / leaderboard

After the committee selects the 8 talks, open `results.html` (same base path, e.g. `.../prediction/results.html`). Enter the 8 winning candidate IDs (one per line or comma-separated). The page will load all predictions from Supabase and show who had the most correct guesses.
