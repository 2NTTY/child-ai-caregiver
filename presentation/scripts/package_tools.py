"""Small, local OOXML packaging and inspection utilities; no Office automation."""
import collections
import hashlib
import html
import json
import posixpath
from pathlib import Path
import re
import sys
import xml.etree.ElementTree as ET
import zipfile

NS = {
    "p": "http://schemas.openxmlformats.org/presentationml/2006/main",
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "rel": "http://schemas.openxmlformats.org/package/2006/relationships",
    "ct": "http://schemas.openxmlformats.org/package/2006/content-types",
    "asvg": "http://schemas.microsoft.com/office/drawing/2016/SVG/main",
}
for prefix, uri in NS.items():
    ET.register_namespace(prefix, uri)


def xml_bytes(root):
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def embed(source, target, map_file):
    with zipfile.ZipFile(source) as source_zip:
        data = {name: source_zip.read(name) for name in source_zip.namelist()}
    grouped = collections.defaultdict(list)
    for entry in json.loads(Path(map_file).read_text(encoding="utf-8")):
        grouped[entry["slide"]].append(entry)
    content_types = ET.fromstring(data["[Content_Types].xml"])
    if not any(node.attrib.get("Extension") == "svg" for node in content_types):
        ET.SubElement(content_types, f"{{{NS['ct']}}}Default", Extension="svg", ContentType="image/svg+xml")
    for number, entries in grouped.items():
        part = f"ppt/slides/slide{number}.xml"
        relationships = f"ppt/slides/_rels/slide{number}.xml.rels"
        slide, rels = ET.fromstring(data[part]), ET.fromstring(data[relationships])
        pictures = slide.findall(".//p:pic", NS)
        if len(pictures) != len(entries):
            raise ValueError(f"Unexpected image count on slide {number}: {len(pictures)} != {len(entries)}")
        ids = {node.attrib["Id"] for node in rels}
        for index, (pic, entry) in enumerate(zip(pictures, entries), 1):
            # Normalize explicit picture geometry/crop discarded by Artifact Tool's contain export.
            position = entry["position"]
            transform = pic.find("p:spPr/a:xfrm", NS)
            off, ext = transform.find("a:off", NS), transform.find("a:ext", NS)
            off.attrib.update(x=str(round(position["left"] * 9525)), y=str(round(position["top"] * 9525)))
            ext.attrib.update(cx=str(round(position["width"] * 9525)), cy=str(round(position["height"] * 9525)))
            if entry.get("crop"):
                fill = pic.find("p:blipFill", NS)
                rectangle = fill.find("a:srcRect", NS)
                if rectangle is None:
                    rectangle = ET.Element(f"{{{NS['a']}}}srcRect")
                    fill.insert(1, rectangle)
                rectangle.attrib.update({short: str(round(entry["crop"].get(long, 0) * 100000)) for short, long in [("l", "left"), ("t", "top"), ("r", "right"), ("b", "bottom")]})
            if not entry["svg"]:
                continue
            asset = Path(entry["svg"]).read_bytes()
            media = f"ppt/media/visual-{hashlib.sha256(asset).hexdigest()[:20]}.svg"
            data[media] = asset
            rel_id = f"rIdVector{index}"
            if rel_id in ids:
                raise ValueError("Duplicate vector relationship")
            ET.SubElement(rels, f"{{{NS['rel']}}}Relationship", Id=rel_id,
                          Type=f"{NS['r']}/image", Target="../media/" + Path(media).name)
            blip = pic.find("p:blipFill/a:blip", NS)
            extension_list = blip.find("a:extLst", NS)
            if extension_list is None:
                extension_list = ET.SubElement(blip, f"{{{NS['a']}}}extLst")
            extension = ET.SubElement(extension_list, f"{{{NS['a']}}}ext", uri="{96DAC541-7B7A-43D3-8B79-37D633B846F1}")
            ET.SubElement(extension, f"{{{NS['asvg']}}}svgBlip", {f"{{{NS['r']}}}embed": rel_id})
        data[part], data[relationships] = xml_bytes(slide), xml_bytes(rels)
    ET.register_namespace("", NS["ct"])
    data["[Content_Types].xml"] = xml_bytes(content_types)
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as output:
        for name, value in data.items():
            output.writestr(name, value)
    print(json.dumps({"embeddedSvgCount": sum(bool(x["svg"]) for group in grouped.values() for x in group)}))


def slides_in_order(data):
    presentation = ET.fromstring(data["ppt/presentation.xml"])
    rels = {r.attrib["Id"]: r.attrib["Target"] for r in ET.fromstring(data["ppt/_rels/presentation.xml.rels"])}
    for entry in presentation.findall("p:sldIdLst/p:sldId", NS):
        target = rels[entry.attrib[f"{{{NS['r']}}}id"]]
        yield posixpath.normpath(posixpath.join("ppt", target)) if not target.startswith("/") else target[1:]


def inspect(pptx, expected):
    with zipfile.ZipFile(pptx) as archive:
        if archive.testzip():
            raise ValueError("Corrupt ZIP member")
        data = {name: archive.read(name) for name in archive.namelist()}
    pres = ET.fromstring(data["ppt/presentation.xml"])
    size = pres.find("p:sldSz", NS).attrib
    assert int(size["cx"]) * 9 == int(size["cy"]) * 16, "Slide size is not 16:9"
    slides = list(slides_in_order(data))
    assert len(slides) == int(expected), "Unexpected slide count"
    results = []
    for number, part in enumerate(slides, 1):
        tree = ET.fromstring(data[part])
        texts = [x.text or "" for x in tree.findall(".//a:t", NS)]
        text_shapes = [x for x in tree.findall(".//p:sp", NS) if x.findall(".//a:t", NS)]
        assert text_shapes, f"Slide {number} is not editable text"
        vectors = tree.findall(".//asvg:svgBlip", NS)
        results.append({"slide": number, "nativeTextShapes": len(text_shapes), "vectorImages": len(vectors), "text": texts})
    note_count = len([x for x in data if re.fullmatch(r"ppt/notesSlides/notesSlide\d+\.xml", x)])
    assert note_count == len(slides), "Missing speaker notes"
    return {"passed": True, "slides": len(slides), "sizeEmu": size, "notes": note_count,
            "vectorImages": sum(x["vectorImages"] for x in results), "slideDetails": results}


def assets(asset_root):
    result = []
    banned = {"script", "image", "foreignObject", "filter", "iframe", "style"}
    for file in sorted(Path(asset_root).rglob("*.svg")):
        raw = file.read_text(encoding="utf-8")
        assert "<!DOCTYPE" not in raw and "<!ENTITY" not in raw, f"Unsafe XML: {file}"
        tree = ET.fromstring(raw)
        assert tree.tag == "{http://www.w3.org/2000/svg}svg", f"Not an SVG: {file}"
        box = [float(n) for n in tree.attrib["viewBox"].split()]
        assert len(box) == 4 and box[2] > 0 and box[3] > 0
        seen, paths = set(), 0
        for node in tree.iter():
            local = node.tag.split("}")[-1]
            assert local not in banned, f"Forbidden {local}: {file}"
            if local == "path":
                paths += 1
            for key, value in node.attrib.items():
                name = key.split("}")[-1]
                assert not name.lower().startswith("on"), f"Event handler: {file}"
                assert not re.search(r"(?:https?:|data:|javascript:|@import)", value, re.I), f"External resource: {file}"
                if name == "href":
                    assert value.startswith("#"), f"External href: {file}"
            if "id" in node.attrib:
                assert node.attrib["id"] not in seen, f"Duplicate ID: {file}"
                seen.add(node.attrib["id"])
        assert paths <= 180, f"Excessive path count: {file}"
        assert tree.find("{http://www.w3.org/2000/svg}title") is not None
        assert tree.find("{http://www.w3.org/2000/svg}desc") is not None
        result.append({"file": file.relative_to(asset_root).as_posix(), "bytes": file.stat().st_size, "paths": paths, "viewBox": box, "sha256": hashlib.sha256(file.read_bytes()).hexdigest()})
    assert result, "No SVG assets found"
    return {"passed": True, "count": len(result), "assets": result}


def color(parent, default="transparent"):
    if parent is None:
        return default
    node = parent.find("a:srgbClr", NS)
    if node is not None:
        return "#" + node.attrib["val"]
    return default


def frame(node):
    transform = node.find("p:spPr/a:xfrm", NS)
    if transform is None:
        return None
    off, ext = transform.find("a:off", NS), transform.find("a:ext", NS)
    return [int(off.attrib["x"]) / 9525, int(off.attrib["y"]) / 9525,
            int(ext.attrib["cx"]) / 9525, int(ext.attrib["cy"]) / 9525]


def html_preview(pptx, destination):
    output = Path(destination)
    (output / "media").mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(pptx) as archive:
        data = {name: archive.read(name) for name in archive.namelist()}
    pres = ET.fromstring(data["ppt/presentation.xml"])
    size = pres.find("p:sldSz", NS).attrib
    width, height = int(size["cx"]) / 9525, int(size["cy"]) / 9525
    pages, text_count = [], 0
    for number, part in enumerate(slides_in_order(data), 1):
        tree = ET.fromstring(data[part])
        rel_path = posixpath.dirname(part) + "/_rels/" + posixpath.basename(part) + ".rels"
        rels = {r.attrib["Id"]: r.attrib["Target"] for r in ET.fromstring(data[rel_path])}
        background = color(tree.find("p:cSld/p:bg/p:bgPr/a:solidFill", NS), "#FFFFFF")
        elements = []
        for node in tree.find("p:cSld/p:spTree", NS):
            box = frame(node)
            if not box:
                continue
            x, y, w, h = box
            position = f"left:{x}px;top:{y}px;width:{w}px;height:{h}px"
            if node.tag == f"{{{NS['p']}}}pic":
                blip = node.find("p:blipFill/a:blip", NS)
                target = rels[blip.attrib[f"{{{NS['r']}}}embed"]]
                media_part = target.lstrip("/") if target.startswith("/") else posixpath.normpath(posixpath.join(posixpath.dirname(part), target))
                filename = Path(media_part).name
                (output / "media" / filename).write_bytes(data[media_part])
                crop_node = node.find("p:blipFill/a:srcRect", NS)
                crop = {k: int(crop_node.attrib.get(k, 0)) / 100000 for k in ["l", "r", "t", "b"]} if crop_node is not None else {k: 0 for k in ["l", "r", "t", "b"]}
                iw, ih = w / (1 - crop["l"] - crop["r"]), h / (1 - crop["t"] - crop["b"])
                inner = f"position:absolute;left:{-crop['l'] * iw}px;top:{-crop['t'] * ih}px;width:{iw}px;height:{ih}px"
                elements.append(f'<div class="obj" style="{position};overflow:hidden"><img style="{inner}" src="media/{html.escape(filename)}" alt=""/></div>')
                continue
            fill = color(node.find("p:spPr/a:solidFill", NS))
            line = node.find("p:spPr/a:ln", NS)
            stroke = color(line.find("a:solidFill", NS)) if line is not None else "transparent"
            stroke_width = int(line.attrib.get("w", 0)) / 9525 if line is not None else 0
            body = node.find("p:txBody", NS)
            if body is None or not body.findall(".//a:t", NS):
                elements.append(f'<div class="obj" style="{position};background:{fill};border:{stroke_width}px solid {stroke}"></div>')
                continue
            text_count += 1
            paragraphs = []
            body_pr = body.find("a:bodyPr", NS)
            padding = [int(body_pr.attrib.get(k, 0)) / 9525 for k in ["tIns", "rIns", "bIns", "lIns"]]
            for paragraph in body.findall("a:p", NS):
                ppr = paragraph.find("a:pPr", NS)
                default_rpr = ppr.find("a:defRPr", NS) if ppr is not None else None
                alignment = {"ctr": "center", "r": "right"}.get(ppr.attrib.get("algn", "l") if ppr is not None else "l", "left")
                spacing = paragraph.find("a:pPr/a:lnSpc/a:spcPct", NS)
                leading = int(spacing.attrib["val"]) / 100000 if spacing is not None else 1.18
                runs = []
                for run in paragraph:
                    if run.tag == f"{{{NS['a']}}}br":
                        runs.append("<br>")
                        continue
                    text_node = run.find("a:t", NS)
                    if text_node is None:
                        continue
                    rp = run.find("a:rPr", NS)
                    if rp is None:
                        rp = default_rpr
                    attrs = rp.attrib if rp is not None else {}
                    size_px = int(attrs.get("sz", "1800")) / 100 * 96 / 72
                    face = rp.find("a:latin", NS) if rp is not None else None
                    family = face.attrib.get("typeface", "Microsoft JhengHei") if face is not None else "Microsoft JhengHei"
                    foreground = color(rp.find("a:solidFill", NS), "#203E3A") if rp is not None else "#203E3A"
                    style = f"font-family:'{html.escape(family, quote=True)}';font-size:{size_px}px;color:{foreground};font-weight:{700 if attrs.get('b') == '1' else 400}"
                    runs.append(f'<span style="{style}">{html.escape(text_node.text or "")}</span>')
                paragraphs.append(f'<p style="text-align:{alignment};line-height:{leading}">{"".join(runs)}</p>')
            padding_css = " ".join(f"{value}px" for value in padding)
            elements.append(f'<div class="obj text" data-slide="{number}" style="{position};padding:{padding_css};background:{fill}">{"".join(paragraphs)}</div>')
        pages.append(f'<section class="slide" id="slide-{number}" style="width:{width}px;height:{height}px;background:{background}">{"".join(elements)}</section>')
    document = '<!doctype html><html lang="zh-HK"><meta charset="utf-8"><title>PPTX layout preview</title><style>body{margin:0;background:#e4e6e3}*{box-sizing:border-box}.slide{position:relative;margin-bottom:24px;overflow:hidden}.obj{position:absolute}img{object-fit:contain}.text{overflow:visible;white-space:pre-wrap;overflow-wrap:normal}p{margin:0}</style><body>' + "".join(pages) + "</body></html>"
    (output / "index.html").write_text(document, encoding="utf-8")
    return {"slides": len(pages), "nativeTextShapes": text_count, "method": "OOXML text/picture geometry rendered by browser; not desktop PowerPoint", "html": str(output / "index.html")}


if __name__ == "__main__":
    command, *args = sys.argv[1:]
    if command == "embed":
        embed(*args)
    elif command == "inspect":
        print(json.dumps(inspect(*args), ensure_ascii=False))
    elif command == "assets":
        print(json.dumps(assets(*args), ensure_ascii=False))
    elif command == "preview":
        print(json.dumps(html_preview(*args), ensure_ascii=False))
    else:
        raise ValueError("Unknown command")
