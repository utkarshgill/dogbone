"""Extract the selected board instance for KiCad's footprint plotter."""
import json
import re


def footprint_for_plot(document, reference):
    property_name = re.escape(json.dumps(reference, ensure_ascii=False).encode())
    matching_ref = re.compile(rb'\(property\s+"Reference"\s+' + property_name + rb'(?=\s|\))')
    depth, start = 0, None
    for token in re.finditer(rb'"(?:\\.|[^"\\])*"|[()]', document):
        if token[0] == b"(":
            if depth == 1 and document.startswith(b"(footprint ", token.start()):
                start = token.start()
            depth += 1
        elif token[0] == b")":
            depth -= 1
            if depth == 1 and start is not None:
                entry = document[start:token.end()]
                start = None
                if matching_ref.search(entry):
                    version = re.search(rb'\(version [0-9]+\)', document)[0]
                    entry = re.sub(rb'^\(footprint "(?:\\.|[^"\\])*"',
                                   b'(footprint "preview"\n' + version + b'\n(generator "pcbnew")', entry)
                    return re.sub(rb'\(at [^()\s]+ [^()\s]+', b'(at 0 0', entry, count=1)
