# X Bulk Muter v1.6

This build adds two major features:

- scan existing muted words and skip them during bulk add
- bulk unmute matching words from the same list

## Add flow

1. Open `/settings/muted_keywords`
2. Scan existing rows using `button[aria-label="Unmute"]`
3. Read each row's muted word
4. Compare case-insensitively against the supplied list
5. Remove already-muted items from the pending queue
6. Click X's own `Add muted word or phrase` button
7. Fill `/settings/add_muted_keyword`
8. Save
9. Return to the list and continue

## Bulk unmute flow

1. Open `/settings/muted_keywords`
2. Scan existing muted-word rows
3. Match the supplied list against currently-muted words
4. Click only the matching row's `Unmute` button
5. Confirm if X presents a confirmation dialog
6. Continue until all matching targets are handled

## Rate-limit behavior

429 / rate-limit handling remains adaptive:

- first detected rate limit -> 1 minute
- next consecutive rate limit -> 2 minutes
- then 3, 4, 5...
- capped at 20 minutes
- retry the same item after cooldown
- successful operations reset the backoff

## Important

The scan depends on the current X muted-word list markup having an
`Unmute` button with `aria-label="Unmute"` inside each muted-word row.

If X changes that structure, `content.js` may need selector updates.
