# Archive source schema v2

## Versioned posts and filename media references

Post data keeps only stable identity/date fields on the post itself. Everything that can change is stored in ordered `versions`; the last entry is the current version used by listings.

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

`versions[].media` contains physical file paths relative to the archive media root, not artwork/media IDs. These paths are lookup keys: each one identifies the logical media item by naming one of its declared physical files, but it does not force the generated page to serve that exact file. Rendering resolves the logical media and then uses its lightest existing equivalent file.

`layout[].display[].blocks` contains zero-based indexes into that post version's `media` array. Tumblr uses this field. Twitter/X derives its 1-4-image layout from media count and does not need a `layout` field.

## Versioned platform profiles

A platform definition now has ordered profile snapshots in `versions`. The last entry is current. A version is a complete snapshot: when any profile field changes, repeat the unchanged fields in the new object as well.

```json
{
  "id": "twitter",
  "label": { "default": "Twitter / X" },
  "defaultAccount": "stairs2line",
  "postUrlTemplate": "https://twitter.com/{account}/status/{id}",
  "icon": "misc/twitter-icon-free-png.webp",
  "versions": [
    {
      "observedAt": "2024-01-01",
      "account": "stairs2line",
      "description": {
        "en": "Profile bio as it appeared on the platform."
      },
      "sourceUrl": "https://twitter.com/stairs2line",
      "avatar": "profiles/twitter/avatar-2024.png",
      "banner": null
    }
  ]
}
```

`observedAt` is optional. `account`, `description`, `sourceUrl`, `avatar`, and `banner` belong to the same snapshot. `sourceUrl` is the official profile/site page from which that platform archive was collected and is shown as an external link on the platform directory and platform pages. `defaultAccount` remains outside the versions as a technical fallback for URL templates when a post does not specify an account of its own; the displayed account comes from the current profile version.

`avatar` and `banner` are tri-state. A string means that exact archived asset is known; `null` means the profile is known to have had no custom asset at that snapshot; omitting the field means the archive does not know whether an asset existed. This distinction is preserved by the compiler and upgrader. An explicitly null banner is not replaced by the decorative platform fallback in generated pages.

String avatar/banner paths are validated against the media root. Missing referenced profile assets are build errors in a normal build and warnings in preview-placeholder builds; `null` is never treated as a missing file.

## Upgrading an existing source tree

```sh
node src/cli.mjs upgrade --source data/source-v1 --output data/source-v2
```

The command converts flat posts into `versions`, replaces legacy media IDs with the best matching declared physical filename to use as the lookup key, injects known Tumblr row layout data where available, and converts legacy flat platform profile fields to `platforms[].versions`. The migration report includes post and platform version counts. Review `ambiguousMediaReferences` when one media entity had several equally plausible files. `unresolvedMediaReferences` should be empty before treating the migration as complete.

The legacy `migrate` command remains an intermediate schema-v1 import because it runs before a physical media directory is known. Run `resolve` afterwards; `resolve` fills artwork file paths and upgrades posts and platform profiles to schema v2 automatically.

## Build and page behavior

The compiler resolves every post filename back to its artwork media entity and validates that the declared file exists. Rendering then uses the media entity's `displayFile`, the smallest existing equivalent physical file by byte length. All existing equivalents of a media item linked to a post count as assigned to that post for validation.

The compiler also recovers media-only Twitter entries from otherwise-unlinked files under `twitter/` whose native Twitter media identifier encodes a timestamp. These are generated manifest posts rather than source post objects: they use `status: "lost"`, have no external post URL, carry `recovery.kind: "media-only"`, and use the latest media upload timestamp in the inferred group as an explicitly approximate publication date. The compact Twitter archive marks them as lost and their detail page explains that only the images survived.

Recovered Twitter media are grouped by upload time rather than artwork/version ownership, because known multi-image tweets in this archive frequently contain media from different artworks or different versions of the same artwork. Media whose decoded upload timestamps all fit inside the same 60-second window are treated as one lost post, up to Twitter's four-image limit. The window is anchored at the first media timestamp, so clustering cannot chain indefinitely through a sequence of pairwise-close uploads. A logical media item already linked to a known Twitter post is not duplicated as a recovered entry. Files outside the `twitter/` directory, including generic names such as `other/before-2018-02-24_...`, are never assigned to Twitter by this heuristic.

The 60-second grouping window is intentionally fixed rather than recalculated on every build. In the current source data there are 60 Twitter posts with known publication times; the smallest interval between two known posts is 110.635 seconds. Half of that is about 55 seconds, for which one minute is the natural practical threshold. As a second check, among known multi-image Twitter posts with decodable media IDs the largest observed span from the first uploaded image to the last is only 12.420 seconds, while the smallest observed gap between media timestamps belonging to different known posts is 855.580 seconds. Keeping the threshold fixed prevents adding a newly recovered exact post date from silently changing how older media-only entries are grouped.

`/posts/` is a monthly activity archive: each year has twelve month cells whose intensity depends only on publication count. Hovering or opening a populated month shows the posts with thumbnails and platform labels. It intentionally does not aggregate artwork or artwork-version counts.

Platform pages use their compact archive as the default route: `/posts/platform/<platform>/`. Full post cards are available at `/posts/platform/<platform>/full/`. The old `/compact/` route is still generated as a noindex compatibility alias. The platform directory uses bounded two-column cards on desktop with a short profile summary and thumbnail previews instead of embedding full posts. Platform cards are emitted in exactly the order of `platforms` in `platforms.jsonc`; no alphabetical or activity-based reordering is applied.

The platform hero itself contains the page heading, so platform feeds no longer repeat a large `Posts on …` heading below it. Archived profile banners are rendered twice: a contained foreground copy always shows the complete banner, while a blurred cover copy fills unused space behind it. This handles both very wide Twitter headers (for example 3:1) and much taller Tumblr headers (for example about 16:9) without cropping away the foreground content. Platforms known to have no banner should use `banner: null`, which removes the banner slot entirely.

Full post media on every platform is capped at `min(62dvh, 680px)` per rendered image/video; platform-specific collage rules such as Twitter and Tumblr still apply inside that bound. Full platform feeds omit the redundant platform-name link from every post header, while individual post pages keep it. When an original post URL exists, the date/status link includes an external-link icon to make that destination explicit.

## MediaViewer alignment and navigation

Artwork media may optionally define a two-point registration for comparing versions of the same image:

```json
{
  "id": "artwork-0042/v03/m01",
  "files": [
    "pixiv/12345678_p0-original.png",
    "pixiv/12345678_p0-small.png"
  ],
  "viewerAnchor": {
    "file": "pixiv/12345678_p0-original.png",
    "flipX": true,
    "rotation": 180,
    "points": [
      { "x": 418.5, "y": 271.25 },
      { "x": 1262.75, "y": 1038.5 }
    ]
  }
}
```

`viewerAnchor.points` contains exactly two distinct points in **pixel coordinates of that image**, and fractional coordinates are allowed. `viewerAnchor.file` names the declared physical file whose pixel coordinate system the numbers refer to. The field is optional; when it is omitted, the first declared existing image with known dimensions is used as the reference. The compiler rescales the coordinates to the lightest `displayFile`, so choosing a smaller equivalent file for the generated site does not change the intended registration.

The pair represents translation and scale. Its midpoint is the stable position of the matched area and the distance between the two points defines the scale. Point order does **not** imply mirroring or rotation. For orientation changes, `viewerAnchor.flipX` and `viewerAnchor.rotation` are optional: omitted `flipX` means `false`, and omitted `rotation` means `0`. `flipX: true` mirrors left/right first; `rotation` then rotates clockwise by the given number of degrees. Thus `flipX: true` together with `rotation: 180` is equivalent to a vertical flip. Arbitrary finite rotation values are accepted rather than only multiples of 90 degrees.

When corresponding pairs are supplied for cropped/resized/reoriented versions, the common source pixels remain at the same screen coordinates while moving between them. The viewer transforms all four image corners before computing the bounds of **all** media in the artwork group, then fits the union of those bounds into the available stage. Consequently an uncropped or rotated version may occupy a larger rectangle than the current version, but no version can run outside the viewport and the registered common area does not jump or change screen scale. The visual orientation is applied to the regular `<img>`/`<video>` element with a CSS transform; the underlying downloadable file is not rewritten.

When `viewerAnchor` is absent, MediaViewer behaves as though the two points were the horizontal center of the top and bottom image edges: `(width / 2, 0)` and `(width / 2, height)`. Thus unregistered versions are aligned by height and centered horizontally. Explicit registration is recommended whenever cropping or resizing changed the relationship between the outer image bounds and the unchanged content.

These coordinates are used only on an individual artwork page while moving among that artwork's version media; normal post viewing is unaffected. The displayed object remains a regular `<img>`/`<video>` rather than being redrawn to a canvas, so normal browser image actions remain available.

MediaViewer reserves a separate scrollable row for metadata, so a tall portrait can no longer push the text below the viewport. Dates in the post-reference row are formatted through the browser locale rather than exposing raw ISO timestamps. The current post is kept in that row as a disabled `aria-current` item instead of being emitted a second time as a link.

Clicking empty space directly to the left of the displayed full-size media moves to the previous item when one exists; clicking empty space to the right moves to the next. Other empty backdrop space closes the viewer. The visible previous/next controls use larger dimmed thumbnails and automatically shrink to the actual free side space so they do not cover the image. Touch devices can also move between media with a horizontal swipe; gestures beginning within 28 CSS pixels of a screen edge are deliberately ignored to avoid competing with browser/system back-forward gestures. Keyboard arrows and wheel navigation remain supported.
