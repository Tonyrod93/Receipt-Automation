"""Read receipt data only. Never execute embedded content or follow PDF links."""
import io
import json
import pathlib
import subprocess
import sys
import tempfile
import warnings

warnings.filterwarnings("error")
MAX_BYTES = 10 * 1024 * 1024
MAX_PAGES = 10


def ocr(image):
    if image.width * image.height > 25_000_000:
        raise ValueError("image_limits")
    with tempfile.TemporaryDirectory(prefix="receipt-ocr-") as temp:
        image_path = pathlib.Path(temp) / "page.png"
        image.convert("RGB").save(image_path)
        result = subprocess.run(
            ["tesseract", str(image_path), "stdout", "--psm", "3"],
            capture_output=True, timeout=40, check=True,
        )
        return result.stdout.decode("utf-8")


def read_document(filename):
    data = pathlib.Path(filename).read_bytes()
    if not data or len(data) > MAX_BYTES:
        raise ValueError("file_limits")
    if data.startswith(b"%PDF-"):
        import pypdf
        import pypdfium2 as pdfium
        reader = pypdf.PdfReader(io.BytesIO(data))
        if reader.is_encrypted or not 0 < len(reader.pages) <= MAX_PAGES:
            raise ValueError("pdf_limits")
        root = reader.trailer["/Root"]
        opening = root.get("/OpenAction")
        opening = opening.get_object() if opening is not None else None
        # An array is an ordinary initial page/zoom destination, not executable code.
        if "/AA" in root or isinstance(opening, dict) and opening.get("/S") not in [None, "/GoTo"]:
            raise ValueError("active_pdf")
        names = root.get("/Names", {})
        names = names.get_object() if hasattr(names, "get_object") else names
        if any(key in names for key in ["/JavaScript", "/EmbeddedFiles"]):
            raise ValueError("active_pdf")
        forms = root.get("/AcroForm", {})
        forms = forms.get_object() if hasattr(forms, "get_object") else forms
        if "/XFA" in forms:
            raise ValueError("active_pdf")
        texts = []
        images = pdfium.PdfDocument(data)
        for index, page in enumerate(reader.pages):
            text = page.extract_text() or ""
            # Text extraction handles ordinary PDFs; OCR independently covers logos,
            # scanned pages and missing/misordered text layers. Compare downstream.
            rendered = images[index]
            width, height = rendered.get_size()
            if width * height * 4 > 25_000_000:
                raise ValueError("page_limits")
            raster = rendered.render(scale=2).to_pil()
            scanned = ocr(raster)
            texts.append(f"PAGE {index + 1} TEXT\n{text}\nPAGE {index + 1} OCR\n{scanned}")
        return {"mime": "application/pdf", "pages": len(texts), "text": "\n".join(texts)}
    from PIL import Image
    Image.MAX_IMAGE_PIXELS = 25_000_000
    image = Image.open(io.BytesIO(data))
    mime = {"PNG": "image/png", "JPEG": "image/jpeg", "WEBP": "image/webp"}.get(image.format)
    if not mime or getattr(image, "n_frames", 1) != 1:
        raise ValueError("unsupported_image")
    return {"mime": mime, "pages": 1, "text": ocr(image)}


if __name__ == "__main__":
    try:
        print(json.dumps(read_document(sys.argv[1])))
    except Exception:
        # No document text, names, provider errors or values in runner logs.
        print(json.dumps({"error": "document_needs_review"}))
        sys.exit(2)
