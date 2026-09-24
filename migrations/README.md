# migrations

SQL for the shared uwuapps Supabase project. Paste each file into the SQL
editor and run it once, in number order.

**Never edit a file once it has been run.** Every change is a new file with
the next number.

| File | What it does |
|---|---|
| `001_uwutetris_schema.sql` | The `uwutetris_` tables, the best score and total points views, and the submit and prune functions. |

Every table has row level security on with no policies. Only the service role
key, used by the Vercel functions in `main-site/api/`, can read or write.
