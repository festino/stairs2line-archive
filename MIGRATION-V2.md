# Archive source schema v2

## Versioned posts and filename media references

Post data keeps stable identity and publication date on the post object itself, together with the current known availability of the original post. Editable content is stored in ordered `versions`; the last entry is the current version used by listings. `status` describes only whether the original post is still available. It is not a property of an edited version.

```json
{
  "key": "tumblr:61704687471",
  "platform": "tumblr",
  "id": "61704687471",
  "status": "deleted",
  "publishedAt": "2013-09-20T00:00:00.000Z",
  "versions": [
    {
      "firstRebloggedAt": "2013-09-20T01:42:17.000Z",
      "reblogs": [
        { "blog": "example-reblogger", "id": "61705200123" }
      ],
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

Tumblr versions may additionally carry reblog evidence. `firstRebloggedAt` is the earliest known timestamp of a **reblog** preserving that exact content/layout version; the original/root post itself is deliberately ignored when calculating it because its `publishedAt` already lives on the outer post. `reblogs` is the list of known live reblogs preserving the version and stores only `{ blog, id }`; generated pages reconstruct the Tumblr URL. The Tumblr import helper always emits `reblogs`, including an empty array, and emits `firstRebloggedAt: null` when a version has no reblog observation.

The source schema still accepts legacy `versions[].status` during the v2.3 transition, but `upgrade` moves the effective value to `post.status` and removes it from version objects. New data should only use the top-level status.

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

The command converts flat posts into `versions`, moves original-post availability to top-level `post.status`, removes legacy per-version status, replaces legacy media IDs with the best matching declared physical filename to use as the lookup key, injects known Tumblr row layout data where available, and converts legacy flat platform profile fields to `platforms[].versions`. The migration report includes post and platform version counts. Review `ambiguousMediaReferences` when one media entity had several equally plausible files. `unresolvedMediaReferences` should be empty before treating the migration as complete.

The legacy `migrate` command remains an intermediate schema-v1 import because it runs before a physical media directory is known. Run `resolve` afterwards; `resolve` fills artwork file paths and upgrades posts and platform profiles to schema v2 automatically.


### Tumblr snapshot/reblog importer

`tools/tumblr_posts_to_v2.py <old-posts.jsonc> <directory> -o data/source/posts/tumblr.jsonc` regenerates the complete Tumblr post file from all API JSON snapshots/reblogs in `<directory>`. The old post file is used only as authoritative existing metadata for root availability and for the end-of-run change report: matching post ids keep their old `alive`/`deleted` status, while newly discovered root posts default to `alive`. Posts or versions that are no longer represented by the supplied JSON set are not silently retained; they disappear from the generated output and are explicitly listed in the report, so an incomplete snapshot directory is visible before replacing the source file.

The importer fingerprints the complete `description + media + layout` and emits every unique version. Versions are ordered by the earliest reblog that preserves them. A direct JSON snapshot of the original/root post participates in content deduplication but never supplies `firstRebloggedAt`; a root-only version with no reblog evidence sorts after dated reblog versions. For each version the importer always writes a chronologically ordered `reblogs` list of Tumblr blog nickname + reblog id pairs. Duplicate input snapshots of the same reblog are collapsed. The earliest timestamp among those reblogs is written as `firstRebloggedAt`.

After generation, stderr reports added/removed root posts, added/removed content versions, existing versions whose reblog evidence changed, publication-time changes, and a separate list of media filenames that occur in the new generated file but nowhere in the old post file. This media list is intended as the checklist for newly introduced post media that may need to be connected to artwork entities before the normal archive validation/build succeeds.

Tumblr URL suffixes are converted according to how this archive stores originals rather than according to Tumblr's response MIME type. `.pnj` is stored as `.png`, `.gifv` is stored as `.gif`, and every other URL extension is kept as-is. This avoids the old `.webp` false positives caused by Tumblr advertising GIF preview variants as WebP.

On an individual Tumblr post page, the earliest known reblog date stays visible in the compact version metadata row. The potentially long preserved-reblog list is collapsed behind a small list button next to that date and opens as a bounded scrolling popover, so a heavily reblogged post does not make every version card much taller by default.

All source locale files are expected to expose the same leaf-key set as `DEFAULT_LOCALES`. Tests also audit every literal `localeText(...)` key used by the site builder, so adding a new UI string without adding it to `en`, `ru`, `ja`, and the generated defaults fails the test suite instead of silently rendering the key name.

## Build and page behavior

The compiler resolves every post filename back to its artwork media entity and validates that the declared file exists. Rendering then uses the media entity's `displayFile`, the smallest existing equivalent physical file by byte length. All existing equivalents of a media item linked to a post count as assigned to that post for validation.

The compiler also recovers media-only Twitter entries from otherwise-unlinked files under `twitter/` whose native Twitter media identifier encodes a timestamp. These are generated manifest posts rather than source post objects: they use `status: "lost"`, have no external post URL, carry `recovery.kind: "media-only"`, and use the latest media upload timestamp in the inferred group as an explicitly approximate publication date. The compact Twitter archive marks them as lost and their detail page explains that only the images survived.

Recovered Twitter media are grouped by upload time rather than artwork/version ownership, because known multi-image tweets in this archive frequently contain media from different artworks or different versions of the same artwork. Media whose decoded upload timestamps all fit inside the same 60-second window are treated as one lost post, up to Twitter's four-image limit. The window is anchored at the first media timestamp, so clustering cannot chain indefinitely through a sequence of pairwise-close uploads. A logical media item already linked to a known Twitter post is not duplicated as a recovered entry. Files outside the `twitter/` directory, including generic names such as `other/before-2018-02-24_...`, are never assigned to Twitter by this heuristic.

The 60-second grouping window is intentionally fixed rather than recalculated on every build. In the current source data there are 60 Twitter posts with known publication times; the smallest interval between two known posts is 110.635 seconds. Half of that is about 55 seconds, for which one minute is the natural practical threshold. As a second check, among known multi-image Twitter posts with decodable media IDs the largest observed span from the first uploaded image to the last is only 12.420 seconds, while the smallest observed gap between media timestamps belonging to different known posts is 855.580 seconds. Keeping the threshold fixed prevents adding a newly recovered exact post date from silently changing how older media-only entries are grouped.

`/posts/` is a monthly activity archive: each year has twelve month cells whose intensity depends only on publication count. Opening a populated month shows the posts with thumbnails and platform labels. The popover is positioned before it becomes visible and has no opening animation, so it stays inside the viewport without a corrective slide. It intentionally does not aggregate artwork or artwork-version counts.

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

`viewerAnchor.points` contains exactly two distinct coordinates in the **pixel coordinate system of that image**, and fractional coordinates are allowed. The coordinates are not required to lie inside the image rectangle: negative values or values beyond width/height are valid and are useful when two versions are non-overlapping crops of the same larger source. `viewerAnchor.file` names the declared physical file whose pixel coordinate system is used. The field is optional; when it is omitted, the first declared existing image with known dimensions is used as the reference. The compiler rescales the coordinates to the lightest `displayFile`, so choosing a smaller equivalent file for the generated site does not change the intended registration.

The pair represents translation and scale. Its midpoint is the stable position of the matched area and the distance between the two points defines the scale. Point order does **not** imply mirroring or rotation. For orientation changes, `viewerAnchor.flipX` and `viewerAnchor.rotation` are optional: omitted `flipX` means `false`, and omitted `rotation` means `0`. `flipX: true` mirrors left/right first; `rotation` then rotates clockwise by the given number of degrees. Thus `flipX: true` together with `rotation: 180` is equivalent to a vertical flip. Arbitrary finite rotation values are accepted rather than only multiples of 90 degrees.

When corresponding coordinate frames are supplied for cropped/resized/reoriented versions, the same source locations remain at the same screen coordinates while moving between them, even when some of those reference locations lie outside a particular crop. The viewer transforms all four image corners before computing the bounds of **all** media in the artwork group, then fits the union of those bounds into the available stage. Consequently an uncropped or rotated version may occupy a larger rectangle than the current version, but no version can run outside the viewport and the registered common area does not jump or change screen scale. The visual orientation is applied to the regular `<img>`/`<video>` element with a CSS transform; the underlying downloadable file is not rewritten.

When `viewerAnchor` is absent, MediaViewer behaves as though the two points were the horizontal center of the top and bottom image edges: `(width / 2, 0)` and `(width / 2, height)`. Thus unregistered versions are aligned by height and centered horizontally. Explicit registration is recommended whenever cropping or resizing changed the relationship between the outer image bounds and the unchanged content.

These coordinates are used only on an individual artwork page while moving among that artwork's version media; normal post viewing is unaffected. The displayed object remains a regular `<img>`/`<video>` rather than being redrawn to a canvas, so normal browser image actions remain available.

MediaViewer reserves a separate scrollable row for metadata, so a tall portrait can no longer push the text below the viewport. Dates in the post-reference row are formatted through the browser locale rather than exposing raw ISO timestamps. The current post is kept in that row as a disabled `aria-current` item instead of being emitted a second time as a link. The post-reference strip always reserves one fixed-height row; media with no known linked posts show a localized “no known posts” placeholder there instead of omitting the row. This keeps the artwork alignment stage at the same height while switching between sourced and unsourced versions, so registered pixels do not jump vertically merely because one image has no preserved publication reference.

The entire empty side area directly to the left of the displayed full-size media is the previous-media hit target when one exists, and the entire corresponding area on the right is the next-media target. Hovering anywhere in either hit target highlights that whole side zone and brightens its larger dimmed thumbnail, so the visual affordance matches the clickable area instead of existing only around the thumbnail. Other empty backdrop space closes the viewer. The side targets end above the metadata row and automatically follow the rendered media bounds, so they do not cover the image. Touch devices can also move between media with a horizontal swipe; gestures beginning within 28 CSS pixels of a screen edge are deliberately ignored to avoid competing with browser/system back-forward gestures. Keyboard arrows and wheel navigation remain supported.

MediaViewer navigation gathers media from paged listing containers and, on individual post pages, from `.post-version-list`. This keeps previous/next navigation available for multi-image standalone posts such as the Piapro Blog entries instead of opening only the clicked image with no neighbours.

## Admin artwork alignment editor

The generated `/admin/` has an **Align versions** tab for preparing `viewerAnchor` values visually. The artwork selector intentionally includes only artworks with at least two versions. Choose one and the editor overlays the first declared `files[]` image from every usable media item in its versions. The selected layer can be dragged on the canvas or moved with the arrow keys, scaled, rotated, horizontally flipped, and given an independent preview opacity. Opacity is never written to source data. Alignment images use nearest-neighbour (`image-rendering: pixelated`) rendering so individual source pixels remain crisp when the editor is magnified.

Layer **Pixel scale ×** is an absolute scale relative to the selected source image, not a scale relative to whatever size happened to fit the canvas. A value of `1` means one pixel in that source image has the same alignment-world size as one pixel in another layer at `1`; an unanchored layer therefore starts at `1`. For a pixel-art image that is itself a 2× nearest-neighbour upscale, entering `0.5` makes its original logical pixels match a non-upscaled version without guessing a viewport-dependent ratio. When valid existing `viewerAnchor` pairs are present, the editor restores their relative scale with one anchored layer as the `1` reference; unanchored layers still start at `1`.

The alignment canvas has a separate **view camera** that never changes generated anchors. Initial layer geometry is kept in source-pixel units and the camera performs the initial fit instead of baking viewport fit into layer scale. The mouse wheel zooms around the pointer; the `+`/`-` keys and toolbar buttons zoom around the canvas center; `0` restores 100% view; and **Fit** (or `F`) fits the current transformed bounds of all layers without altering their alignment. Pan with the middle mouse button or hold Space while dragging. Camera zoom is applied when calculating each `<img>` element's final CSS size instead of scaling one already-rasterized parent element; this keeps nearest-neighbour rendering stable. Layer position is then applied on a separate wrapper with `translate3d(...)` rather than fractional CSS `left`/`top`, so fractional offsets are preserved for compositing and become visibly finer as the camera is zoomed. Selecting a layer raises that layer above the others, which is useful while matching details; per-layer opacity still controls the comparison blend.

Movement is expressed in **alignment-world pixels**, independent of camera zoom. With **Snap 1 px** enabled (the default), dragging snaps to that grid and arrow keys move exactly 1 alignment pixel; `Shift` moves 10 and `Alt` allows 0.25-pixel subpixel adjustment. At Pixel scale `1`, one alignment pixel is one source pixel. Disabling Snap permits free fractional dragging, and the numeric X/Y fields accept arbitrary fractional values. For unanchored layers at Pixel scale `1`, initial placement also snaps the top-left source-pixel lattice to integer alignment coordinates, avoiding the old half-pixel phase difference between odd- and even-sized images. View zoom and pan are editor-only state and are neither emitted in generated JSON nor written to the artwork source file.

The editor deliberately uses `media.files[0]` as the coordinate image. Anchors generated by this tool therefore omit `viewerAnchor.file`; after rebuilding, the compiler interprets the points in that first usable declared image's pixel coordinate system. If the first declared file is missing, is not an image, or has no known dimensions in the build catalog, that media item is not offered as an alignment layer.

The two generated points are derived from the current overlay rather than requiring the user to click matching landmarks manually. They define a shared coordinate frame: the editor takes the first usable layer's vertical centre line as two stable world-space reference locations and maps those same locations back into every source image. This reproduces the relative translation and scale established visually, while `flipX` and `rotation` record orientation explicitly. A mapped point may be outside a cropped image (including negative coordinates), so no geometric overlap between every version is required. This is important for adjacent or near-adjacent crops of the same larger source. All point coordinates may be fractional pixels.

The **Write anchors to source file** button generates the anchors and, in browsers that support the File System Access API, asks for local read/write access on first use. Select `data/source`, `data/source/artworks`, or the repository root; the admin data identifies the exact `artworks/*.jsonc` file containing the selected artwork. The editor updates only that artwork's media `viewerAnchor` values and writes the source document back. Existing leading line comments and all parsed data are retained, though the JSON body is normalized to two-space formatting. Rebuild the site afterwards so normal compiler validation checks the generated coordinates. Browsers without direct local-file access still show the generated anchor JSON for manual use.

