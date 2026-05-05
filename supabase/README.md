# Supabase migrations

Schema-as-code for the Reckon Supabase project (`kvsipdhtsgibavcvxgqx`).

## Apply a migration

1. Open the [SQL editor](https://supabase.com/dashboard/project/kvsipdhtsgibavcvxgqx/sql/new)
2. Paste the contents of the next pending file from `migrations/`
3. Click **Run**
4. Confirm no errors in the output panel

## Files

- `0001_initial_schema.sql` — pharmacies, invoices, invoice_lines, statements, statement_lines, RLS, storage bucket

## Conventions

- File numbering is monotonic (0001, 0002, 0003 …) — never reuse a number
- Every business table has `pharmacy_id` for multi-tenancy
- RLS is `enable`d on every table — write the policy in the same migration
- Soft deletes use `deleted_at timestamptz` rather than hard `delete`
- Money columns are `numeric(12, 2)` — never `float`
- Primary keys are `uuid` generated server-side via `gen_random_uuid()`

## Local schema check

After running a migration, sanity-check the result with:

```sql
select table_name, column_name, data_type
from information_schema.columns
where table_schema = 'public'
order by table_name, ordinal_position;
```
