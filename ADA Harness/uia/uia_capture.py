"""
============================================================================
ADA Harness - Windows UI Automation (UIA) Capture
============================================================================

Purpose
-------
Validate what Windows Assistive Technologies (Narrator, JAWS, NVDA) actually
receive by reading the *Windows* accessibility tree via the UI Automation API.

This script is invoked once per page by scripts/uia-scan.ts. The TypeScript
side owns the browser lifecycle (it opens a real, visible Chromium window and
navigates to the route); this script only:

  1. Connects to the running browser window (by Win32 class name + title).
  2. Walks the Windows accessibility subtree.
  3. Emits a JSON node tree of names, roles (control types), automation ids,
     and hierarchy to STDOUT.

Output contract (STDOUT, single JSON object):
  { "available": bool, "found": bool, "window": str,
    "nodeCount": int, "tree": {..} | null, "error": str? }

Exit codes:
  0  success (see JSON payload for details)
  2  uiautomation package not installed (Windows-only dependency)

Install the dependency with:  pip install uiautomation
============================================================================
"""

import sys
import json
import argparse

try:
    import uiautomation as auto
except Exception as exc:  # ImportError on non-Windows / missing dep.
    print(json.dumps({
        "available": False,
        "found": False,
        "nodeCount": 0,
        "tree": None,
        "error": "uiautomation not available: {} (run: pip install uiautomation)".format(exc),
    }))
    sys.exit(2)


def _safe(getter, default=None):
    """Read a UIA property defensively (some controls raise on access)."""
    try:
        return getter()
    except Exception:
        return default


def walk(control, depth, max_depth):
    """Recursively convert a UIA control into a plain dict node.

    Every property read is defensive (via _safe): on a real, dynamic web page
    a control can go stale mid-walk (removed/replaced by app JS while we're
    reading it), and Name/ControlTypeName/AutomationId/ClassName can raise
    just as readily as the properties already wrapped below. An unhandled
    exception here previously aborted the ENTIRE capture for the page (losing
    every other node already walked), instead of just skipping the one bad
    control.
    """
    rect = _safe(lambda: control.BoundingRectangle)
    bounding = None
    if rect is not None:
        bounding = {
            "left": getattr(rect, "left", 0),
            "top": getattr(rect, "top", 0),
            "right": getattr(rect, "right", 0),
            "bottom": getattr(rect, "bottom", 0),
        }
    node = {
        "name": _safe(lambda: control.Name, "") or "",
        "role": _safe(lambda: control.ControlTypeName, "") or "",
        "automationId": _safe(lambda: control.AutomationId, "") or "",
        "className": _safe(lambda: control.ClassName, "") or "",
        # Extra properties consumed by the accessibility Rule Engine.
        "isEnabled": _safe(lambda: bool(control.IsEnabled)),
        "isKeyboardFocusable": _safe(lambda: bool(control.IsKeyboardFocusable)),
        "isOffscreen": _safe(lambda: bool(control.IsOffscreen)),
        "boundingRectangle": bounding,
        "children": [],
    }
    if depth < max_depth:
        try:
            for child in control.GetChildren():
                node["children"].append(walk(child, depth + 1, max_depth))
        except Exception:
            # A control can disappear mid-walk; skip its subtree rather than fail.
            pass
    return node


def count_nodes(node):
    """Count total nodes in a captured tree."""
    return 1 + sum(count_nodes(child) for child in node["children"])


def find_window(window_class, title_contains):
    """Find the best-matching top-level browser window."""
    root = auto.GetRootControl()
    fallback = None
    for window, _depth in auto.WalkControl(root, maxDepth=1):
        try:
            same_class = (not window_class) or (window.ClassName == window_class)
        except Exception:
            same_class = False
        if not same_class:
            continue
        name = (_safe(lambda: window.Name, "") or "").lower()
        if not title_contains or title_contains.lower() in name:
            return window
        if fallback is None:
            fallback = window
    return fallback


def main():
    parser = argparse.ArgumentParser(description="Capture the Windows UIA tree for a browser window.")
    parser.add_argument("--window-class", default="Chrome_WidgetWin_1",
                        help="Win32 class name of the browser window.")
    parser.add_argument("--title", default="",
                        help="Substring of the window title used to disambiguate tabs.")
    parser.add_argument("--max-depth", type=int, default=40,
                        help="Maximum depth to walk the accessibility tree.")
    args = parser.parse_args()

    # Keep searches snappy so the orchestrator does not stall.
    auto.SetGlobalSearchTimeout(3)

    window = find_window(args.window_class, args.title)
    if window is None:
        print(json.dumps({
            "available": True,
            "found": False,
            "nodeCount": 0,
            "tree": None,
            "error": "No matching browser window (class='{}', title~='{}')".format(
                args.window_class, args.title),
        }))
        return

    # Capture the window name BEFORE the walk, not after — the walk of a large
    # tree takes real time, during which the window can close or navigate away,
    # so re-reading window.Name afterwards is exactly the kind of stale-control
    # access this script otherwise guards against.
    window_name = _safe(lambda: window.Name, "") or ""
    tree = walk(window, 0, args.max_depth)
    print(json.dumps({
        "available": True,
        "found": True,
        "window": window_name,
        "nodeCount": count_nodes(tree),
        "tree": tree,
    }))


if __name__ == "__main__":
    main()
