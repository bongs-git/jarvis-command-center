# Loading the knowledge base

The atlas's data (`atlas_kb.json`) is private. It lives in one row of the table `public.indai_atlas` (key `kb`), which
only the back end's service role can read, and nowhere in this repository. This folder is how it gets there when the
only road to the database is SQL statements. It holds no data.

Loaded November 20, 2026: version `rev1.1-corrected`, 67 rules, 223 kB stored, an exact copy of the owner's file.

## When the owner sends a new revision

1. `python3 atlas/load/pack.py /path/atlas_kb.json /a/folder/outside/the/repository`
   It writes about 32 statements of about 8,000 characters and prints two fingerprints.
2. Run the top part of `unpack.sql` on the database (staging table and three helper functions).
3. Run each statement. Every one answers `part, ok` for its rows; send again any row that is not `ok`.
   A statement can be sent by hand or by a helper that copies it character for character: the check on each row is
   what makes that safe.
4. Run block 3a of `unpack.sql` with the new version name and the second fingerprint. It stores nothing unless the
   rebuilt value matches the owner's file exactly.
5. Run block 3b to remove the staging area, and delete the folder from step 1.

Check afterwards: `select version, pg_size_pretty(pg_column_size(value)::bigint) from public.indai_atlas where key = 'kb'`
returns the row, and `GET /rest/v1/indai_atlas` with the public key answers "permission denied".

## What the packing does

Every result cell in the file holds six numbers. Two of them are exact functions of the others
(`win = wins / n`, `lift = win - base`), and every rule has the same grid of eras, bins and horizons, so the packed
form sends four numbers a cell and no field names: 228,000 characters instead of 493,000. The database rebuilds the
rest. `pack.py` checks each cell before leaving anything out, and sends whole any cell that would not rebuild exactly.

One thing to know: the hosted database prints rebuilt decimals to 15 digits unless told otherwise. The helper
functions set `extra_float_digits = 1` for that reason, and the fingerprint check in step 4 is what catches it if
that ever stops being enough.
