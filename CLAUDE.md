# Working on INDAI

Credits are spent once. Before you research, test, diagnose or ask Bongs anything:

1. `grep -n -i "<topic>" ANSWERED.md`. If it is answered and not stale, use it; re-check only the time-sensitive part.
2. `git log --oneline -8` and the open pull requests: another bot may already have done it.
3. Read the big documents by heading, never whole: `grep -n "^## " HANDOFF.md`, then read that section with an
   offset and limit. HANDOFF.md (38 KB), supabase/OPERATIONS.md (44 KB) and FEATURES.md (18 KB) are long.

When you finish, add an ANSWERED.md entry for any question you answered, research you did, bug you diagnosed or
decision Bongs made (the format is at its top), and a FEATURES.md line for anything he can see.

Lanes: Ikpa has the back end (`supabase/`) and the website's chart; Papilo has the Quest app; ChatGPT gets
front-end hand-offs; Perplexity researches. Hand work across in `handoff/`.

This repository is public: no keys, account numbers, personal finances, trades or atlas numbers in any file.
