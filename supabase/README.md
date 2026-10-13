# Supabase migrations

Schema-as-code for Reckon.

## Apply migrations

Run every file in `migrations/` in filename order on a new project, using the Supabase SQL editor or your migration runner. On an existing project, back up first and run only the files not yet applied. `npm test` checks that the full set applies cleanly to an empty database.

## Conventions

- One numbered file per change; never edit a file that has been applied anywhere.
- Every table has row level security; members only see their own pharmacy.
- Functions that write are `security definer` with `search_path` set, check pharmacy membership, and are not executable by `anon`.
