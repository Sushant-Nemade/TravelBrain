import os
import subprocess
import sys
import tarfile
import tempfile
import zipfile
from pathlib import Path


def main():
    wheel = next(Path("dist").glob("*.whl"))
    source = next(Path("dist").glob("*.tar.gz"))
    with zipfile.ZipFile(wheel) as archive:
        names = archive.namelist()
        for name in (
            "src/web.py",
            "src/site/index.html",
            "src/site/catalog.json",
            "src/site/NOTICE.md",
            "src/site/licenses.json",
            "src/site/assets/paris.jpg",
        ):
            assert name in names, name
        assert "src/graph/runner.py" not in names
        assert not any(name.endswith((".sqlite", ".pem", "/.env")) for name in names)
    with tarfile.open(source) as archive:
        names = archive.getnames()
        for suffix in (
            "frontend/package-lock.json",
            "frontend/static/js/engine.js",
            "tests/test_browser_parity.py",
            "uv.lock",
            "LICENSE",
            "NOTICE.md",
        ):
            assert any(name.endswith("/" + suffix) for name in names), suffix
        assert not any(
            "/node_modules/" in name or name.endswith((".sqlite", ".pem", "/.env")) for name in names
        )
    with tempfile.TemporaryDirectory() as directory:
        target = Path(directory) / "installed"
        subprocess.run(
            [
                sys.executable,
                "-m",
                "pip",
                "install",
                "--no-deps",
                "--target",
                str(target),
                str(wheel.resolve()),
            ],
            check=True,
        )
        environment = {
            **os.environ,
            "PYTHONPATH": str(target),
            "TRAVEL_API_TOKEN": "",
            "TRAVEL_AI_ENABLED": "0",
            "TRAVEL_LIVE_WEATHER": "0",
        }
        code = "from fastapi.testclient import TestClient; from src.web import create_app; from pathlib import Path; import src; assert 'installed' in str(Path(src.__file__)); connection=TestClient(create_app()); connection.__enter__(); assert connection.get('/').status_code==200; assert connection.get('/api/sample').status_code==200; assert connection.get('/assets/paris.jpg').status_code==200; assert connection.get('/api/trips').status_code==503; connection.__exit__(None,None,None); print('Installed UI/API verified outside checkout')"
        subprocess.run([sys.executable, "-c", code], cwd=directory, env=environment, check=True)
    print("Wheel/source completeness and private-state exclusions passed.")


if __name__ == "__main__":
    main()
