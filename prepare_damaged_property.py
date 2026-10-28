from pathlib import Path
import shutil

src = Path(r"C:\Users\HP\UrbanPulse\datasets\yolo-detection\damaged_property_raw")
dst = Path(r"C:\Users\HP\UrbanPulse\datasets\yolo-detection\damaged_public_property")

# Original class IDs we want to keep
keep = {5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15}

for split in ["train", "valid", "test"]:
    src_images = src / split / "images"
    src_labels = src / split / "labels"

    dst_images = dst / split / "images"
    dst_labels = dst / split / "labels"

    dst_images.mkdir(parents=True, exist_ok=True)
    dst_labels.mkdir(parents=True, exist_ok=True)

    if not src_labels.exists():
        continue

    for label_file in src_labels.glob("*.txt"):
        selected = []

        for line in label_file.read_text().splitlines():
            parts = line.split()

            if len(parts) >= 5:
                class_id = int(parts[0])

                if class_id in keep:
                    selected.append("0 " + " ".join(parts[1:]))

        if selected:
            image_found = None

            for ext in [".jpg", ".jpeg", ".png", ".webp"]:
                candidate = src_images / (label_file.stem + ext)
                if candidate.exists():
                    image_found = candidate
                    break

            if image_found:
                shutil.copy2(image_found, dst_images / image_found.name)
                (dst_labels / label_file.name).write_text("\n".join(selected) + "\n")

# Create new YAML
yaml = """train: ../train/images
val: ../valid/images
test: ../test/images

nc: 1
names: ['damaged_public_property']
"""

(dst / "data.yaml").write_text(yaml)

print("DONE - damaged_public_property dataset created.")
