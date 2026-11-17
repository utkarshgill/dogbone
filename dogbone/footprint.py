"""Prepare KiCad board data for preview plots."""
import json
import re


def _blocks(document, *names):
    tag = re.compile(rb'\(\s*(?:' + b'|'.join(names) + rb')(?=\s|\))')
    depth, start = 0, None
    for token in re.finditer(rb'"(?:\\.|[^"\\])*"|[()]', document):
        if token[0] == b"(":
            if depth == 1 and tag.match(document, token.start()):
                start = token.start()
            depth += 1
        elif token[0] == b")":
            depth -= 1
            if depth == 1 and start is not None:
                yield start, token.end()
                start = None


def without_zone_fills(document):
    pieces = []
    previous = 0
    for start, end in _blocks(document, b'zone'):
        for begin, finish in _blocks(document[start:end], b'filled_polygon', b'fill_segments'):
            pieces.append(document[previous:start + begin])
            previous = start + finish
    return b''.join((*pieces, document[previous:]))


def footprint_for_plot(document, reference):
    property_name = re.escape(json.dumps(reference, ensure_ascii=False).encode())
    matching_ref = re.compile(rb'\(property\s+"Reference"\s+' + property_name + rb'(?=\s|\))')
    for start, end in _blocks(document, b'footprint'):
        entry = document[start:end]
        if matching_ref.search(entry):
            version = re.search(rb'\(version [0-9]+\)', document)[0]
            entry = re.sub(rb'^\(footprint "(?:\\.|[^"\\])*"',
                           b'(footprint "preview"\n' + version + b'\n(generator "pcbnew")', entry)
            return re.sub(rb'\(at [^()\s]+ [^()\s]+', b'(at 0 0', entry, count=1)
