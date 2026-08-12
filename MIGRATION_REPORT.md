# Migration report

The legacy page was parsed from `tests/fixtures/legacy-page.txt`.

## Imported

| Entity | Count |
|---|---:|
| Posts | 243 |
| Artworks | 239 |
| Versions | 401 |
| Logical media items | 401 |
| Legacy media IDs | 505 |
| Inferred post-to-media links | 189 |

## Decisions applied

- Every post contains `status: "alive"` or `status: "deleted"` directly.
- Twitter post timestamps are decoded from post snowflakes.
- Numeric timestamps from other platforms are normalized to ISO 8601.
- Legacy version dates are migrated as `knownNotAfter`, not as exact creation dates.
- Artwork text inferred from a linked post is stored only under `ja`; translations are never invented.
- Artwork `description` remains supported and missing languages are reported once per artwork.
- Each legacy version becomes one logical media item containing all equivalent legacy IDs from that version.
- The first migration pass does not invent file extensions or paths that were absent from the uploaded source.

## Expected preview warnings

The placeholder preview has no physical media directory, so these warnings are expected:

- 401 unresolved media candidate warnings;
- translation warnings for entities that currently contain only Japanese text or no text;
- undated version warnings where neither an explicit date nor an inferred dated post exists;
- post-without-media warnings where a relation requires the real filename catalog.

There are no validation errors in placeholder preview mode. Production mode does not create placeholders and fails when a logical media item has no existing equivalent file.

## Completing physical resolution

```bash
node src/cli.mjs resolve \
  --source data/source \
  --media-root /path/to/wwwroot/media/stairs2line \
  --output data/resolved
```

This step uses the real filenames and sizes, fills exact `files`, auto-links posts, and orders the source file candidates by size. The compiled `displayFile` is always selected independently from the source order by the smallest existing `byteLength`.
