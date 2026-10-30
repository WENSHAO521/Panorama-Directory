"""Frame every scholar portrait the same way: head and shoulders, face centred.

Photos arrive in all kinds of framings (studio headshots, full-body shots in a
landscape). This finds the face in each photo and writes a `photoCrop` line
into the scholar's Markdown front matter. The site then shows that 4:5 window
of the original photo everywhere (src/components/Portrait.astro); the photo
file itself is never changed.

Only scholars without a `photoCrop` line are processed, so a crop you adjust
by hand is kept. Delete the line to recompute it. Run after adding a scholar:
    pip install "opencv-python-headless<5" pyyaml
    npm run build:crops
"""
import re
from pathlib import Path

import cv2
import yaml

ROOT = Path(__file__).resolve().parent.parent
SCHOLARS = ROOT / "src/content/scholars"

ASPECT = 4 / 5  # width / height of every portrait frame on the site
FACE_HEIGHT = 0.27  # face height as a share of the frame height
FACE_X, FACE_Y = 0.5, 0.38  # where the face centre sits in the frame

cascade = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")


def find_face(img):
    h, w = img.shape[:2]
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    faces = cascade.detectMultiScale(gray, 1.1, 6, minSize=(w // 25, w // 25))
    if len(faces) == 0:
        return None
    return max(faces, key=lambda f: f[2])  # largest face


def crop_for(path):
    """Return (x, y, width) of the frame as fractions of the photo."""
    img = cv2.imread(str(path))
    h, w = img.shape[:2]
    face = find_face(img)
    max_h = min(h, w / ASPECT)
    if face is None:
        fh, fx, fy = max_h, w / 2, max_h * FACE_Y  # top-centred fallback
        crop_h = max_h
    else:
        x, y, fw, fh = face
        fx, fy = x + fw / 2, y + fh / 2
        crop_h = min(max_h, fh / FACE_HEIGHT)
    crop_w = crop_h * ASPECT
    left = min(max(fx - crop_w * FACE_X, 0), w - crop_w)
    top = min(max(fy - crop_h * FACE_Y, 0), h - crop_h)
    return round(left / w, 4), round(top / h, 4), round(crop_w / w, 4)


def main():
    for md in sorted(SCHOLARS.glob("*.md")):
        text = md.read_text(encoding="utf-8")
        front = yaml.safe_load(text.split("---")[1])
        if "photoCrop" in front:
            continue
        x, y, width = crop_for((md.parent / front["photo"]).resolve())
        line = f"photoCrop: {{ x: {x}, y: {y}, width: {width} }}"
        text = re.sub(r"^(photo: .*)$", rf"\1\n{line}", text, count=1, flags=re.M)
        md.write_text(text, encoding="utf-8")
        print(f"{md.stem}: {line}")


if __name__ == "__main__":
    main()
