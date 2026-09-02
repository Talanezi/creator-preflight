"""Command-line adapter for the shared Creator Preflight scanner."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Sequence

from creator_preflight.config import ConfigurationError, PreflightConfig, load_config
from creator_preflight.detectors import DetectorExecutionError
from creator_preflight.engine import PreflightScanner
from creator_preflight.media import MediaInspectionError
from creator_preflight.models import FindingStatus, PreflightReport, PublishingPackage


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="creator-preflight")
    subparsers = parser.add_subparsers(dest="command", required=True)
    scan_parser = subparsers.add_parser("scan", help="scan one local creator video")
    scan_parser.add_argument("video_path", type=Path)
    scan_parser.add_argument("--title", default="")
    description_group = scan_parser.add_mutually_exclusive_group()
    description_group.add_argument("--description", default=None)
    description_group.add_argument("--description-file", type=Path)
    scan_parser.add_argument("--captions", type=Path)
    scan_parser.add_argument("--config", type=Path)
    scan_parser.add_argument("--json", action="store_true", dest="json_output")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.command != "scan":
        parser.error("a command is required")

    try:
        description = _load_description(args.description, args.description_file)
        if args.captions is not None and not args.captions.is_file():
            raise CliInputError(f"Captions path is not a file: {args.captions}")
        config = load_config(args.config) if args.config else PreflightConfig()
        report = PreflightScanner(
            config=config,
            configuration_source=str(args.config) if args.config else "typed defaults",
        ).scan(
            args.video_path,
            PublishingPackage(
                title=args.title,
                description=description,
                captions_path=args.captions,
            ),
        )
    except (
        CliInputError,
        ConfigurationError,
        DetectorExecutionError,
        MediaInspectionError,
        OSError,
    ) as exc:
        message = getattr(exc, "message", str(exc))
        print(f"creator-preflight: {message}", file=sys.stderr)
        return 2

    if args.json_output:
        print(report.model_dump_json())
    else:
        print(format_human_report(report))
    return 0 if report.verdict is FindingStatus.READY else 1


class CliInputError(Exception):
    pass


def _load_description(direct: str | None, path: Path | None) -> str:
    if path is not None:
        if not path.is_file():
            raise CliInputError(f"Description path is not a file: {path}")
        return path.read_text(encoding="utf-8")
    return direct or ""


def format_human_report(report: PreflightReport) -> str:
    media = report.media
    dimensions = (
        f"{media.width}x{media.height}"
        if media.width is not None and media.height is not None
        else "unknown dimensions"
    )
    duration = _format_duration(media.duration_seconds)
    lines = [
        "CREATOR PREFLIGHT",
        "",
        report.verdict.value.replace("_", " "),
        "",
        "Media",
        f"{dimensions} • {media.video_codec or 'no video'} • "
        f"{media.audio_codec or 'no audio'} • {duration}",
        "",
        f"PASS  {report.passed_check_count} checks",
        f"WARN  {report.warning_count}",
        f"FAIL  {report.critical_count}",
    ]
    for finding in report.findings:
        label = "FAIL" if finding.status is FindingStatus.BLOCKED else "WARN"
        location = _format_finding_location(finding)
        title = (
            str(finding.details.get("title"))
            if finding.details and finding.details.get("title")
            else finding.message
        )
        lines.append(f"{label:<5} {location:<23} {title}")
    return "\n".join(lines)


def _format_duration(seconds: float | None) -> str:
    if seconds is None:
        return "unknown duration"
    total_seconds = max(0, round(seconds))
    hours, remainder = divmod(total_seconds, 3600)
    minutes, second = divmod(remainder, 60)
    return (
        f"{hours:02d}:{minutes:02d}:{second:02d}"
        if hours
        else f"{minutes:02d}:{second:02d}"
    )


def _format_finding_location(finding) -> str:
    start = finding.timestamp_start_seconds
    end = finding.timestamp_end_seconds
    if start is None:
        return "PACKAGE"
    if end is None:
        return _format_timestamp(start)
    return f"{_format_timestamp(start)}–{_format_timestamp(end)}"


def _format_timestamp(seconds: float) -> str:
    minutes, second = divmod(seconds, 60)
    return f"{int(minutes):02d}:{second:05.2f}"


if __name__ == "__main__":
    raise SystemExit(main())
