import argparse
import json
import shutil
from pathlib import Path

from src.catalog import CATALOG_VERSION, DESTINATIONS
from src.web import sample_plans


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--package", action="store_true")
    options = parser.parse_args()
    if options.package:
        site = Path("frontend/dist")
        required = ["index.html", "catalog.json", "demo.json", "LICENSE", "NOTICE.md", "licenses.json"]
        if any(not (site / name).is_file() for name in required):
            raise ValueError("Build the complete frontend with legal assets before packaging.")
        target = Path("src/site")
        if target.exists():
            shutil.rmtree(target)
        shutil.copytree(site, target)
        return
    public = Path("frontend/public")
    public.mkdir(parents=True, exist_ok=True)
    (public / "catalog.json").write_text(
        json.dumps({"version": CATALOG_VERSION, "destinations": DESTINATIONS}), encoding="utf-8"
    )
    (public / "demo.json").write_text(json.dumps(sample_plans()), encoding="utf-8")
    for filename in ("LICENSE", "NOTICE.md"):
        if Path(filename).exists():
            shutil.copy2(filename, public / filename)


if __name__ == "__main__":
    main()
