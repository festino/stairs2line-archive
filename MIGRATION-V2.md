# Post data schema v2

Post data now keeps only stable identity/date fields on the post itself. Everything that can change is stored in ordered `versions`; the last entry is the current version used by listings.

```json
{
  "key": "tumblr:61704687471",
  "platform": "tumblr",
  "id": "61704687471",
  "publishedAt": "2013-09-20T00:00:00.000Z",
  "versions": [
    {
      "status": "deleted",
      "title": { "ja": "..." },
      "description": { "ja": "..." },
      "media": [
        "tumblr/61704687471_example_1.png",
        "tumblr/61704687471_example_2.png"
      ],
      "layout": [
        {
          "type": "rows",
          "display": [
            { "blocks": [0] },
            { "blocks": [1, 2] }
          ]
        }
      ]
    }
  ]
}
```

`versions[].media` contains physical file paths relative to the archive media root, not artwork/media IDs. These paths are lookup keys: each one identifies the logical media item by naming one of its declared physical files, but it does not force the generated page to serve that exact file. `layout[].display[].blocks` contains zero-based indexes into that version's `media` array, so layout may change independently in each post version.

## Upgrading an existing source tree

```sh
node src/cli.mjs upgrade --source data/source-v1 --output data/source-v2
```

The command converts flat posts into `versions`, replaces legacy media IDs with the best matching declared physical filename to use as the lookup key, injects known Tumblr row layout data where available, and writes `migration-v2-report.json`. Review `ambiguousMediaReferences` in that report when one media entity had several equally plausible files. `unresolvedMediaReferences` should be empty before treating the migration as complete.

The legacy `migrate` command remains an intermediate schema-v1 import because it runs before a physical media directory is known. Run `resolve` afterwards; `resolve` fills artwork file paths and upgrades posts to schema v2 automatically.

## Build/validation behavior

The compiler resolves every post filename back to its artwork media entity and validates that the declared file exists. After that resolution, rendering uses the media entity's `displayFile`: the smallest existing equivalent physical file by byte length. The filename written in the post remains available as the source/lookup reference, so a Tumblr `_1280` filename can identify the media while the generated page serves an equivalent `_540` file. All existing equivalents of a media item linked to a post count as assigned to that post for validation. Missing or unassigned post files are build errors in a normal build; preview-placeholder builds downgrade missing physical files so the UI can still be inspected without the media tree.

Tumblr full-post rendering honors `layout` row definitions. Compact platform archives are available at `/posts/platform/<platform>/compact/` (and `/compact/oldest/`), with platform-specific Pixiv, Twitter/X, and Tumblr presentation.
