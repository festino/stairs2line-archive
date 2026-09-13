#!/usr/bin/env python3
"""Convert Tumblr post/reblog JSON snapshots to stairs2line post schema v2.

The input directory may contain original Tumblr posts and/or reblogs.  Each
reblog may preserve a different historical snapshot of the root post.  The
script groups snapshots by root post id and emits every unique post version,
ordered by the first reblog in which that version was observed.

Output is ordinary JSON (and therefore also valid JSONC) in the form expected
by data/source/posts/tumblr.jsonc.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any



def strip_jsonc_comments(text: str) -> str:
    """Remove // and /* */ comments while preserving strings."""
    out: list[str] = []
    i = 0
    in_string = False
    escape = False
    length = len(text)
    while i < length:
        ch = text[i]
        if in_string:
            out.append(ch)
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                in_string = False
            i += 1
            continue
        if ch == '"':
            in_string = True
            out.append(ch)
            i += 1
            continue
        if ch == "/" and i + 1 < length and text[i + 1] == "/":
            i += 2
            while i < length and text[i] not in "\r\n":
                i += 1
            continue
        if ch == "/" and i + 1 < length and text[i + 1] == "*":
            i += 2
            while i + 1 < length and not (text[i] == "*" and text[i + 1] == "/"):
                if text[i] in "\r\n":
                    out.append(text[i])
                i += 1
            i = min(length, i + 2)
            continue
        out.append(ch)
        i += 1
    return "".join(out)


def load_posts_document(path: Path) -> dict[str, Any]:
    data = json.loads(strip_jsonc_comments(path.read_text(encoding="utf-8")))
    if not isinstance(data, dict) or not isinstance(data.get("posts"), list):
        raise ValueError("expected an object with a posts array")
    return data


def status_map_from_document(data: dict[str, Any]) -> dict[str, str]:
    result: dict[str, str] = {}
    for post in data.get("posts", []):
        if not isinstance(post, dict):
            continue
        post_id = str(post.get("id", ""))
        status = post.get("status")
        if post_id and status in {"alive", "deleted"}:
            result[post_id] = status
    return result


def source_version_identity(version: dict[str, Any]) -> str:
    """Return the content identity used to compare old/new post versions."""
    return json.dumps(
        {
            "description": version.get("description"),
            "media": list(version.get("media") or []),
            "layout": version.get("layout") or None,
        },
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )


def source_version_evidence(version: dict[str, Any]) -> tuple[Any, tuple[tuple[str, str], ...]]:
    reblogs: list[tuple[str, str]] = []
    for item in version.get("reblogs") or []:
        if not isinstance(item, dict):
            continue
        blog = item.get("blog")
        post_id = item.get("id")
        if isinstance(blog, str) and blog and post_id is not None:
            reblogs.append((blog, str(post_id)))
    return (version.get("firstRebloggedAt"), tuple(sorted(set(reblogs))))


def source_media_filenames(posts: list[dict[str, Any]]) -> set[str]:
    filenames: set[str] = set()
    for post in posts:
        if not isinstance(post, dict):
            continue
        for version in post.get("versions") or []:
            if not isinstance(version, dict):
                continue
            for filename in version.get("media") or []:
                if isinstance(filename, str) and filename:
                    filenames.add(filename)
    return filenames


def version_report_label(version: dict[str, Any]) -> str:
    when = version.get("firstRebloggedAt") or "undated"
    media = [item for item in version.get("media") or [] if isinstance(item, str)]
    if not media:
        media_label = "no media"
    elif len(media) == 1:
        media_label = media[0]
    else:
        media_label = f"{len(media)} media; first {media[0]}"
    return f"{when}; {media_label}"


def report_changes(old_document: dict[str, Any], new_posts: list[dict[str, Any]]) -> None:
    old_posts = [post for post in old_document.get("posts", []) if isinstance(post, dict)]
    old_by_id = {str(post.get("id")): post for post in old_posts if post.get("id") is not None}
    new_by_id = {str(post.get("id")): post for post in new_posts if post.get("id") is not None}

    old_ids = set(old_by_id)
    new_ids = set(new_by_id)
    added_posts = sorted(new_ids - old_ids, key=int)
    removed_posts = sorted(old_ids - new_ids, key=int)

    added_versions: list[tuple[str, dict[str, Any]]] = []
    removed_versions: list[tuple[str, dict[str, Any]]] = []
    evidence_updates: list[tuple[str, dict[str, Any]]] = []
    publication_time_changes: list[tuple[str, Any, Any]] = []

    for post_id in sorted(old_ids | new_ids, key=int):
        old_post = old_by_id.get(post_id, {})
        new_post = new_by_id.get(post_id, {})
        if post_id in old_by_id and post_id in new_by_id and old_post.get("publishedAt") != new_post.get("publishedAt"):
            publication_time_changes.append((post_id, old_post.get("publishedAt"), new_post.get("publishedAt")))

        old_versions = {
            source_version_identity(version): version
            for version in old_post.get("versions", [])
            if isinstance(version, dict)
        }
        new_versions = {
            source_version_identity(version): version
            for version in new_post.get("versions", [])
            if isinstance(version, dict)
        }
        for identity in sorted(new_versions.keys() - old_versions.keys()):
            added_versions.append((post_id, new_versions[identity]))
        for identity in sorted(old_versions.keys() - new_versions.keys()):
            removed_versions.append((post_id, old_versions[identity]))
        for identity in old_versions.keys() & new_versions.keys():
            if source_version_evidence(old_versions[identity]) != source_version_evidence(new_versions[identity]):
                evidence_updates.append((post_id, new_versions[identity]))

    old_media = source_media_filenames(old_posts)
    new_media = source_media_filenames(new_posts)
    added_media = sorted(new_media - old_media)

    print("Changes compared with the old Tumblr post file:", file=sys.stderr)
    print(f"  Posts added: {len(added_posts)}", file=sys.stderr)
    for post_id in added_posts:
        print(f"    + {post_id} (status: alive)", file=sys.stderr)
    print(f"  Posts removed: {len(removed_posts)}", file=sys.stderr)
    for post_id in removed_posts:
        print(f"    - {post_id}", file=sys.stderr)

    print(f"  Versions added: {len(added_versions)}", file=sys.stderr)
    for post_id, version in added_versions:
        print(f"    + {post_id}: {version_report_label(version)}", file=sys.stderr)
    print(f"  Versions removed: {len(removed_versions)}", file=sys.stderr)
    for post_id, version in removed_versions:
        print(f"    - {post_id}: {version_report_label(version)}", file=sys.stderr)

    print(f"  Existing versions with changed reblog evidence: {len(evidence_updates)}", file=sys.stderr)
    if publication_time_changes:
        print(f"  Posts with changed publishedAt: {len(publication_time_changes)}", file=sys.stderr)
        for post_id, old_value, new_value in publication_time_changes:
            print(f"    ~ {post_id}: {old_value} -> {new_value}", file=sys.stderr)
    else:
        print("  Posts with changed publishedAt: 0", file=sys.stderr)

    print(f"  New media filenames not present in the old post file: {len(added_media)}", file=sys.stderr)
    for filename in added_media:
        print(f"    + {filename}", file=sys.stderr)


from urllib.parse import urlparse


# These aliases describe how the files were archived locally.  Do not trust
# Tumblr's MIME type here: GIF previews are often advertised as WebP even when
# the original URL is a .gifv that the archive saved as .gif.
URL_EXTENSION_ALIASES = {
    ".pnj": ".png",
    ".gifv": ".gif",
}


@dataclass
class ReblogObservation:
    blog: str
    post_id: str
    timestamp: int


@dataclass
class Snapshot:
    post_id: str
    published_at: int
    description: str
    media: list[str]
    layout: list[dict[str, Any]] | None
    reblog: ReblogObservation | None
    source_ref: str


@dataclass
class UniqueVersion:
    snapshot: Snapshot
    reblogs: dict[tuple[str, str], ReblogObservation] = field(default_factory=dict)
    observed_in: list[str] = field(default_factory=list)

    def add_snapshot(self, snapshot: Snapshot) -> None:
        if snapshot.source_ref not in self.observed_in:
            self.observed_in.append(snapshot.source_ref)
        if snapshot.reblog is None:
            return
        key = (snapshot.reblog.blog, snapshot.reblog.post_id)
        previous = self.reblogs.get(key)
        if previous is None or snapshot.reblog.timestamp < previous.timestamp:
            self.reblogs[key] = snapshot.reblog

    @property
    def first_reblogged_at(self) -> int | None:
        return min((item.timestamp for item in self.reblogs.values()), default=None)


def warn(message: str) -> None:
    print(f"Warning: {message}", file=sys.stderr)


def iso_utc(timestamp: int) -> str:
    return datetime.fromtimestamp(timestamp, timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def normalize_id(value: Any) -> str | None:
    if value is None:
        return None
    value = str(value)
    return value if value else None


def root_post_id(data: dict[str, Any]) -> str | None:
    return normalize_id(
        data.get("reblogged_root_id")
        or data.get("rebloggedRootId")
        or data.get("id_string")
        or data.get("id")
    )


def source_ref(data: dict[str, Any], fallback: str) -> str:
    blog = data.get("blog") or {}
    blog_name = blog.get("name") or data.get("blog_name")
    post_id = normalize_id(data.get("id_string") or data.get("id"))
    if blog_name and post_id:
        return f"{blog_name}/{post_id}"
    return fallback


def reblog_observation(data: dict[str, Any], root_id: str) -> ReblogObservation | None:
    """Return the outer reblog identity/time, never the root post itself."""
    outer_id = normalize_id(data.get("id_string") or data.get("id"))
    if not outer_id or outer_id == root_id:
        return None
    blog = data.get("blog") or {}
    blog_name = blog.get("name") or data.get("blog_name")
    timestamp = data.get("timestamp")
    if not isinstance(blog_name, str) or not blog_name or not isinstance(timestamp, int):
        return None
    return ReblogObservation(blog=blog_name, post_id=outer_id, timestamp=timestamp)


def choose_root_snapshot(data: dict[str, Any], post_id: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]], int | None] | None:
    """Return (content, layout, root timestamp) for the root post snapshot."""
    for trail_item in data.get("trail") or []:
        post = trail_item.get("post") or {}
        if normalize_id(post.get("id")) != post_id:
            continue
        return (
            list(trail_item.get("content") or []),
            list(trail_item.get("layout") or []),
            post.get("timestamp") if isinstance(post.get("timestamp"), int) else None,
        )

    # Original-post JSON frequently has no trail entry for itself.
    if normalize_id(data.get("id_string") or data.get("id")) == post_id:
        timestamp = data.get("timestamp")
        return (
            list(data.get("content") or []),
            list(data.get("layout") or []),
            timestamp if isinstance(timestamp, int) else None,
        )

    return None


def media_extension(url: str) -> str:
    suffix = Path(urlparse(url).path).suffix.lower()
    return URL_EXTENSION_ALIASES.get(suffix, suffix or ".bin")


def media_file_name(post_id: str, content_item: dict[str, Any]) -> str | None:
    variants = content_item.get("media") or []
    if not variants or not isinstance(variants[0], dict):
        return None

    # Tumblr returns the original/largest candidate first in the snapshots this
    # importer targets.  This mirrors the old script, but now emits the actual
    # archive filename instead of the Tumblr media id fragment.
    media = variants[0]
    url = media.get("url")
    if not isinstance(url, str) or not url:
        return None

    basename = Path(urlparse(url).path).name
    if not basename:
        return None
    stem = Path(basename).stem
    extension = media_extension(url)
    return f"tumblr/{post_id}_{stem}{extension}"


def apply_text_formatting(text: str, formatting: Any, context: str) -> str:
    """Serialize Tumblr NPF inline formatting to the archive pseudo-markup.

    Tumblr permits differently-typed formatting ranges to overlap.  The output
    vocabulary is intentionally tiny and is rendered later from an allow-list;
    when ranges cross, tags are closed and reopened at the range boundary so the
    result remains properly nested while preserving the visual formatting.
    """
    if not formatting:
        return text
    if not isinstance(formatting, list):
        raise ValueError(f"Invalid formatting in {context}")

    def quoted_attribute(name: str, value: str) -> str:
        if "'" not in value:
            return f"{name}='{value}'"
        if '"' not in value:
            return f'{name}="{value}"'
        raise ValueError(f"Formatting attribute contains both quote types in {context}")

    spans: list[dict[str, Any]] = []
    for order, fmt in enumerate(formatting):
        if not isinstance(fmt, dict):
            raise ValueError(f"Invalid formatting entry in {context}")
        kind = fmt.get("type")
        start = fmt.get("start")
        end = fmt.get("end")
        if not isinstance(start, int) or not isinstance(end, int) or not (0 <= start <= end <= len(text)):
            raise ValueError(f"Invalid formatting range in {context}: {fmt!r}")
        if start == end:
            continue

        if kind == "bold":
            opening, closing = "<bold>", "</bold>"
        elif kind == "italic":
            opening, closing = "<italic>", "</italic>"
        elif kind == "strikethrough":
            opening, closing = "<strikethrough>", "</strikethrough>"
        elif kind == "small":
            opening, closing = "<small>", "</small>"
        elif kind == "link":
            url = fmt.get("url")
            if not isinstance(url, str):
                raise ValueError(f"Link without URL in {context}")
            opening, closing = f"<link {quoted_attribute('url', url)}>", "</link>"
        elif kind == "mention":
            blog = fmt.get("blog")
            url = blog.get("url") if isinstance(blog, dict) else None
            opening = f"<mention {quoted_attribute('url', url)}>" if isinstance(url, str) and url else "<mention>"
            closing = "</mention>"
        elif kind == "color":
            color = fmt.get("hex")
            if not isinstance(color, str) or not color.startswith("#") or len(color) != 7:
                raise ValueError(f"Invalid color formatting in {context}: {fmt!r}")
            opening, closing = f"<color {quoted_attribute('hex', color)}>", "</color>"
        else:
            raise ValueError(f"Unsupported formatting ({kind}) in {context}")
        spans.append({
            "start": start,
            "end": end,
            "opening": opening,
            "closing": closing,
            "order": order,
        })

    if not spans:
        return text

    boundaries = sorted({0, len(text), *(span["start"] for span in spans), *(span["end"] for span in spans)})
    previous: list[dict[str, Any]] = []
    output: list[str] = []

    for left, right in zip(boundaries, boundaries[1:]):
        active = [
            span for span in spans
            if span["start"] <= left and span["end"] >= right
        ]
        active.sort(key=lambda span: (span["start"], -span["end"], span["order"]))

        common = 0
        while common < len(previous) and common < len(active) and previous[common] is active[common]:
            common += 1

        for span in reversed(previous[common:]):
            output.append(span["closing"])
        for span in active[common:]:
            output.append(span["opening"])

        output.append(text[left:right])
        previous = active

    for span in reversed(previous):
        output.append(span["closing"])

    return "".join(output)


def normalize_layout(raw_layout: list[dict[str, Any]], content_to_media: dict[int, int], context: str) -> list[dict[str, Any]] | None:
    """Convert Tumblr NPF content indexes to stairs2line media indexes."""
    normalized: list[dict[str, Any]] = []

    for section in raw_layout:
        if not isinstance(section, dict):
            warn(f"ignoring malformed layout section in {context}")
            continue
        if section.get("type") != "rows":
            warn(f"ignoring unsupported Tumblr layout type {section.get('type')!r} in {context}")
            continue

        display: list[dict[str, list[int]]] = []
        for row in section.get("display") or []:
            if not isinstance(row, dict):
                continue
            mapped: list[int] = []
            for block in row.get("blocks") or []:
                if isinstance(block, int) and block in content_to_media:
                    media_index = content_to_media[block]
                    if media_index not in mapped:
                        mapped.append(media_index)
            # Text/other NPF blocks are deliberately removed: stairs2line's
            # Tumblr layout addresses only version.media indexes.
            if mapped:
                display.append({"blocks": mapped})

        if display:
            normalized.append({"type": "rows", "display": display})

    return normalized or None


def extract_snapshot(data: dict[str, Any], filename: str) -> Snapshot | None:
    post_id = root_post_id(data)
    if not post_id:
        return None

    root = choose_root_snapshot(data, post_id)
    if root is None:
        return None
    content, raw_layout, root_timestamp = root
    if root_timestamp is None:
        return None

    reblog = reblog_observation(data, post_id)

    description_parts: list[str] = []
    media: list[str] = []
    content_to_media: dict[int, int] = {}
    context = f"{post_id} ({filename})"

    for content_index, content_item in enumerate(content):
        if not isinstance(content_item, dict):
            warn(f"ignoring malformed content block in {context}")
            continue

        content_type = content_item.get("type")
        if content_type == "image":
            filename_value = media_file_name(post_id, content_item)
            if filename_value is None:
                warn(f"image without a usable URL in {context}")
                continue
            content_to_media[content_index] = len(media)
            media.append(filename_value)
        elif content_type == "text":
            text = content_item.get("text")
            if isinstance(text, str) and text:
                text = apply_text_formatting(text, content_item.get("formatting"), context)
                description_parts.append(text)
        else:
            warn(f"ignoring unsupported content type {content_type!r} in {context}")

    layout = normalize_layout(raw_layout, content_to_media, context)

    return Snapshot(
        post_id=post_id,
        published_at=root_timestamp,
        description="\n\n".join(description_parts),
        media=media,
        layout=layout,
        reblog=reblog,
        source_ref=source_ref(data, filename),
    )


def version_fingerprint(snapshot: Snapshot) -> str:
    # Use actual content, not just text length/media count.  Layout is part of a
    # version too, so a layout-only edit is preserved as a separate version.
    return json.dumps(
        {
            "description": snapshot.description,
            "media": snapshot.media,
            "layout": snapshot.layout,
        },
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )


def version_object(unique: UniqueVersion, language: str, include_provenance: bool = False) -> dict[str, Any]:
    snapshot = unique.snapshot
    ordered_reblogs = sorted(
        unique.reblogs.values(),
        key=lambda item: (item.timestamp, item.blog, item.post_id),
    )
    first_reblogged_at = unique.first_reblogged_at
    version: dict[str, Any] = {
        # The root post publication time and availability belong to the post,
        # not to an edited snapshot. Reblog evidence is version-specific.
        "firstRebloggedAt": iso_utc(first_reblogged_at) if first_reblogged_at is not None else None,
        "reblogs": [
            {"blog": item.blog, "id": item.post_id}
            for item in ordered_reblogs
        ],
    }

    if snapshot.description:
        version["description"] = {language: snapshot.description}
        if language != "default":
            version["originalLanguage"] = language

    if snapshot.media:
        version["media"] = snapshot.media
    if snapshot.layout:
        version["layout"] = snapshot.layout

    if include_provenance:
        version["migration"] = {"observedIn": sorted(unique.observed_in)}

    return version


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Regenerate Tumblr posts from JSON snapshots/reblogs while preserving "
            "alive/deleted statuses from the previous post file."
        )
    )
    parser.add_argument(
        "old_posts",
        type=Path,
        help="existing stairs2line Tumblr posts JSON/JSONC used for statuses and change reporting",
    )
    parser.add_argument("directory", type=Path, help="directory containing all Tumblr *.json snapshots/reblogs")
    parser.add_argument("-o", "--output", type=Path, help="write generated JSON here instead of stdout")
    parser.add_argument(
        "--language",
        default="ja",
        help="language key for extracted text (default: ja; use 'default' if unknown)",
    )
    parser.add_argument(
        "--include-provenance",
        action="store_true",
        help="store reblog snapshot references under versions[].migration.observedIn",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    input_dir: Path = args.directory
    if not input_dir.is_dir():
        print(f"Error: not a directory: {input_dir}", file=sys.stderr)
        return 1

    try:
        old_document = load_posts_document(args.old_posts)
    except Exception as error:
        print(f"Error: failed to read old post file {args.old_posts}: {error}", file=sys.stderr)
        return 1
    status_map = status_map_from_document(old_document)

    posts: dict[str, dict[str, Any]] = {}

    for file_path in sorted(input_dir.glob("*.json")):
        try:
            with file_path.open("r", encoding="utf-8") as file:
                data = json.load(file)
            snapshot = extract_snapshot(data, file_path.name)
        except Exception as error:
            print(f"Error: failed to process {file_path}: {error}", file=sys.stderr)
            return 1

        if snapshot is None:
            warn(f"could not find the root post snapshot in {file_path}")
            continue

        post = posts.setdefault(
            snapshot.post_id,
            {
                "published_at": snapshot.published_at,
                "versions": {},
            },
        )
        post["published_at"] = min(post["published_at"], snapshot.published_at)

        fingerprint = version_fingerprint(snapshot)
        versions: dict[str, UniqueVersion] = post["versions"]
        if fingerprint not in versions:
            versions[fingerprint] = UniqueVersion(snapshot=snapshot)
        versions[fingerprint].add_snapshot(snapshot)

    output_posts: list[dict[str, Any]] = []
    for post_id, grouped in sorted(posts.items(), key=lambda item: (item[1]["published_at"], item[0])):
        # Reblog timestamps are evidence for when a particular edited state
        # existed. A direct snapshot of the root post has only the root's
        # publication timestamp, so it must not pretend to date that version.
        # Root-only versions therefore sort after versions with reblog evidence.
        unique_versions: list[UniqueVersion] = sorted(
            grouped["versions"].values(),
            key=lambda version: (
                version.first_reblogged_at is None,
                version.first_reblogged_at if version.first_reblogged_at is not None else 0,
                version_fingerprint(version.snapshot),
            ),
        )

        output_posts.append(
            {
                "key": f"tumblr:{post_id}",
                "platform": "tumblr",
                "id": post_id,
                # Existing statuses are authoritative. Newly discovered root
                # posts default to alive until manually established otherwise.
                "status": status_map.get(post_id, "alive"),
                "publishedAt": iso_utc(grouped["published_at"]),
                "versions": [
                    version_object(unique, args.language, args.include_provenance)
                    for unique in unique_versions
                ],
            }
        )

    text = json.dumps({"posts": output_posts}, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(text, encoding="utf-8")
    else:
        sys.stdout.write(text)

    report_changes(old_document, output_posts)
    print(
        f"Imported {len(output_posts)} posts with {sum(len(post['versions']) for post in output_posts)} unique versions.",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
